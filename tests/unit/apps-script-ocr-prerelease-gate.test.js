import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/apps-script");
const serviceSource = await readFile(path.join(ROOT, "services/PreReleaseService.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function ocrRows({ decision = "AUTO_ACEPTADO", includeBatch = true, batchStatus = "COMPLETADO", remote = false } = {}) {
  const candidateId = "candidate-01";
  const document = {
    documentId: "document-1", sessionId: "session-1", evidenceId: "evidence-original",
    sha256: "c".repeat(64), mimeType: "image/png", status: "REVISION_OCR",
    ocrRequestId: remote ? "request-crops" : ""
  };
  const original = {
    evidenceId: "evidence-original", sessionId: "session-1", kind: "LISTA_FISICA_ORIGINAL",
    driveFileId: "drive-original", sha256: "c".repeat(64), mimeType: "image/png", immutable: true,
    byteSize: 100, status: "LISTA"
  };
  const references = [];
  const cropEvidence = [];
  for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
    const cropId = `r01-d${digitIndex + 1}`;
    const visualEvidenceId = `visual-${digitIndex}`;
    const processedEvidenceId = `processed-${digitIndex}`;
    references.push({ cropId, digitIndex, visualEvidenceId, processedEvidenceId });
    cropEvidence.push({
      evidenceId: visualEvidenceId, sessionId: "session-1", documentId: "document-1",
      candidateId, cropId, variant: "CROP_VISUAL", kind: "OCR_CROP_VISUAL",
      status: "LISTA", immutable: true, mimeType: "image/png", sha256: "a".repeat(64),
      byteSize: 50, driveFileId: `drive-visual-${digitIndex}`, requestId: "request-crops"
    }, {
      evidenceId: processedEvidenceId, sessionId: "session-1", documentId: "document-1",
      candidateId, cropId, variant: "CROP_PROCESSED", kind: "OCR_CROP_PROCESSED",
      status: "LISTA", immutable: true, mimeType: "image/png", sha256: "b".repeat(64),
      byteSize: 45, driveFileId: `drive-processed-${digitIndex}`, requestId: "request-crops"
    });
  }
  const empty = decision === "CONFIRMADO_VACIO";
  const candidate = {
    candidateId, documentId: "document-1", rowIndex: 1, rawDigits: empty ? "" : "00123",
    normalizedEmployeeId: empty ? "" : "00123", decision,
    originalValue: empty ? "" : "00123", correctedValue: "",
    correctionActor: empty ? "reviewer@example.invalid" : "",
    correctionAt: empty ? "2026-07-21T16:00:00.000Z" : "",
    correctionReason: empty ? "Las cinco casillas se revisaron sin participante" : "",
    cropEvidenceRefs: JSON.stringify(references)
  };
  const batch = {
    batchId: "batch-1", requestId: "request-crops", sessionId: "session-1",
    documentId: "document-1", status: batchStatus,
    totalPairs: remote ? 200 : 5, storedVariants: remote ? 400 : 10,
    linkedCandidates: remote ? 40 : 1, chunkCount: 1, completedChunks: "[0]"
  };
  return {
    document, original, candidate, cropEvidence,
    batches: includeBatch ? [batch] : []
  };
}

