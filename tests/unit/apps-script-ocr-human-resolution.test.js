import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/apps-script");
const serviceSource = await readFile(path.join(ROOT, "services/OcrWorkflowService.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function cropFixture(candidateId = "candidate-01", rowIndex = 1, requestId = "request-crops") {
  const refs = [];
  const evidence = [];
  for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
    const cropId = `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`;
    const visualEvidenceId = `visual-${rowIndex}-${digitIndex}`;
    const processedEvidenceId = `processed-${rowIndex}-${digitIndex}`;
    refs.push({ cropId, digitIndex, visualEvidenceId, processedEvidenceId });
    evidence.push({
      evidenceId: visualEvidenceId, sessionId: "session-1", kind: "OCR_CROP_VISUAL",
      driveFileId: `drive-visual-${rowIndex}-${digitIndex}`, sha256: "a".repeat(64),
      mimeType: "image/png", immutable: true, documentId: "document-1", candidateId,
      cropId, variant: "CROP_VISUAL", byteSize: 80, requestId, status: "LISTA"
    }, {
      evidenceId: processedEvidenceId, sessionId: "session-1", kind: "OCR_CROP_PROCESSED",
      driveFileId: `drive-processed-${rowIndex}-${digitIndex}`, sha256: "b".repeat(64),
      mimeType: "image/png", immutable: true, documentId: "document-1", candidateId,
      cropId, variant: "CROP_PROCESSED", byteSize: 70, requestId, status: "LISTA"
    });
  }
  return { refs, evidence };
}

