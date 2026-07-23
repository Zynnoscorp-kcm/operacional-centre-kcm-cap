import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { PNG } from "pngjs";

const ROOT = path.resolve("src/apps-script");
const serviceSource = await readFile(path.join(ROOT, "services/OcrCropEvidenceService.gs"), "utf8");
const routerSource = await readFile(path.join(ROOT, "server/Router.gs"), "utf8");
const configSource = await readFile(path.join(ROOT, "server/00_Config.gs"), "utf8");
const driveSource = await readFile(path.join(ROOT, "repositories/DriveEvidenceRepository.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function pngBytes(width = 100, height = 40, { noisy = false } = {}) {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    const value = noisy ? ((index * 73 + 41) % 256) : 255;
    image.data[index] = value;
    image.data[index + 1] = noisy ? ((index * 29 + 17) % 256) : 255;
    image.data[index + 2] = noisy ? ((index * 11 + 97) % 256) : 255;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

function createDriveParser() {
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      maxUploadBytes: () => 1000000,
      maxReviewCropBytes: () => 1024,
      maxReviewCropDimension: () => 2048
    },
    KcmValidation: {
      fail,
      text(value) { return String(value ?? ""); }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      base64Decode(value) { return [...Buffer.from(String(value), "base64")]; },
      computeDigest(_algorithm, value) {
        const input = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
        return [...crypto.createHash("sha256").update(input).digest()];
      }
    }
  });
  new vm.Script(driveSource, { filename: "DriveEvidenceRepository.gs" }).runInContext(context);
  return context.KcmDriveEvidenceRepository;
}

function pair(candidateId, rowIndex, digitIndex, suffix = "a") {
  return {
    candidateId,
    digitIndex,
    cropId: `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`,
    visual: { mimeType: "image/png", dataUrl: `data:image/png;base64,VISUAL-${suffix}` },
    processed: { mimeType: "image/png", dataUrl: `data:image/png;base64,PROCESSED-${suffix}` }
  };
}

