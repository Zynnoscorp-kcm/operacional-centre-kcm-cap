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

function createHarness({ requireHumanReview = false, autoAcceptThreshold = 0.98, digitThreshold = 0.98 } = {}) {
  const tables = {
    OCR_DOCUMENTOS: [{
      documentId: "document-flags", sessionId: "session-flags", evidenceId: "evidence-flags",
      sha256: "synthetic-hash", mimeType: "image/png", byteSize: 100, pageCount: 1,
      status: "OCR_EN_PROCESO", createdAt: "2026-07-21T12:00:00.000Z", version: "1.0.0"
    }],
    OCR_RESULTADOS: [],
    EVIDENCIAS: [],
    EMPLEADOS: [{ employeeId: "01234", active: true }],
    ASISTENCIAS: [],
    SESIONES: [{ sessionId: "session-flags", status: "OCR_EN_PROCESO" }]
  };
  let uuidIndex = 0;
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    insertMany(name, rows) {
      tables[name].push(...rows.map((row) => ({ ...row })));
      return rows;
    },
    updateMany(name, keyField, updates) {
      return updates.map((update) => {
        const row = tables[name].find((item) => String(item[keyField]) === String(update[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
        Object.assign(row, update);
        return row;
      });
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      ocrAutoAcceptThreshold: () => autoAcceptThreshold,
      ocrDigitThreshold: () => digitThreshold,
      ocrRequireHumanReview: () => requireHumanReview,
      SHEETS: {
        OCR_DOCUMENTS: "OCR_DOCUMENTOS", OCR_RESULTS: "OCR_RESULTADOS",
        EVIDENCE: "EVIDENCIAS", EMPLOYEES: "EMPLEADOS", ATTENDANCES: "ASISTENCIAS",
        SESSIONS: "SESIONES", AUDIT: "AUDITORIA"
      }
    },
    KcmAuth: { requireRoles: () => ({ actor: "reviewer@example.invalid", role: "CAPACITACION" }) },
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
        const text = JSON.stringify(value);
        if (text.length > maximum) fail("INVALID_PAYLOAD", "JSON invalido");
        return text;
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
        if (!row) fail("NOT_FOUND", "Sesion ausente");
        return row;
      },
      uuid: () => `synthetic-${++uuidIndex}`,
      nowIso: () => "2026-07-21T12:00:00.000Z",
      audit: () => undefined
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) }
  });
  new vm.Script(source, { filename: "OcrWorkflowService.gs" }).runInContext(context);
  return { service: context.KcmOcrWorkflowService, tables };
}

function candidate(technicalFlags = []) {
  return {
    rowIndex: 1,
    rawDigits: "01234",
    digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99],
    overallConfidence: 0.99,
    technicalFlags
  };
}

test("un warning geometrico persiste y nunca puede autoaceptarse", () => {
  const harness = createHarness();
  const [result] = harness.service.ingestCandidates({
    documentId: "document-flags",
    candidates: [candidate(["PAGE_ALIGNMENT_REVIEW_REQUIRED"])]
  });
  assert.equal(result.decision, "REVISION_REQUERIDA");
  assert.deepEqual([...result.validationFlags], ["PAGE_ALIGNMENT_REVIEW_REQUIRED"]);
  assert.equal(harness.tables.ASISTENCIAS.length, 0);
});

test("sin warning y con identidad y confianza validas conserva autoaceptacion", () => {
  const harness = createHarness({ requireHumanReview: false });
  const [result] = harness.service.ingestCandidates({
    documentId: "document-flags",
    candidates: [candidate()]
  });
  assert.equal(result.decision, "AUTO_ACEPTADO");
  assert.deepEqual([...result.validationFlags], []);
  assert.equal(harness.tables.ASISTENCIAS.length, 1);
});

test("la politica conservadora exige revision humana aun con identidad y confianza validas", () => {
  const harness = createHarness({ requireHumanReview: true });
  const [result] = harness.service.ingestCandidates({
    documentId: "document-flags",
    candidates: [candidate()]
  });
  assert.equal(result.decision, "REVISION_REQUERIDA");
  assert.deepEqual([...result.validationFlags], ["HUMAN_REVIEW_REQUIRED_BY_POLICY"]);
  assert.equal(harness.tables.ASISTENCIAS.length, 0);
});

test("rechaza flags no tecnicos antes de persistir resultados", () => {
  const harness = createHarness();
  assert.throws(
    () => harness.service.ingestCandidates({
      documentId: "document-flags",
      candidates: [candidate(["AUTO_ACEPTADO"])]
    }),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.equal(harness.tables.OCR_RESULTADOS.length, 0);
});
