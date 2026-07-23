import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");
const serviceSource = await readFile(path.join(ROOT, "services/RemoteOcrProcessingService.gs"), "utf8");

const RUNTIME = Object.freeze({
  nodeVersion: "22.17.0", ocrEngineName: "tesseract", ocrEngineVersion: "5.3.4",
  pdfInfoVersion: "25.6.0", pdfToPpmVersion: "25.6.0",
  imagePipelineVersion: "raster-homography-1.0.0",
  containerBuildId: "synthetic-build-1", pdfToolsUsed: false
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function candidateInputs() {
  return Array.from({ length: 40 }, (_, index) => ({
    rowIndex: index + 1,
    rawDigits: String(index).padStart(5, "0"),
    digitConfidences: [0.9, 0.9, 0.9, 0.9, 0.9],
    overallConfidence: 0.9,
    technicalFlags: index === 0 ? ["PAGE_ALIGNMENT_REVIEW_REQUIRED"] : []
  }));
}

function createHarness({
  existingCandidates = [], completedBatch = null, failFirstStore = false,
  failFirstRead = false, failCompletionAuditOnce = false, processingMsSequence = [100]
} = {}) {
  const initialStatus = completedBatch ? "REVISION_OCR" : "RECIBIDO";
  const initialSessionStatus = completedBatch ? "REVISION_OCR" : "EVIDENCIA_RECIBIDA";
  const tables = {
    OCR_DOCUMENTOS: [{
      documentId: "document-remote", sessionId: "session-remote", evidenceId: "evidence-remote",
      sha256: "a".repeat(64), mimeType: "image/png", status: initialStatus
    }],
    EVIDENCIAS: [{
      evidenceId: "evidence-remote", sessionId: "session-remote", kind: "LISTA_FISICA_ORIGINAL",
      sha256: "a".repeat(64), mimeType: "image/png", immutable: true, driveFileId: "drive-synthetic"
    }],
    SESIONES: [{ sessionId: "session-remote", status: initialSessionStatus }],
    OCR_RESULTADOS: existingCandidates.map((row) => ({ ...row })),
    OCR_RECORTES_LOTES: completedBatch ? [{ ...completedBatch }] : [],
    AUDITORIA: []
  };
  const calls = {
    read: 0, begin: 0, remote: 0, ingest: 0, reconcile: 0, store: 0,
    audits: [], roles: [], stateHistory: [], duringRemote: null
  };
  const inputs = candidateInputs();
  let storeFailurePending = failFirstStore;
  let readFailurePending = failFirstRead;
  let completionAuditFailurePending = failCompletionAuditOnce;
  let candidateId = 0;
  let leaseId = 0;
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    updateMany(name, keyField, updates) {
      return updates.map((update) => {
        const row = tables[name].find((item) => String(item[keyField]) === String(update[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
        if (Object.hasOwn(update, "status")) {
          calls.stateHistory.push({ name, previous: String(row.status), next: String(update.status) });
        }
        Object.assign(row, update);
        return row;
      });
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      SHEETS: {
        OCR_DOCUMENTS: "OCR_DOCUMENTOS", EVIDENCE: "EVIDENCIAS", OCR_RESULTS: "OCR_RESULTADOS",
        OCR_CROP_BATCHES: "OCR_RECORTES_LOTES", SESSIONS: "SESIONES", AUDIT: "AUDITORIA"
      },
      property: (_name, fallback) => fallback
    },
    KcmAuth: {
      requireRoles(roles) {
        calls.roles.push([...roles]);
        return { actor: "operator@example.invalid", role: "CAPACITACION" };
      }
    },
    KcmValidation: {
      fail,
      identifier(value) {
        const text = String(value ?? "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail("INVALID_IDENTIFIER", "Identificador invalido");
        return text;
      }
    },
    KcmServiceSupport: {
      repository: () => repository,
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      parseArray(value) {
        if (Array.isArray(value)) return value;
        try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
      },
      ocrMetadata(input, required) {
        if (!input || !input.workerVersion) {
          if (required) fail("INVALID_INPUT", "Metadata ausente");
          return { workerVersion: "", runtime: "", pipelineVersion: "", processingMs: "" };
        }
        const runtime = typeof input.runtime === "string" ? JSON.parse(input.runtime) : input.runtime;
        return {
          workerVersion: String(input.workerVersion), runtime: JSON.stringify(runtime),
          pipelineVersion: String(runtime.imagePipelineVersion), processingMs: Number(input.processingMs)
        };
      },
      nowIso: () => "2026-07-21T12:00:00.000Z",
      uuid: () => `synthetic-lease-${++leaseId}`,
      session(sessionId) {
        const row = tables.SESIONES.find((item) => item.sessionId === sessionId);
        if (!row) fail("NOT_FOUND", "Sesion ausente");
        return row;
      },
      audit(_identity, input) {
        if (input.action === "REMOTE_OCR_COMPLETED" && completionAuditFailurePending) {
          completionAuditFailurePending = false;
          throw new Error("synthetic completion audit failure");
        }
        const event = { ...input, eventId: `audit-${tables.AUDITORIA.length + 1}` };
        tables.AUDITORIA.push(event);
        calls.audits.push(event);
        return event;
      }
    },
    KcmDriveEvidenceRepository: {
      readOriginalBytes() {
        calls.read += 1;
        if (readFailurePending) {
          readFailurePending = false;
          throw new Error("synthetic read failure after claim");
        }
        return { bytes: [1, 2, 3], mimeType: "image/png", sha256: "a".repeat(64), byteSize: 3 };
      }
    },
    KcmOcrWorkflowService: {
      beginProcessing() {
        calls.begin += 1;
        tables.OCR_DOCUMENTOS[0].status = "OCR_EN_PROCESO";
        tables.SESIONES[0].status = "OCR_EN_PROCESO";
      },
      ingestCandidatesForRemote({ candidates, requestId }) {
        calls.ingest += 1;
        assert.equal(requestId, "request-remote");
        const created = candidates.map((input) => {
          const row = {
            candidateId: `candidate-${String(++candidateId).padStart(2, "0")}`,
            documentId: "document-remote",
            rowIndex: input.rowIndex,
            rawDigits: input.rawDigits,
            digitConfidences: JSON.stringify(input.digitConfidences),
            overallConfidence: input.overallConfidence,
            validationFlags: JSON.stringify(input.technicalFlags)
          };
          tables.OCR_RESULTADOS.push(row);
          return { candidateId: row.candidateId, rowIndex: row.rowIndex };
        });
        return created;
      },
      reconcileCandidatesForRemote({ requestId }) {
        calls.reconcile += 1;
        assert.equal(requestId, "request-remote");
        return tables.OCR_RESULTADOS.map((row) => ({
          candidateId: row.candidateId, rowIndex: Number(row.rowIndex)
        }));
      }
    },
    KcmOcrRemoteWorkerClient: {
      process(input) {
        calls.remote += 1;
        if (calls.duringRemote) {
          const callback = calls.duringRemote;
          calls.duringRemote = null;
          callback(context.KcmRemoteOcrProcessingService);
        }
        assert.equal(Object.hasOwn(input, "sessionId"), false);
        assert.equal(input.templateVersion, "formato-ocr-v6-1");
        return {
          contractVersion: "1.0.0", status: "COMPLETED", requestId: input.requestId,
          documentId: input.documentId, workerVersion: "synthetic-worker",
          processingMs: processingMsSequence[Math.min(calls.remote - 1, processingMsSequence.length - 1)], runtime: RUNTIME,
          rows: inputs, cropPairs: Array.from({ length: 200 }, () => ({}))
        };
      },
      candidateInputs: () => inputs,
      evidenceBatch(_result, input) { return { ...input, items: Array.from({ length: 200 }, () => ({})) }; }
    },
    KcmOcrCropEvidenceService: {
      storeBatch(input) {
        calls.store += 1;
        if (storeFailurePending) {
          storeFailurePending = false;
          const error = new Error("synthetic recoverable store failure");
          error.code = "CONFLICT";
          error.retryable = true;
          throw error;
        }
        tables.OCR_RECORTES_LOTES.splice(0, tables.OCR_RECORTES_LOTES.length, {
          requestId: input.requestId, documentId: input.documentId, sessionId: input.sessionId,
          status: "COMPLETADO", totalPairs: 200, storedVariants: 400,
          workerVersion: input.ocrMetadata.workerVersion, runtime: input.ocrMetadata.runtime,
          pipelineVersion: input.ocrMetadata.pipelineVersion, processingMs: input.ocrMetadata.processingMs
        });
        return {
          status: "COMPLETADO", totalPairs: 200, storedVariants: 400, repeated: calls.store > 1,
          workerVersion: input.ocrMetadata.workerVersion, runtime: JSON.parse(input.ocrMetadata.runtime),
          pipelineVersion: input.ocrMetadata.pipelineVersion, processingMs: input.ocrMetadata.processingMs
        };
      }
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined })
    }
  });
  new vm.Script(serviceSource, { filename: "RemoteOcrProcessingService.gs" }).runInContext(context);
  return {
    service: context.KcmRemoteOcrProcessingService, tables, calls, inputs,
    duringRemote(callback) { calls.duringRemote = callback; }
  };
}

function request() {
  return { requestId: "request-remote", documentId: "document-remote" };
}

test("procesa evidencia, ingiere una vez y devuelve sólo resumen sin binarios", () => {
  const harness = createHarness();
  const result = harness.service.process(request());
  assert.equal(result.status, "REVISION_OCR");
  assert.equal(result.candidateCount, 40);
  assert.equal(result.cropPairCount, 200);
  assert.equal(harness.tables.OCR_RESULTADOS.length, 40);
  assert.equal(harness.calls.read, 1);
  assert.equal(harness.calls.begin, 0, "la concesion cambia ambos estados sin una segunda ventana de carrera");
  assert.equal(harness.calls.remote, 1);
  assert.equal(harness.calls.ingest, 1);
  assert.equal(harness.calls.store, 1);
  assert.deepEqual(harness.calls.roles[0], ["CAPACITACION", "ADMINISTRADOR"]);
  assert.equal(JSON.stringify(result).includes("cropPairs"), false);
  assert.equal(JSON.stringify(result).includes("sourceBytes"), false);
  assert.equal(result.runtime.containerBuildId, "synthetic-build-1");
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrWorkerVersion, "synthetic-worker");
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrPipelineVersion, "raster-homography-1.0.0");
  assert.equal(harness.calls.audits.at(-1).ocrMetadata.workerVersion, "synthetic-worker");
});