function createHarness({ candidateCount = 2, chunkPairs = 5, budgetMs = 240000, clockStepMs = 0, failCompletionAuditOnce = false } = {}) {
  const tables = {
    OCR_DOCUMENTOS: [{
      documentId: "document-1", sessionId: "session-1", evidenceId: "original-evidence",
      status: "REVISION_OCR"
    }],
    OCR_RESULTADOS: Array.from({ length: candidateCount }, (_, index) => ({
      candidateId: `candidate-${String(index + 1).padStart(2, "0")}`,
      documentId: "document-1", rowIndex: index + 1, cropEvidenceRefs: "[]"
    })),
    EVIDENCIAS: [],
    OCR_RECORTES_LOTES: [],
    AUDITORIA: []
  };
  const auditEvents = [];
  const rolesRequested = [];
  const repositoryCalls = [];
  const files = new Map();
  let failOnNewSaveNumber = 0;
  let newSaveAttempts = 0;
  let saveCalls = 0;
  let locksAcquired = 0;
  let locksReleased = 0;
  let syntheticNow = 0;
  let syntheticClockStep = clockStepMs;
  let completionAuditFailurePending = failCompletionAuditOnce;

  class SyntheticDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else {
        super(syntheticNow);
        syntheticNow += syntheticClockStep;
      }
    }
  }

  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) {
      return this.list(name, predicate)[0] ?? null;
    },
    insertMany(name, objects) {
      repositoryCalls.push({ operation: "insertMany", name, count: objects.length });
      tables[name].push(...objects.map((object) => ({ ...object })));
      return objects;
    },
    updateMany(name, keyField, updates) {
      repositoryCalls.push({ operation: "updateMany", name, count: updates.length });
      return updates.map((update) => {
        const row = tables[name].find((candidate) => String(candidate[keyField]) === String(update[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
        Object.assign(row, update);
        return row;
      });
    },
    replaceOne(name, keyField, replacement) {
      repositoryCalls.push({ operation: "replaceOne", name, count: 1 });
      const row = tables[name].find((candidate) => String(candidate[keyField]) === String(replacement[keyField]));
      if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
      Object.keys(row).forEach((field) => delete row[field]);
      Object.assign(row, replacement);
      return row;
    }
  };

  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date: SyntheticDate, Math, Error, isFinite,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      maxReviewCropBytes: () => 300000,
      maxReviewCropBatchBytes: () => 8388608,
      reviewCropChunkPairs: () => chunkPairs,
      reviewCropExecutionBudgetMs: () => budgetMs,
      SHEETS: {
        OCR_DOCUMENTS: "OCR_DOCUMENTOS", OCR_RESULTS: "OCR_RESULTADOS",
        EVIDENCE: "EVIDENCIAS", OCR_CROP_BATCHES: "OCR_RECORTES_LOTES", AUDIT: "AUDITORIA"
      }
    },
    KcmAuth: {
      requireRoles(roles) {
        rolesRequested.push([...roles]);
        return { actor: "synthetic-reviewer@example.invalid", role: "CAPACITACION" };
      }
    },
    KcmValidation: {
      fail,
      identifier(value) {
        const text = String(value ?? "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail("INVALID_IDENTIFIER", "Identificador invalido");
        return text;
      },
      enumValue(value, allowed) {
        const text = String(value ?? "");
        if (!allowed.includes(text)) fail("INVALID_ENUM", "Valor no permitido");
        return text;
      },
      integer(value, minimum, maximum) {
        const number = Number(value);
        if (!Number.isInteger(number) || number < minimum || number > maximum) fail("INVALID_INTEGER", "Entero invalido");
        return number;
      },
      json(value, maximum) {
        const serialized = JSON.stringify(value);
        if (serialized.length > maximum) fail("INVALID_JSON", "JSON demasiado largo");
        return serialized;
      },
      safeError(error) {
        return { code: String(error?.code || "INTERNAL_ERROR") };
      }
    },
    KcmServiceSupport: {
      repository: () => repository,
      session(sessionId) {
        if (sessionId !== "session-1") fail("NOT_FOUND", "Sesion ausente");
        return { sessionId, status: "REVISION_OCR" };
      },
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
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      nowIso: () => "2026-07-21T12:00:00.000Z",
      audit(identity, input) {
        if (input.action === "OCR_CROP_BATCH_COMPLETED" && completionAuditFailurePending) {
          completionAuditFailurePending = false;
          throw new Error("synthetic crop completion audit failure");
        }
        const event = { ...input, eventId: `audit-${tables.AUDITORIA.length + 1}` };
        tables.AUDITORIA.push(event);
        auditEvents.push({ identity, input: event });
        return event;
      }
    },
    KcmDriveEvidenceRepository: {
      parseReviewCropDataUrl(dataUrl, mimeType) {
        return {
          bytes: [1, 2, 3], mimeType, byteSize: String(dataUrl).length,
          width: 100, height: 40, sha256: hash(dataUrl)
        };
      },
      stableId(prefix, value) {
        return `${prefix}-${hash(value).slice(0, 32)}`;
      },
      saveReviewCrop(parsed, metadata) {
        saveCalls += 1;
        const key = [metadata.sessionId, metadata.documentId, metadata.candidateId, metadata.cropId, metadata.variant, parsed.sha256].join("|");
        if (files.has(key)) return { driveFileId: files.get(key), reused: true };
        newSaveAttempts += 1;
        if (failOnNewSaveNumber && newSaveAttempts === failOnNewSaveNumber) fail("DRIVE_FAILURE", "Fallo sintetico parcial");
        const driveFileId = `mock-drive-${hash(key).slice(0, 24)}`;
        files.set(key, driveFileId);
        return { driveFileId, reused: false };
      }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { locksAcquired += 1; return true; },
        releaseLock: () => { locksReleased += 1; }
      })
    }
  });
  new vm.Script(serviceSource, { filename: "OcrCropEvidenceService.gs" }).runInContext(context);

  return {
    service: context.KcmOcrCropEvidenceService,
    tables, auditEvents, rolesRequested, repositoryCalls, files,
    saveCalls: () => saveCalls,
    locksAcquired: () => locksAcquired,
    locksReleased: () => locksReleased,
    setClockStep(value) { syntheticClockStep = value; },
    failOnSave(number) { failOnNewSaveNumber = number; },
    allowSaves() { failOnNewSaveNumber = 0; }
  };
}