function createHarness({
  decision = "AUTO_ACEPTADO", captureRoute = "OCR", includeAttendance = true,
  failAuditActionOnce = "", failCandidateReplaceOnce = false
} = {}) {
  const crops = cropFixture();
  const tables = {
    OCR_DOCUMENTOS: [{
      documentId: "document-1", sessionId: "session-1", evidenceId: "evidence-original",
      status: "REVISION_OCR", sha256: "c".repeat(64), mimeType: "image/png"
    }],
    OCR_RESULTADOS: [{
      candidateId: "candidate-01", documentId: "document-1", rowIndex: 1,
      rawDigits: "00123", normalizedEmployeeId: "00123", decision,
      validationFlags: "[]", originalValue: "00123", correctedValue: "",
      correctionActor: "", correctionAt: "", correctionReason: "",
      cropEvidenceRefs: JSON.stringify(crops.refs), digitConfidences: "[0.99,0.99,0.99,0.99,0.99]",
      overallConfidence: 0.99, version: "1.0.0"
    }],
    EVIDENCIAS: [{
      evidenceId: "evidence-original", sessionId: "session-1", kind: "LISTA_FISICA_ORIGINAL",
      driveFileId: "drive-original", sha256: "c".repeat(64), mimeType: "image/png", immutable: true
    }, ...crops.evidence],
    OCR_RECORTES_LOTES: [{
      batchId: "batch-1", requestId: "request-crops", sessionId: "session-1",
      documentId: "document-1", status: "COMPLETADO"
    }],
    EMPLEADOS: [
      { employeeId: "00123", active: true },
      { employeeId: "00999", active: true }
    ],
    ASISTENCIAS: includeAttendance ? [{
      attendanceId: "attendance-old", sessionId: "session-1", employeeId: "00123",
      captureRoute, identityValidated: true, attendanceProven: false,
      examStatus: "EXAMEN_PENDIENTE", status: "PENDIENTE_COTEJO", released: false,
      sourceEvidenceId: "evidence-original"
    }] : [],
    AUDITORIA: []
  };
  const audits = [];
  let pendingAuditFailure = failAuditActionOnce;
  let pendingCandidateReplaceFailure = failCandidateReplaceOnce;
  let uuidSequence = 0;
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    insertMany(name, rows) {
      tables[name] ??= [];
      tables[name].push(...rows.map((row) => ({ ...row })));
      return rows;
    },
    updateMany(name, key, patches) {
      return patches.map((patch) => {
        const row = (tables[name] ?? []).find((item) => String(item[key]) === String(patch[key]));
        if (!row) fail("NOT_FOUND", "Fila no encontrada");
        Object.assign(row, patch);
        return row;
      });
    },
    replaceOne(name, key, replacement) {
      if (name === "OCR_RESULTADOS" && pendingCandidateReplaceFailure) {
        pendingCandidateReplaceFailure = false;
        throw Object.assign(new Error("Fallo sintetico antes del reemplazo de candidato"), {
          code: "CONFLICT", retryable: true
        });
      }
      const row = (tables[name] ?? []).find((item) => String(item[key]) === String(replacement[key]));
      if (!row) fail("NOT_FOUND", "Fila no encontrada");
      Object.keys(row).forEach((field) => delete row[field]);
      Object.assign(row, replacement);
      return row;
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Set, isFinite,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      SHEETS: {
        OCR_DOCUMENTS: "OCR_DOCUMENTOS", OCR_RESULTS: "OCR_RESULTADOS",
        OCR_CROP_BATCHES: "OCR_RECORTES_LOTES", EVIDENCE: "EVIDENCIAS",
        EMPLOYEES: "EMPLEADOS", ATTENDANCES: "ASISTENCIAS", AUDIT: "AUDITORIA"
      },
      ocrAutoAcceptThreshold: () => 0.98,
      ocrDigitThreshold: () => 0.98,
      ocrRequireHumanReview: () => false
    },
    KcmAuth: { requireRoles: () => ({ actor: "reviewer@example.invalid", role: "CAPACITACION" }) },
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
      text(value, field, maximum, required) {
        const result = String(value ?? "").trim();
        if (required && !result) fail("INVALID_INPUT", `${field} requerido`);
        if (result.length > maximum) fail("INVALID_INPUT", `${field} excedido`);
        return result;
      },
      integer: (value) => Number(value),
      json: (value) => JSON.stringify(value),
      enumValue(value, allowed) {
        if (!allowed.includes(value)) fail("INVALID_INPUT", "Enum invalido");
        return value;
      }
    },
    KcmServiceSupport: {
      repository: () => repository,
      parseArray(value) {
        if (Array.isArray(value)) return value;
        try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      session: () => ({ sessionId: "session-1", status: "REVISION_OCR" }),
      nowIso: () => "2026-07-21T15:00:00.000Z",
      uuid: () => `synthetic-${++uuidSequence}`,
      audit(identity, input) {
        if (pendingAuditFailure === input.action) {
          pendingAuditFailure = "";
          throw Object.assign(new Error("Fallo sintetico de auditoria"), { code: "CONFLICT", retryable: true });
        }
        const event = { ...input, eventId: `audit-${tables.AUDITORIA.length + 1}` };
        tables.AUDITORIA.push(event);
        audits.push({ identity, input: event });
        return event;
      }
    },
    KcmDriveEvidenceRepository: {
      previewEvidence: () => null,
      parseDataUrl: () => { throw new Error("not expected"); },
      saveOriginal: () => { throw new Error("not expected"); }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) }
  });
  new vm.Script(serviceSource, { filename: "OcrWorkflowService.gs" }).runInContext(context);
  return { service: context.KcmOcrWorkflowService, tables, audits };
}

function addPendingSecondCandidate(harness) {
  const crops = cropFixture("candidate-02", 2);
  harness.tables.OCR_RESULTADOS.push({
    candidateId: "candidate-02", documentId: "document-1", rowIndex: 2,
    rawDigits: "", normalizedEmployeeId: "", decision: "REVISION_REQUERIDA",
    validationFlags: "[]", originalValue: "", correctedValue: "",
    correctionActor: "", correctionAt: "", correctionReason: "",
    correctionRequestId: "", correctionPreviousDecision: "", correctionPreviousEmployeeId: "",
    cropEvidenceRefs: JSON.stringify(crops.refs), digitConfidences: "[]",
    overallConfidence: 0, version: "1.0.0"
  });
  harness.tables.EVIDENCIAS.push(...crops.evidence);
}

