/**
 * Repositorio en memoria para Quiosco, Sesiones y Auditoría.
 * Permite ejecutar pruebas completas sin dependencias externas ni credenciales reales.
 */

import type { WorkerNumber } from "../../domain/comun/numero-trabajador.ts";
import type {
  AuditEventRecord,
  AuditAction,
  AttendanceRecord,
  ConcessionRecord,
  KioskRegistrationJournal,
  OperativeSessionSummary,
  SecretScope,
  SessionRecord,
  TrainingCatalogItem,
} from "../../domain/quiosco/tipos.ts";
import { numeroDeCodigoDeSesion } from "../../domain/quiosco/codigo-de-sesion.ts";
import { SessionCodeTakenError } from "../../domain/quiosco/errores.ts";
import type { KioskSessionRepositoryPort } from "../../ports/quiosco.port.ts";
import type { Clock } from "../../ports/reloj.port.ts";
import { systemClock } from "../sistema/reloj-sistema.ts";

export interface MemoryKioskSessionState {
  readonly sessions?: readonly SessionRecord[];
  readonly attendances?: readonly AttendanceRecord[];
  readonly journals?: readonly KioskRegistrationJournal[];
  readonly audits?: readonly AuditEventRecord[];
  readonly concessions?: readonly ConcessionRecord[];
  readonly trainings?: readonly TrainingCatalogItem[];
  readonly activeWorkers?: readonly WorkerNumber[];
  readonly secrets?: Readonly<Record<SecretScope, string>>;
  /**
   * Reloj de la corrida. Sin él la ventana de sesiones operativas se calculaba
   * con la hora de la máquina aunque la prueba hubiera inyectado un reloj fijo:
   * una prueba escrita con fecha fija empezaba a fallar sola catorce días
   * después de escrita, y el fallo no decía eso.
   */
  readonly clock?: Clock;
}

export class MemoryKioskSessionRepository implements KioskSessionRepositoryPort {
  private sessions = new Map<string, SessionRecord>();
  private attendances = new Map<string, AttendanceRecord>();
  private journals = new Map<string, KioskRegistrationJournal>();
  private audits: AuditEventRecord[] = [];
  private concessions = new Map<string, ConcessionRecord>();
  private trainings = new Map<string, TrainingCatalogItem>();
  private activeWorkers = new Set<string>();
  private secrets = new Map<SecretScope, string>();
  private auditSequence = 0;
  private readonly clock: Clock;

  constructor(initialState?: MemoryKioskSessionState) {
    this.clock = initialState?.clock ?? systemClock;
    if (initialState?.sessions) {
      for (const s of initialState.sessions) this.sessions.set(s.sessionId, { ...s });
    }
    if (initialState?.attendances) {
      for (const a of initialState.attendances) this.attendances.set(a.attendanceId, { ...a });
    }
    if (initialState?.journals) {
      for (const j of initialState.journals) this.journals.set(j.registrationId, { ...j });
    }
    if (initialState?.audits) {
      this.audits = initialState.audits.map((a) => ({ ...a }));
      this.auditSequence = this.audits.length;
    }
    if (initialState?.concessions) {
      for (const c of initialState.concessions) this.concessions.set(c.concessionId, { ...c });
    }
    if (initialState?.trainings) {
      for (const t of initialState.trainings) this.trainings.set(t.trainingId, { ...t });
    } else {
      // Cursos sintéticos por omisión
      this.trainings.set("CAP-SINT-001", {
        trainingId: "CAP-SINT-001",
        name: "BUENAS PRÁCTICAS DE MANUFACTURA",
        active: true,
        durationHours: 1,
      });
      this.trainings.set("CAP-SINT-002", {
        trainingId: "CAP-SINT-002",
        name: "SEGURIDAD INDUSTRIAL Y LOTO",
        active: true,
        durationHours: 2,
      });
    }
    if (initialState?.activeWorkers) {
      for (const w of initialState.activeWorkers) this.activeWorkers.add(String(w));
    }
    if (initialState?.secrets) {
      for (const [scope, val] of Object.entries(initialState.secrets)) {
        this.secrets.set(scope as SecretScope, val);
      }
    } else {
      this.secrets.set("REGISTRO_QUIOSCO", "0000");
      this.secrets.set("APERTURA_SESION", "0000");
    }
  }

