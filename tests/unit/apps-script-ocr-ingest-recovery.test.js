import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/services/OcrWorkflowService.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function inputs() {
  return Array.from({ length: 40 }, (_, index) => index === 0 ? {
    rowIndex: 1, rawDigits: "01234",
    digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99], overallConfidence: 0.99,
    technicalFlags: []
  } : {
    rowIndex: index + 1, rawDigits: "", digitConfidences: [], overallConfidence: 0,
    technicalFlags: []
  });
}

function createHarness(failurePoint) {
  const tables = {
    OCR_DOCUMENTOS: [{
      documentId: "document-recovery", sessionId: "session-recovery", evidenceId: "evidence-recovery",
      status: "OCR_EN_PROCESO", ocrRequestId: "request-recovery"
    }],
    OCR_RESULTADOS: [],
    EMPLEADOS: [{ employeeId: "01234", active: true }],
    ASISTENCIAS: [],
    SESIONES: [{ sessionId: "session-recovery", status: "OCR_EN_PROCESO" }],
    EVIDENCIAS: [],
    AUDITORIA: []
  };
  let failurePending = true;
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
      if (failurePending && ((failurePoint === "candidates" && name === "OCR_RESULTADOS") ||
          (failurePoint === "attendance" && name === "ASISTENCIAS"))) {
        failurePending = false;
        throw new Error(`synthetic failure after ${failurePoint}`);
      }
      return rows;
    },
    updateMany(name, keyField, patches) {
      return patches.map((patch) => {
        const row = (tables[name] ?? []).find((item) => String(item[keyField]) === String(patch[keyField]));
        if (!row) fail("NOT_FOUND", "Fila sintetica ausente");
        Object.assign(row, patch);
        return row;
      });
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      SHEETS: {
        OCR_DOCUMENTS: "OCR_DOCUMENTOS", OCR_RESULTS: "OCR_RESULTADOS",
        EMPLOYEES: "EMPLEADOS", ATTENDANCES: "ASISTENCIAS", SESSIONS: "SESIONES",
        EVIDENCE: "EVIDENCIAS", AUDIT: "AUDITORIA"
      },
      ocrAutoAcceptThreshold: () => 0.98,
      ocrDigitThreshold: () => 0.98,
      ocrRequireHumanReview: () => false
    },
    KcmAuth: {
      requireRoles: () => ({ actor: "operator@example.invalid", role: "CAPACITACION" })
    },
    KcmValidation: {
      fail,
      identifier(value) {
        const text = String(value ?? "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail("INVALID_IDENTIFIER", "Identificador invalido");
        return text;
      },
      integer(value, minimum, maximum) {
        const number = Number(value);
        if (!Number.isInteger(number) || number < minimum || number > maximum) fail("INVALID_NUMBER", "Numero invalido");
        return number;
      },
      text(value, _field, maximum, required) {
        const text = String(value ?? "");
        if ((required && !text) || text.length > maximum) fail("INVALID_INPUT", "Texto invalido");
        return text;
      },
      json(value, maximum) {
        const serialized = JSON.stringify(value);
        if (serialized.length > maximum) fail("INVALID_PAYLOAD", "JSON invalido");
        return serialized;
      }
    },
    KcmServiceSupport: {
      repository: () => repository,
      parseArray(value) {
        if (Array.isArray(value)) return value;
        try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      session(sessionId) {
        const row = tables.SESIONES.find((item) => item.sessionId === sessionId);
        if (!row) fail("NOT_FOUND", "Sesion sintetica ausente");
        return row;
      },
      uuid: () => `synthetic-${++uuidSequence}`,
      nowIso: () => "2026-07-22T12:00:00.000Z",
      audit(_identity, input) {
        const event = { ...input, eventId: `audit-${tables.AUDITORIA.length + 1}` };
        tables.AUDITORIA.push(event);
        if (failurePending && failurePoint === "audit" && input.action === "OCR_RESULTS_INGESTED") {
          failurePending = false;
          throw new Error("synthetic failure after audit");
        }
        return event;
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) }
  });
  new vm.Script(source, { filename: "OcrWorkflowService.gs" }).runInContext(context);
  return { service: context.KcmOcrWorkflowService, tables };
}

function request() {
  return { documentId: "document-recovery", requestId: "request-recovery", candidates: inputs() };
}

function assertRecovered(harness) {
  const recovered = harness.service.ingestCandidatesForRemote(request());
  assert.equal(recovered.length, 40);
  assert.equal(harness.tables.OCR_RESULTADOS.length, 40);
  assert.equal(harness.tables.ASISTENCIAS.length, 1, "sólo la decisión autoaceptada genera asistencia");
  assert.equal(harness.tables.ASISTENCIAS[0].employeeId, "01234");
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_ATTENDANCE_CAPTURED").length, 1);
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_RESULTS_INGESTED").length, 1);
  assert.equal(harness.tables.AUDITORIA.find(({ action }) => action === "OCR_RESULTS_INGESTED").requestId, "request-recovery");
}

test("reanuda tras persistir candidatos y repara asistencia y auditoria", () => {
  const harness = createHarness("candidates");
  assert.throws(() => harness.service.ingestCandidatesForRemote(request()), /synthetic failure after candidates/);
  assert.equal(harness.tables.OCR_RESULTADOS.length, 40);
  assert.equal(harness.tables.ASISTENCIAS.length, 0);
  assertRecovered(harness);
});

test("reanuda tras persistir asistencia y repara sus auditorias sin duplicar", () => {
  const harness = createHarness("attendance");
  assert.throws(() => harness.service.ingestCandidatesForRemote(request()), /synthetic failure after attendance/);
  assert.equal(harness.tables.ASISTENCIAS.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 0);
  assertRecovered(harness);
});

test("reanuda tras persistir OCR_RESULTS_INGESTED sin duplicar el evento", () => {
  const harness = createHarness("audit");
  assert.throws(() => harness.service.ingestCandidatesForRemote(request()), /synthetic failure after audit/);
  assert.equal(harness.tables.AUDITORIA.filter(({ action }) => action === "OCR_RESULTS_INGESTED").length, 1);
  assertRecovered(harness);
});
