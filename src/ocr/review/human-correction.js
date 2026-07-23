import { CONTRACT_VERSION, EMPLOYEE_ID_PATTERN, OCR_DECISIONS } from "../../shared/contracts.js";
import { employeeIsActive } from "../validation/candidate-validator.js";

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} es obligatorio`);
  return value.trim();
}

export function applyHumanCorrection(candidate, {
  correctedValue,
  actor,
  reason,
  correctedAt = new Date().toISOString(),
  employeeRoster
} = {}) {
  if (!candidate?.candidateId) throw new TypeError("Se requiere un candidato OCR");
  if (candidate.decision === OCR_DECISIONS.EMPTY_CONFIRMED) {
    throw new TypeError("Un renglon confirmado sin participante no puede corregirse silenciosamente");
  }
  if (typeof correctedValue !== "string" || !EMPLOYEE_ID_PATTERN.test(correctedValue)) {
    throw new TypeError("La correccion debe conservar exactamente cinco digitos como texto");
  }
  if (!employeeIsActive(employeeRoster, correctedValue)) {
    throw new TypeError("La correccion no corresponde a un trabajador activo");
  }
  const correctionActor = requiredText(actor, "actor");
  const correctionReason = requiredText(reason, "reason");
  const correctionAt = new Date(correctedAt).toISOString();

  const correction = Object.freeze({
    correctionId: `${candidate.candidateId}:${correctionAt}`,
    candidateId: candidate.candidateId,
    documentId: candidate.documentId,
    rowIndex: candidate.rowIndex,
    before: candidate.originalValue,
    after: correctedValue,
    actor: correctionActor,
    at: correctionAt,
    reason: correctionReason,
    version: CONTRACT_VERSION
  });

  const updatedCandidate = Object.freeze({
    ...candidate,
    normalizedEmployeeId: correctedValue,
    decision: OCR_DECISIONS.HUMAN_CONFIRMED,
    validationFlags: Object.freeze(["HUMAN_REVIEW_COMPLETED"]),
    correctedValue,
    correctionActor,
    correctionAt,
    correctionReason
  });

  return Object.freeze({ candidate: updatedCandidate, correction });
}

export function confirmEmptyCandidate(candidate, {
  actor,
  reason,
  confirmedAt = new Date().toISOString()
} = {}) {
  if (!candidate?.candidateId) throw new TypeError("Se requiere un candidato OCR");
  if (![OCR_DECISIONS.REVIEW_REQUIRED, OCR_DECISIONS.AUTO_ACCEPTED].includes(candidate.decision)) {
    throw new TypeError("Solo un renglon pendiente o autoaceptado puede confirmarse sin participante");
  }
  const correctionActor = requiredText(actor, "actor");
  const correctionReason = requiredText(reason, "reason");
  const correctionAt = new Date(confirmedAt).toISOString();
  const previousFlags = Array.isArray(candidate.validationFlags) ? candidate.validationFlags.map(String) : [];
  const validationFlags = Object.freeze([...new Set([
    ...previousFlags,
    "HUMAN_REVIEW_COMPLETED",
    "EMPTY_ROW_CONFIRMED"
  ])]);

  const correction = Object.freeze({
    correctionId: `${candidate.candidateId}:${correctionAt}`,
    candidateId: candidate.candidateId,
    documentId: candidate.documentId,
    rowIndex: candidate.rowIndex,
    before: candidate.originalValue,
    after: null,
    actor: correctionActor,
    at: correctionAt,
    reason: correctionReason,
    resolution: OCR_DECISIONS.EMPTY_CONFIRMED,
    version: CONTRACT_VERSION
  });

  const updatedCandidate = Object.freeze({
    ...candidate,
    normalizedEmployeeId: null,
    decision: OCR_DECISIONS.EMPTY_CONFIRMED,
    validationFlags,
    correctedValue: null,
    correctionActor,
    correctionAt,
    correctionReason
  });

  return Object.freeze({ candidate: updatedCandidate, correction });
}