test("reanuda evidencia tras fallo sin reinsertar los cuarenta candidatos", () => {
  const harness = createHarness({ failFirstStore: true, processingMsSequence: [100, 275] });
  const pending = harness.service.process(request());
  assert.equal(pending.status, "OCR_EN_PROCESO");
  assert.equal(pending.retryRequired, true);
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].status, "OCR_EN_PROCESO");
  assert.equal(harness.tables.SESIONES[0].status, "OCR_EN_PROCESO");
  assert.equal(harness.tables.OCR_RESULTADOS.length, 40);
  assert.equal(harness.calls.ingest, 1);

  const result = harness.service.process(request());
  assert.equal(result.status, "REVISION_OCR");
  assert.equal(harness.tables.OCR_RESULTADOS.length, 40);
  assert.equal(harness.calls.ingest, 1);
  assert.equal(harness.calls.remote, 2);
  assert.equal(harness.calls.store, 2);
  assert.equal(harness.calls.audits.some(({ action }) => action === "REMOTE_OCR_RESUMED"), true);
  assert.equal(harness.calls.audits.at(-1).action, "REMOTE_OCR_COMPLETED");
  assert.equal(result.processingMs, 100, "el primer tiempo observado se conserva en el replay");
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrProcessingMs, 100);
  assert.equal(harness.calls.stateHistory.some(({ previous, next }) => previous === "REVISION_OCR" && next === "OCR_EN_PROCESO"), false);
});

