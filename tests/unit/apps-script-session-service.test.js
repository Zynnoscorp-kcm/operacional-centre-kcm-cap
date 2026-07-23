import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script/services");
const lockSource = await readFile(path.join(ROOT, "00_Lock.gs"), "utf8");
const sessionSource = await readFile(path.join(ROOT, "SessionService.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createHarness({
  status = "ABIERTA",
  authorized = false,
  failAudit = "",
  failSessionUpdateOnce = false,
  lockAvailable = true,
  reconcileWithNestedLock = false
} = {}) {
  const session = {
    sessionId: "session-synthetic",
    sessionCode: "KCM-260722-TEST01",
    status,
    authorized,
    createdBy: "trainer@example.invalid"
  };
  const training = { trainingId: "CAP-SINT-001", active: true };
  const tables = { SESIONES: [session], AUDITORIA: [], CAPACITACIONES: [training] };
  const calls = { tryLock: 0, releaseLock: 0, reconcile: 0, audit: 0, sessionUpdate: 0, order: [] };
  let pendingAuditFailure = failAudit;
  let pendingSessionUpdate = failSessionUpdateOnce;
  let sequence = 0;

  const repository = {
    list(name, predicate) {
      const rows = tables[name] || [];
      return predicate ? rows.filter(predicate) : rows.slice();
    },
    findOne(name, predicate) {
      return (tables[name] || []).find(predicate) || null;
    },
    insertMany(name, rows) {
      tables[name] = (tables[name] || []).concat(rows.map((row) => ({ ...row })));
      return rows;
    },
    updateMany(name, keyField, updates) {
      calls.order.push("state");
      calls.sessionUpdate += 1;
      if (name === "SESIONES" && pendingSessionUpdate) {
        pendingSessionUpdate = false;
        throw Object.assign(new Error("Fallo sintetico de estado"), { code: "CONFLICT", retryable: true });
      }
      return updates.map((update) => {
        const row = (tables[name] || []).find((item) => String(item[keyField]) === String(update[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
        Object.assign(row, update);
        return { ...row };
      });
    }
  };

  const identityForRoles = (roles) => roles.includes("CAPACITADOR")
    ? { actor: "trainer@example.invalid", role: "CAPACITADOR" }
    : { actor: "authorizer@example.invalid", role: "CAPACITACION" };

  let context;
  context = vm.createContext({
    Array, Boolean, Date, Error, Math, Number, Object, String, isFinite,
    KcmRequestContext: { requestId: "request-synthetic" },
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      TIME_ZONE: "UTC",
      SHEETS: { SESSIONS: "SESIONES", TRAININGS: "CAPACITACIONES", AUDIT: "AUDITORIA" }
    },
    KcmValidation: {
      fail,
      identifier(value) {
        const normalized = String(value || "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalized)) fail("INVALID_IDENTIFIER", "Identificador invalido");
        return normalized;
      },
      text(value, field, maximum, required) {
        if ((value === undefined || value === null || value === "") && !required) return "";
        if (typeof value !== "string") fail("INVALID_INPUT", `${field} invalido`);
        const normalized = value.trim();
        if (required && !normalized) fail("INVALID_INPUT", `${field} requerido`);
        if (normalized.length > maximum) fail("INVALID_INPUT", `${field} excedido`);
        return normalized;
      },
      dateIso: String,
      integer: Number
    },
    KcmAuth: { requireRoles: identityForRoles },
    KcmServiceSupport: {
      repository: () => repository,
      session(sessionId) {
        const found = (tables.SESIONES || []).find((item) => String(item.sessionId) === String(sessionId));
        if (!found) fail("NOT_FOUND", "Sesion ausente");
        return { ...found };
      },
      transitionSession(current, next) {
        const allowed = { BORRADOR: ["ABIERTA"], ABIERTA: ["CERRADA"] }[String(current.status)] || [];
        if (!allowed.includes(next)) fail("INVALID_STATE", "Transicion invalida");
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      uuid: () => `uuid-${++sequence}`,
      nowIso: () => "2026-07-22T12:00:00.000Z",
      audit(identity, input) {
        calls.order.push("audit");
        calls.audit += 1;
        if (pendingAuditFailure === "before") {
          pendingAuditFailure = "";
          throw Object.assign(new Error("Fallo sintetico antes de auditoria"), { code: "CONFLICT", retryable: true });
        }
        const event = {
          eventId: `audit-${++sequence}`,
          actor: identity.actor,
          role: identity.role,
          sessionId: input.sessionId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          previousState: input.previousState || "",
          newState: input.newState || "",
          reason: input.reason || "",
          requestId: input.requestId
        };
        tables.AUDITORIA.push(event);
        if (pendingAuditFailure === "after") {
          pendingAuditFailure = "";
          throw Object.assign(new Error("Fallo sintetico despues de auditoria"), { code: "CONFLICT", retryable: true });
        }
        return event;
      }
    },
    KcmKioskService: {
      reconcileSession(identity, repo, sessionId) {
        calls.order.push("reconcile");
        calls.reconcile += 1;
        assert.equal(identity.actor, "trainer@example.invalid");
        assert.equal(repo, repository);
        assert.equal(sessionId, session.sessionId);
        if (reconcileWithNestedLock) {
          const nested = context.KcmScriptLock.acquire(30000, "nested");
          nested.release();
        }
      }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock(timeout) {
          calls.tryLock += 1;
          assert.equal(timeout, 30000);
          return lockAvailable;
        },
        releaseLock() { calls.releaseLock += 1; }
      })
    },
    Utilities: { getUuid: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", formatDate: () => "260722" }
  });
  new vm.Script(lockSource, { filename: "00_Lock.gs" }).runInContext(context);
  new vm.Script(sessionSource, { filename: "SessionService.gs" }).runInContext(context);
  return { context, service: context.KcmSessionService, session, tables, calls };
}

test("el bloqueo global es reentrante y libera el ScriptLock una sola vez", () => {
  const harness = createHarness({ reconcileWithNestedLock: true });
  harness.service.close(harness.session.sessionId);
  assert.deepEqual(
    [harness.calls.tryLock, harness.calls.releaseLock, harness.calls.reconcile],
    [1, 1, 1]
  );
});

test("close reconcilia el quiosco y persiste auditoria antes del estado", () => {
  const harness = createHarness();
  const result = harness.service.close(harness.session.sessionId);
  assert.equal(result.status, "CERRADA");
  assert.deepEqual(harness.calls.order, ["reconcile", "audit", "state"]);
  assert.equal(harness.tables.AUDITORIA.length, 1);
  assert.deepEqual(
    [harness.tables.AUDITORIA[0].previousState, harness.tables.AUDITORIA[0].newState],
    ["ABIERTA", "CERRADA"]
  );
});

test("close reanuda un evento persistido aunque la primera respuesta de auditoria falle", () => {
  const harness = createHarness({ failAudit: "after" });
  assert.throws(() => harness.service.close(harness.session.sessionId), /despues de auditoria/);
  assert.equal(harness.session.status, "ABIERTA", "la sesion no queda cerrada sin control de reanudacion");
  assert.equal(harness.tables.AUDITORIA.length, 1);

  const recovered = harness.service.close(harness.session.sessionId);
  assert.equal(recovered.status, "CERRADA");
  assert.equal(harness.tables.AUDITORIA.length, 1, "el replay no duplica el evento");
  assert.equal(harness.calls.sessionUpdate, 1);
});

test("close reanuda una falla posterior de estado y su replay es idempotente", () => {
  const harness = createHarness({ failSessionUpdateOnce: true });
  assert.throws(() => harness.service.close(harness.session.sessionId), /Fallo sintetico de estado/);
  assert.equal(harness.session.status, "ABIERTA");
  assert.equal(harness.tables.AUDITORIA.length, 1);

  assert.equal(harness.service.close(harness.session.sessionId).status, "CERRADA");
  harness.context.KcmRequestContext.requestId = "request-replay-new";
  assert.equal(harness.service.close(harness.session.sessionId).status, "CERRADA");
  assert.equal(harness.tables.AUDITORIA.length, 1);
});

test("open comparte el journal semantico y no ejecuta reconciliacion de quiosco", () => {
  const harness = createHarness({ status: "BORRADOR", failSessionUpdateOnce: true });
  assert.throws(() => harness.service.open(harness.session.sessionId), /Fallo sintetico de estado/);
  assert.equal(harness.session.status, "BORRADOR");
  assert.equal(harness.tables.AUDITORIA.length, 1);
  assert.equal(harness.calls.reconcile, 0);

  assert.equal(harness.service.open(harness.session.sessionId).status, "ABIERTA");
  harness.context.KcmRequestContext.requestId = "request-open-replay";
  assert.equal(harness.service.open(harness.session.sessionId).status, "ABIERTA");
  assert.equal(harness.tables.AUDITORIA.length, 1);
  assert.deepEqual(
    [harness.tables.AUDITORIA[0].previousState, harness.tables.AUDITORIA[0].newState],
    ["BORRADOR", "ABIERTA"]
  );
});

test("authorize nunca deja una bandera liberable sin auditoria y recupera la actualizacion", () => {
  const beforeAudit = createHarness({ status: "LISTA_PARA_LIBERAR", failAudit: "before" });
  assert.throws(() => beforeAudit.service.authorize(beforeAudit.session.sessionId, "Confirmacion sintetica"), /antes de auditoria/);
  assert.equal(beforeAudit.session.authorized, false);
  assert.equal(beforeAudit.tables.AUDITORIA.length, 0);
  assert.equal(beforeAudit.service.authorize(beforeAudit.session.sessionId, "Confirmacion sintetica").authorized, true);
  assert.equal(beforeAudit.tables.AUDITORIA.length, 1);

  const afterAudit = createHarness({ status: "LISTA_PARA_LIBERAR", failSessionUpdateOnce: true });
  assert.throws(() => afterAudit.service.authorize(afterAudit.session.sessionId, "Confirmacion sintetica"), /Fallo sintetico de estado/);
  assert.equal(afterAudit.session.authorized, false);
  assert.equal(afterAudit.tables.AUDITORIA.length, 1);
  assert.equal(afterAudit.service.authorize(afterAudit.session.sessionId, "Confirmacion sintetica").authorized, true);
  assert.equal(afterAudit.tables.AUDITORIA.length, 1);
  assert.deepEqual(
    [afterAudit.tables.AUDITORIA[0].previousState, afterAudit.tables.AUDITORIA[0].newState],
    ["false", "true"]
  );
});

test("authorize rechaza reutilizar el mismo requestId con otra razon", () => {
  const harness = createHarness({ status: "LISTA_PARA_LIBERAR" });
  harness.service.authorize(harness.session.sessionId, "Motivo original");
  assert.throws(
    () => harness.service.authorize(harness.session.sessionId, "Motivo distinto"),
    /requestId ya pertenece/
  );
  assert.equal(harness.tables.AUDITORIA.length, 1);
});

test("create escribe una sola vez la sesion y reanuda la auditoria por requestId", () => {
  const harness = createHarness();
  harness.tables.SESIONES.length = 0;

  const input = {
    trainingId: "CAP-SINT-001",
    date: "2026-07-22",
    durationMinutes: 60,
    instructor: "Instructor de prueba",
    room: "Sala A",
    shift: "1",
    eventType: "Capacitación"
  };

  const created = harness.service.create(input);
  assert.equal(created.status, "BORRADOR");
  assert.equal(harness.tables.SESIONES.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 1);
  assert.equal(harness.tables.SESIONES[0].creationRequestId, "request-synthetic");
  assert.equal(harness.tables.AUDITORIA[0].requestId, "request-synthetic");

  harness.context.KcmRequestContext.requestId = "request-synthetic";
  const replayed = harness.service.create(input);
  assert.equal(replayed.sessionId, created.sessionId);
  assert.equal(harness.tables.SESIONES.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 1);
});

test("create reanuda una falla de auditoria sin duplicar sesion y rechaza un replay divergente", () => {
  const beforeAudit = createHarness({ failAudit: "before" });
  beforeAudit.tables.SESIONES.length = 0;
  const input = {
    trainingId: "CAP-SINT-001",
    date: "2026-07-22",
    durationMinutes: 60,
    instructor: "Instructor de prueba",
    room: "Sala A",
    shift: "1",
    eventType: "Capacitación"
  };

  assert.throws(() => beforeAudit.service.create(input), /antes de auditoria/);
  assert.equal(beforeAudit.tables.SESIONES.length, 1);
  assert.equal(beforeAudit.tables.AUDITORIA.length, 0);

  const repaired = beforeAudit.service.create(input);
  assert.equal(repaired.status, "BORRADOR");
  assert.equal(beforeAudit.tables.SESIONES.length, 1);
  assert.equal(beforeAudit.tables.AUDITORIA.length, 1);

  const divergent = createHarness();
  divergent.tables.SESIONES.length = 0;
  divergent.service.create(input);
  divergent.context.KcmRequestContext.requestId = "request-synthetic";
  assert.throws(
    () => divergent.service.create({ ...input, room: "Sala B" }),
    /requestId ya pertenece/
  );
  assert.equal(divergent.tables.SESIONES.length, 1);
  assert.equal(divergent.tables.AUDITORIA.length, 1);
});

test("create conserva la sesion aunque la respuesta de auditoria falle despues del efecto", () => {
  const harness = createHarness({ failAudit: "after" });
  harness.tables.SESIONES.length = 0;
  const input = {
    trainingId: "CAP-SINT-001",
    date: "2026-07-22",
    durationMinutes: 60,
    instructor: "Instructor de prueba",
    room: "Sala A",
    shift: "1",
    eventType: "Capacitación"
  };

  assert.throws(() => harness.service.create(input), /despues de auditoria/);
  assert.equal(harness.tables.SESIONES.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 1);

  const replay = harness.service.create(input);
  assert.equal(replay.status, "BORRADOR");
  assert.equal(harness.tables.SESIONES.length, 1);
  assert.equal(harness.tables.AUDITORIA.length, 1);
});

test("un lock ocupado no cambia sesion, auditoria ni journals", () => {
  const harness = createHarness({ lockAvailable: false });
  assert.throws(
    () => harness.service.close(harness.session.sessionId),
    (error) => error.code === "CONFLICT" && error.retryable === true
  );
  assert.equal(harness.session.status, "ABIERTA");
  assert.deepEqual(
    [harness.calls.reconcile, harness.calls.audit, harness.calls.sessionUpdate, harness.calls.releaseLock],
    [0, 0, 0, 0]
  );
});
