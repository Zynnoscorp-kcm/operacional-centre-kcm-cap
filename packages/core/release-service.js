import { CONTRACT_VERSION, createParticipantAttendance, releaseIdempotencyKey } from "../contracts/contracts.js";
import { BLOCKING_REASONS, evaluateEligibility } from "./eligibility.js";
import { domainError } from "./errors.js";
import { immutableCopy } from "./immutable.js";

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `release-${Date.now()}-${Math.random()}`;
}

export class LocalMutex {
  #tail = Promise.resolve();

  async runExclusive(operation) {
    let release;
    const predecessor = this.#tail;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const GLOBAL_RELEASE_MUTEX = new LocalMutex();

function assertReleaseDate(value) {
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw domainError("INVALID_RELEASE_DATE", "La fecha de liberacion debe usar formato YYYY-MM-DD");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== text) {
    throw domainError("INVALID_RELEASE_DATE", "La fecha de liberacion no es una fecha valida");
  }
  return text;
}

export class ReleaseService {
  #attendances;
  #releases;
  #matrix;
  #audit;
  #mutex;
  #clock;
  #idFactory;

  constructor({ attendances, releases, matrix, audit, mutex = GLOBAL_RELEASE_MUTEX, clock = () => new Date(), idFactory = defaultId }) {
    this.#attendances = attendances;
    this.#releases = releases;
    this.#matrix = matrix;
    this.#audit = audit;
    this.#mutex = mutex;
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  preview({ sessionId, trainingId, mappingVersion, releaseDate }) {
    const normalizedReleaseDate = assertReleaseDate(releaseDate);
    const included = [];
    const excluded = [];
    for (const attendance of this.#attendances.listBySession(sessionId)) {
      const key = releaseIdempotencyKey({
        sessionId, employeeId: attendance.employeeId, trainingId, mappingVersion
      });
      const evaluation = evaluateEligibility(attendance);
      const reasons = [...evaluation.reasons];
      if (this.#releases.hasEffective(key) && !reasons.includes(BLOCKING_REASONS.ALREADY_RELEASED)) {
        reasons.push(BLOCKING_REASONS.ALREADY_RELEASED);
      }
      if (reasons.length === 0 && this.#matrix.getCell({ employeeId: attendance.employeeId, trainingId }) !== null) {
        reasons.push(BLOCKING_REASONS.MATRIX_VALUE_EXISTS);
      }
      if (reasons.length > 0) {
        excluded.push(immutableCopy({ attendanceId: attendance.attendanceId, employeeId: attendance.employeeId, reasons }));
      } else {
        included.push(immutableCopy({
          attendanceId: attendance.attendanceId,
          employeeId: attendance.employeeId,
          trainingId: String(trainingId),
          mappingVersion: String(mappingVersion),
          value: normalizedReleaseDate,
          idempotencyKey: key
        }));
      }
    }
    return immutableCopy({
      sessionId: String(sessionId),
      trainingId: String(trainingId),
      mappingVersion: String(mappingVersion),
      releaseDate: normalizedReleaseDate,
      included,
      excluded
    });
  }

  async release(input) {
    return this.#mutex.runExclusive(async () => {
      if (input.requestId == null || String(input.requestId).trim() === "") {
        throw domainError("REQUEST_ID_REQUIRED", "La liberacion requiere un requestId");
      }
      const preview = this.preview(input);
      const releaseId = this.#idFactory();
      const requestId = String(input.requestId);
      const attemptAt = this.#clock().toISOString();
      this.#releases.recordAttempt({
        releaseId, requestId, sessionId: preview.sessionId,
        includedCount: preview.included.length, excludedCount: preview.excluded.length,
        attemptedAt: attemptAt
      });

      if (preview.included.length === 0) {
        this.#audit.record({
          actor: input.actor, role: input.role ?? "CAPACITACION", sessionId: input.sessionId,
          entityType: "Release", entityId: releaseId, action: "LIBERACION_REPETIDA_O_SIN_ELEGIBLES",
          previousState: "LISTA_PARA_LIBERAR", newState: "SIN_CAMBIOS", requestId,
          reason: `${preview.excluded.length} excluidos`
        });
        return immutableCopy({
          releaseId, requestId, status: "SIN_CAMBIOS", effectiveWrites: 0,
          included: [], excluded: preview.excluded, createdAt: attemptAt
        });
      }

      for (const item of preview.included) {
        if (this.#attendances.getState(input.sessionId, item.employeeId) !== "EXAMEN_CONFIRMADO") {
          throw domainError("INCONSISTENT_ELIGIBLE_STATE", "Una asistencia elegible tiene un estado interno inconsistente");
        }
      }
      const effectiveWrites = this.#matrix.applyWrites(preview.included);
      for (const item of preview.included) {
        const attendance = this.#attendances.get(input.sessionId, item.employeeId);
        this.#attendances.advanceState(input.sessionId, item.employeeId, "ELEGIBLE");
        const released = createParticipantAttendance({ ...attendance, released: true, blockingReasons: [] });
        this.#attendances.replace(released);
        this.#attendances.advanceState(input.sessionId, item.employeeId, "LIBERADA");
        this.#releases.recordEffective(item.idempotencyKey, {
          releaseId: `${releaseId}:${item.attendanceId}`,
          sessionId: String(input.sessionId),
          requestId,
          idempotencyKey: item.idempotencyKey,
          mappingVersion: String(input.mappingVersion),
          included: [{ attendanceId: item.attendanceId, employeeId: item.employeeId, value: item.value }],
          excluded: [],
          status: "APLICADA",
          createdBy: String(input.actor),
          createdAt: attemptAt,
          version: CONTRACT_VERSION
        });
        this.#audit.record({
          actor: input.actor, role: input.role ?? "CAPACITACION", sessionId: input.sessionId,
          entityType: "Attendance", entityId: item.attendanceId, action: "REGISTRO_LIBERADO",
          previousState: "ELEGIBLE", newState: "LIBERADA", requestId,
          reason: item.idempotencyKey
        });
      }
      const allSessionAttendancesReleased = this.#attendances.listBySession(input.sessionId)
        .every((attendance) => attendance.released);
      const status = allSessionAttendancesReleased ? "LIBERADA_TOTAL" : "LIBERADA_PARCIAL";
      this.#audit.record({
        actor: input.actor, role: input.role ?? "CAPACITACION", sessionId: input.sessionId,
        entityType: "Release", entityId: releaseId, action: status,
        previousState: "LISTA_PARA_LIBERAR", newState: status, requestId,
        reason: `${effectiveWrites} aplicados; ${preview.excluded.length} excluidos`
      });
      return immutableCopy({
        releaseId, requestId, status, effectiveWrites,
        included: preview.included, excluded: preview.excluded, createdAt: attemptAt
      });
    });
  }
}