function createHarness({ route = "OCR", decision, includeBatch = true, batchStatus, mockMode = true, remote = false, retracted = false } = {}) {
  const fixture = route === "OCR" ? ocrRows({ decision, includeBatch, batchStatus, remote }) : null;
  const session = {
    sessionId: "session-1", status: route === "OCR" ? "REVISION_OCR" : "CERRADA",
    authorized: true, trainingId: "training-1", date: "2026-07-21"
  };
  const attendances = route === "DIGITAL" ? [{
    attendanceId: "attendance-digital", sessionId: "session-1", employeeId: "00123",
    captureRoute: "DIGITAL", identityValidated: true, attendanceProven: false,
    examStatus: "EXAMEN_PENDIENTE", status: "PENDIENTE_COTEJO", released: false
  }] : decision === "CONFIRMADO_VACIO" && !retracted ? [] : [{
    attendanceId: "attendance-ocr", sessionId: "session-1", employeeId: "00123",
    captureRoute: "OCR", identityValidated: !retracted, attendanceProven: false,
    examStatus: "EXAMEN_PENDIENTE", status: retracted ? "EXCLUIDA" : "PENDIENTE_COTEJO",
    released: false, sourceEvidenceId: "evidence-original"
  }];
  const tables = {
    SESIONES: [session], ASISTENCIAS: attendances,
    OCR_DOCUMENTOS: fixture ? [fixture.document] : [],
    OCR_RESULTADOS: fixture ? [fixture.candidate] : [],
    OCR_RECORTES_LOTES: fixture ? fixture.batches : [],
    EVIDENCIAS: fixture ? [fixture.original, ...fixture.cropEvidence] : [{
      evidenceId: "physical-evidence", sessionId: "session-1", kind: "LISTA_FISICA_ORIGINAL",
      driveFileId: "drive-physical", sha256: "d".repeat(64), mimeType: "image/png",
      immutable: true, byteSize: 100, status: "LISTA"
    }]
  };
  const updateCalls = [];
  const auditEvents = [];
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    updateMany(name, key, patches) {
      updateCalls.push({ name, key, patches });
      return patches.map((patch) => {
        const row = (tables[name] ?? []).find((item) => String(item[key]) === String(patch[key]));
        if (!row) fail("NOT_FOUND", "Fila no encontrada");
        Object.assign(row, patch);
        return row;
      });
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Set, Boolean,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0", isMockMode: () => mockMode,
      SHEETS: {
        SESSIONS: "SESIONES", ATTENDANCES: "ASISTENCIAS", OCR_DOCUMENTS: "OCR_DOCUMENTOS",
        OCR_RESULTS: "OCR_RESULTADOS", OCR_CROP_BATCHES: "OCR_RECORTES_LOTES", EVIDENCE: "EVIDENCIAS"
      }
    },
    KcmAuth: { requireRoles: () => ({ actor: "operator@example.invalid", role: "CAPACITACION" }) },
    KcmValidation: {
      fail,
      identifier(value) {
        const result = String(value ?? "");
        if (!/^[A-Za-z0-9_-]+$/.test(result)) fail("INVALID_INPUT", "Identificador invalido");
        return result;
      },
      employeeId(value) {
        const result = String(value ?? "");
        if (!/^\d{5}$/.test(result)) fail("INVALID_INPUT", "Numero invalido");
        return result;
      },
      stringArray(values, validator, maximum) {
        if (!Array.isArray(values) || values.length > maximum) fail("INVALID_INPUT", "Arreglo invalido");
        return values.map(validator);
      }
    },
    KcmServiceSupport: {
      repository: () => repository,
      session(sessionId) {
        const row = tables.SESIONES.find((item) => item.sessionId === String(sessionId));
        if (!row) fail("NOT_FOUND", "Sesion no encontrada");
        return row;
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      nowIso: () => "2026-07-21T16:30:00.000Z",
      auditMany(identity, events) { auditEvents.push(...events.map((event) => ({ identity, event }))); }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) }
  });
  new vm.Script(serviceSource, { filename: "PreReleaseService.gs" }).runInContext(context);
  return { service: context.KcmPreReleaseService, tables, updateCalls, auditEvents };
}

test("la ruta digital avanza sin documentos, lotes ni candidatos OCR", () => {
  const harness = createHarness({ route: "DIGITAL" });
  const result = harness.service.reconcilePhysicalAttendance({
    sessionId: "session-1", evidenceId: "physical-evidence", attendedEmployeeIds: ["00123"]
  });
  assert.equal(harness.tables.SESIONES[0].status, "PRELIBERACION");
  assert.equal(harness.tables.ASISTENCIAS[0].attendanceProven, true);
  assert.equal(result.counts.ocrCandidateRows, 0);
  assert.deepEqual(Array.from(result.ocrExclusions), []);
});

test("el cotejo rechaza evidencia fisica ajena, no original o sin integridad antes de escribir", () => {
  const invalidCases = [
    ["otra sesion", { sessionId: "session-other" }, "NOT_FOUND"],
    ["recorte OCR", { kind: "OCR_CROP_VISUAL" }, "INVALID_STATE"],
    ["otro tipo", { kind: "ACTA_CAPACITACION" }, "INVALID_STATE"],
    ["mutable", { immutable: false }, "INVALID_STATE"],
    ["estado no listo", { status: "PENDIENTE" }, "INVALID_STATE"],
    ["MIME no permitido", { mimeType: "text/plain" }, "INVALID_STATE"],
    ["SHA-256 invalido", { sha256: "ABC123" }, "INVALID_STATE"],
    ["tamano no positivo", { byteSize: 0 }, "INVALID_STATE"],
    ["Drive ID inseguro", { driveFileId: "drive/unsafe" }, "INVALID_STATE"]
  ];

  invalidCases.forEach(([description, patch, expectedCode]) => {
    const harness = createHarness({ route: "DIGITAL" });
    Object.assign(harness.tables.EVIDENCIAS[0], patch);
    assert.throws(
      () => harness.service.reconcilePhysicalAttendance({
        sessionId: "session-1", evidenceId: "physical-evidence", attendedEmployeeIds: ["00123"]
      }),
      (error) => error.code === expectedCode,
      description
    );
    assert.equal(harness.updateCalls.length, 0, description);
    assert.equal(harness.tables.SESIONES[0].status, "CERRADA", description);
    assert.equal(harness.tables.ASISTENCIAS[0].attendanceProven, false, description);
  });
});

