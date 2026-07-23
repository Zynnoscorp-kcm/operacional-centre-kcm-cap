/** Ruta digital: captura minima y convergencia a Attendance v1. */
var KcmKioskService = (function () {
  "use strict";

  var MAX_REGISTRATIONS_PER_SESSION = 40;

  function acquireKioskLock() {
    if (typeof KcmScriptLock !== "undefined") {
      return KcmScriptLock.acquire(30000, "Existe otro registro en proceso; reintente");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      var busy = new Error("Existe otro registro en proceso; reintente");
      busy.code = "CONFLICT"; busy.retryable = true; throw busy;
    }
    return lock;
  }

  function assertTrainerOwnsSession(identity, session) {
    if (identity.role === "CAPACITADOR" && String(session.createdBy) !== String(identity.actor)) {
      KcmValidation.fail("FORBIDDEN", "La sesion no pertenece al capacitador");
    }
  }

  function expirationMinutes(input) {
    var configured = Number(KcmConfig.kioskTokenMinutes());
    if (!Number.isInteger(configured) || configured < 1 || configured > 1440) {
      KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    }
    if (input.expiresInMinutes === undefined || input.expiresInMinutes === null) return configured;
    if (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > configured) {
      KcmValidation.fail("INVALID_INPUT", "La expiracion del token no es valida");
    }
    return input.expiresInMinutes;
  }

  function optionalStationLabel(value) {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") KcmValidation.fail("INVALID_INPUT", "La etiqueta de estacion no es valida");
    return KcmValidation.text(value, "stationLabel", 80, true);
  }

  function kioskWebAppUrl(token) {
    var configured = KcmConfig.property("KCM_KIOSK_WEB_APP_URL", "");
    if (typeof configured !== "string" || configured.length < 12 || configured.length > 2000 ||
        configured !== configured.trim() || /[?#\s]/.test(configured)) {
      KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    }
    var match = /^https:\/\/([^/]+)(\/.*)?$/.exec(configured);
    if (!match || match[1].indexOf("@") !== -1) KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    var kioskUrl = configured + "?view=kiosk#kioskToken=" + encodeURIComponent(token);
    if (kioskUrl.length > 4000) KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    return kioskUrl;
  }

  function capacityFromRepository(repo, sessionId) {
    var identities = Object.create(null);
    repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
      return String(row.sessionId) === String(sessionId);
    }).forEach(function (row) {
      var employeeId = String(row.employeeId || "").padStart(5, "0");
      if (/^\d{5}$/.test(employeeId)) identities[employeeId] = true;
    });
    repo.list(KcmConfig.SHEETS.KIOSK_REGISTRATIONS, function (row) {
      return String(row.sessionId) === String(sessionId);
    }).forEach(function (row) {
      var employeeId = String(row.employeeId || "").padStart(5, "0");
      if (!/^\d{5}$/.test(employeeId)) KcmValidation.fail("INVALID_STATE", "El journal de registro esta corrupto");
      identities[employeeId] = true;
    });
    var registrations = Object.keys(identities).length;
    return {
      maximum: MAX_REGISTRATIONS_PER_SESSION,
      registered: registrations,
      remaining: Math.max(0, MAX_REGISTRATIONS_PER_SESSION - registrations),
      available: registrations < MAX_REGISTRATIONS_PER_SESSION
    };
  }

  function capacity(sessionId, identity) {
    var id = KcmValidation.identifier(sessionId, "sessionId");
    var repo = KcmServiceSupport.repository();
    if (!identity) return capacityFromRepository(repo, id);
    var lock = acquireKioskLock();
    try {
      reconcileSession(identity, repo, id);
      return capacityFromRepository(repo, id);
    } finally {
      lock.releaseLock();
    }
  }

  function validateJournal(journal, sessionId, employeeId) {
    if (!journal || String(journal.sessionId) !== String(sessionId) ||
        String(journal.employeeId).padStart(5, "0") !== employeeId ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(String(journal.registrationId || "")) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(String(journal.attendanceId || "")) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(String(journal.requestId || "")) ||
        ["RESERVADO", "ASISTENCIA_CREADA", "COMPLETADO"].indexOf(String(journal.phase)) === -1) {
      KcmValidation.fail("INVALID_STATE", "El journal de registro esta corrupto");
    }
    return journal;
  }

  function registrationJournal(repo, sessionId, employeeId) {
    var rows = repo.list(KcmConfig.SHEETS.KIOSK_REGISTRATIONS, function (row) {
      return String(row.sessionId) === String(sessionId) && String(row.employeeId).padStart(5, "0") === employeeId;
    });
    if (rows.length > 1) KcmValidation.fail("INVALID_STATE", "El journal de registro contiene duplicados");
    return rows.length ? validateJournal(rows[0], sessionId, employeeId) : null;
  }

  function attendanceForEmployee(repo, sessionId, employeeId) {
    var rows = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
      return String(row.sessionId) === String(sessionId) && String(row.employeeId).padStart(5, "0") === employeeId;
    });
    if (rows.length > 1) KcmValidation.fail("INVALID_STATE", "La sesion contiene asistencias duplicadas");
    return rows.length ? rows[0] : null;
  }

  function issueToken(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) KcmValidation.fail("INVALID_INPUT", "Solicitud de token invalida");
    var identity = KcmAuth.requireRoles(["CAPACITADOR", "CAPACITACION", "ADMINISTRADOR"]);
    var sessionId = KcmValidation.identifier(input.sessionId, "sessionId");
    var session = KcmServiceSupport.session(sessionId);
    assertTrainerOwnsSession(identity, session);
    if (String(session.status) !== "ABIERTA") KcmValidation.fail("INVALID_STATE", "La sesion no acepta registros");
    var stationLabel = optionalStationLabel(input.stationLabel);
    var lifetime = expirationMinutes(input);
    var issued = KcmAuth.createKioskToken({
      sessionId: sessionId,
      issuedBy: identity.actor,
      expiresInMinutes: lifetime,
      stationLabel: stationLabel
    });
    var kioskUrl = kioskWebAppUrl(issued.token);
    KcmServiceSupport.audit(identity, {
      sessionId: sessionId, entityType: "Session", entityId: sessionId,
      action: "KIOSK_TOKEN_ISSUED", newState: "ABIERTA",
      reason: stationLabel ? "ESTACION:" + stationLabel : ""
    });
    return {
      expiresAt: issued.expiresAt,
      kioskUrl: kioskUrl,
      sessionId: sessionId,
      stationLabel: stationLabel || "",
      expiresInMinutes: lifetime
    };
  }

  function ensureRegistrationAudit(identity, repo, sessionId, attendance, requestId, stationLabel) {
    var existingAudit = repo.findOne(KcmConfig.SHEETS.AUDIT, function (row) {
      return String(row.sessionId) === String(sessionId) &&
        String(row.entityType) === "Attendance" &&
        String(row.entityId) === String(attendance.attendanceId) &&
        String(row.action) === "DIGITAL_ATTENDANCE_CAPTURED";
    });
    if (existingAudit) return existingAudit;
    return KcmServiceSupport.audit(identity, {
      sessionId: sessionId, entityType: "Attendance", entityId: attendance.attendanceId,
      action: "DIGITAL_ATTENDANCE_CAPTURED", newState: attendance.status,
      reason: stationLabel ? "ESTACION:" + stationLabel : "",
      requestId: requestId
    });
  }

  function repairJournal(identity, repo, journal) {
    var sessionId = String(journal.sessionId);
    var employeeId = String(journal.employeeId).padStart(5, "0");
    validateJournal(journal, sessionId, employeeId);
    var attendance = attendanceForEmployee(repo, sessionId, employeeId);
    if (attendance && String(attendance.attendanceId) !== String(journal.attendanceId)) {
      KcmValidation.fail("INVALID_STATE", "El journal no coincide con la asistencia registrada");
    }
    if (attendance && String(attendance.captureRoute) !== "DIGITAL") {
      KcmValidation.fail("INVALID_STATE", "El journal digital apunta a otra ruta de captura");
    }
    if (!attendance) {
      var timestamp = KcmServiceSupport.nowIso();
      attendance = {
        attendanceId: String(journal.attendanceId), sessionId: sessionId, employeeId: employeeId,
        captureRoute: "DIGITAL", identityValidated: true, attendanceProven: false,
        examStatus: "EXAMEN_PENDIENTE", status: "PENDIENTE_COTEJO", released: false,
        sourceEvidenceId: "", createdAt: timestamp, updatedAt: timestamp,
        version: KcmConfig.CONTRACT_VERSION
      };
      repo.insertMany(KcmConfig.SHEETS.ATTENDANCES, [attendance]);
    }
    if (String(journal.phase) === "RESERVADO") {
      journal = repo.updateMany(KcmConfig.SHEETS.KIOSK_REGISTRATIONS, "registrationId", [{
        registrationId: journal.registrationId, phase: "ASISTENCIA_CREADA", updatedAt: KcmServiceSupport.nowIso()
      }])[0];
    }
    ensureRegistrationAudit(identity, repo, sessionId, attendance, String(journal.requestId), String(journal.stationLabel || ""));
    if (String(journal.phase) !== "COMPLETADO") {
      journal = repo.updateMany(KcmConfig.SHEETS.KIOSK_REGISTRATIONS, "registrationId", [{
        registrationId: journal.registrationId, phase: "COMPLETADO", updatedAt: KcmServiceSupport.nowIso()
      }])[0];
    }
    return attendance;
  }

  function repairSessionJournals(identity, repo, sessionId) {
    var journals = repo.list(KcmConfig.SHEETS.KIOSK_REGISTRATIONS, function (row) {
      return String(row.sessionId) === String(sessionId);
    });
    journals.forEach(function (journal) {
      var employeeId = String(journal.employeeId || "").padStart(5, "0");
      validateJournal(journal, sessionId, employeeId);
      if (String(journal.phase) !== "COMPLETADO") repairJournal(identity, repo, journal);
    });
    return journals.length;
  }

  /** Reconciliacion interna; el llamador debe conservar el ScriptLock. */
  function reconcileSession(identity, repo, sessionId) {
    return repairSessionJournals(identity, repo, KcmValidation.identifier(sessionId, "sessionId"));
  }

  function createJournal(repo, identity, sessionId, employeeId, attendanceId, requestId) {
    var timestamp = KcmServiceSupport.nowIso();
    var journal = {
      registrationId: KcmServiceSupport.uuid(), sessionId: sessionId, employeeId: employeeId,
      attendanceId: attendanceId, requestId: requestId,
      stationLabel: String(identity.stationLabel || ""), phase: "RESERVADO",
      createdAt: timestamp, updatedAt: timestamp, version: KcmConfig.CONTRACT_VERSION
    };
    repo.insertMany(KcmConfig.SHEETS.KIOSK_REGISTRATIONS, [journal]);
    return journal;
  }

  function participantReceipt() {
    return {
      received: true,
      message: "Solicitud recibida; la asistencia se confirmara durante el cotejo fisico"
    };
  }

  function register(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) KcmValidation.fail("INVALID_INPUT", "Solicitud de registro invalida");
    var token = KcmValidation.text(input.token, "token", 3000, true);
    var requestId = KcmValidation.identifier(input.requestId, "requestId");
    var identity = KcmAuth.verifyKioskToken(token);
    KcmAuth.enforceKioskRateLimit(token, 20);
    var employeeId = KcmValidation.employeeId(input.employeeId);
    var lock = acquireKioskLock();
    try {
      var session = KcmServiceSupport.session(identity.sessionId);
      if (String(session.status) !== "ABIERTA") KcmValidation.fail("INVALID_STATE", "La sesion no acepta registros");
      var repo = KcmServiceSupport.repository();
      repairSessionJournals(identity, repo, session.sessionId);
      var currentCapacity = capacityFromRepository(repo, session.sessionId);
      if (!currentCapacity.available) return participantReceipt();
      var employee = repo.findOne(KcmConfig.SHEETS.EMPLOYEES, function (row) {
        return String(row.employeeId).padStart(5, "0") === employeeId && KcmServiceSupport.asBoolean(row.active);
      });
      if (!employee) return participantReceipt();
      var existing = attendanceForEmployee(repo, session.sessionId, employeeId);
      if (existing && String(existing.captureRoute) !== "DIGITAL") return participantReceipt();
      var journal = registrationJournal(repo, session.sessionId, employeeId);
      if (!journal) {
        journal = createJournal(
          repo, identity, session.sessionId, employeeId,
          existing ? String(existing.attendanceId) : KcmServiceSupport.uuid(), requestId
        );
      }
      repairJournal(identity, repo, journal);
      return participantReceipt();
    } finally {
      lock.releaseLock();
    }
  }

  return Object.freeze({
    issueToken: issueToken, register: register, capacity: capacity,
    reconcileSession: reconcileSession
  });
}());