test("confirmar falso positivo autoaceptado neutraliza la asistencia OCR sin borrarla", () => {
  const harness = createHarness();
  const result = harness.service.confirmEmptyCandidate({
    candidateId: "candidate-01",
    reason: "Revision visual de las cinco casillas: renglon sin participante",
    requestId: "request-empty-01"
  });

  assert.equal(result.decision, "CONFIRMADO_VACIO");
  assert.equal(result.correctionAt, "2026-07-21T15:00:00.000Z");
  assert.equal(harness.tables.OCR_RESULTADOS[0].correctionActor, "reviewer@example.invalid");
  assert.equal(harness.tables.OCR_RESULTADOS[0].correctionReason, "Revision visual de las cinco casillas: renglon sin participante");
  assert.equal(harness.tables.ASISTENCIAS.length, 1);
  assert.deepEqual({
    status: harness.tables.ASISTENCIAS[0].status,
    identityValidated: harness.tables.ASISTENCIAS[0].identityValidated,
    attendanceProven: harness.tables.ASISTENCIAS[0].attendanceProven
  }, { status: "EXCLUIDA", identityValidated: false, attendanceProven: false });
  assert.ok(harness.audits.some(({ input }) => input.action === "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW"));
  assert.ok(harness.audits.some(({ input }) => input.action === "OCR_ROW_CONFIRMED_EMPTY"));
  assert.throws(
    () => harness.service.reviewCandidate({ candidateId: "candidate-01", correctedValue: "00999", reason: "Intento posterior", requestId: "request-late-01" }),
    (error) => error.code === "INVALID_STATE"
  );
});

test("confirmar renglon vacio pendiente no crea asistencia", () => {
  const harness = createHarness({ decision: "REVISION_REQUERIDA", includeAttendance: false });
  harness.service.confirmEmptyCandidate({ candidateId: "candidate-01", reason: "Renglon revisado sin participante", requestId: "request-empty-02" });
  assert.equal(harness.tables.ASISTENCIAS.length, 0);
  assert.equal(harness.audits.some(({ input }) => input.action === "OCR_ATTENDANCE_CAPTURED"), false);
});

test("confirmar vacio no neutraliza una asistencia digital compartida", () => {
  const harness = createHarness({ captureRoute: "DIGITAL" });
  harness.service.confirmEmptyCandidate({ candidateId: "candidate-01", reason: "Renglon OCR sin participante", requestId: "request-empty-03" });
  assert.equal(harness.tables.ASISTENCIAS[0].status, "PENDIENTE_COTEJO");
  assert.equal(harness.tables.ASISTENCIAS[0].identityValidated, true);
  assert.equal(harness.audits.some(({ input }) => input.action === "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW"), false);
});

test("confirmar vacio preserva una asistencia OCR respaldada por otro candidato confirmado", () => {
  const harness = createHarness();
  harness.tables.OCR_DOCUMENTOS.push({
    documentId: "document-2", sessionId: "session-1", evidenceId: "evidence-other", status: "REVISION_OCR"
  });
  harness.tables.OCR_RESULTADOS.push({
    candidateId: "candidate-other", documentId: "document-2", rowIndex: 2,
    rawDigits: "00123", normalizedEmployeeId: "00123", correctedValue: "",
    decision: "CONFIRMADO_HUMANO"
  });
  harness.service.confirmEmptyCandidate({ candidateId: "candidate-01", reason: "El primer renglon esta vacio", requestId: "request-empty-04" });
  assert.equal(harness.tables.ASISTENCIAS[0].status, "PENDIENTE_COTEJO");
  assert.equal(harness.tables.ASISTENCIAS[0].identityValidated, true);
  assert.equal(harness.audits.some(({ input }) => input.action === "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW"), false);
});