function request(requestId = "request-1", items = [pair("candidate-01", 1, 0, "one")]) {
  return { requestId, sessionId: "session-1", documentId: "document-1", items };
}

const RUNTIME = Object.freeze({
  nodeVersion: "22.17.0", ocrEngineName: "tesseract", ocrEngineVersion: "5.3.4",
  pdfInfoVersion: "25.6.0", pdfToPpmVersion: "25.6.0",
  imagePipelineVersion: "raster-homography-1.0.0",
  containerBuildId: "synthetic-build-1", pdfToolsUsed: false
});

function withMetadata(input, processingMs) {
  return {
    ...input,
    ocrMetadata: { workerVersion: "synthetic-worker", runtime: RUNTIME, processingMs }
  };
}

test("almacena hasta dos variantes por casilla en una sola operacion por tabla y sin binarios en Sheets", () => {
  const harness = createHarness();
  const result = harness.service.storeBatch(request("request-success", [
    pair("candidate-01", 1, 0, "one"), pair("candidate-02", 2, 1, "two")
  ]));

  assert.equal(result.status, "COMPLETADO");
  assert.equal(result.totalPairs, 2);
  assert.equal(result.storedVariants, 4);
  assert.equal(result.linkedCandidates, 2);
  assert.equal(result.repeated, false);
  assert.deepEqual(harness.rolesRequested[0], ["CAPACITACION", "ADMINISTRADOR"]);
  assert.equal(harness.tables.EVIDENCIAS.length, 4);
  assert.equal(harness.files.size, 4);
  assert.equal(harness.repositoryCalls.filter((call) => call.operation === "insertMany" && call.name === "EVIDENCIAS").length, 1);
  assert.equal(harness.repositoryCalls.filter((call) => call.operation === "updateMany" && call.name === "OCR_RESULTADOS").length, 1);
  assert.equal(harness.repositoryCalls.filter((call) => call.operation === "replaceOne" && call.name === "OCR_RECORTES_LOTES").length, 1);
  assert.equal(harness.tables.OCR_RESULTADOS.every((candidate) => JSON.parse(candidate.cropEvidenceRefs).length === 1), true);
  for (const evidence of harness.tables.EVIDENCIAS) {
    for (const forbidden of ["dataUrl", "base64", "bytes", "visual", "processed"]) {
      assert.equal(Object.hasOwn(evidence, forbidden), false, `Sheets contiene ${forbidden}`);
    }
  }
  assert.equal(JSON.stringify(result).includes("driveFileId"), false);
  assert.equal(harness.auditEvents.some(({ input }) => input.action === "OCR_CROP_BATCH_COMPLETED"), true);
});

test("el replay exacto no duplica archivos, metadatos ni referencias", () => {
  const harness = createHarness();
  const input = request("request-replay");
  harness.service.storeBatch(input);
  const saves = harness.saveCalls();
  const replay = harness.service.storeBatch(input);

  assert.equal(replay.repeated, true);
  assert.equal(harness.saveCalls(), saves);
  assert.equal(harness.files.size, 2);
  assert.equal(harness.tables.EVIDENCIAS.length, 2);
  assert.equal(harness.tables.OCR_RECORTES_LOTES.length, 1);
  assert.equal(JSON.parse(harness.tables.OCR_RESULTADOS[0].cropEvidenceRefs).length, 1);
});

