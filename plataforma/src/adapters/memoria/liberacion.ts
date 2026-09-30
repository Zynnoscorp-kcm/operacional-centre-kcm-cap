import { randomUUID } from "node:crypto";

import type { WorkerNumber } from "../../domain/comun/numero-trabajador.ts";
import type { HcRecord } from "../../domain/importacion-matriz/tipos.ts";
import type {
  AttendanceRecord,
  AuditEventRecord,
  SessionRecord,
} from "../../domain/quiosco/tipos.ts";
import type {
  MatrixMapping,
  OverwriteHistoryEntry,
  ReleaseBatch,
  ReleaseEffect,
} from "../../domain/liberacion/tipos.ts";
import type {
  MatrixWriteOperation,
  MatrixWritePort,
  ReleaseRepositoryPort,
} from "../../ports/liberacion.port.ts";

export interface MemoryReleaseState {
  readonly sessions?: readonly SessionRecord[];
  readonly attendances?: readonly AttendanceRecord[];
  readonly mappings?: readonly MatrixMapping[];
  readonly hcRecords?: readonly HcRecord[];
  readonly workers?: readonly string[];
  readonly trainings?: readonly string[];
  readonly batches?: readonly ReleaseBatch[];
  readonly effects?: readonly ReleaseEffect[];
  readonly audits?: readonly AuditEventRecord[];
}

function pairKey(workerNumber: string, trainingId: string): string {
  return `${workerNumber}|${trainingId}`;
}

export class MemoryReleaseRepository implements ReleaseRepositoryPort, MatrixWritePort {
  #sessions = new Map<string, SessionRecord>();
  #attendances = new Map<string, AttendanceRecord>();
  #mappings: MatrixMapping[] = [];
  #hcRecords = new Map<string, HcRecord>();
  #workers = new Set<string>();
  #trainings = new Set<string>();
  #batches = new Map<string, ReleaseBatch>();
  #effects = new Map<string, ReleaseEffect>();
  #history: OverwriteHistoryEntry[] = [];
  #audits: AuditEventRecord[] = [];
  #locks = new Map<string, Promise<void>>();
  #auditSequence = 0;

  #writeLog: string[] = [];

