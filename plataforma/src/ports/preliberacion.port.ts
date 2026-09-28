/**
 * Puerto de repositorio para Preliberación (Función 4).
 * Separa el dominio de la infraestructura: los servicios de preliberación
 * trabajan contra esta interfaz, nunca contra Supabase ni memoria directamente.
 */

import type { WorkerNumber } from "../domain/comun/numero-trabajador.ts";
import type {
  AttendanceRecord,
  SessionRecord,
  AuditEventRecord,
  TrainingCatalogItem,
} from "../domain/quiosco/tipos.ts";
import type {
  PreReleaseReviewRecord,
  EmployeeInfo,
  ReportEvidenceRecord,
} from "../domain/preliberacion/tipos.ts";

export interface PreReleaseRepositoryPort {
  // Sesiones
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord>;
  /** Sesiones en cualquiera de los estados dados, para las bandejas de revisión. */
  listSessionsByStatuses(statuses: readonly string[]): Promise<readonly SessionRecord[]>;

  // Asistencias
  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]>;
  getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null>;
  createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord>;
  updateAttendance(
    attendanceId: string,
    updates: Partial<AttendanceRecord>,
  ): Promise<AttendanceRecord>;
  updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void>;
  countAttendancesBySession(sessionId: string): Promise<number>;

  // Revisión de preliberación
  getLatestReview(sessionId: string): Promise<PreReleaseReviewRecord | null>;
  upsertReview(review: PreReleaseReviewRecord): Promise<PreReleaseReviewRecord>;

  // Padrón de trabajadores
  isWorkerActive(workerNumber: WorkerNumber): Promise<boolean>;
  getEmployeeInfo(workerNumber: WorkerNumber): Promise<EmployeeInfo | null>;

  // Catálogo de capacitaciones
  getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null>;

  // Reportes archivados
  /**
   * Guarda fila de evidencia y bytes juntos. Van en la misma operación a
   * propósito: una evidencia cuyo archivo no existe es peor que no tenerla,
   * porque la auditoría la ofrecería como consultable.
   */
  archiveReport(record: ReportEvidenceRecord, content: Uint8Array): Promise<ReportEvidenceRecord>;
  /** Reportes de una sesión, del más reciente al más antiguo. */
  listReportsBySession(sessionId: string): Promise<readonly ReportEvidenceRecord[]>;
  getReportById(evidenceId: string): Promise<ReportEvidenceRecord | null>;
  getReportContent(evidenceId: string): Promise<Uint8Array | null>;

  // Auditoría
  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord>;
  recordManyAudits(
    events: readonly Omit<AuditEventRecord, "eventId" | "occurredAt">[],
  ): Promise<void>;
  findAuditEvent(filter: {
    sessionId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null>;

  // Bloqueo atómico
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
