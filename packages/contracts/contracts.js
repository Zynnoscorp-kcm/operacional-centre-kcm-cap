export const CONTRACT_VERSION = "1.0.0";
export const TIME_ZONE = "America/Mexico_City";
export const EMPLOYEE_ID_PATTERN = /^\d{5}$/;
export const MAX_PARTICIPANTS_PER_SESSION = 40;

export const CAPTURE_ROUTES = Object.freeze({
  DIGITAL: "DIGITAL",
  OCR: "OCR"
});

export const EXAM_STATUSES = Object.freeze({
  PENDING: "EXAMEN_PENDIENTE",
  CONFIRMED: "EXAMEN_CONFIRMADO",
  NOT_FOUND: "EXAMEN_NO_ENCONTRADO"
});

export const OCR_DECISIONS = Object.freeze({
  AUTO_ACCEPTED: "AUTO_ACEPTADO",
  REVIEW_REQUIRED: "REVISION_REQUERIDA",
  HUMAN_CONFIRMED: "CONFIRMADO_HUMANO",
  EMPTY_CONFIRMED: "CONFIRMADO_VACIO",
  REJECTED: "RECHAZADO"
});

export const CONTRACTS = Object.freeze({
  Session: ["sessionId", "sessionCode", "trainingId", "date", "durationMinutes", "instructor", "room", "shift", "eventType", "status", "authorized", "createdBy", "createdAt", "creationRequestId", "version"],
  Participant: ["employeeId", "displayName", "area", "position", "shift", "active"],
  Attendance: ["attendanceId", "sessionId", "employeeId", "captureRoute", "identityValidated", "attendanceProven", "examStatus", "status", "released", "createdAt", "updatedAt", "version"],
  KioskRegistration: ["registrationId", "sessionId", "employeeId", "attendanceId", "requestId", "stationLabel", "phase", "createdAt", "updatedAt", "version"],
  ParticipantAttendance: ["attendanceId", "sessionId", "employeeId", "captureRoute", "identityValidated", "attendanceProven", "examStatus", "sessionAuthorized", "released", "blockingReasons", "sourceEvidenceId", "version"],
  OcrDocument: ["documentId", "sessionId", "evidenceId", "sha256", "mimeType", "byteSize", "pageCount", "status", "createdBy", "createdAt", "version"],
  OcrCandidate: ["candidateId", "documentId", "rowIndex", "rawDigits", "digitConfidences", "overallConfidence", "normalizedEmployeeId", "decision", "validationFlags", "originalValue", "correctedValue", "correctionActor", "correctionAt", "correctionReason", "correctionRequestId", "correctionPreviousDecision", "correctionPreviousEmployeeId", "version"],
  ExamReconciliation: ["reconciliationId", "sessionId", "eligibleAttendanceCount", "receivedExamCount", "missingEmployeeIds", "confirmedBy", "confirmedAt", "version"],
  Release: ["releaseId", "sessionId", "requestId", "idempotencyKey", "mappingVersion", "included", "excluded", "status", "createdBy", "createdAt", "version"],
  ReleaseBatch: ["batchId", "sessionId", "requestId", "mappingVersion", "planHash", "plan", "results", "phase", "status", "createdBy", "createdAt", "updatedAt", "journalMac", "version"],
  AuditEvent: ["eventId", "timestamp", "actor", "role", "sessionId", "entityType", "entityId", "action", "previousState", "newState", "reason", "requestId", "version", "evidenceId"],
  Evidence: ["evidenceId", "sessionId", "kind", "driveFileId", "sha256", "mimeType", "immutable", "createdBy", "createdAt", "version"]
});

export function assertEmployeeId(value) {
  if (typeof value !== "string" || !EMPLOYEE_ID_PATTERN.test(value)) {
    throw new TypeError("El numero de trabajador debe ser texto de exactamente cinco digitos");
  }
  return value;
}

export function createParticipantAttendance(input) {
  const employeeId = assertEmployeeId(input.employeeId);
  if (!Object.values(CAPTURE_ROUTES).includes(input.captureRoute)) {
    throw new TypeError("Ruta de captura no soportada");
  }
  return Object.freeze({
    attendanceId: String(input.attendanceId),
    sessionId: String(input.sessionId),
    employeeId,
    captureRoute: input.captureRoute,
    identityValidated: input.identityValidated === true,
    attendanceProven: input.attendanceProven === true,
    examStatus: input.examStatus ?? EXAM_STATUSES.PENDING,
    sessionAuthorized: input.sessionAuthorized === true,
    released: input.released === true,
    blockingReasons: [...(input.blockingReasons ?? [])],
    sourceEvidenceId: input.sourceEvidenceId ? String(input.sourceEvidenceId) : null,
    version: CONTRACT_VERSION
  });
}

export function releaseIdempotencyKey({ sessionId, employeeId, trainingId, mappingVersion }) {
  return [sessionId, assertEmployeeId(employeeId), trainingId, mappingVersion].map(String).join("|");
}
