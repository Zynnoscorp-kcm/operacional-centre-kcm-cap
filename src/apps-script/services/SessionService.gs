/** Ciclo de vida de Session v1. */
var KcmSessionService = (function () {
  "use strict";

  function requestId() {
    return KcmValidation.identifier(String(KcmRequestContext.requestId || ""), "requestId");
  }

  function auditConflict(message) {
    KcmValidation.fail("CONFLICT", message);
  }

  function sameAuditSemantics(row, input) {
    return String(row.sessionId || "") === String(input.sessionId || "") &&
      String(row.entityType || "") === String(input.entityType || "") &&
      String(row.entityId || "") === String(input.entityId || "") &&
      String(row.action || "") === String(input.action || "") &&
      String(row.previousState || "") === String(input.previousState || "") &&
      String(row.newState || "") === String(input.newState || "");
  }

  function semanticAudits(repo, input) {
    return repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
      return sameAuditSemantics(row, input);
    });
  }

  /**
   * El evento se escribe antes del estado que habilita efectos posteriores. Si la escritura
   * de estado falla, cualquier reintento adopta el unico evento semantico y termina el cambio.
   */
  function auditOnce(identity, repo, input, allowCreate) {
    var operationRequestId = requestId();
    var reason = KcmValidation.text(input.reason || "", "reason", 300, false);
    var requestEvents = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
      return String(row.sessionId || "") === String(input.sessionId || "") &&
        String(row.entityType || "") === String(input.entityType || "") &&
        String(row.entityId || "") === String(input.entityId || "") &&
        String(row.action || "") === String(input.action || "") &&
        String(row.requestId || "") === operationRequestId;
    });
    if (requestEvents.length > 1) auditConflict("La operacion conserva eventos de auditoria duplicados");
    if (requestEvents.length === 1) {
      var requestEvent = requestEvents[0];
      if (!sameAuditSemantics(requestEvent, input) ||
          String(requestEvent.actor || "") !== String(identity.actor || "") ||
          String(requestEvent.role || "") !== String(identity.role || "") ||
          String(requestEvent.reason || "") !== reason) {
        auditConflict("El requestId ya pertenece a otra transicion de sesion");
      }
      return requestEvent;
    }

    var events = semanticAudits(repo, input);
    if (events.length > 1) auditConflict("La transicion conserva eventos de auditoria duplicados");
    if (events.length === 1) return events[0];
    if (!allowCreate) auditConflict("El estado de la sesion no conserva su auditoria requerida");
    return KcmServiceSupport.audit(identity, Object.assign({}, input, {
      reason: reason,
      requestId: operationRequestId
    }));
  }

  function uniqueCode(repo) {
    for (var attempt = 0; attempt < 8; attempt += 1) {
      var suffix = Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();
      var code = "KCM-" + Utilities.formatDate(new Date(), KcmConfig.TIME_ZONE, "yyMMdd") + "-" + suffix;
      if (!repo.findOne(KcmConfig.SHEETS.SESSIONS, function (row) { return String(row.sessionCode) === code; })) return code;
    }
    KcmValidation.fail("CONFLICT", "No fue posible generar un codigo unico");
  }

  function assertSameCreation(existing, intended, identity) {
    var fields = ["trainingId", "date", "durationMinutes", "instructor", "room", "shift", "eventType"];
    if (String(existing.createdBy || "") !== String(identity.actor || "") || fields.some(function (field) {
      return String(existing[field] === undefined ? "" : existing[field]) !==
        String(intended[field] === undefined ? "" : intended[field]);
    })) {
      auditConflict("El requestId ya pertenece a otra creacion de sesion");
    }
  }

  function creationAuditInput(session) {
    return {
      sessionId: session.sessionId, entityType: "Session", entityId: session.sessionId,
      action: "SESSION_CREATED", previousState: "", newState: "BORRADOR"
    };
  }

  function assertCreationAudit(repo, session) {
    var creationRequestId = String(session.creationRequestId || "");
    if (!creationRequestId) return;
    var matches = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
      return String(row.sessionId || "") === String(session.sessionId) &&
        String(row.entityType || "") === "Session" &&
        String(row.entityId || "") === String(session.sessionId) &&
        String(row.action || "") === "SESSION_CREATED" &&
        String(row.newState || "") === "BORRADOR" &&
        String(row.requestId || "") === creationRequestId &&
        String(row.actor || "") === String(session.createdBy || "");
    });
    if (matches.length !== 1) auditConflict("La sesion no conserva su auditoria de creacion");
  }

  function create(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) KcmValidation.fail("INVALID_INPUT", "Solicitud de sesion invalida");
    var identity = KcmAuth.requireRoles(["CAPACITADOR", "CAPACITACION", "ADMINISTRADOR"]);
    var operationRequestId = requestId();
    var intended = {
      trainingId: KcmValidation.identifier(input.trainingId, "trainingId"),
      date: KcmValidation.dateIso(input.date),
      durationMinutes: KcmValidation.integer(input.durationMinutes, 1, 1440),
      instructor: KcmValidation.text(input.instructor, "instructor", 120, true),
      room: KcmValidation.text(input.room, "room", 80, false),
      shift: KcmValidation.text(input.shift, "shift", 30, false),
      eventType: KcmValidation.text(input.eventType, "eventType", 80, true)
    };
    var lock = KcmScriptLock.acquire(30000, "Existe otra creacion de sesion en proceso; reintente");
    try {
      var repo = KcmServiceSupport.repository();
      var training = repo.findOne(KcmConfig.SHEETS.TRAININGS, function (row) {
        return String(row.trainingId) === intended.trainingId && KcmServiceSupport.asBoolean(row.active);
      });
      if (!training) KcmValidation.fail("NOT_FOUND", "La capacitacion no esta disponible");
      var matches = repo.list(KcmConfig.SHEETS.SESSIONS, function (row) {
        return String(row.creationRequestId || "") === operationRequestId;
      });
      if (matches.length > 1) auditConflict("La creacion de sesion contiene registros duplicados");
      if (matches.length === 1) {
        assertSameCreation(matches[0], intended, identity);
        auditOnce(identity, repo, creationAuditInput(matches[0]), true);
        return matches[0];
      }
      var session = Object.assign({
        sessionId: KcmServiceSupport.uuid(), sessionCode: uniqueCode(repo)
      }, intended, {
        status: "BORRADOR", authorized: false, createdBy: identity.actor,
        createdAt: KcmServiceSupport.nowIso(), creationRequestId: operationRequestId,
        version: KcmConfig.CONTRACT_VERSION
      });
      repo.insertMany(KcmConfig.SHEETS.SESSIONS, [session]);
      auditOnce(identity, repo, creationAuditInput(session), true);
      return session;
    } finally {
      lock.releaseLock();
    }
  }

  function move(sessionId, previous, next, allowedRoles) {
    var identity = KcmAuth.requireRoles(allowedRoles);
    var lock = KcmScriptLock.acquire(30000, "Existe otro cambio de sesion en proceso; reintente");
    try {
      var repo = KcmServiceSupport.repository();
      var current = KcmServiceSupport.session(sessionId);
      if (identity.role === "CAPACITADOR" && String(current.createdBy) !== String(identity.actor)) {
        KcmValidation.fail("FORBIDDEN", "La sesion no pertenece al capacitador");
      }
      assertCreationAudit(repo, current);
      var currentStatus = String(current.status);
      if (currentStatus !== previous && currentStatus !== next) {
        KcmServiceSupport.transitionSession(current, next);
      }
      if (next === "CERRADA") KcmKioskService.reconcileSession(identity, repo, current.sessionId);
      var auditInput = {
        sessionId: current.sessionId, entityType: "Session", entityId: current.sessionId,
        action: "SESSION_STATE_CHANGED", previousState: previous, newState: next
      };
      if (currentStatus === next) {
        auditOnce(identity, repo, auditInput, false);
        return current;
      }
      KcmServiceSupport.transitionSession(current, next);
      auditOnce(identity, repo, auditInput, true);
      repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: current.sessionId, status: next }]);
      var stored = KcmServiceSupport.session(current.sessionId);
      if (String(stored.status) !== next) auditConflict("No fue posible confirmar el estado de la sesion");
      return stored;
    } finally {
      lock.releaseLock();
    }
  }

  function open(sessionId) { return move(sessionId, "BORRADOR", "ABIERTA", ["CAPACITADOR", "CAPACITACION", "ADMINISTRADOR"]); }
  function close(sessionId) { return move(sessionId, "ABIERTA", "CERRADA", ["CAPACITADOR", "CAPACITACION", "ADMINISTRADOR"]); }

  function authorize(sessionId, reason) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var lock = KcmScriptLock.acquire(30000, "Existe otra autorizacion de sesion en proceso; reintente");
    try {
      var repo = KcmServiceSupport.repository();
      var current = KcmServiceSupport.session(sessionId);
      assertCreationAudit(repo, current);
      var auditInput = {
        sessionId: current.sessionId, entityType: "Session", entityId: current.sessionId,
        action: "SESSION_AUTHORIZED", previousState: "false", newState: "true", reason: reason
      };
      if (KcmServiceSupport.asBoolean(current.authorized)) {
        auditOnce(identity, repo, auditInput, false);
        return current;
      }
      if (["PRELIBERACION", "LISTA_PARA_LIBERAR", "LIBERADA_PARCIAL"].indexOf(String(current.status)) === -1) {
        KcmValidation.fail("INVALID_STATE", "La sesion aun no puede autorizarse");
      }
      auditOnce(identity, repo, auditInput, true);
      repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: current.sessionId, authorized: true }]);
      var stored = KcmServiceSupport.session(current.sessionId);
      if (!KcmServiceSupport.asBoolean(stored.authorized)) auditConflict("No fue posible confirmar la autorizacion de la sesion");
      return stored;
    } finally {
      lock.releaseLock();
    }
  }

  function findByCode(code) {
    var identity = KcmAuth.requireRoles(["CAPACITADOR", "CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
    var normalized = KcmValidation.sessionCode(code);
    var found = KcmServiceSupport.repository().findOne(KcmConfig.SHEETS.SESSIONS, function (row) { return String(row.sessionCode) === normalized; });
    if (!found) KcmValidation.fail("NOT_FOUND", "La sesion no existe");
    if (identity.role === "CAPACITADOR" && String(found.createdBy) !== identity.actor) KcmValidation.fail("FORBIDDEN", "La sesion no pertenece al capacitador");
    return found;
  }

  function list() {
    var identity = KcmAuth.requireRoles(["CAPACITADOR", "CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
    return KcmServiceSupport.repository().list(KcmConfig.SHEETS.SESSIONS, function (row) {
      return identity.role !== "CAPACITADOR" || String(row.createdBy) === identity.actor;
    }).slice(-100).reverse();
  }

  return Object.freeze({ create: create, open: open, close: close, authorize: authorize, findByCode: findByCode, list: list });
}());
