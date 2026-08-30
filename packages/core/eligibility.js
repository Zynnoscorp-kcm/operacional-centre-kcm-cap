import { EXAM_STATUSES } from "../contracts/contracts.js";

export const BLOCKING_REASONS = Object.freeze({
  INVALID_IDENTITY: "IDENTIDAD_INVALIDA",
  ATTENDANCE_NOT_PROVEN: "ASISTENCIA_NO_COMPROBADA",
  EXAM_NOT_CONFIRMED: "EXAMEN_NO_CONFIRMADO",
  EXAM_NOT_FOUND: "EXAMEN_NO_ENCONTRADO",
  SESSION_NOT_AUTHORIZED: "SESION_NO_AUTORIZADA",
  ALREADY_RELEASED: "YA_LIBERADO_PREVIAMENTE",
  MATRIX_VALUE_EXISTS: "MATRIZ_CON_FECHA_EXISTENTE"
});

export function evaluateEligibility(attendance) {
  const reasons = [];
  if (attendance.identityValidated !== true) reasons.push(BLOCKING_REASONS.INVALID_IDENTITY);
  if (attendance.attendanceProven !== true) reasons.push(BLOCKING_REASONS.ATTENDANCE_NOT_PROVEN);
  if (attendance.examStatus === EXAM_STATUSES.NOT_FOUND) {
    reasons.push(BLOCKING_REASONS.EXAM_NOT_FOUND);
  } else if (attendance.examStatus !== EXAM_STATUSES.CONFIRMED) {
    reasons.push(BLOCKING_REASONS.EXAM_NOT_CONFIRMED);
  }
  if (attendance.sessionAuthorized !== true) reasons.push(BLOCKING_REASONS.SESSION_NOT_AUTHORIZED);
  if (attendance.released === true) reasons.push(BLOCKING_REASONS.ALREADY_RELEASED);
  return Object.freeze({ eligible: reasons.length === 0, reasons: Object.freeze(reasons) });
}
