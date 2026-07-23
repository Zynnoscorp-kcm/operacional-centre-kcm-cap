import { assertEmployeeId, createParticipantAttendance } from "../shared/contracts.js";
import { ATTENDANCE_STATES, transition } from "../shared/state-machine.js";
import { domainError } from "./errors.js";
import { immutableCopy } from "./immutable.js";

function attendanceKey(sessionId, employeeId) {
  return `${String(sessionId)}|${assertEmployeeId(employeeId)}`;
}

export class InMemoryEmployeeRepository {
  #employees = new Map();

  constructor(employees = []) {
    for (const employee of employees) {
      this.add(employee);
    }
  }

  add(employee) {
    const employeeId = assertEmployeeId(employee.employeeId);
    if (this.#employees.has(employeeId)) {
      throw domainError("DUPLICATE_EMPLOYEE", "El padron contiene un identificador duplicado");
    }
    const stored = immutableCopy({
      employeeId,
      displayName: String(employee.displayName ?? ""),
      area: String(employee.area ?? ""),
      position: String(employee.position ?? ""),
      shift: String(employee.shift ?? ""),
      active: employee.active !== false
    });
    this.#employees.set(employeeId, stored);
    return stored;
  }

  findByEmployeeId(employeeId) {
    assertEmployeeId(employeeId);
    return this.#employees.get(employeeId) ?? null;
  }

  get size() {
    return this.#employees.size;
  }
}

export class InMemoryAttendanceRepository {
  #entries = new Map();

  add(attendance, initialState = "CAPTURADA") {
    if (!ATTENDANCE_STATES.includes(initialState)) {
      throw domainError("INVALID_ATTENDANCE_STATE", "Estado de asistencia no reconocido");
    }
    const normalized = createParticipantAttendance(attendance);
    const key = attendanceKey(normalized.sessionId, normalized.employeeId);
    if (this.#entries.has(key)) {
      throw domainError("DUPLICATE_ATTENDANCE", "El trabajador ya tiene un registro en la sesion");
    }
    this.#entries.set(key, { attendance: normalized, state: initialState });
    return normalized;
  }

  get(sessionId, employeeId) {
    return this.#entries.get(attendanceKey(sessionId, employeeId))?.attendance ?? null;
  }

  getState(sessionId, employeeId) {
    return this.#entries.get(attendanceKey(sessionId, employeeId))?.state ?? null;
  }

  listBySession(sessionId) {
    const expected = String(sessionId);
    return [...this.#entries.values()]
      .filter(({ attendance }) => attendance.sessionId === expected)
      .map(({ attendance }) => attendance);
  }

  replace(attendance) {
    const normalized = createParticipantAttendance(attendance);
    const key = attendanceKey(normalized.sessionId, normalized.employeeId);
    const entry = this.#entries.get(key);
    if (!entry) {
      throw domainError("ATTENDANCE_NOT_FOUND", "No existe la asistencia solicitada");
    }
    if (entry.attendance.released && normalized.released !== true) {
      throw domainError("RELEASED_ATTENDANCE_IMMUTABLE", "Una asistencia liberada no puede reabrirse");
    }
    if (normalized.attendanceId !== entry.attendance.attendanceId ||
        normalized.captureRoute !== entry.attendance.captureRoute) {
      throw domainError("ATTENDANCE_IDENTITY_IMMUTABLE", "No se pueden cambiar los identificadores de la asistencia");
    }
    entry.attendance = normalized;
    return normalized;
  }

  advanceState(sessionId, employeeId, nextState) {
    const key = attendanceKey(sessionId, employeeId);
    const entry = this.#entries.get(key);
    if (!entry) {
      throw domainError("ATTENDANCE_NOT_FOUND", "No existe la asistencia solicitada");
    }
    entry.state = transition("ATTENDANCE", entry.state, nextState);
    return entry.state;
  }
}

export class InMemoryReleaseRepository {
  #effectiveByKey = new Map();
  #attempts = [];

  hasEffective(idempotencyKey) {
    return this.#effectiveByKey.has(String(idempotencyKey));
  }

  getEffective(idempotencyKey) {
    return this.#effectiveByKey.get(String(idempotencyKey)) ?? null;
  }

  recordEffective(idempotencyKey, result) {
    const key = String(idempotencyKey);
    if (this.#effectiveByKey.has(key)) {
      throw domainError("DUPLICATE_EFFECTIVE_RELEASE", "La liberacion ya fue aplicada");
    }
    const stored = immutableCopy(result);
    this.#effectiveByKey.set(key, stored);
    return stored;
  }

  recordAttempt(attempt) {
    const stored = immutableCopy(attempt);
    this.#attempts.push(stored);
    return stored;
  }

  listAttempts() {
    return [...this.#attempts];
  }

  get effectiveCount() {
    return this.#effectiveByKey.size;
  }
}
