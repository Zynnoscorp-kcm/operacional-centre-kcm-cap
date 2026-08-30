import {
  CAPTURE_ROUTES,
  EXAM_STATUSES,
  OCR_DECISIONS,
  assertEmployeeId,
  createParticipantAttendance
} from "../contracts/contracts.js";
import { domainError } from "./errors.js";

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `attendance-${Date.now()}-${Math.random()}`;
}

export class AttendanceCaptureService {
  #employees;
  #attendances;
  #audit;
  #idFactory;

  constructor({ employees, attendances, audit, idFactory = defaultId }) {
    this.#employees = employees;
    this.#attendances = attendances;
    this.#audit = audit;
    this.#idFactory = idFactory;
  }

  registerDigital(input) {
    return this.#register({ ...input, captureRoute: CAPTURE_ROUTES.DIGITAL });
  }

  registerOcr(input) {
    const accepted = [OCR_DECISIONS.AUTO_ACCEPTED, OCR_DECISIONS.HUMAN_CONFIRMED];
    if (!accepted.includes(input.candidate?.decision)) {
      throw domainError("OCR_REVIEW_REQUIRED", "La lectura OCR requiere revision antes de crear la asistencia");
    }
    if (!input.evidenceId) {
      throw domainError("OCR_EVIDENCE_REQUIRED", "La captura OCR requiere evidencia vinculada");
    }
    return this.#register({
      ...input,
      employeeId: input.candidate.normalizedEmployeeId,
      captureRoute: CAPTURE_ROUTES.OCR
    });
  }

  confirmAttendance({ sessionId, employeeId, actor, role = "CAPACITACION", requestId, evidenceId }) {
    const current = this.#attendances.get(sessionId, employeeId);
    if (!current) {
      throw domainError("ATTENDANCE_NOT_FOUND", "No existe la asistencia solicitada");
    }
    if (!current.identityValidated) {
      throw domainError("IDENTITY_NOT_VALIDATED", "No se puede cotejar una identidad invalida");
    }
    if (current.released) {
      throw domainError("RELEASED_ATTENDANCE_IMMUTABLE", "Una asistencia liberada no puede modificarse");
    }
    if (!current.attendanceProven) {
      const updated = createParticipantAttendance({ ...current, attendanceProven: true });
      this.#attendances.replace(updated);
      this.#attendances.advanceState(sessionId, employeeId, "COTEJADA");
      this.#attendances.advanceState(sessionId, employeeId, "EXAMEN_PENDIENTE");
      this.#audit.record({
        actor, role, sessionId, entityType: "Attendance", entityId: current.attendanceId,
        action: "ASISTENCIA_COTEJADA", previousState: "PENDIENTE_COTEJO",
        newState: "EXAMEN_PENDIENTE", requestId, evidenceId
      });
      return updated;
    }
    return current;
  }

  #register(input) {
    const employeeId = assertEmployeeId(input.employeeId);
    const employee = this.#employees.findByEmployeeId(employeeId);
    const identityValidated = Boolean(employee?.active);
    const attendance = createParticipantAttendance({
      attendanceId: input.attendanceId ?? this.#idFactory(),
      sessionId: input.session.sessionId,
      employeeId,
      captureRoute: input.captureRoute,
      identityValidated,
      attendanceProven: false,
      examStatus: EXAM_STATUSES.PENDING,
      sessionAuthorized: input.session.authorized === true,
      released: false,
      blockingReasons: identityValidated ? [] : ["IDENTIDAD_INVALIDA"],
      sourceEvidenceId: input.evidenceId ?? null
    });
    this.#attendances.add(attendance);
    const nextState = identityValidated ? "PENDIENTE_COTEJO" : "IDENTIDAD_INVALIDA";
    this.#attendances.advanceState(attendance.sessionId, employeeId, nextState);
    this.#audit.record({
      actor: input.actor,
      role: input.role ?? "CAPACITADOR",
      sessionId: attendance.sessionId,
      entityType: "Attendance",
      entityId: attendance.attendanceId,
      action: `CAPTURA_${input.captureRoute}`,
      previousState: null,
      newState: nextState,
      requestId: input.requestId,
      evidenceId: input.evidenceId
    });
    if (input.attendanceProven === true && identityValidated) {
      return this.confirmAttendance({
        sessionId: attendance.sessionId,
        employeeId,
        actor: input.actor,
        role: input.role,
        requestId: input.requestId,
        evidenceId: input.evidenceId
      });
    }
    return attendance;
  }
}
