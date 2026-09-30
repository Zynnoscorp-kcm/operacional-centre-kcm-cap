function doGet(event) {
  var requestedView = event && event.parameter ? String(event.parameter.view || "") : "";
  var kioskView = requestedView === "kiosk";
  var templateName = kioskView ? "Kiosk" : "Index";
  var pageTitle = kioskView ? "Registro de capacitacion KCM" : "Control de capacitaciones KCM";
  return HtmlService.createTemplateFromFile(templateName).evaluate()
    .setTitle(pageTitle)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function api(action, payload) {
  "use strict";
  var fallbackRequestId = Utilities.getUuid();
  var requestId = fallbackRequestId;
  var operation = String(action || "");
  var input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  KcmRequestContext.requestId = fallbackRequestId;
  var routes = {
    bootstrap: function () { return KcmAdminAndAuditService.bootstrap(); },
    kioskBootstrap: function () { return KcmAdminAndAuditService.kioskBootstrap(input.token); },
    initializeSchema: function () { return KcmAdminAndAuditService.initializeSchema(); },
    createSession: function () { return KcmSessionService.create(input); },
    openSession: function () { return KcmSessionService.open(input.sessionId); },
    closeSession: function () { return KcmSessionService.close(input.sessionId); },
    authorizeSession: function () { return KcmSessionService.authorize(input.sessionId, input.reason); },
    findSession: function () { return KcmSessionService.findByCode(input.sessionCode); },
    listSessions: function () { return KcmSessionService.list(); },
    issueKioskToken: function () { return KcmKioskService.issueToken(input); },
    kioskRegister: function () { return KcmKioskService.register(input); },
    uploadOcrDocument: function () { return KcmOcrWorkflowService.upload(input); },
    beginOcrProcessing: function () { if (!KcmConfig.isMockMode()) KcmValidation.fail("FORBIDDEN", "Operacion disponible solo en modo MOCK"); return KcmOcrWorkflowService.beginProcessing(input.documentId); },
    processRemoteOcrDocument: function () { return KcmRemoteOcrProcessingService.process(input); },
    ingestOcrCandidates: function () { if (!KcmConfig.isMockMode()) KcmValidation.fail("FORBIDDEN", "Operacion disponible solo en modo MOCK"); return KcmOcrWorkflowService.ingestCandidates(input); },
    storeOcrCropEvidenceBatch: function () { return KcmOcrCropEvidenceService.storeBatch(input); },
    reviewOcrCandidate: function () { return KcmOcrWorkflowService.reviewCandidate(input); },
    confirmEmptyOcrRow: function () { return KcmOcrWorkflowService.confirmEmptyCandidate(input); },
    listOcrCandidates: function () { return KcmOcrWorkflowService.listCandidates(input.documentId); },
    reviewEvidence: function () { return KcmOcrWorkflowService.reviewEvidence(input); },
    listSessionDocuments: function () { return KcmAdminAndAuditService.documentsBySession(input.sessionId); },
    reconcilePhysicalAttendance: function () { return KcmPreReleaseService.reconcilePhysicalAttendance(input); },
    preReleasePreview: function () { return KcmPreReleaseService.preview(input.sessionId); },
    reconcileExams: function () { return KcmExamService.reconcile(input); },
    releasePreview: function () { return KcmReleaseService.preview(input.sessionId); },
    executeRelease: function () { return KcmReleaseService.execute(input); },
    sessionAudit: function () { return KcmAdminAndAuditService.auditBySession(input.sessionId); }
  };
  try {
    if (Object.prototype.hasOwnProperty.call(input, "requestId")) {
      requestId = KcmValidation.identifier(String(input.requestId), "requestId");
    }
    input.requestId = requestId;
    KcmRequestContext.requestId = requestId;
    if (!Object.prototype.hasOwnProperty.call(routes, operation)) KcmValidation.fail("INVALID_INPUT", "Operacion no reconocida");
    return { ok: true, requestId: requestId, data: routes[operation]() };
  } catch (error) {
    KcmServiceSupport.recordError(operation, requestId, error);
    return { ok: false, requestId: requestId, error: KcmValidation.safeError(error) };
  }
}