test("corregir un autoaceptado a otro ID crea el nuevo y neutraliza el anterior", () => {
  const harness = createHarness();
  const result = harness.service.reviewCandidate({
    candidateId: "candidate-01", correctedValue: "00999",
    reason: "Los recortes muestran una identidad distinta", requestId: "request-correct-01"
  });

  assert.equal(result.decision, "CONFIRMADO_HUMANO");
  assert.equal(result.normalizedEmployeeId, "00999");
  assert.equal(harness.tables.ASISTENCIAS.length, 2);
  const previous = harness.tables.ASISTENCIAS.find(({ employeeId }) => employeeId === "00123");
  const corrected = harness.tables.ASISTENCIAS.find(({ employeeId }) => employeeId === "00999");
  assert.deepEqual([previous.status, previous.identityValidated, previous.attendanceProven], ["EXCLUIDA", false, false]);
  assert.deepEqual([corrected.status, corrected.identityValidated, corrected.captureRoute], ["PENDIENTE_COTEJO", true, "OCR"]);
  assert.ok(harness.audits.some(({ input }) => input.action === "OCR_ATTENDANCE_RETRACTED_CORRECTION"));
});

test("otra decision confirmada reactiva una asistencia OCR previamente retractada", () => {
  const harness = createHarness({ failAuditActionOnce: "OCR_ATTENDANCE_REACTIVATED" });
  addPendingSecondCandidate(harness);
  harness.service.reviewCandidate({
    candidateId: "candidate-01", correctedValue: "00999",
    reason: "La primera fila corresponde a otra identidad", requestId: "request-first-correction"
  });
  const originalAttendance = harness.tables.ASISTENCIAS.find(({ employeeId }) => employeeId === "00123");
  assert.deepEqual(
    [originalAttendance.status, originalAttendance.identityValidated],
    ["EXCLUIDA", false]
  );

  const secondInput = {
    candidateId: "candidate-02", correctedValue: "00123",
    reason: "La segunda fila contiene la identidad original", requestId: "request-reactivate"
  };
  assert.throws(() => harness.service.reviewCandidate(secondInput), /Fallo sintetico de auditoria/);
  assert.deepEqual(
    [originalAttendance.status, originalAttendance.identityValidated, harness.tables.OCR_RESULTADOS[1].decision],
    ["PENDIENTE_COTEJO", true, "CONFIRMADO_HUMANO"]
  );

  const recovered = harness.service.reviewCandidate(secondInput);
  assert.equal(recovered.decision, "CONFIRMADO_HUMANO");
  assert.equal(recovered.normalizedEmployeeId, "00123");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ATTENDANCE_REACTIVATED").length, 1);
  assert.equal(harness.tables.ASISTENCIAS.filter(({ employeeId }) => employeeId === "00123").length, 1);
});

test("un retry terminal repara la auditoria final sin duplicar efectos", () => {
  const harness = createHarness({ failAuditActionOnce: "OCR_ROW_CONFIRMED_EMPTY" });
  const first = {
    candidateId: "candidate-01", reason: "Las cinco casillas confirman un renglon vacio",
    requestId: "request-empty-recovery"
  };
  assert.throws(() => harness.service.confirmEmptyCandidate(first), /Fallo sintetico de auditoria/);
  assert.equal(harness.tables.OCR_RESULTADOS[0].decision, "CONFIRMADO_VACIO");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ROW_CONFIRMED_EMPTY").length, 0);

  const replay = harness.service.confirmEmptyCandidate({ ...first, requestId: "request-client-retry" });
  assert.equal(replay.decision, "CONFIRMADO_VACIO");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ROW_CONFIRMED_EMPTY").length, 1);
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW").length, 1);
  assert.equal(harness.tables.AUDITORIA.find(({ action }) => action === "OCR_ROW_CONFIRMED_EMPTY").requestId, "request-empty-recovery");
});

