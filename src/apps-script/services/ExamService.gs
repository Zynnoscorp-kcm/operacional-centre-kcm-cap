var KcmExamService = (function () {
  "use strict";

  function reconcile(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var lock;
    if (typeof KcmScriptLock !== "undefined") {
      lock = KcmScriptLock.acquire(30000, "Existe otra conciliacion en proceso; reintente");
    } else {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        var busy = new Error("Existe otra conciliacion en proceso; reintente");
        busy.code = "CONFLICT"; busy.retryable = true; throw busy;
      }
    }
    try {
      var session = KcmServiceSupport.session(input.sessionId);
      if (["PRELIBERACION", "LIBERADA_PARCIAL"].indexOf(String(session.status)) === -1) {
        KcmValidation.fail("INVALID_STATE", "La sesion no esta en una etapa conciliable");
      }
      var repo = KcmServiceSupport.repository();
      var eligible = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
        return String(row.sessionId) === session.sessionId && KcmServiceSupport.asBoolean(row.identityValidated) &&
          KcmServiceSupport.asBoolean(row.attendanceProven) && !KcmServiceSupport.asBoolean(row.released);
      });
      if (!eligible.length) KcmValidation.fail("INVALID_STATE", "No hay asistencias pendientes de examen");
      var received = KcmValidation.integer(input.receivedExamCount, 0, eligible.length);
      var missing = KcmValidation.stringArray(input.missingEmployeeIds || [], KcmValidation.employeeId, 40);
      if (new Set(missing).size !== missing.length) KcmValidation.fail("DUPLICATE", "La lista de examenes faltantes contiene duplicados");
      var eligibleMap = Object.create(null);
      eligible.forEach(function (row) { eligibleMap[String(row.employeeId).padStart(5, "0")] = true; });
      missing.forEach(function (id) { if (!eligibleMap[id]) KcmValidation.fail("EXAM_MISMATCH", "Un examen faltante no corresponde a un asistente elegible"); });
      if (eligible.length - received !== missing.length) KcmValidation.fail("EXAM_MISMATCH", "El conteo de examenes no concilia con las personas marcadas");
      var missingMap = Object.create(null);
      missing.forEach(function (id) { missingMap[id] = true; });
      var now = KcmServiceSupport.nowIso();
      var auditInputs = [];
      var updates = eligible.map(function (row) {
        var notFound = Boolean(missingMap[String(row.employeeId).padStart(5, "0")]);
        var next = notFound ? "EXAMEN_NO_ENCONTRADO" : "EXAMEN_CONFIRMADO";
        auditInputs.push({
          sessionId: session.sessionId, entityType: "Attendance", entityId: row.attendanceId,
          action: "EXAM_STATUS_RECONCILED", previousState: String(row.examStatus || "EXAMEN_PENDIENTE"), newState: next
        });
        return { attendanceId: row.attendanceId, examStatus: next, status: next, updatedAt: now };
      });
      repo.updateMany(KcmConfig.SHEETS.ATTENDANCES, "attendanceId", updates);
      var storedReconciliation = {
        reconciliationId: KcmServiceSupport.uuid(), sessionId: session.sessionId,
        eligibleAttendanceCount: eligible.length, receivedExamCount: received,
        missingEmployeeIds: KcmValidation.json(missing, 400), confirmedBy: identity.actor,
        confirmedAt: now, version: KcmConfig.CONTRACT_VERSION
      };
      repo.insertMany(KcmConfig.SHEETS.EXAMS, [storedReconciliation]);
      if (updates.some(function (update) { return update.examStatus === "EXAMEN_CONFIRMADO"; })) {
        repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: session.sessionId, status: "LISTA_PARA_LIBERAR" }]);
      }
      KcmServiceSupport.auditMany(identity, auditInputs);
      KcmServiceSupport.audit(identity, {
        sessionId: session.sessionId, entityType: "ExamReconciliation", entityId: storedReconciliation.reconciliationId,
        action: "EXAMS_RECONCILED", newState: "CONFIRMADA"
      });
      var dto = Object.assign({}, storedReconciliation, { missingEmployeeIds: missing.slice() });
      return { reconciliation: dto, preview: KcmPreReleaseService.preview(session.sessionId) };
    } finally {
      lock.releaseLock();
    }
  }

  return Object.freeze({ reconcile: reconcile });
}());