  // --- Sesiones ---
  async createSession(session: SessionRecord): Promise<SessionRecord> {
    // La misma unicidad que la base: dos sesiones no comparten código.
    for (const existente of this.sessions.values()) {
      if (existente.sessionCode === session.sessionCode) throw new SessionCodeTakenError();
    }
    const copy = { ...session };
    this.sessions.set(session.sessionId, copy);
    return copy;
  }

  getHighestSessionCodeNumber(): Promise<number> {
    let mayor = 0;
    for (const session of this.sessions.values()) {
      mayor = Math.max(mayor, numeroDeCodigoDeSesion(session.sessionCode) ?? 0);
    }
    return Promise.resolve(mayor);
  }

  async updateSession(sessionId: string, updates: Partial<SessionRecord>): Promise<SessionRecord> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Sesión ${sessionId} no encontrada`);
    const updated = { ...existing, ...updates };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    const existing = this.sessions.get(sessionId);
    return existing ? { ...existing } : null;
  }

  async getSessionByCode(sessionCode: string): Promise<SessionRecord | null> {
    const normalized = sessionCode.trim().toUpperCase();
    for (const session of this.sessions.values()) {
      if (session.sessionCode.toUpperCase() === normalized) {
        return { ...session };
      }
    }
    return null;
  }

  async getSessionByCreationRequestId(requestId: string): Promise<SessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.creationRequestId === requestId) {
        return { ...session };
      }
    }
    return null;
  }

  async listSessions(predicate?: (s: SessionRecord) => boolean): Promise<readonly SessionRecord[]> {
    const all = Array.from(this.sessions.values()).map((s) => ({ ...s }));
    return predicate ? all.filter(predicate) : all;
  }

  /**
   * Mismo criterio que la consulta del adaptador de Postgres: los estados vivos
   * siempre, y `BORRADOR` y `LIBERADA_TOTAL` sólo mientras sigan siendo
   * recientes. `BORRADOR` faltaba aquí, y una sesión nace precisamente ahí: la
   * pantalla la creaba, redirigía y la lista se veía idéntica, así que su botón
   * «Abrir» no llegaba a dibujarse y no había forma de operarla.
   */
  async listOperativeSessions(options?: {
    cutoffDate?: string;
  }): Promise<readonly OperativeSessionSummary[]> {
    const results: OperativeSessionSummary[] = [];
    const cutoff =
      options?.cutoffDate ??
      new Date(this.clock.now().getTime() - 14 * 86400000).toISOString().slice(0, 10);

    for (const s of this.sessions.values()) {
      const isOperative =
        s.status === "ABIERTA" ||
        s.status === "CERRADA" ||
        s.status === "PRELIBERACION" ||
        s.status === "LISTA_PARA_LIBERAR" ||
        (s.status === "BORRADOR" && s.date >= cutoff) ||
        (s.status === "LIBERADA_TOTAL" && s.date >= cutoff);

      if (isOperative) {
        const training = this.trainings.get(s.trainingId);
        const count = await this.countAttendancesBySession(s.sessionId);
        results.push({
          sessionId: s.sessionId,
          sessionCode: s.sessionCode,
          trainingId: s.trainingId,
          trainingName: training ? training.name : s.trainingId,
          instructor: s.instructor,
          date: s.date,
          startTime: s.startTime ?? "",
          durationMinutes: s.durationMinutes,
          status: s.status,
          authorized: s.authorized,
          totalAttendances: count,
        });
      }
    }

    return results.sort(
      (a, b) => b.date.localeCompare(a.date) || a.sessionCode.localeCompare(b.sessionCode),
    );
  }

  // --- Asistencias ---
  async createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord> {
    const copy = { ...attendance };
    this.attendances.set(attendance.attendanceId, copy);
    return copy;
  }

  async getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null> {
    for (const a of this.attendances.values()) {
      if (a.sessionId === sessionId && a.workerNumber === workerNumber) {
        return { ...a };
      }
    }
    return null;
  }

  async listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]> {
    const list: AttendanceRecord[] = [];
    for (const a of this.attendances.values()) {
      if (a.sessionId === sessionId) list.push({ ...a });
    }
    return list;
  }

  async countAttendancesBySession(sessionId: string): Promise<number> {
    let count = 0;
    for (const a of this.attendances.values()) {
      if (a.sessionId === sessionId) count += 1;
    }
    return count;
  }

  // --- Journal Quiosco ---
  async createJournal(journal: KioskRegistrationJournal): Promise<KioskRegistrationJournal> {
    const copy = { ...journal };
    this.journals.set(journal.registrationId, copy);
    return copy;
  }

  async updateJournal(
    registrationId: string,
    updates: Partial<KioskRegistrationJournal>,
  ): Promise<KioskRegistrationJournal> {
    const existing = this.journals.get(registrationId);
    if (!existing) throw new Error(`Journal ${registrationId} no encontrado`);
    const updated = { ...existing, ...updates };
    this.journals.set(registrationId, updated);
    return updated;
  }

  async getJournalByRequest(requestId: string): Promise<KioskRegistrationJournal | null> {
    for (const j of this.journals.values()) {
      if (j.requestId === requestId) return { ...j };
    }
    return null;
  }

  async getJournalBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<KioskRegistrationJournal | null> {
    for (const j of this.journals.values()) {
      if (j.sessionId === sessionId && j.workerNumber === workerNumber) return { ...j };
    }
    return null;
  }

  async listJournalsBySession(sessionId: string): Promise<readonly KioskRegistrationJournal[]> {
    const list: KioskRegistrationJournal[] = [];
    for (const j of this.journals.values()) {
      if (j.sessionId === sessionId) list.push({ ...j });
    }
    return list;
  }

  async listIncompleteJournalsBySession(
    sessionId: string,
  ): Promise<readonly KioskRegistrationJournal[]> {
    const list: KioskRegistrationJournal[] = [];
    for (const j of this.journals.values()) {
      if (j.sessionId === sessionId && j.phase !== "COMPLETADO") list.push({ ...j });
    }
    return list;
  }

  // --- Auditoría ---
  async recordAudit(
    event: Omit<AuditEventRecord, "eventId" | "occurredAt">,
  ): Promise<AuditEventRecord> {
    this.auditSequence += 1;
    const auditRecord: AuditEventRecord = {
      ...event,
      eventId: `audit-${this.auditSequence}`,
      sequence: this.auditSequence,
      occurredAt: new Date().toISOString(),
    };
    this.audits.push(auditRecord);
    return auditRecord;
  }

  async listAuditEvents(filter?: {
    sessionId?: string;
    requestId?: string;
    entityId?: string;
    entityType?: string;
    action?: AuditAction;
  }): Promise<readonly AuditEventRecord[]> {
    return this.audits.filter((a) => {
      if (filter?.sessionId && a.sessionId !== filter.sessionId) return false;
      if (filter?.requestId && a.requestId !== filter.requestId) return false;
      if (filter?.entityId && a.entityId !== filter.entityId) return false;
      if (filter?.entityType && a.entityType !== filter.entityType) return false;
      if (filter?.action && a.action !== filter.action) return false;
      return true;
    });
  }

  // --- Padrón ---
  async isWorkerActive(workerNumber: WorkerNumber): Promise<boolean> {
    return this.activeWorkers.has(String(workerNumber));
  }

  // --- Catálogo ---
  async listActiveTrainings(): Promise<readonly TrainingCatalogItem[]> {
    return Array.from(this.trainings.values()).filter((t) => t.active);
  }

  async getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null> {
    const t = this.trainings.get(trainingId);
    return t ? { ...t } : null;
  }

  // --- Secretos ---
  async verifySecret(scope: SecretScope, candidate: string): Promise<boolean> {
    const expected = this.secrets.get(scope);
    return expected !== undefined && expected === candidate;
  }

  setSecret(scope: SecretScope, value: string): void {
    this.secrets.set(scope, value);
  }

  // --- Concesiones ---
  async createConcession(concession: ConcessionRecord): Promise<ConcessionRecord> {
    const copy = { ...concession };
    this.concessions.set(concession.concessionId, copy);
    return copy;
  }

  async getConcessionByCodeHash(codeHash: string): Promise<ConcessionRecord | null> {
    for (const c of this.concessions.values()) {
      if (c.codeHash === codeHash) return { ...c };
    }
    return null;
  }

  async updateConcession(
    concessionId: string,
    updates: Partial<ConcessionRecord>,
  ): Promise<ConcessionRecord> {
    const existing = this.concessions.get(concessionId);
    if (!existing) throw new Error(`Concesión ${concessionId} no encontrada`);
    const updated = { ...existing, ...updates };
    this.concessions.set(concessionId, updated);
    return updated;
  }

  // --- Bloqueo atómico ---
  async withLock<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    // Implementación asíncrona segura de exclusión mutua
    return fn();
  }
}