test("el replay terminal repara la auditoria de lote completado", () => {
  const harness = createHarness({ failCompletionAuditOnce: true });
  const input = request("request-audit-recovery");
  assert.throws(() => harness.service.storeBatch(input), /synthetic crop completion audit failure/);
  assert.equal(harness.tables.OCR_RECORTES_LOTES[0].status, "COMPLETADO");
  assert.equal(harness.auditEvents.filter(({ input: event }) => event.action === "OCR_CROP_BATCH_COMPLETED").length, 0);
  const saves = harness.saveCalls();

  const replay = harness.service.storeBatch(input);
  assert.equal(replay.repeated, true);
  assert.equal(harness.saveCalls(), saves);
  assert.equal(harness.auditEvents.filter(({ input: event }) => event.action === "OCR_CROP_BATCH_COMPLETED").length, 1);
  assert.equal(harness.auditEvents.filter(({ input: event }) => event.action === "OCR_CROP_BATCH_REPLAYED").length, 1);
});

test("el replay completado revalida metadatos, referencia y journal de cada evidencia", () => {
  const corruptions = [
    ["kind", (evidence) => { evidence.kind = "LISTA_FISICA_ORIGINAL"; }],
    ["status", (evidence) => { evidence.status = "PENDIENTE"; }],
    ["driveFileId", (evidence) => { evidence.driveFileId = "ruta/no-permitida"; }],
    ["byteSize", (evidence) => { evidence.byteSize += 1; }],
    ["version", (evidence) => { evidence.version = "0.9.0"; }],
    ["requestId", (evidence) => { evidence.requestId = "request-sin-journal"; }]
  ];
  for (const [field, corrupt] of corruptions) {
    const harness = createHarness();
    const input = request(`request-integrity-${field}`);
    harness.service.storeBatch(input);
    corrupt(harness.tables.EVIDENCIAS[0]);
    assert.throws(
      () => harness.service.storeBatch(input),
      (error) => error.code === "CONFLICT",
      `el replay acepto ${field} corrupto`
    );
  }

  const missingReference = createHarness();
  const input = request("request-missing-reference");
  missingReference.service.storeBatch(input);
  missingReference.tables.OCR_RESULTADOS[0].cropEvidenceRefs = "[]";
  assert.throws(() => missingReference.service.storeBatch(input), (error) => error.code === "CONFLICT");
});

test("procesa doscientos pares en fragmentos deterministas con un bloqueo corto por fragmento", () => {
  const harness = createHarness({ candidateCount: 40, chunkPairs: 20 });
  const items = Array.from({ length: 40 }, (_, rowIndex) =>
    Array.from({ length: 5 }, (_, digitIndex) =>
      pair(`candidate-${String(rowIndex + 1).padStart(2, "0")}`, rowIndex + 1, digitIndex, `${rowIndex}-${digitIndex}`)
    )
  ).flat();

  const result = harness.service.storeBatch(withMetadata(request("request-200", items), 1500));

  assert.equal(result.status, "COMPLETADO");
  assert.equal(result.totalPairs, 200);
  assert.equal(result.storedVariants, 400);
  assert.equal(result.linkedCandidates, 40);
  assert.equal(result.chunkSize, 20);
  assert.equal(result.chunkCount, 10);
  assert.equal(result.completedChunks, 10);
  assert.equal(harness.tables.EVIDENCIAS.length, 400);
  assert.equal(harness.tables.OCR_RESULTADOS.every((candidate) => JSON.parse(candidate.cropEvidenceRefs).length === 5), true);
  assert.equal(harness.locksAcquired(), 12, "un bloqueo inicial, diez de fragmento y uno para el audit terminal");
  assert.equal(harness.locksReleased(), harness.locksAcquired());
});

