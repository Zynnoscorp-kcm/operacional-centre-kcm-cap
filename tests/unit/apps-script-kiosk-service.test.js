import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");
const kioskSource = await readFile(path.join(ROOT, "services/KioskService.gs"), "utf8");
const adminSource = await readFile(path.join(ROOT, "services/AdminAndAuditService.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createHarness({
  attendanceCount = 0,
  sessionStatus = "ABIERTA",
  failAuditOnce = false,
  failAttendanceOnce = false,
  failCompleteOnce = false
} = {}) {
  const session = {
    sessionId: "session-kiosk-1",
    sessionCode: "KCM-260722-KIOSK1",
    trainingId: "CAP-SINT-001",
    status: sessionStatus,
    createdBy: "trainer@example.invalid"
  };
  const tables = {
    EMPLEADOS: Array.from({ length: 41 }, (_, index) => ({
      employeeId: String(index + 1).padStart(5, "0"),
      displayName: `Persona ${String(index + 1).padStart(2, "0")}`,
      area: "Área sintética",
      active: true
    })),
    ASISTENCIAS: Array.from({ length: attendanceCount }, (_, index) => ({
      attendanceId: `attendance-${index + 1}`,
      sessionId: session.sessionId,
      employeeId: String(index + 1).padStart(5, "0"),
      captureRoute: "DIGITAL",
      status: "PENDIENTE_COTEJO"
    })),
    KIOSK_REGISTROS: [],
    CAPACITACIONES: [],
    AUDITORIA: Array.from({ length: attendanceCount }, (_, index) => ({
      eventId: `audit-existing-${index + 1}`,
      sessionId: session.sessionId,
      entityType: "Attendance",
      entityId: `attendance-${index + 1}`,
      action: "DIGITAL_ATTENDANCE_CAPTURED",
      requestId: `request-existing-${index + 1}`
    })),
    OCR_DOCUMENTOS: [],
    EVIDENCIAS: []
  };
  const audits = [];
  let pendingAuditFailure = failAuditOnce;
  let pendingAttendanceFailure = failAttendanceOnce;
  let pendingCompleteFailure = failCompleteOnce;
  const rateLimits = [];
  let sequence = 0;
  const repositoryCalls = { list: 0 };
  const repository = {
    list(name, predicate) {
      repositoryCalls.list += 1;
      const rows = tables[name] || [];
      return predicate ? rows.filter(predicate) : rows.slice();
    },
    findOne(name, predicate) {
      return (tables[name] || []).find(predicate) || null;
    },
    insertMany(name, rows) {
      if (name === "ASISTENCIAS" && pendingAttendanceFailure) {
        pendingAttendanceFailure = false;
        throw Object.assign(new Error("Fallo sintético de asistencia"), { code: "CONFLICT", retryable: true });
      }
      tables[name] = (tables[name] || []).concat(rows.map((row) => ({ ...row })));
      return rows;
    },
    updateMany(name, keyField, updates) {
      if (name === "KIOSK_REGISTROS" && updates[0]?.phase === "COMPLETADO" && pendingCompleteFailure) {
        pendingCompleteFailure = false;
        throw Object.assign(new Error("Fallo sintético de cierre"), { code: "CONFLICT", retryable: true });
      }
      return updates.map((update) => {
        const row = (tables[name] || []).find((item) => String(item[keyField]) === String(update[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintético ausente");
        Object.assign(row, update);
        return row;
      });
    }
  };
  const validation = {
    fail,
    text(value, field, maximum, required) {
      if (typeof value !== "string") fail("INVALID_INPUT", `${field} inválido`);
      const normalized = value.trim();
      if (required && !normalized) fail("INVALID_INPUT", `${field} requerido`);
      if (normalized.length > maximum) fail("INVALID_INPUT", `${field} demasiado largo`);
      return normalized;
    },
    identifier(value) {
      const normalized = String(value || "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalized)) fail("INVALID_IDENTIFIER", "Identificador inválido");
      return normalized;
    },
    employeeId(value) {
      if (typeof value !== "string" || !/^\d{5}$/.test(value)) fail("INVALID_EMPLOYEE_ID", "Número inválido");
      return value;
    }
  };
  const context = vm.createContext({
    Array, Boolean, Date, Error, Math, Number, Object, String,
    KcmValidation: validation,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      SHEETS: {
        ATTENDANCES: "ASISTENCIAS", EMPLOYEES: "EMPLEADOS", TRAININGS: "CAPACITACIONES",
        KIOSK_REGISTRATIONS: "KIOSK_REGISTROS",
        AUDIT: "AUDITORIA", OCR_DOCUMENTS: "OCR_DOCUMENTOS", EVIDENCE: "EVIDENCIAS"
      },
      property: (name) => name === "KCM_KIOSK_WEB_APP_URL"
        ? "https://script.google.com/macros/s/example-synthetic/exec"
        : "",
      kioskTokenMinutes: () => 120,
      isMockMode: () => false
    },
    KcmAuth: {
      requireRoles: () => ({ actor: "trainer@example.invalid", role: "CAPACITADOR" }),
      createKioskToken: () => ({
        token: "signed.synthetic.kiosk-token-value",
        expiresAt: "2026-07-22T18:00:00.000Z"
      }),
      verifyKioskToken: () => ({
        actor: "KIOSK", role: "KIOSK", sessionId: session.sessionId,
        stationLabel: "Sala sintética · Equipo 01", expiresAt: "2026-07-22T18:00:00.000Z"
      }),
      enforceKioskRateLimit: (token, limit) => rateLimits.push({ token, limit }),
      currentIdentity: () => ({ actor: "admin@example.invalid", role: "ADMINISTRADOR" })
    },
    KcmServiceSupport: {
      repository: () => repository,
      session: (sessionId) => {
        if (sessionId !== session.sessionId) fail("NOT_FOUND", "Sesión no encontrada");
        return session;
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      nowIso: () => "2026-07-22T16:00:00.000Z",
      uuid: () => `attendance-new-${++sequence}`,
      audit: (identity, event) => {
        const audit = {
          eventId: `audit-${audits.length + 1}`,
          sessionId: event.sessionId,
          entityType: event.entityType,
          entityId: event.entityId,
          action: event.action,
          requestId: event.requestId || "request-generated"
        };
        if (pendingAuditFailure) {
          pendingAuditFailure = false;
          throw Object.assign(new Error("Fallo sintético de auditoría"), { code: "CONFLICT", retryable: true });
        }
        tables.AUDITORIA.push(audit);
        audits.push({ identity, event });
        return audit;
      }
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    KcmMockRepository: { seedSynthetic: () => {} },
    KcmSheetsRepository: { ensureSchema: () => {} },
    KcmSessionService: { list: () => [] },
    KcmDriveEvidenceRepository: {}
  });
  new vm.Script(kioskSource, { filename: "KioskService.gs" }).runInContext(context);
  new vm.Script(adminSource, { filename: "AdminAndAuditService.gs" }).runInContext(context);
  return {
    service: context.KcmKioskService, admin: context.KcmAdminAndAuditService,
    tables, audits, rateLimits, session, repositoryCalls
  };
}

test("emite URL con vista en query y token exclusivamente en fragmento", () => {
  const harness = createHarness();
  const issued = harness.service.issueToken({ sessionId: harness.session.sessionId, stationLabel: "Sala sintética · Equipo 01" });

  assert.equal(Object.hasOwn(issued, "token"), false);
  const url = new URL(issued.kioskUrl);
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("view"), "kiosk");
  assert.equal(url.searchParams.has("kioskToken"), false);
  assert.equal(url.hash, "#kioskToken=signed.synthetic.kiosk-token-value");
  assert.equal(harness.audits[0].event.action, "KIOSK_TOKEN_ISSUED");
});

test("registro conserva idempotencia natural y aplica cupo máximo de cuarenta bajo lock", () => {
  const harness = createHarness({ attendanceCount: 39 });
  const duplicate = harness.service.register({
    token: "signed.synthetic.kiosk-token-value", employeeId: "00001", requestId: "request-duplicate"
  });
  assert.deepEqual(Object.keys(duplicate).sort(), ["message", "received"]);
  assert.equal(duplicate.received, true);
  assert.equal(harness.tables.ASISTENCIAS.length, 39);

  const accepted = harness.service.register({
    token: "signed.synthetic.kiosk-token-value", employeeId: "00040", requestId: "request-fortieth"
  });
  assert.deepEqual(accepted, duplicate, "nuevo y duplicado usan el mismo contrato participante");
  assert.equal(harness.tables.ASISTENCIAS.length, 40);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0].event.requestId, "request-fortieth");

  const repeatedFortieth = harness.service.register({
    token: "signed.synthetic.kiosk-token-value", employeeId: "00040", requestId: "request-fortieth"
  });
  const fullUnknown = harness.service.register({
    token: "signed.synthetic.kiosk-token-value", employeeId: "99999", requestId: "request-over-capacity"
  });
  assert.deepEqual(repeatedFortieth, accepted, "el registro numero cuarenta conserva replay idempotente");
  assert.deepEqual(fullUnknown, accepted, "el cupo lleno tampoco crea un oraculo de identidad");
  assert.equal(harness.tables.ASISTENCIAS.length, 40);
  assert.equal(harness.audits.length, 1);
  assert.ok(harness.rateLimits.every(({ limit }) => limit === 20));
});

test("identidad inexistente usa respuesta genérica y no crea asistencia", () => {
  const harness = createHarness();
  const result = harness.service.register({
    token: "signed.synthetic.kiosk-token-value", employeeId: "99999", requestId: "request-unknown"
  });
  const validHarness = createHarness();
  const validResult = validHarness.service.register({
    token: "signed.synthetic.kiosk-token-value", employeeId: "00001", requestId: "request-valid"
  });
  assert.equal(JSON.stringify(result), JSON.stringify(validResult), "la respuesta no revela pertenencia al padrón");
  assert.deepEqual([harness.tables.ASISTENCIAS.length, harness.audits.length], [0, 0]);
  assert.equal(JSON.stringify(result).includes("identity"), false);
});

test("bootstrap repara la auditoría si la asistencia quedó persistida", () => {
  const harness = createHarness({ failAuditOnce: true });
  const input = {
    token: "signed.synthetic.kiosk-token-value", employeeId: "00001", requestId: "request-repair"
  };

  assert.throws(
    () => harness.service.register(input),
    (error) => error.code === "CONFLICT" && error.retryable === true
  );
  assert.equal(harness.tables.ASISTENCIAS.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 0);

  const repaired = harness.admin.kioskBootstrap("signed.synthetic.kiosk-token-value");
  assert.equal(repaired.acceptingRegistrations, true);
  assert.equal(harness.tables.ASISTENCIAS.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 1);
  assert.equal(harness.tables.KIOSK_REGISTROS[0].phase, "COMPLETADO");
  assert.equal(harness.tables.AUDITORIA[0].entityId, harness.tables.ASISTENCIAS[0].attendanceId);

  harness.admin.kioskBootstrap("signed.synthetic.kiosk-token-value");
  assert.equal(harness.tables.AUDITORIA.length, 1);
});

test("bootstrap repara fallos antes de asistencia y después de auditoría", () => {
  const beforeAttendance = createHarness({ failAttendanceOnce: true });
  const input = { token: "signed.synthetic.kiosk-token-value", employeeId: "00001", requestId: "request-before" };
  assert.throws(() => beforeAttendance.service.register(input), /Fallo sintético de asistencia/);
  assert.equal(beforeAttendance.tables.KIOSK_REGISTROS[0].phase, "RESERVADO");
  assert.equal(beforeAttendance.tables.ASISTENCIAS.length, 0);
  beforeAttendance.admin.kioskBootstrap("signed.synthetic.kiosk-token-value");
  assert.deepEqual(
    [beforeAttendance.tables.ASISTENCIAS.length, beforeAttendance.tables.AUDITORIA.length, beforeAttendance.tables.KIOSK_REGISTROS[0].phase],
    [1, 1, "COMPLETADO"]
  );

  const afterAudit = createHarness({ failCompleteOnce: true });
  assert.throws(() => afterAudit.service.register(input), /Fallo sintético de cierre/);
  assert.deepEqual([afterAudit.tables.ASISTENCIAS.length, afterAudit.tables.AUDITORIA.length], [1, 1]);
  afterAudit.admin.kioskBootstrap("signed.synthetic.kiosk-token-value");
  assert.deepEqual([afterAudit.tables.AUDITORIA.length, afterAudit.tables.KIOSK_REGISTROS[0].phase], [1, "COMPLETADO"]);
});

test("bootstrap de quiosco expone sólo sesión, estación, expiración y cupo", () => {
  const harness = createHarness({ attendanceCount: 2 });
  const result = harness.admin.kioskBootstrap("signed.synthetic.kiosk-token-value");
  assert.deepEqual(
    [result.sessionId, result.status, result.stationLabel, result.availability.maximum, result.availability.available, result.acceptingRegistrations],
    ["session-kiosk-1", "ABIERTA", "Sala sintética · Equipo 01", 40, true, true]
  );
  assert.equal(Object.hasOwn(result.availability, "remaining"), false);
  assert.equal(Object.hasOwn(result, "capacity"), false);
  assert.equal(result.expiresAt, "2026-07-22T18:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(result), /signed\.synthetic\.kiosk-token-value/);

  harness.session.status = "CERRADA";
  assert.equal(harness.admin.kioskBootstrap("signed.synthetic.kiosk-token-value").acceptingRegistrations, false);
});

test("bootstrap valida journals terminales en tiempo lineal sin reabrir sus efectos", () => {
  const harness = createHarness({ attendanceCount: 40 });
  harness.tables.KIOSK_REGISTROS.push(...Array.from({ length: 40 }, (_, index) => ({
    registrationId: `registration-${index + 1}`,
    sessionId: harness.session.sessionId,
    employeeId: String(index + 1).padStart(5, "0"),
    attendanceId: `attendance-${index + 1}`,
    requestId: `request-existing-${index + 1}`,
    stationLabel: "Sala sintetica",
    phase: "COMPLETADO",
    createdAt: "2026-07-22T16:00:00.000Z",
    updatedAt: "2026-07-22T16:00:00.000Z",
    version: "1.0.0"
  })));

  const result = harness.admin.kioskBootstrap("signed.synthetic.kiosk-token-value");
  assert.equal(result.acceptingRegistrations, false);
  assert.equal(harness.repositoryCalls.list, 3, "una lectura de journals y dos para calcular cupo");
  assert.equal(harness.audits.length, 0);
  assert.equal(harness.tables.ASISTENCIAS.length, 40);
});