test("un replay completado no vuelve a leer Drive ni invoca el worker", () => {
  const inputs = candidateInputs();
  const existingCandidates = inputs.map((input, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(2, "0")}`,
    documentId: "document-remote", rowIndex: input.rowIndex, rawDigits: input.rawDigits,
    digitConfidences: JSON.stringify(input.digitConfidences), overallConfidence: input.overallConfidence,
    validationFlags: JSON.stringify(input.technicalFlags)
  }));
  const harness = createHarness({
    existingCandidates,
    completedBatch: {
      requestId: "request-remote", documentId: "document-remote", sessionId: "session-remote",
      status: "COMPLETADO", totalPairs: 200, storedVariants: 400,
      workerVersion: "synthetic-worker", runtime: JSON.stringify(RUNTIME),
      pipelineVersion: "raster-homography-1.0.0", processingMs: 100
    }
  });
  const result = harness.service.process(request());
  assert.equal(result.repeated, true);
  assert.equal(result.candidateCount, 40);
  assert.equal(harness.calls.read, 0);
  assert.equal(harness.calls.remote, 0);
  assert.equal(harness.calls.ingest, 0);
  assert.equal(harness.calls.reconcile, 1);
  assert.equal(harness.calls.store, 0);
  assert.equal(harness.calls.audits.at(-1).action, "REMOTE_OCR_REPLAYED");
  assert.equal(result.runtime.containerBuildId, "synthetic-build-1");
});

test("reanuda candidatos persistidos y restaura estados de revision", () => {
  const inputs = candidateInputs();
  const existingCandidates = inputs.map((input, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(2, "0")}`,
    documentId: "document-remote", rowIndex: input.rowIndex, rawDigits: input.rawDigits,
    digitConfidences: JSON.stringify(input.digitConfidences), overallConfidence: input.overallConfidence,
    validationFlags: JSON.stringify(input.technicalFlags)
  }));
  const harness = createHarness({ existingCandidates });
  const result = harness.service.process(request());
  assert.equal(result.status, "REVISION_OCR");
  assert.equal(harness.calls.ingest, 0);
  assert.equal(harness.calls.reconcile, 1);
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].status, "REVISION_OCR");
  assert.equal(harness.tables.SESIONES[0].status, "REVISION_OCR");
  assert.equal(harness.calls.audits.some(({ action }) => action === "REMOTE_OCR_RESUMED"), true);
  assert.equal(harness.calls.audits.at(-1).action, "REMOTE_OCR_COMPLETED");
});