test("pausa por presupuesto y reanuda los fragmentos pendientes sin duplicar evidencia", () => {
  const harness = createHarness({ candidateCount: 8, chunkPairs: 20, budgetMs: 30000, clockStepMs: 20000 });
  const items = Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 5 }, (_, digitIndex) =>
      pair(`candidate-${String(rowIndex + 1).padStart(2, "0")}`, rowIndex + 1, digitIndex, `pause-${rowIndex}-${digitIndex}`)
    )
  ).flat();
  const input = withMetadata(request("request-paused", items), 800);

  assert.throws(
    () => harness.service.storeBatch(input),
    (error) => error.code === "CONFLICT" && error.retryable === true
  );
  const batch = harness.tables.OCR_RECORTES_LOTES[0];
  assert.equal(batch.status, "PENDIENTE");
  assert.deepEqual(JSON.parse(batch.completedChunks), [0]);
  assert.equal(harness.tables.EVIDENCIAS.length, 40);
  assert.equal(harness.tables.OCR_RESULTADOS.slice(0, 4).every((candidate) => JSON.parse(candidate.cropEvidenceRefs).length === 5), true);
  assert.equal(harness.tables.OCR_RESULTADOS.slice(4).every((candidate) => JSON.parse(candidate.cropEvidenceRefs).length === 0), true);

  harness.setClockStep(0);
  const result = harness.service.storeBatch(input);
  assert.equal(result.status, "COMPLETADO");
  assert.equal(result.completedChunks, 2);
  assert.equal(harness.tables.EVIDENCIAS.length, 80);
  assert.equal(harness.files.size, 80);
  assert.equal(harness.tables.OCR_RESULTADOS.every((candidate) => JSON.parse(candidate.cropEvidenceRefs).length === 5), true);
});

test("processingMs no forma parte de la identidad idempotente del manifiesto", () => {
  const harness = createHarness();
  const first = harness.service.storeBatch(withMetadata(request("request-time-stable"), 100));
  const replay = harness.service.storeBatch(withMetadata(request("request-time-stable"), 275));

  assert.equal(replay.repeated, true);
  assert.equal(replay.payloadHash, first.payloadHash);
  assert.equal(replay.processingMs, 100);
  assert.equal(harness.tables.OCR_RECORTES_LOTES[0].processingMs, 100);
  assert.equal(harness.tables.OCR_RECORTES_LOTES.length, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 2);
});

test("otro requestId con el mismo manifiesto reutiliza evidencia estable", () => {
  const harness = createHarness();
  harness.service.storeBatch(request("request-first"));
  const saves = harness.saveCalls();
  const result = harness.service.storeBatch(request("request-second"));

  assert.equal(result.status, "COMPLETADO");
  assert.equal(result.repeated, false);
  assert.equal(harness.saveCalls(), saves);
  assert.equal(harness.files.size, 2);
  assert.equal(harness.tables.EVIDENCIAS.length, 2);
  assert.equal(harness.tables.OCR_RECORTES_LOTES.length, 2);
});

test("reanuda el mismo requestId tras fallo parcial sin duplicar archivo ni metadatos", () => {
  const harness = createHarness();
  harness.failOnSave(2);
  const input = request("request-resume");

  assert.throws(() => harness.service.storeBatch(input), (error) => error.code === "CONFLICT" && error.retryable === true);
  assert.equal(harness.files.size, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 0);
  assert.equal(harness.tables.OCR_RECORTES_LOTES[0].status, "ERROR_RECUPERABLE");

  harness.allowSaves();
  const result = harness.service.storeBatch(input);
  assert.equal(result.status, "COMPLETADO");
  assert.equal(harness.files.size, 2);
  assert.equal(harness.tables.EVIDENCIAS.length, 2);
  assert.equal(harness.tables.OCR_RECORTES_LOTES.length, 1);
  assert.equal(JSON.parse(harness.tables.OCR_RESULTADOS[0].cropEvidenceRefs).length, 1);
  assert.equal(harness.auditEvents.some(({ input: event }) => event.action === "OCR_CROP_BATCH_RESUMED"), true);
});

test("reusar un requestId completado con otro payload falla sin degradar el lote", () => {
  const harness = createHarness();
  harness.service.storeBatch(request("request-immutable"));
  const batch = harness.tables.OCR_RECORTES_LOTES[0];
  const originalHash = batch.payloadHash;

  assert.throws(
    () => harness.service.storeBatch(request("request-immutable", [pair("candidate-01", 1, 1, "changed")])),
    (error) => error.code === "CONFLICT"
  );
  assert.equal(batch.status, "COMPLETADO");
  assert.equal(batch.payloadHash, originalHash);
  assert.equal(harness.tables.EVIDENCIAS.length, 2);
});