  constructor(initial?: MemoryReleaseState) {
    for (const session of initial?.sessions ?? []) {
      this.#sessions.set(session.sessionId, { ...session });
    }
    for (const attendance of initial?.attendances ?? []) {
      this.#attendances.set(attendance.attendanceId, { ...attendance });
    }
    this.#mappings = (initial?.mappings ?? []).map((mapping) => ({ ...mapping }));
    for (const record of initial?.hcRecords ?? []) {
      this.#hcRecords.set(pairKey(String(record.workerNumber), record.trainingId), { ...record });
      this.#trainings.add(record.trainingId);
    }

    if (initial?.workers) {
      for (const worker of initial.workers) this.#workers.add(worker);
    } else {
      for (const attendance of this.#attendances.values()) {
        this.#workers.add(String(attendance.workerNumber));
      }
      for (const record of this.#hcRecords.values()) {
        this.#workers.add(String(record.workerNumber));
      }
    }
    for (const training of initial?.trainings ?? []) this.#trainings.add(training);
    for (const mapping of this.#mappings) this.#trainings.add(mapping.trainingId);
    for (const batch of initial?.batches ?? []) this.#batches.set(batch.batchId, { ...batch });
    for (const effect of initial?.effects ?? []) {
      this.#effects.set(effect.idempotencyKey, { ...effect });
    }
    this.#audits = (initial?.audits ?? []).map((audit) => ({ ...audit }));
    this.#auditSequence = this.#audits.length;
  }

  getSessionById(sessionId: string): Promise<SessionRecord | null> {
    const session = this.#sessions.get(sessionId);
    return Promise.resolve(session ? { ...session } : null);
  }

  getSessionByCode(sessionCode: string): Promise<SessionRecord | null> {
    const normalized = sessionCode.trim().toUpperCase();
    const session = [...this.#sessions.values()].find(
      (candidate) => candidate.sessionCode.toUpperCase() === normalized,
    );
    return Promise.resolve(session ? { ...session } : null);
  }

  updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord> {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Sesión inexistente: ${sessionId}`);
    const updated = {
      ...session,
      status: status as SessionRecord["status"],
      version: session.version + 1,
    };
    this.#sessions.set(sessionId, updated);
    return Promise.resolve({ ...updated });
  }

  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]> {
    const rows = [...this.#attendances.values()]
      .filter((attendance) => attendance.sessionId === sessionId)
      .map((attendance) => ({ ...attendance }));
    return Promise.resolve(rows);
  }

  updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void> {
    for (const update of updates) {
      const current = this.#attendances.get(update.attendanceId);
      if (!current) throw new Error(`Asistencia inexistente: ${update.attendanceId}`);
      this.#attendances.set(update.attendanceId, {
        ...current,
        ...update.updates,
        version: current.version + 1,
      });
    }
    return Promise.resolve();
  }

  findActiveMapping(trainingId: string): Promise<readonly MatrixMapping[]> {
    return Promise.resolve(
      this.#mappings
        .filter((mapping) => mapping.trainingId === trainingId && mapping.active)
        .map((mapping) => ({ ...mapping })),
    );
  }

  findBatchByRequestId(requestId: string): Promise<ReleaseBatch | null> {
    const found = [...this.#batches.values()].filter((batch) => batch.requestId === requestId);
    if (found.length > 1) throw new Error("El requestId tiene más de un lote");
    return Promise.resolve(found[0] ? { ...found[0] } : null);
  }

  findBatchById(batchId: string): Promise<ReleaseBatch | null> {
    const batch = this.#batches.get(batchId);
    return Promise.resolve(batch ? { ...batch } : null);
  }

  listBatchesBySession(sessionId: string): Promise<readonly ReleaseBatch[]> {
    return Promise.resolve(
      [...this.#batches.values()]
        .filter((batch) => batch.sessionId === sessionId)
        .map((batch) => ({ ...batch })),
    );
  }

  insertBatch(batch: ReleaseBatch): Promise<ReleaseBatch> {
    if (this.#batches.has(batch.batchId)) {
      throw new Error(`El lote ya existe: ${batch.batchId}`);
    }
    for (const existing of this.#batches.values()) {
      if (existing.requestId === batch.requestId) {
        throw new Error(`El requestId ya tiene un lote durable: ${batch.requestId}`);
      }
    }
    this.#batches.set(batch.batchId, { ...batch });
    return Promise.resolve({ ...batch });
  }

  replaceBatch(batch: ReleaseBatch): Promise<ReleaseBatch> {
    if (!this.#batches.has(batch.batchId)) {
      throw new Error(`El lote durable desapareció: ${batch.batchId}`);
    }
    this.#batches.set(batch.batchId, { ...batch });
    return Promise.resolve({ ...batch });
  }

  findEffectByIdempotencyKey(idempotencyKey: string): Promise<ReleaseEffect | null> {
    const effect = this.#effects.get(idempotencyKey);
    return Promise.resolve(effect ? { ...effect } : null);
  }

  insertEffects(effects: readonly ReleaseEffect[]): Promise<void> {
    for (const effect of effects) {
      if (this.#effects.has(effect.idempotencyKey)) {
        throw new Error(`Clave idempotente duplicada: ${effect.idempotencyKey}`);
      }
      this.#effects.set(effect.idempotencyKey, { ...effect });
    }
    return Promise.resolve();
  }

  listEffectsByBatch(batchId: string): Promise<readonly ReleaseEffect[]> {
    return Promise.resolve(
      [...this.#effects.values()]
        .filter((effect) => effect.batchId === batchId)
        .map((effect) => ({ ...effect })),
    );
  }

  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord> {
    this.#auditSequence += 1;
    const stored: AuditEventRecord = {
      ...event,
      eventId: randomUUID(),
      sequence: this.#auditSequence,
      occurredAt: new Date().toISOString(),
    };
    this.#audits.push(stored);
    return Promise.resolve({ ...stored });
  }

  findAuditEvent(filter: {
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null> {
    const found = this.#audits.find(
      (event) =>
        (filter.entityId === undefined || event.entityId === filter.entityId) &&
        (filter.action === undefined || event.action === filter.action) &&
        (filter.requestId === undefined || event.requestId === filter.requestId),
    );
    return Promise.resolve(found ? { ...found } : null);
  }

  getHcRecord(workerNumber: WorkerNumber, trainingId: string): Promise<HcRecord | null> {
    const record = this.#hcRecords.get(pairKey(String(workerNumber), trainingId));
    return Promise.resolve(record ? { ...record } : null);
  }

  workerExists(workerNumber: WorkerNumber): Promise<boolean> {
    return Promise.resolve(this.#workers.has(String(workerNumber)));
  }

  trainingExists(trainingId: string): Promise<boolean> {
    return Promise.resolve(this.#trainings.has(trainingId));
  }

  applyWrites(operations: readonly MatrixWriteOperation[]): Promise<void> {
    for (const operation of operations) {
      if (operation.history) {
        if (operation.history.previousCompletionDate === operation.history.completionDate) {
          throw new Error("Un historial de sobrescritura no puede repetir la misma fecha");
        }
        if (!operation.history.reason.trim()) {
          throw new Error("Un historial de sobrescritura exige motivo");
        }
        this.#history.push({ ...operation.history });
        this.#writeLog.push(`history:${operation.idempotencyKey}`);
      }

      this.#hcRecords.set(
        pairKey(String(operation.record.workerNumber), operation.record.trainingId),
        { ...operation.record },
      );
      this.#writeLog.push(`record:${operation.idempotencyKey}`);
      this.#workers.add(String(operation.record.workerNumber));
      this.#trainings.add(operation.record.trainingId);
    }
    return Promise.resolve();
  }

  listOverwriteHistory(
    workerNumber: WorkerNumber,
    trainingId: string,
  ): Promise<readonly OverwriteHistoryEntry[]> {
    return Promise.resolve(
      this.#history
        .filter(
          (entry) =>
            String(entry.workerNumber) === String(workerNumber) && entry.trainingId === trainingId,
        )
        .map((entry) => ({ ...entry }))
        .reverse(),
    );
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.#locks.has(key)) {
      await this.#locks.get(key);
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#locks.set(key, gate);
    try {
      return await fn();
    } finally {
      this.#locks.delete(key);
      release();
    }
  }

  getAllAudits(): readonly AuditEventRecord[] {
    return this.#audits.map((audit) => ({ ...audit }));
  }

  getAllHistory(): readonly OverwriteHistoryEntry[] {
    return this.#history.map((entry) => ({ ...entry }));
  }

  getAllEffects(): readonly ReleaseEffect[] {
    return [...this.#effects.values()].map((effect) => ({ ...effect }));
  }

  getWriteLog(): readonly string[] {
    return [...this.#writeLog];
  }

  seedSession(session: SessionRecord): void {
    this.#sessions.set(session.sessionId, { ...session });
  }

  seedAttendance(attendance: AttendanceRecord): void {
    this.#attendances.set(attendance.attendanceId, { ...attendance });
    this.#workers.add(String(attendance.workerNumber));
  }

  seedHcRecord(record: HcRecord): void {
    this.#hcRecords.set(pairKey(String(record.workerNumber), record.trainingId), { ...record });
    this.#workers.add(String(record.workerNumber));
    this.#trainings.add(record.trainingId);
  }

  tamperBatch(batchId: string, patch: Partial<ReleaseBatch>): void {
    const batch = this.#batches.get(batchId);
    if (!batch) throw new Error(`El lote no existe: ${batchId}`);
    this.#batches.set(batchId, { ...batch, ...patch });
  }
}