test("un replay terminal repara REMOTE_OCR_COMPLETED si fallo el primer append", () => {
  const harness = createHarness({ failCompletionAuditOnce: true });
  assert.throws(() => harness.service.process(request()), /synthetic completion audit failure/);
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].status, "REVISION_OCR");
  assert.equal(harness.tables.OCR_RECORTES_LOTES[0].status, "COMPLETADO");
  assert.equal(harness.calls.audits.filter(({ action }) => action === "REMOTE_OCR_COMPLETED").length, 0);

  const replay = harness.service.process(request());
  assert.equal(replay.repeated, true);
  assert.equal(harness.calls.audits.filter(({ action }) => action === "REMOTE_OCR_COMPLETED").length, 1);
  assert.equal(harness.calls.audits.filter(({ action }) => action === "REMOTE_OCR_REPLAYED").length, 1);
  assert.equal(harness.calls.remote, 1, "el replay no vuelve a invocar el worker");
});

test("un resultado remoto distinto no sobrescribe candidatos existentes", () => {
  const inputs = candidateInputs();
  const existingCandidates = inputs.map((input, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(2, "0")}`,
    documentId: "document-remote", rowIndex: input.rowIndex,
    rawDigits: index === 0 ? "99999" : input.rawDigits,
    digitConfidences: JSON.stringify(input.digitConfidences), overallConfidence: input.overallConfidence,
    validationFlags: JSON.stringify(input.technicalFlags)
  }));
  const harness = createHarness({ existingCandidates });
  assert.throws(() => harness.service.process(request()), (error) => error.code === "CONFLICT" && error.retryable === false);
  assert.equal(harness.tables.OCR_RESULTADOS[0].rawDigits, "99999");
  assert.equal(harness.calls.ingest, 0);
  assert.equal(harness.calls.store, 0);
});

test("un requestId distinto no reemplaza la procedencia ya persistida", () => {
  const harness = createHarness({ failFirstStore: true });
  const pending = harness.service.process(request());
  assert.equal(pending.status, "OCR_EN_PROCESO");
  assert.throws(
    () => harness.service.process({ requestId: "request-other", documentId: "document-remote" }),
    (error) => error.code === "CONFLICT" && error.retryable === false
  );
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrRequestId, "request-remote");
});

test("una llamada concurrente se excluye antes de invocar por segunda vez al worker", () => {
  const harness = createHarness();
  let concurrentError = null;
  harness.duringRemote((service) => {
    try { service.process(request()); } catch (error) { concurrentError = error; }
  });

  const result = harness.service.process(request());
  assert.equal(result.status, "REVISION_OCR");
  assert.equal(harness.calls.remote, 1);
  assert.equal(concurrentError?.code, "CONFLICT");
  assert.equal(concurrentError?.retryable, true);
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrLeaseId, "");
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrLeaseUntil, "");
});

test("una concesion expirada se recupera con el mismo requestId", () => {
  const harness = createHarness();
  Object.assign(harness.tables.OCR_DOCUMENTOS[0], {
    status: "OCR_EN_PROCESO", ocrRequestId: "request-remote",
    ocrLeaseId: "lease-expired", ocrLeaseUntil: "2020-01-01T00:00:00.000Z"
  });
  harness.tables.SESIONES[0].status = "OCR_EN_PROCESO";

  const result = harness.service.process(request());
  assert.equal(result.status, "REVISION_OCR");
  assert.equal(harness.calls.remote, 1);
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrLeaseId, "");
});

test("un fallo tras el claim conserva y repara una sola auditoria de inicio", () => {
  const harness = createHarness({ failFirstRead: true });
  assert.throws(() => harness.service.process(request()), /synthetic read failure after claim/);
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].status, "OCR_EN_PROCESO");
  assert.equal(harness.tables.SESIONES[0].status, "OCR_EN_PROCESO");
  assert.equal(harness.tables.OCR_DOCUMENTOS[0].ocrLeaseId, "");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_PROCESSING_STARTED").length, 1);

  const recovered = harness.service.process(request());
  assert.equal(recovered.status, "REVISION_OCR");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_PROCESSING_STARTED").length, 1);
  assert.equal(harness.tables.AUDITORIA.find(({ action }) => action === "OCR_PROCESSING_STARTED").requestId, "request-remote");
});

test("una sesion heredada con varios documentos falla antes de leer Drive o llamar al worker", () => {
  const harness = createHarness();
  harness.tables.OCR_DOCUMENTOS.push({
    ...harness.tables.OCR_DOCUMENTOS[0], documentId: "document-extra", evidenceId: "evidence-extra",
    sha256: "b".repeat(64)
  });
  assert.throws(() => harness.service.process(request()), (error) => error.code === "INVALID_STATE");
  assert.equal(harness.calls.read, 0);
  assert.equal(harness.calls.remote, 0);
});

test("el router expone sólo la operación de resumen y no campos binarios", async () => {
  const router = await readFile(path.join(ROOT, "server/Router.gs"), "utf8");
  assert.match(router, /processRemoteOcrDocument:\s*function \(\) \{ return KcmRemoteOcrProcessingService\.process\(input\); \}/);
  assert.doesNotMatch(router, /processRemoteOcrDocument[^\n]*(?:sourceBytes|cropPairs|contentBase64)/);
});
