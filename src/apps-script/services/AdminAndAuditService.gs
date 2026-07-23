/** Operaciones administrativas y consulta de auditoria, siempre autorizadas. */
var KcmAdminAndAuditService = (function () {
  "use strict";

  function initializeSchema() {
    var identity = KcmAuth.requireRoles(["ADMINISTRADOR"]);
    if (KcmConfig.isMockMode()) {
      KcmMockRepository.seedSynthetic();
      return { mode: "MOCK", initialized: true };
    }
    KcmSheetsRepository.ensureSchema();
    KcmServiceSupport.audit(identity, { entityType: "Configuration", entityId: "SCHEMA_V1", action: "SCHEMA_INITIALIZED", newState: "1.0.0" });
    return { mode: "GOOGLE", initialized: true };
  }

  function bootstrap() {
    var identity = KcmAuth.currentIdentity();
    var repo = KcmServiceSupport.repository();
    var cache = CacheService.getScriptCache();
    var cached = cache.get("active-trainings-v1");
    var trainings = cached ? JSON.parse(cached) : repo.list(KcmConfig.SHEETS.TRAININGS, function (row) { return KcmServiceSupport.asBoolean(row.active); });
    if (!cached) cache.put("active-trainings-v1", JSON.stringify(trainings), 300);
    return {
      actor: identity.actor, role: identity.role, mode: KcmConfig.isMockMode() ? "MOCK" : "GOOGLE",
      contractVersion: KcmConfig.CONTRACT_VERSION, trainings: trainings,
      sessions: KcmSessionService.list()
    };
  }

  function kioskBootstrap(token) {
    var identity = KcmAuth.verifyKioskToken(token);
    var session = KcmServiceSupport.session(identity.sessionId);
    var capacity = KcmKioskService.capacity(session.sessionId, identity);
    return {
      sessionId: session.sessionId,
      sessionCode: session.sessionCode,
      status: session.status,
      trainingId: session.trainingId,
      stationLabel: identity.stationLabel || "Equipo de registro",
      expiresAt: identity.expiresAt,
      availability: { maximum: capacity.maximum, available: capacity.available },
      acceptingRegistrations: String(session.status) === "ABIERTA" && capacity.available
    };
  }

  function auditBySession(sessionId) {
    KcmAuth.requireRoles(["ADMINISTRADOR", "AUDITOR", "CAPACITACION"]);
    var id = KcmValidation.identifier(sessionId, "sessionId");
    return KcmServiceSupport.repository().list(KcmConfig.SHEETS.AUDIT, function (row) { return String(row.sessionId) === id; }).slice(-500);
  }

  function documentsBySession(sessionId) {
    KcmAuth.requireRoles(["ADMINISTRADOR", "AUDITOR", "CAPACITACION"]);
    var id = KcmValidation.identifier(sessionId, "sessionId");
    return KcmServiceSupport.repository().list(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.sessionId) === id; });
  }

  function evidencePreview(evidenceId) {
    KcmAuth.requireRoles(["ADMINISTRADOR", "AUDITOR", "CAPACITACION"]);
    var id = KcmValidation.identifier(evidenceId, "evidenceId");
    var evidence = KcmServiceSupport.repository().findOne(KcmConfig.SHEETS.EVIDENCE, function (row) { return String(row.evidenceId) === id; });
    if (!evidence) KcmValidation.fail("NOT_FOUND", "La evidencia no existe");
    return { evidenceId: id, mimeType: evidence.mimeType, dataUrl: KcmDriveEvidenceRepository.previewDataUrl(String(evidence.driveFileId)) };
  }

  return Object.freeze({ initializeSchema: initializeSchema, bootstrap: bootstrap, kioskBootstrap: kioskBootstrap, auditBySession: auditBySession, documentsBySession: documentsBySession, evidencePreview: evidencePreview });
}());
