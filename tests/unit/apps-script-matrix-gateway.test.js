import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/services/MatrixGateway.gs"), "utf8");
const INTEGRITY_SECRET = "synthetic-release-integrity-secret-2026-tests-only";

function signedBytes(buffer) {
  return [...buffer].map((byte) => byte > 127 ? byte - 256 : byte);
}

function hmac(purpose, value) {
  return crypto.createHmac("sha256", INTEGRITY_SECRET).update(`${purpose}\n${value}`).digest("hex");
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validation() {
  return {
    fail,
    identifier(value) {
      const text = String(value ?? "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail("INVALID_IDENTIFIER", "Identificador invalido");
      return text;
    },
    employeeId(value) {
      const text = String(value ?? "");
      if (!/^\d{5}$/.test(text)) fail("INVALID_EMPLOYEE_ID", "Numero invalido");
      return text;
    },
    dateIso(value) {
      const text = String(value ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail("INVALID_DATE", "Fecha invalida");
      return text;
    },
    text(value, _field, maximum, required) {
      const text = String(value ?? "").trim();
      if ((required && !text) || text.length > maximum) fail("INVALID_INPUT", "Texto invalido");
      return text;
    },
    integer(value, minimum, maximum) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < minimum || number > maximum) fail("INVALID_NUMBER", "Numero invalido");
      return number;
    },
    enumValue(value, allowed) {
      if (!allowed.includes(String(value))) fail("INVALID_ENUM", "Enum invalido");
      return String(value);
    }
  };
}

function baseTables() {
  return {
    MATRIZ_MAPEO: [{
      trainingId: "training-synthetic", destinationSheet: "HC", destinationColumn: "J",
      destinationHeader: "CURSO SINTETICO", headerRow: 3, mappingVersion: "mapping-v1",
      overwritePolicy: "NO_OVERWRITE", active: true
    }],
    MATRIZ_SIMULADA: [],
    LIBERACION_LOTES: []
  };
}

function contextFor({ mock = true, tables = baseTables(), sheet = null } = {}) {
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    insertMany(name, rows) { tables[name].push(...rows.map((row) => ({ ...row }))); return rows; }
  };
  const properties = {
    KCM_MATRIX_SPREADSHEET_ID: "matrix-synthetic",
    KCM_MATRIX_EMPLOYEE_COLUMN: "B",
    KCM_MATRIX_FIRST_DATA_ROW: "4"
  };
  const context = vm.createContext({
    Array, Boolean, Date, Error, JSON, Math, Number, Object, RegExp, String, isNaN,
    KcmConfig: {
      TIME_ZONE: "America/Mexico_City",
      SHEETS: { MATRIX_MAPPING: "MATRIZ_MAPEO", MOCK_MATRIX: "MATRIZ_SIMULADA", RELEASE_BATCHES: "LIBERACION_LOTES" },
      property: (name, fallback) => Object.hasOwn(properties, name) ? properties[name] : fallback,
      isMockMode: () => mock,
      releaseIntegritySecret: () => INTEGRITY_SECRET
    },
    KcmValidation: validation(),
    KcmServiceSupport: {
      repository: () => repository,
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      nowIso: () => "2026-07-22T12:00:00.000Z"
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => undefined }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, value) => signedBytes(crypto.createHash("sha256").update(String(value)).digest()),
      computeHmacSha256Signature: (_value, _secret) => signedBytes(crypto.createHmac("sha256", _secret).update(String(_value)).digest()),
      parseDate: (value) => new Date(`${value}T12:00:00.000Z`),
      formatDate: (value) => value.toISOString().slice(0, 10)
    },
    SpreadsheetApp: {
      openById(id) { assert.equal(id, "matrix-synthetic"); return { getSheetByName: () => sheet }; },
      flush: () => undefined
    }
  });
  new vm.Script(source, { filename: "MatrixGateway.gs" }).runInContext(context);
  function durableContext(plan, { batchId = "batch-synthetic", requestId = "request-synthetic", phase = "PENDIENTE" } = {}) {
    const serializedPlan = JSON.stringify(plan);
    const planHash = crypto.createHash("sha256").update(serializedPlan).digest("hex");
    const journalMac = crypto.createHash("sha256").update(`journal:${batchId}:${phase}`).digest("hex");
    const payload = [batchId, plan.session.sessionId, requestId, planHash, plan.mapping.mappingVersion, journalMac].join("|");
    const contextValue = { batchId, requestId, planHash, journalMac, contextMac: hmac("MATRIX_CONTEXT_V1", payload) };
    const existing = tables.LIBERACION_LOTES.find((row) => row.batchId === batchId);
    const row = {
      batchId, sessionId: plan.session.sessionId, requestId,
      mappingVersion: plan.mapping.mappingVersion, planHash, plan: serializedPlan, journalMac, phase
    };
    if (existing) Object.assign(existing, row);
    else tables.LIBERACION_LOTES.push(row);
    return contextValue;
  }
  return { gateway: context.KcmMatrixGateway, tables, durableContext };
}

