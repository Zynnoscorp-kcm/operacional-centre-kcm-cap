import { EXAM_STATUSES, assertEmployeeId, createParticipantAttendance } from "../shared/contracts.js";
import { canTransition } from "../shared/state-machine.js";
import { domainError } from "./errors.js";
import { immutableCopy } from "./immutable.js";

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `exam-${Date.now()}-${Math.random()}`;
}

export class ExamReconciliationService {
  #attendances;
  #audit;
  #clock;
  #idFactory;

  constructor({ attendances, audit, clock = () => new Date(), idFactory = defaultId }) {
    this.#attendances = attendances;
    this.#audit = audit;
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  reconcile({ sessionId, receivedExamCount, missingEmployeeIds = [], actor, role = "CAPACITACION", requestId }) {
    if (!Number.isInteger(receivedExamCount) || receivedExamCount < 0) {
      throw domainError("INVALID_EXAM_COUNT", "El conteo de examenes debe ser un entero no negativo");
    }
    const eligibleAttendances = this.#attendances.listBySession(sessionId)
      .filter((attendance) => attendance.identityValidated && attendance.attendanceProven && !attendance.released);
    const eligibleIds = new Set(eligibleAttendances.map(({ employeeId }) => employeeId));
    const normalizedMissing = missingEmployeeIds.map(assertEmployeeId);
    if (new Set(normalizedMissing).size !== normalizedMissing.length) {
      throw domainError("DUPLICATE_MISSING_EXAM", "La lista de examenes no encontrados contiene duplicados");
    }
    if (normalizedMissing.some((employeeId) => !eligibleIds.has(employeeId))) {
      throw domainError("UNKNOWN_MISSING_EXAM", "Se marco un examen para una asistencia no elegible");
    }
    if (receivedExamCount > eligibleAttendances.length ||
        eligibleAttendances.length - receivedExamCount !== normalizedMissing.length) {
      throw domainError("EXAM_COUNT_MISMATCH", "El conteo recibido no concilia con los examenes no encontrados");
    }

    const missingSet = new Set(normalizedMissing);
    const updates = eligibleAttendances.map((attendance) => {
      const missing = missingSet.has(attendance.employeeId);
      const examStatus = missing ? EXAM_STATUSES.NOT_FOUND : EXAM_STATUSES.CONFIRMED;
      const nextState = missing ? "EXAMEN_NO_ENCONTRADO" : "EXAMEN_CONFIRMADO";
      const previousState = this.#attendances.getState(sessionId, attendance.employeeId);
      if (previousState !== nextState && !canTransition("ATTENDANCE", previousState, nextState)) {
        throw domainError("INVALID_EXAM_RECONCILIATION_STATE", "El estado actual no permite esta conciliacion de examenes");
      }
      return { attendance, examStatus, nextState, previousState, missing };
    });

    for (const { attendance, examStatus, nextState, previousState, missing } of updates) {
      const updated = createParticipantAttendance({ ...attendance, examStatus });
      this.#attendances.replace(updated);
      if (previousState !== nextState) {
        this.#attendances.advanceState(sessionId, attendance.employeeId, nextState);
      }
      this.#audit.record({
        actor, role, sessionId, entityType: "Attendance", entityId: attendance.attendanceId,
        action: missing ? "EXAMEN_NO_ENCONTRADO" : "EXAMEN_CONFIRMADO",
        previousState, newState: nextState, requestId
      });
    }

    const reconciliation = immutableCopy({
      reconciliationId: this.#idFactory(),
      sessionId: String(sessionId),
      eligibleAttendanceCount: eligibleAttendances.length,
      receivedExamCount,
      missingEmployeeIds: normalizedMissing,
      confirmedBy: String(actor),
      confirmedAt: this.#clock().toISOString(),
      version: "1.0.0"
    });
    this.#audit.record({
      actor, role, sessionId, entityType: "ExamReconciliation",
      entityId: reconciliation.reconciliationId, action: "EXAMENES_CONCILIADOS",
      previousState: null, newState: "CONFIRMADA", requestId,
      reason: `${receivedExamCount}/${eligibleAttendances.length}`
    });
    return reconciliation;
  }
}
