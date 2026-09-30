import type { WorkerNumber } from "../domain/comun/numero-trabajador.ts";
import type {
  SessionRecord,
  AttendanceRecord,
  KioskRegistrationJournal,
  AuditEventRecord,
  AuditAction,
  ConcessionRecord,
  TrainingCatalogItem,
  SecretScope,
  OperativeSessionSummary,
} from "../domain/quiosco/tipos.ts";

export interface KioskSessionRepositoryPort {
  createSession(session: SessionRecord): Promise<SessionRecord>;
  getHighestSessionCodeNumber(): Promise<number>;
  updateSession(sessionId: string, updates: Partial<SessionRecord>): Promise<SessionRecord>;
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  getSessionByCode(sessionCode: string): Promise<SessionRecord | null>;
  getSessionByCreationRequestId(requestId: string): Promise<SessionRecord | null>;
  listSessions(predicate?: (s: SessionRecord) => boolean): Promise<readonly SessionRecord[]>;
  listOperativeSessions(options?: {
    cutoffDate?: string | undefined;
  }): Promise<readonly OperativeSessionSummary[]>;

  createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord>;
  getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null>;
  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]>;
  countAttendancesBySession(sessionId: string): Promise<number>;

  createJournal(journal: KioskRegistrationJournal): Promise<KioskRegistrationJournal>;
  updateJournal(
    registrationId: string,
    updates: Partial<KioskRegistrationJournal>,
  ): Promise<KioskRegistrationJournal>;
  getJournalByRequest(requestId: string): Promise<KioskRegistrationJournal | null>;
  getJournalBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<KioskRegistrationJournal | null>;
  listJournalsBySession(sessionId: string): Promise<readonly KioskRegistrationJournal[]>;
  listIncompleteJournalsBySession(sessionId: string): Promise<readonly KioskRegistrationJournal[]>;

  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord>;
  listAuditEvents(filter?: {
    sessionId?: string;
    requestId?: string;
    entityId?: string;
    entityType?: string;
    action?: AuditAction;
  }): Promise<readonly AuditEventRecord[]>;

  isWorkerActive(workerNumber: WorkerNumber): Promise<boolean>;

  listActiveTrainings(): Promise<readonly TrainingCatalogItem[]>;
  getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null>;

  verifySecret(scope: SecretScope, candidate: string): Promise<boolean>;

  createConcession(concession: ConcessionRecord): Promise<ConcessionRecord>;
  getConcessionByCodeHash(codeHash: string): Promise<ConcessionRecord | null>;
  updateConcession(
    concessionId: string,
    updates: Partial<ConcessionRecord>,
  ): Promise<ConcessionRecord>;

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
