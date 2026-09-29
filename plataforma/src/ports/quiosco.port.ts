/**
 * Puerto de repositorio para Quiosco, Sesiones y Auditoría.
 */

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
  // Sesiones
  /**
   * Guarda la sesión. Si otra ya tiene su código, lanza `SessionCodeTakenError`
   * y no guarda nada: el servicio pide entonces el siguiente consecutivo.
   */
  createSession(session: SessionRecord): Promise<SessionRecord>;
  /** El mayor consecutivo `KC-NNNN` en uso, o 0 si todavía no hay ninguno. */
  getHighestSessionCodeNumber(): Promise<number>;
  updateSession(sessionId: string, updates: Partial<SessionRecord>): Promise<SessionRecord>;
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  getSessionByCode(sessionCode: string): Promise<SessionRecord | null>;
  getSessionByCreationRequestId(requestId: string): Promise<SessionRecord | null>;
  listSessions(predicate?: (s: SessionRecord) => boolean): Promise<readonly SessionRecord[]>;
  listOperativeSessions(options?: {
    cutoffDate?: string | undefined;
  }): Promise<readonly OperativeSessionSummary[]>;

  // Asistencias
  createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord>;
  getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null>;
  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]>;
  countAttendancesBySession(sessionId: string): Promise<number>;

  // Journal de Quiosco
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

  // Auditoría
  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord>;
  listAuditEvents(filter?: {
    sessionId?: string;
    requestId?: string;
    entityId?: string;
    entityType?: string;
    action?: AuditAction;
  }): Promise<readonly AuditEventRecord[]>;

  // Padrón de trabajadores
  isWorkerActive(workerNumber: WorkerNumber): Promise<boolean>;

  // Catálogo de capacitaciones
  listActiveTrainings(): Promise<readonly TrainingCatalogItem[]>;
  getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null>;

  // Secretos de operación (segunda contraseña)
  verifySecret(scope: SecretScope, candidate: string): Promise<boolean>;

  // Concesiones y códigos de quiosco
  createConcession(concession: ConcessionRecord): Promise<ConcessionRecord>;
  getConcessionByCodeHash(codeHash: string): Promise<ConcessionRecord | null>;
  updateConcession(
    concessionId: string,
    updates: Partial<ConcessionRecord>,
  ): Promise<ConcessionRecord>;

  // Bloqueo atómico
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