function session() {
  return { sessionId: "session-synthetic", trainingId: "training-synthetic", date: "2026-07-22" };
}

function participants() {
  return [
    { attendanceId: "attendance-1", employeeId: "00123" },
    { attendanceId: "attendance-2", employeeId: "00456" }
  ];
}

function createSheet({ employees = ["00123", "00456"], cells = {} } = {}) {
  const state = {
    J4: { value: "", note: "", formula: "", ...(cells.J4 ?? {}) },
    J5: { value: "", note: "", formula: "", ...(cells.J5 ?? {}) }
  };
  const writes = [];
  function one(address) {
    const cell = state[address] ?? { value: "", note: "", formula: "" };
    return {
      getDisplayValue: () => address === "J3" ? "CURSO SINTETICO" : String(cell.value ?? ""),
      getValue: () => cell.value,
      getNote: () => cell.note,
      getFormula: () => cell.formula,
      setNote(value) { cell.note = value; return this; }
    };
  }
  const sheet = {
    getLastRow: () => 5,
    getRange(address) {
      if (address === "B4:B5") return { getDisplayValues: () => employees.map((value) => [value]) };
      if (address === "J4:J5") return {
        getValues: () => [[state.J4.value], [state.J5.value]],
        getNotes: () => [[state.J4.note], [state.J5.note]],
        getFormulas: () => [[state.J4.formula], [state.J5.formula]]
      };
      return one(address);
    },
    getRangeList(addresses) {
      return {
        setValue(value) {
          addresses.forEach((address) => { state[address].value = value; state[address].formula = ""; });
          writes.push([...addresses]);
          return this;
        },
        setNumberFormat() { return this; }
      };
    }
  };
  return { sheet, state, writes };
}

test("la matriz simulada aborta todo el lote si otra sesion ya ocupo una persona y curso", () => {
  const tables = baseTables();
  tables.MATRIZ_SIMULADA.push({
    idempotencyKey: "other|00456|training-synthetic|mapping-v1", sessionId: "other",
    employeeId: "00456", trainingId: "training-synthetic", mappingVersion: "mapping-v1",
    completionDate: "2026-01-15"
  });
  const harness = contextFor({ tables });
  const plan = harness.gateway.plan(session(), participants());

  const preview = harness.gateway.preview(plan, {});
  assert.deepEqual(preview.map((item) => item.status), ["ATOMIC_BATCH_ABORTED", "EXISTING_VALUE_CONFLICT"]);
  const written = harness.gateway.write(plan, harness.durableContext(plan));
  assert.deepEqual(written.map((item) => item.status), ["ATOMIC_BATCH_ABORTED", "EXISTING_VALUE_CONFLICT"]);
  assert.equal(tables.MATRIZ_SIMULADA.length, 1);
});

test("la matriz simulada escribe el lote completo una vez y el replay no duplica", () => {
  const harness = contextFor();
  const plan = harness.gateway.plan(session(), participants());
  const context = harness.durableContext(plan);
  assert.deepEqual(harness.gateway.write(plan, context).map((item) => item.status), ["WRITTEN", "WRITTEN"]);
  assert.equal(harness.tables.MATRIZ_SIMULADA.length, 2);
  assert.deepEqual(harness.gateway.write(plan, context).map((item) => item.status), ["RECOVERED", "RECOVERED"]);
  assert.equal(harness.tables.MATRIZ_SIMULADA.length, 2);
  assert.match(harness.tables.MATRIZ_SIMULADA[0].marker, /^KCM_RELEASE_V2:batch-synthetic:[a-f0-9]{64}$/);
});

test("la vista previa real bloquea formulas aunque su valor evaluado sea vacio y no escribe parcialmente", () => {
  const matrix = createSheet({ cells: { J5: { value: "", formula: "=IF(TRUE,\"\",\"x\")" } } });
  const harness = contextFor({ mock: false, sheet: matrix.sheet });
  const plan = harness.gateway.plan(session(), participants());
  const preview = harness.gateway.preview(plan, {});
  assert.deepEqual(preview.map((item) => item.status), ["ATOMIC_BATCH_ABORTED", "EXISTING_FORMULA_CONFLICT"]);
  const context = harness.durableContext(plan);
  assert.throws(() => harness.gateway.write(plan, context), (error) =>
    error.code === "RELEASE_CONFLICT" && /precondicion atomica/.test(error.message));
  assert.equal(matrix.writes.length, 0);
  assert.equal(matrix.state.J4.value, "");
});