test("un retry repara la auditoria de retraccion si la asistencia ya quedo excluida", () => {
  const harness = createHarness({ failAuditActionOnce: "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW" });
  const input = {
    candidateId: "candidate-01", reason: "Revision visual sin identidad",
    requestId: "request-retract-recovery"
  };
  assert.throws(() => harness.service.confirmEmptyCandidate(input), /Fallo sintetico de auditoria/);
  assert.equal(harness.tables.ASISTENCIAS[0].status, "EXCLUIDA");
  assert.equal(harness.tables.OCR_RESULTADOS[0].decision, "CONFIRMADO_VACIO");
  assert.equal(harness.tables.OCR_RESULTADOS[0].correctionRequestId, "request-retract-recovery");

  harness.service.confirmEmptyCandidate(input);
  assert.equal(harness.tables.OCR_RESULTADOS[0].decision, "CONFIRMADO_VACIO");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW").length, 1);
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ROW_CONFIRMED_EMPTY").length, 1);
});

test("un fallo antes del reemplazo atomico conserva la intencion reanudable", () => {
  const harness = createHarness({ failCandidateReplaceOnce: true });
  const input = {
    candidateId: "candidate-01", reason: "Las cinco casillas no contienen identidad",
    requestId: "request-atomic-candidate"
  };
  assert.throws(
    () => harness.service.confirmEmptyCandidate(input),
    /Fallo sintetico antes del reemplazo de candidato/
  );
  assert.equal(harness.tables.OCR_RESULTADOS[0].decision, "AUTO_ACEPTADO");
  assert.equal(harness.tables.OCR_RESULTADOS[0].correctionRequestId ?? "", "");
  assert.equal(harness.tables.ASISTENCIAS[0].status, "PENDIENTE_COTEJO");

  const recovered = harness.service.confirmEmptyCandidate(input);
  assert.equal(recovered.decision, "CONFIRMADO_VACIO");
  assert.equal(harness.tables.OCR_RESULTADOS[0].correctionRequestId, "request-atomic-candidate");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW").length, 1);
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ROW_CONFIRMED_EMPTY").length, 1);
});

test("un replace fallido no deja efectos huerfanos si el retry cambia de decision", () => {
  const harness = createHarness({ failCandidateReplaceOnce: true });
  assert.throws(() => harness.service.reviewCandidate({
    candidateId: "candidate-01", correctedValue: "00999",
    reason: "Primer intento de correccion", requestId: "request-first-divergent"
  }), /Fallo sintetico antes del reemplazo de candidato/);
  assert.equal(harness.tables.ASISTENCIAS.some(({ employeeId }) => employeeId === "00999"), false);
  assert.deepEqual(
    [harness.tables.ASISTENCIAS[0].status, harness.tables.ASISTENCIAS[0].identityValidated],
    ["PENDIENTE_COTEJO", true]
  );

  harness.service.confirmEmptyCandidate({
    candidateId: "candidate-01", reason: "La revision final confirma fila vacia",
    requestId: "request-second-divergent"
  });
  assert.equal(harness.tables.OCR_RESULTADOS[0].decision, "CONFIRMADO_VACIO");
  assert.equal(harness.tables.ASISTENCIAS.some(({ employeeId }) => employeeId === "00999"), false);
  assert.equal(harness.tables.ASISTENCIAS[0].status, "EXCLUIDA");
});

test("la ruta publica no admite diferir el estado y la interna remota si lo conserva", () => {
  const harness = createHarness({ includeAttendance: false });
  assert.throws(
    () => harness.service.ingestCandidates({ documentId: "document-1", candidates: [], deferReviewState: true }),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.equal(typeof harness.service.ingestCandidatesForRemote, "function");
});