test("la preliberacion usa el motivo contractual para registros ya liberados", () => {
  const harness = createHarness({ route: "DIGITAL" });
  Object.assign(harness.tables.ASISTENCIAS[0], {
    attendanceProven: true, examStatus: "EXAMEN_CONFIRMADO", released: true
  });
  const result = harness.service.preview("session-1");
  assert.equal(result.excluded.length, 1);
  assert.deepEqual(Array.from(result.excluded[0].blockingReasons), ["YA_LIBERADO_PREVIAMENTE"]);
});

test("el gate bloquea antes de escribir cuando falta el lote durable", () => {
  const harness = createHarness({ includeBatch: false });
  assert.throws(
    () => harness.service.reconcilePhysicalAttendance({
      sessionId: "session-1", evidenceId: "evidence-original", attendedEmployeeIds: ["00123"]
    }),
    (error) => error.code === "INVALID_STATE"
  );
  assert.equal(harness.updateCalls.length, 0);
  assert.equal(harness.tables.SESIONES[0].status, "REVISION_OCR");
  assert.equal(harness.tables.ASISTENCIAS[0].attendanceProven, false);
});

test("el gate rechaza lote incompleto y evidencia de casilla faltante", () => {
  const incomplete = createHarness({ batchStatus: "PENDIENTE" });
  assert.throws(() => incomplete.service.preview("session-1"), (error) => error.code === "INVALID_STATE");

  const missingEvidence = createHarness();
  missingEvidence.tables.EVIDENCIAS.splice(-1, 1);
  assert.throws(() => missingEvidence.service.preview("session-1"), (error) => error.code === "INVALID_STATE");
});

test("candidato OCR completo converge en preliberacion", () => {
  const harness = createHarness();
  const result = harness.service.reconcilePhysicalAttendance({
    sessionId: "session-1", evidenceId: "evidence-original", attendedEmployeeIds: ["00123"]
  });
  assert.equal(result.participants.length, 1);
  assert.equal(result.participants[0].captureRoute, "OCR");
  assert.equal(result.participants[0].attendanceProven, true);
  assert.equal(result.counts.ocrCandidateRows, 1);
});

test("renglon sin participante aparece en exclusiones con actor, fecha y motivo", () => {
  const harness = createHarness({ decision: "CONFIRMADO_VACIO" });
  const result = harness.service.preview("session-1");
  assert.equal(result.participants.length, 0);
  assert.equal(result.ocrExclusions.length, 1);
  assert.deepEqual({
    candidateId: result.ocrExclusions[0].candidateId,
    rowIndex: result.ocrExclusions[0].rowIndex,
    resolvedBy: result.ocrExclusions[0].resolvedBy,
    resolvedAt: result.ocrExclusions[0].resolvedAt,
    reason: result.ocrExclusions[0].reason,
    reasons: Array.from(result.ocrExclusions[0].reasons)
  }, {
    candidateId: "candidate-01", rowIndex: 1,
    resolvedBy: "reviewer@example.invalid", resolvedAt: "2026-07-21T16:00:00.000Z",
    reason: "Las cinco casillas se revisaron sin participante", reasons: ["RENGLON_SIN_PARTICIPANTE"]
  });
  assert.equal(result.counts.ocrExcludedRows, 1);
});

test("una asistencia OCR neutralizada permanece excluida y no rompe el gate", () => {
  const harness = createHarness({ decision: "CONFIRMADO_VACIO", retracted: true });
  const result = harness.service.preview("session-1");
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].employeeId, "00123");
  assert.ok(result.excluded[0].blockingReasons.includes("IDENTIDAD_INVALIDA"));
  assert.equal(result.ocrExclusions.length, 1);
});

test("un renglon sin decision definitiva bloquea preliberacion", () => {
  const harness = createHarness({ decision: "REVISION_REQUERIDA" });
  assert.throws(() => harness.service.preview("session-1"), (error) => error.code === "INVALID_STATE");
});

test("en modo productivo un documento remoto con candidato faltante no puede avanzar", () => {
  const harness = createHarness({ mockMode: false, remote: true });
  assert.throws(
    () => harness.service.preview("session-1"),
    (error) => error.code === "INVALID_STATE" && /cuarenta candidatos/.test(error.message)
  );
});