test("rechaza mas de doscientos pares antes de escribir o reservar lote", () => {
  const harness = createHarness();
  const items = Array.from({ length: 201 }, (_, index) => pair("candidate-01", 1, index % 5, `limit-${index}`));
  assert.throws(() => harness.service.storeBatch(request("request-limit", items)), (error) => error.code === "INVALID_ARRAY");
  assert.equal(harness.tables.OCR_RECORTES_LOTES.length, 0);
  assert.equal(harness.tables.EVIDENCIAS.length, 0);
  assert.equal(harness.files.size, 0);
});

test("el parser de Drive valida MIME real, hash, dimensiones y limite individual", () => {
  const repository = createDriveParser();
  const bytes = pngBytes();
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const parsed = repository.parseReviewCropDataUrl(dataUrl, "image/png");
  assert.equal(parsed.mimeType, "image/png");
  assert.equal(parsed.byteSize, bytes.length);
  assert.equal(parsed.width, 100);
  assert.equal(parsed.height, 40);
  assert.equal(parsed.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.throws(() => repository.parseReviewCropDataUrl(dataUrl, "image/jpeg"), (error) => error.code === "INVALID_FILE");

  const truncatedPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.throws(
    () => repository.parseReviewCropDataUrl(`data:image/png;base64,${truncatedPng.toString("base64")}`, "image/png"),
    (error) => error.code === "INVALID_FILE"
  );

  const tooLarge = pngBytes(100, 40, { noisy: true });
  assert.ok(tooLarge.length > 1024);
  assert.throws(
    () => repository.parseReviewCropDataUrl(`data:image/png;base64,${tooLarge.toString("base64")}`, "image/png"),
    (error) => error.code === "INVALID_FILE"
  );
  const tooWide = pngBytes(4096, 40);
  assert.throws(
    () => repository.parseReviewCropDataUrl(`data:image/png;base64,${tooWide.toString("base64")}`, "image/png"),
    (error) => error.code === "INVALID_FILE"
  );
});

test("rechaza referencias existentes corruptas antes de crear archivos o reservar lote", () => {
  for (const corrupt of [
    "{json-invalido",
    JSON.stringify([{ cropId: "r01-d1", digitIndex: 0, visualEvidenceId: "same", processedEvidenceId: "same" }]),
    JSON.stringify([
      { cropId: "r01-d1", digitIndex: 0, visualEvidenceId: "visual-1", processedEvidenceId: "processed-1" },
      { cropId: "r01-d1", digitIndex: 0, visualEvidenceId: "visual-2", processedEvidenceId: "processed-2" }
    ])
  ]) {
    const harness = createHarness();
    harness.tables.OCR_RESULTADOS[0].cropEvidenceRefs = corrupt;

    assert.throws(
      () => harness.service.storeBatch(request("request-corrupt-refs")),
      (error) => error.code === "CONFLICT"
    );
    assert.equal(harness.files.size, 0);
    assert.equal(harness.tables.EVIDENCIAS.length, 0);
    assert.equal(harness.tables.OCR_RECORTES_LOTES.length, 0);
  }
});

test("el contrato estatico expone un solo endpoint productor y conserva binarios fuera de Sheets", () => {
  assert.match(routerSource, /storeOcrCropEvidenceBatch:\s*function/);
  assert.match(routerSource, /KcmOcrCropEvidenceService\.storeBatch\(input\)/);
  assert.match(configSource, /OCR_CROP_BATCHES:\s*"OCR_RECORTES_LOTES"/);
  assert.doesNotMatch(configSource, /"(?:dataUrl|base64|bytes|visual|processed)"/i);
  assert.match(driveSource, /getFilesByName/);
  assert.match(driveSource, /DriveApp\.Access\.PRIVATE/);
  assert.match(driveSource, /parseReviewCropDataUrl/);
  assert.match(serviceSource, /repo\.insertMany\(KcmConfig\.SHEETS\.EVIDENCE, newEvidence\)/);
  assert.match(serviceSource, /repo\.updateMany\(KcmConfig\.SHEETS\.OCR_RESULTS, "candidateId", updates\)/);
});