test("la matriz real rechaza numeros de trabajador duplicados antes de escribir", () => {
  const matrix = createSheet({ employees: ["00123", "00123"] });
  const harness = contextFor({ mock: false, sheet: matrix.sheet });
  const plan = harness.gateway.plan(session(), participants());
  assert.throws(() => harness.gateway.preview(plan, {}), (error) => error.code === "RELEASE_CONFLICT");
  assert.equal(matrix.writes.length, 0);
});

test("la matriz real limpia permanece fail-closed porque Sheets no ofrece CAS", () => {
  const matrix = createSheet();
  const harness = contextFor({ mock: false, sheet: matrix.sheet });
  const plan = harness.gateway.plan(session(), participants());
  assert.deepEqual(harness.gateway.preview(plan, {}).map((item) => item.status), ["READY", "READY"]);
  const context = harness.durableContext(plan);
  assert.throws(() => harness.gateway.write(plan, context), (error) => error.code === "RELEASE_CONFLICT");
  assert.deepEqual(matrix.writes, []);
  assert.equal(matrix.state.J4.value, "");
});

test("rechaza dos mapeos activos aunque sean identicos y no usa cache obsoleto", () => {
  const tables = baseTables();
  tables.MATRIZ_MAPEO.push({ ...tables.MATRIZ_MAPEO[0] });
  const harness = contextFor({ tables });
  assert.throws(() => harness.gateway.plan(session(), participants()), (error) => error.code === "RELEASE_CONFLICT");
});

test("un marcador SHA publico o de otro lote no autoriza recuperar un efecto", () => {
  const tables = baseTables();
  const key = "session-synthetic|00123|training-synthetic|mapping-v1";
  tables.MATRIZ_SIMULADA.push({
    idempotencyKey: key, sessionId: "session-synthetic", employeeId: "00123",
    trainingId: "training-synthetic", mappingVersion: "mapping-v1", completionDate: "2026-07-22",
    batchId: "batch-forged", planHash: crypto.createHash("sha256").update("public").digest("hex"),
    marker: `KCM_RELEASE_V1:${crypto.createHash("sha256").update(key).digest("hex")}`
  });
  const harness = contextFor({ tables });
  const plan = harness.gateway.plan(session(), participants().slice(0, 1));
  const result = harness.gateway.write(plan, harness.durableContext(plan));
  assert.equal(result[0].status, "IDEMPOTENCY_CONFLICT");
  assert.equal(tables.MATRIZ_SIMULADA.length, 1);
});

test("el commit exige que el contexto corresponda a un lote durable unico", () => {
  const harness = contextFor();
  const plan = harness.gateway.plan(session(), participants().slice(0, 1));
  const context = harness.durableContext(plan);
  harness.tables.LIBERACION_LOTES.length = 0;
  assert.throws(() => harness.gateway.write(plan, context), (error) => error.code === "RELEASE_CONFLICT");
  assert.equal(harness.tables.MATRIZ_SIMULADA.length, 0);
});

test("el contexto durable queda ligado al contenido exacto del plan", () => {
  const harness = contextFor();
  const plan = harness.gateway.plan(session(), participants().slice(0, 1));
  const context = harness.durableContext(plan);
  plan.entries[0].employeeId = "99999";
  plan.entries[0].idempotencyKey = "session-synthetic|99999|training-synthetic|mapping-v1";
  assert.throws(() => harness.gateway.write(plan, context), (error) =>
    error.code === "RELEASE_CONFLICT" && /contexto/.test(error.message));
  assert.equal(harness.tables.MATRIZ_SIMULADA.length, 0);
});

test("la verificacion historica usa el mapeo congelado sin habilitar commits obsoletos", () => {
  const harness = contextFor();
  const plan = harness.gateway.plan(session(), participants().slice(0, 1));
  const stalePlan = harness.gateway.plan(session(), participants().slice(1));
  const written = harness.gateway.write(plan, harness.durableContext(plan));
  harness.tables.MATRIZ_MAPEO[0].active = false;
  harness.tables.MATRIZ_MAPEO.push({
    ...harness.tables.MATRIZ_MAPEO[0], destinationColumn: "K", mappingVersion: "mapping-v2", active: true
  });

  assert.deepEqual(
    harness.gateway.verifyApplied(plan, harness.durableContext(plan, { phase: "COMPLETADO" }), written)
      .map((item) => item.status),
    ["RECOVERED"]
  );
  assert.deepEqual(
    harness.gateway.write(plan, harness.durableContext(plan)).map((item) => item.status),
    ["RECOVERED"]
  );
  assert.throws(
    () => harness.gateway.write(stalePlan, harness.durableContext(stalePlan, {
      batchId: "batch-stale", requestId: "request-stale"
    })),
    (error) => error.code === "RELEASE_CONFLICT" && /mapeo activo cambio/.test(error.message)
  );
  assert.equal(harness.tables.MATRIZ_SIMULADA.length, 1);
});
