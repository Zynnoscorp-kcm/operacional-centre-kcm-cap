/**
 * Puertos del dominio de Liberación (Función 5).
 *
 * Se separan dos responsabilidades que en el legado estaban entreveradas: el
 * journal y los efectos de dominio por un lado, y la escritura al destino por
 * el otro. Esa frontera es la que hace que E11 pueda sustituir el destino por
 * el puente VBA sin tocar la saga.
 */

import type { WorkerNumber } from "../domain/numero-trabajador.ts";
import type { HcRecord } from "../domain/importacion-matriz/tipos.ts";
import type {
  AttendanceRecord,
  AuditEventRecord,
  SessionRecord,
} from "../domain/quiosco/tipos.ts";
import type {
  MatrixMapping,
  OverwriteHistoryEntry,
  ReleaseBatch,
  ReleaseEffect,
} from "../domain/liberacion/tipos.ts";

/**
 * Una escritura ya resuelta: trae el registro nuevo y, cuando sustituye a un
 * valor previo, la entrada de historial que debe quedar guardada antes.
 */
export interface MatrixWriteOperation {
  readonly idempotencyKey: string;
  readonly record: HcRecord;
  readonly history: OverwriteHistoryEntry | null;
  readonly isUpdate: boolean;
}

export interface MatrixWritePort {
  /** Registro vigente del par trabajador/capacitación, o `null` si la celda está libre. */
  getHcRecord(workerNumber: WorkerNumber, trainingId: string): Promise<HcRecord | null>;

  /**
   * Distingue "la celda está vacía" de "el trabajador no está en la matriz".
   * Sin esta separación un trabajador desconocido pasaría por celda libre y se
   * le escribiría una fila que nadie reconciliará.
   */
  workerExists(workerNumber: WorkerNumber): Promise<boolean>;

  /** Igual que la anterior, para la capacitación. */
  trainingExists(trainingId: string): Promise<boolean>;

  /**
   * Aplica el lote en una sola transacción.
   *
   * Contrato que el adaptador debe honrar y que no es negociable: dentro de
   * cada operación, la entrada de historial se persiste antes que el valor
   * nuevo. Si la transacción se interrumpe, lo que puede faltar es el valor
   * nuevo, nunca el rastro del anterior.
   */
  applyWrites(operations: readonly MatrixWriteOperation[]): Promise<void>;

  /** Historial de sobrescritura de un par, del más reciente al más antiguo. */
  listOverwriteHistory(
    workerNumber: WorkerNumber,
    trainingId: string,
  ): Promise<readonly OverwriteHistoryEntry[]>;
}

export interface ReleaseRepositoryPort {
  // Sesiones
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  getSessionByCode(sessionCode: string): Promise<SessionRecord | null>;
  updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord>;

  // Asistencias
  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]>;
  updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void>;

  // Destinos declarados
  /** Mapeo vigente de la capacitación. Debe ser exactamente uno. */
  findActiveMapping(trainingId: string): Promise<readonly MatrixMapping[]>;

  // Journal
  findBatchByRequestId(requestId: string): Promise<ReleaseBatch | null>;
  findBatchById(batchId: string): Promise<ReleaseBatch | null>;
  listBatchesBySession(sessionId: string): Promise<readonly ReleaseBatch[]>;
  insertBatch(batch: ReleaseBatch): Promise<ReleaseBatch>;
  replaceBatch(batch: ReleaseBatch): Promise<ReleaseBatch>;

  // Efectos
  findEffectByIdempotencyKey(idempotencyKey: string): Promise<ReleaseEffect | null>;
  insertEffects(effects: readonly ReleaseEffect[]): Promise<void>;
  listEffectsByBatch(batchId: string): Promise<readonly ReleaseEffect[]>;

  // Auditoría — sólo se agrega
  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord>;
  findAuditEvent(filter: {
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null>;

  /** Serializa la liberación de una sesión: dos lotes a la vez producen doble efecto. */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
