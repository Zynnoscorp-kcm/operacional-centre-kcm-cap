import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/services/ExamService.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createHarness({ sessionStatus = "LIBERADA_PARCIAL", pending = true } = {}) {
  let uuid = 0;
  let locksReleased = 0;
  const tables = {
    SESIONES: [{ sessionId: "session-partial", status: sessionStatus, authorized: true }],
    ASISTENCIAS: [
      {
        attendanceId: "attendance-released", sessionId: "session-partial", employeeId: "00123",
        identityValidated: true, attendanceProven: true, examStatus: "EXAMEN_CONFIRMADO",
        status: "LIBERADA", released: true
      },
      ...(pending ? [{
        attendanceId: "attendance-pending", sessionId: "session-partial", employeeId: "00456",
        identityValidated: true, attendanceProven: true, examStatus: "EXAMEN_NO_ENCONTRADO",
        status: "EXAMEN_NO_ENCONTRADO", released: false
      }] : [])
    ],
    EXAMENES: [],
    AUDITORIA: []
  };
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      const copies = rows.map((row) => ({ ...row }));
      return predicate ? copies.filter(predicate) : copies;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    insertMany(name, rows) { tables[name].push(...rows.map((row) => ({ ...row }))); return rows; },
    updateMany(name, keyField, updates) {
      return updates.map((patch) => {
        const row = tables[name].find((item) => String(item[keyField]) === String(patch[keyField]));
        if (!row) fail("NOT_FOUND", "Registro ausente");
        Object.assign(row, patch);
        return { ...row };
      });
    }
  };
  const auditEvents = [];
  const support = {
    repository: () => repository,
    session(sessionId) {
      const row = tables.SESIONES.find((item) => item.sessionId === sessionId);
      if (!row) fail("NOT_FOUND", "Sesion ausente");
      return { ...row };
    },
    asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
    nowIso: () => "2026-07-22T13:00:00.000Z",
    uuid: () => `synthetic-${++uuid}`,
    auditMany(_identity, events) { auditEvents.push(...events.map((event) => ({ ...event }))); },
    audit(_identity, event) { auditEvents.push({ ...event }); }
  };
  const validation = {
    fail,
    integer(value, minimum, maximum) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < minimum || number > maximum) fail("INVALID_NUMBER", "Numero invalido");
      return number;
    },
    employeeId(value) {
      const text = String(value ?? "");
      if (!/^\d{5}$/.test(text)) fail("INVALID_EMPLOYEE_ID", "Numero invalido");
      return text;
    },
    stringArray(value, validator, maximum) {
      if (!Array.isArray(value) || value.length > maximum) fail("INVALID_ARRAY", "Lista invalida");
      return value.map(validator);
    },
    json(value, maximum) {
      const serialized = JSON.stringify(value);
      if (serialized.length > maximum) fail("INVALID_PAYLOAD", "JSON invalido");
      return serialized;
    }
  };
  const context = vm.createContext({
    Array, Boolean, Date, Error, JSON, Math, Number, Object, Set, String,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      SHEETS: { ATTENDANCES: "ASISTENCIAS", SESSIONS: "SESIONES", EXAMS: "EXAMENES" }
    },
    KcmValidation: validation,
    KcmAuth: { requireRoles: () => ({ actor: "operator@example.invalid", role: "CAPACITACION" }) },
    KcmServiceSupport: support,
    KcmPreReleaseService: {
      preview: () => ({
        session: { ...tables.SESIONES[0] },
        participants: tables.ASISTENCIAS.map((row) => ({ ...row })),
        included: tables.ASISTENCIAS.filter((row) => !row.released && row.examStatus === "EXAMEN_CONFIRMADO"),
        excluded: tables.ASISTENCIAS.filter((row) => row.released || row.examStatus !== "EXAMEN_CONFIRMADO"),
        ocrExclusions: [], counts: { total: tables.ASISTENCIAS.length, included: 1, excluded: 1 }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { locksReleased += 1; } }) }
  });
  new vm.Script(source, { filename: "ExamService.gs" }).runInContext(context);
  return { service: context.KcmExamService, tables, auditEvents, locksReleased: () => locksReleased };
}

test("un examen localizado despues de una liberacion parcial vuelve a habilitar la sesion", () => {
  const harness = createHarness();
  const result = harness.service.reconcile({
    sessionId: "session-partial", receivedExamCount: 1, missingEmployeeIds: []
  });

  assert.equal(harness.tables.ASISTENCIAS[0].released, true, "la liberacion previa permanece inmutable");
  assert.equal(harness.tables.ASISTENCIAS[1].examStatus, "EXAMEN_CONFIRMADO");
  assert.equal(harness.tables.SESIONES[0].status, "LISTA_PARA_LIBERAR");
  assert.deepEqual([...result.reconciliation.missingEmployeeIds], []);
  assert.equal(typeof harness.tables.EXAMENES[0].missingEmployeeIds, "string", "Sheets conserva JSON, el DTO no");
  const event = harness.auditEvents.find((item) => item.entityId === "attendance-pending");
  assert.deepEqual([event.previousState, event.newState], ["EXAMEN_NO_ENCONTRADO", "EXAMEN_CONFIRMADO"]);
  assert.equal(harness.locksReleased(), 1);
});

test("una conciliacion parcial puede conservar otro examen como no encontrado", () => {
  const harness = createHarness();
  const result = harness.service.reconcile({
    sessionId: "session-partial", receivedExamCount: 0, missingEmployeeIds: ["00456"]
  });
  assert.equal(harness.tables.SESIONES[0].status, "LIBERADA_PARCIAL");
  assert.deepEqual([...result.reconciliation.missingEmployeeIds], ["00456"]);
  assert.equal(harness.tables.ASISTENCIAS[1].examStatus, "EXAMEN_NO_ENCONTRADO");
});

test("rechaza una parcial sin asistencias pendientes y siempre libera el lock", () => {
  const harness = createHarness({ pending: false });
  assert.throws(
    () => harness.service.reconcile({ sessionId: "session-partial", receivedExamCount: 0, missingEmployeeIds: [] }),
    (error) => error.code === "INVALID_STATE"
  );
  assert.equal(harness.locksReleased(), 1);
  assert.equal(harness.tables.EXAMENES.length, 0);
});
