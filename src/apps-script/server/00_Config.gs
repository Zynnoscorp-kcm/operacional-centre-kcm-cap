var KcmConfig = (function () {
  "use strict";

  var CONTRACT_VERSION = "1.0.0";
  var TIME_ZONE = "America/Mexico_City";
  var SHEETS = Object.freeze({
    CONFIG: "CONFIG",
    EMPLOYEES: "EMPLEADOS",
    TRAININGS: "CAPACITACIONES",
    SESSIONS: "SESIONES",
    ATTENDANCES: "ASISTENCIAS",
    KIOSK_REGISTRATIONS: "KIOSK_REGISTROS",
    OCR_DOCUMENTS: "OCR_DOCUMENTOS",
    OCR_RESULTS: "OCR_RESULTADOS",
    OCR_CROP_BATCHES: "OCR_RECORTES_LOTES",
    EVIDENCE: "EVIDENCIAS",
    EXAMS: "EXAMENES",
    RELEASES: "LIBERACIONES",
    RELEASE_BATCHES: "LIBERACION_LOTES",
    MATRIX_MAPPING: "MATRIZ_MAPEO",
    AUDIT: "AUDITORIA",
    ERRORS: "ERRORES",
    MOCK_MATRIX: "MATRIZ_SIMULADA"
  });

  var HEADERS = Object.freeze({
    CONFIG: ["key", "value", "category", "updatedAt"],
    EMPLEADOS: ["employeeId", "displayName", "area", "position", "shift", "active", "version"],
    CAPACITACIONES: ["trainingId", "trainingName", "active", "version"],
    SESIONES: ["sessionId", "sessionCode", "trainingId", "date", "durationMinutes", "instructor", "room", "shift", "eventType", "status", "authorized", "createdBy", "createdAt", "creationRequestId", "version"],
    ASISTENCIAS: ["attendanceId", "sessionId", "employeeId", "captureRoute", "identityValidated", "attendanceProven", "examStatus", "status", "released", "sourceEvidenceId", "createdAt", "updatedAt", "version"],
    KIOSK_REGISTROS: ["registrationId", "sessionId", "employeeId", "attendanceId", "requestId", "stationLabel", "phase", "createdAt", "updatedAt", "version"],
    OCR_DOCUMENTOS: ["documentId", "sessionId", "evidenceId", "sha256", "mimeType", "byteSize", "pageCount", "status", "createdBy", "createdAt", "version", "ocrRequestId", "ocrWorkerVersion", "ocrRuntime", "ocrPipelineVersion", "ocrProcessingMs", "ocrProcessedAt", "ocrLeaseId", "ocrLeaseUntil"],
    OCR_RESULTADOS: ["candidateId", "documentId", "rowIndex", "rawDigits", "digitConfidences", "overallConfidence", "normalizedEmployeeId", "decision", "validationFlags", "originalValue", "correctedValue", "correctionActor", "correctionAt", "correctionReason", "correctionRequestId", "correctionPreviousDecision", "correctionPreviousEmployeeId", "cropEvidenceId", "cropEvidenceRefs", "version"],
    EVIDENCIAS: ["evidenceId", "sessionId", "kind", "driveFileId", "sha256", "mimeType", "immutable", "createdBy", "createdAt", "version", "documentId", "candidateId", "cropId", "variant", "byteSize", "requestId", "status"],
    OCR_RECORTES_LOTES: ["batchId", "requestId", "sessionId", "documentId", "payloadHash", "status", "totalPairs", "storedVariants", "linkedCandidates", "errorCode", "createdBy", "createdAt", "updatedAt", "version", "chunkSize", "chunkCount", "completedChunks", "workerVersion", "runtime", "pipelineVersion", "processingMs"],
    EXAMENES: ["reconciliationId", "sessionId", "eligibleAttendanceCount", "receivedExamCount", "missingEmployeeIds", "confirmedBy", "confirmedAt", "version"],
    LIBERACIONES: ["releaseId", "sessionId", "requestId", "idempotencyKey", "mappingVersion", "included", "excluded", "status", "createdBy", "createdAt", "version"],
    LIBERACION_LOTES: ["batchId", "sessionId", "requestId", "mappingVersion", "planHash", "plan", "results", "phase", "status", "createdBy", "createdAt", "updatedAt", "journalMac", "version"],
    MATRIZ_MAPEO: ["trainingId", "destinationSheet", "destinationColumn", "destinationHeader", "headerRow", "mappingVersion", "overwritePolicy", "active"],
    AUDITORIA: ["eventId", "timestamp", "actor", "role", "sessionId", "entityType", "entityId", "action", "previousState", "newState", "reason", "requestId", "version", "evidenceId", "workerVersion", "runtime", "pipelineVersion", "processingMs"],
    ERRORES: ["errorId", "timestamp", "requestId", "operation", "category", "safeMessage", "retryable", "version"],
    MATRIZ_SIMULADA: ["idempotencyKey", "sessionId", "employeeId", "trainingId", "mappingVersion", "completionDate", "batchId", "planHash", "marker", "createdAt"]
  });

  var SESSION_TRANSITIONS = Object.freeze({
    BORRADOR: ["ABIERTA", "CANCELADA"],
    ABIERTA: ["CERRADA", "CANCELADA", "ERROR"],
    CERRADA: ["EVIDENCIA_RECIBIDA", "PRELIBERACION", "CANCELADA", "ERROR"],
    EVIDENCIA_RECIBIDA: ["OCR_EN_PROCESO", "PRELIBERACION", "ERROR"],
    OCR_EN_PROCESO: ["REVISION_OCR", "ERROR"],
    REVISION_OCR: ["PRELIBERACION", "ERROR"],
    PRELIBERACION: ["LISTA_PARA_LIBERAR", "ERROR"],
    LISTA_PARA_LIBERAR: ["LIBERADA_PARCIAL", "LIBERADA_TOTAL", "ERROR"],
    LIBERADA_PARCIAL: ["LISTA_PARA_LIBERAR", "LIBERADA_TOTAL"],
    LIBERADA_TOTAL: [], CANCELADA: [],
    ERROR: ["EVIDENCIA_RECIBIDA", "REVISION_OCR", "PRELIBERACION", "CANCELADA"]
  });

  function property(name, fallback) {
    var value = PropertiesService.getScriptProperties().getProperty(name);
    return value === null || value === "" ? fallback : value;
  }

  function isMockMode() {
    return property("KCM_MODE", "MOCK").toUpperCase() === "MOCK";
  }

  function configurationError() {
    var error = new Error("La configuracion OCR no es valida");
    error.code = "INTERNAL_ERROR";
    throw error;
  }

  function boundedOcrThreshold(name, fallback, minimum) {
    var value = Number(property(name, String(fallback)));
    if (!isFinite(value) || value < minimum || value > 1) configurationError();
    return value;
  }

  function strictBooleanProperty(name, fallback) {
    var value = String(property(name, fallback ? "true" : "false")).toLowerCase();
    if (value === "true") return true;
    if (value === "false") return false;
    configurationError();
  }

  function releaseIntegritySecret() {
    var properties = PropertiesService.getScriptProperties();
    var value = String(properties.getProperty("KCM_RELEASE_INTEGRITY_SECRET") || "");
    if (!value && isMockMode()) {
      value = String(Utilities.getUuid()).replace(/-/g, "") + String(Utilities.getUuid()).replace(/-/g, "");
      properties.setProperty("KCM_RELEASE_INTEGRITY_SECRET", value);
    }
    var distinct = Object.create(null);
    for (var index = 0; index < value.length; index += 1) distinct[value.charAt(index)] = true;
    if (value.length < 32 || value.length > 256 || Object.keys(distinct).length < 8 ||
        /[\u0000-\u001F\u007F]/.test(value) || /replace|example|changeme|secret_here/i.test(value)) {
      var error = new Error("La configuracion de integridad de liberacion no es valida");
      error.code = "INTERNAL_ERROR";
      throw error;
    }
    return value;
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    TIME_ZONE: TIME_ZONE,
    SHEETS: SHEETS,
    HEADERS: HEADERS,
    SESSION_TRANSITIONS: SESSION_TRANSITIONS,
    property: property,
    isMockMode: isMockMode,
    releaseIntegritySecret: releaseIntegritySecret,
    maxUploadBytes: function () { return Number(property("KCM_MAX_UPLOAD_BYTES", "10485760")); },
    maxReviewCropBytes: function () { return Number(property("KCM_MAX_REVIEW_CROP_BYTES", "262144")); },
    maxReviewCropBatchBytes: function () { return Number(property("KCM_MAX_REVIEW_CROP_BATCH_BYTES", "8388608")); },
    maxReviewCropDimension: function () { return Number(property("KCM_MAX_REVIEW_CROP_DIMENSION", "2048")); },
    reviewCropChunkPairs: function () { return Number(property("KCM_OCR_CROP_CHUNK_PAIRS", "20")); },
    reviewCropExecutionBudgetMs: function () { return Number(property("KCM_OCR_CROP_EXECUTION_BUDGET_MS", "240000")); },
    ocrAutoAcceptThreshold: function () { return boundedOcrThreshold("KCM_OCR_AUTO_ACCEPT_THRESHOLD", 0.98, 0.96); },
    ocrDigitThreshold: function () { return boundedOcrThreshold("KCM_OCR_DIGIT_THRESHOLD", 0.98, 0.94); },
    ocrRequireHumanReview: function () { return strictBooleanProperty("KCM_OCR_REQUIRE_HUMAN_REVIEW", true); },
    minImageShortSide: function () { return Number(property("KCM_MIN_IMAGE_SHORT_SIDE", "700")); },
    minImageLongSide: function () { return Number(property("KCM_MIN_IMAGE_LONG_SIDE", "1000")); },
    kioskTokenMinutes: function () { return Number(property("KCM_KIOSK_TOKEN_MINUTES", "120")); }
  });
}());

var KcmRequestContext = { requestId: "" };
