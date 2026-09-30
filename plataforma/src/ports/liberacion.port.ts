import type { WorkerNumber } from "../domain/comun/numero-trabajador.ts";
import type { HcRecord } from "../domain/importacion-matriz/tipos.ts";
import type { AttendanceRecord, AuditEventRecord, SessionRecord } from "../domain/quiosco/tipos.ts";
import type {
  MatrixMapping,
  OverwriteHistoryEntry,
  ReleaseBatch,
  ReleaseEffect,
} from "../domain/liberacion/tipos.ts";

export interface MatrixWriteOperation {
  readonly idempotencyKey: string;
  readonly record: HcRecord;
  readonly history: OverwriteHistoryEntry | null;
  readonly isUpdate: boolean;
  readonly attendanceId?: string;
  readonly result?: string;
}

export interface MatrixWritePort {
  getHcRecord(workerNumber: WorkerNumber, trainingId: string): Promise<HcRecord | null>;

  workerExists(workerNumber: WorkerNumber): Promise<boolean>;

  trainingExists(trainingId: string): Promise<boolean>;

  applyWrites(operations: readonly MatrixWriteOperation[]): Promise<void>;

  listOverwriteHistory(
    workerNumber: WorkerNumber,
    trainingId: string,
  ): Promise<readonly OverwriteHistoryEntry[]>;
}

export interface ReleaseRepositoryPort {
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  getSessionByCode(sessionCode: string): Promise<SessionRecord | null>;
  updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord>;

  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]>;
  updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void>;

  findActiveMapping(trainingId: string): Promise<readonly MatrixMapping[]>;

  findBatchByRequestId(requestId: string): Promise<ReleaseBatch | null>;
  findBatchById(batchId: string): Promise<ReleaseBatch | null>;
  listBatchesBySession(sessionId: string): Promise<readonly ReleaseBatch[]>;
  insertBatch(batch: ReleaseBatch): Promise<ReleaseBatch>;
  replaceBatch(batch: ReleaseBatch): Promise<ReleaseBatch>;

  findEffectByIdempotencyKey(idempotencyKey: string): Promise<ReleaseEffect | null>;
  insertEffects(effects: readonly ReleaseEffect[]): Promise<void>;
  listEffectsByBatch(batchId: string): Promise<readonly ReleaseEffect[]>;

  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord>;
  findAuditEvent(filter: {
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null>;

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
