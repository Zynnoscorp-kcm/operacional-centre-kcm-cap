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
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord>;
  listSessionsByStatuses(statuses: readonly string[]): Promise<readonly SessionRecord[]>;

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

  getLatestReview(sessionId: string): Promise<PreReleaseReviewRecord | null>;
  upsertReview(review: PreReleaseReviewRecord): Promise<PreReleaseReviewRecord>;

  isWorkerActive(workerNumber: WorkerNumber): Promise<boolean>;
  getEmployeeInfo(workerNumber: WorkerNumber): Promise<EmployeeInfo | null>;

  getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null>;

  archiveReport(record: ReportEvidenceRecord, content: Uint8Array): Promise<ReportEvidenceRecord>;
  listReportsBySession(sessionId: string): Promise<readonly ReportEvidenceRecord[]>;
  getReportById(evidenceId: string): Promise<ReportEvidenceRecord | null>;
  getReportContent(evidenceId: string): Promise<Uint8Array | null>;

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

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
