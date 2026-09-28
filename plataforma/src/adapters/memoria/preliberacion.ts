/**
 * Repositorio en memoria para Preliberación.
 * Permite ejecutar pruebas sin dependencias externas ni credenciales.
 */

/* eslint-disable @typescript-eslint/require-await --
 * El puerto es asíncrono porque su implementación real habla con PostgreSQL.
 * En memoria no hay nada que esperar, y quitar `async` obligaría a envolver
 * cada retorno en `Promise.resolve`, que dice lo mismo con más ruido. */

import { randomUUID } from "node:crypto";
import type { WorkerNumber } from "../../domain/comun/numero-trabajador.ts";
import type {
  AuditEventRecord,
  AttendanceRecord,
  SessionRecord,
  TrainingCatalogItem,
} from "../../domain/quiosco/tipos.ts";
import type {
  PreReleaseReviewRecord,
  EmployeeInfo,
  ReportEvidenceRecord,
} from "../../domain/preliberacion/tipos.ts";
import type { PreReleaseRepositoryPort } from "../../ports/preliberacion.port.ts";

export interface MemoryPreReleaseState {
  readonly sessions?: readonly SessionRecord[];
  readonly attendances?: readonly AttendanceRecord[];
  readonly reviews?: readonly PreReleaseReviewRecord[];
  readonly audits?: readonly AuditEventRecord[];
  readonly employees?: readonly EmployeeInfo[];
  readonly trainings?: readonly TrainingCatalogItem[];
}

export class MemoryPreReleaseRepository implements PreReleaseRepositoryPort {
  private sessions = new Map<string, SessionRecord>();
  private attendances = new Map<string, AttendanceRecord>();
  private reviews = new Map<string, PreReleaseReviewRecord>();
  private audits: AuditEventRecord[] = [];
  private employees = new Map<string, EmployeeInfo>();
  private trainings = new Map<string, TrainingCatalogItem>();
  private reports = new Map<string, ReportEvidenceRecord>();
  private reportContent = new Map<string, Uint8Array>();
  private locks = new Map<string, Promise<void>>();
  private auditSequence = 0;

  constructor(initialState?: MemoryPreReleaseState) {
    if (initialState?.sessions) {
      for (const s of initialState.sessions) this.sessions.set(s.sessionId, { ...s });
    }
    if (initialState?.attendances) {
      for (const a of initialState.attendances) this.attendances.set(a.attendanceId, { ...a });
    }
    if (initialState?.reviews) {
      for (const r of initialState.reviews) this.reviews.set(r.sessionId, { ...r });
    }
    if (initialState?.audits) {
      this.audits = initialState.audits.map((a) => ({ ...a }));
      this.auditSequence = this.audits.length;
    }
    if (initialState?.employees) {
      for (const e of initialState.employees) this.employees.set(e.employeeId, { ...e });
    }
    if (initialState?.trainings) {
      for (const t of initialState.trainings) this.trainings.set(t.trainingId, { ...t });
    } else {
      this.trainings.set("CAP-SINT-001", {
        trainingId: "CAP-SINT-001",
        name: "BUENAS PRÁCTICAS DE MANUFACTURA",
        active: true,
        durationHours: 1,
      });
    }
  }

  // Sessions
  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const updated = { ...session, status: status as SessionRecord["status"] };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async listSessionsByStatuses(statuses: readonly string[]): Promise<readonly SessionRecord[]> {
    return Array.from(this.sessions.values()).filter((s) => statuses.includes(s.status));
  }

  // Attendances
  async listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]> {
    return Array.from(this.attendances.values()).filter((a) => a.sessionId === sessionId);
  }

  async getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null> {
    for (const a of this.attendances.values()) {
      if (a.sessionId === sessionId && String(a.workerNumber) === String(workerNumber)) return a;
    }
    return null;
  }

  async createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord> {
    this.attendances.set(attendance.attendanceId, { ...attendance });
    return attendance;
  }

  async updateAttendance(
    attendanceId: string,
    updates: Partial<AttendanceRecord>,
  ): Promise<AttendanceRecord> {
    const existing = this.attendances.get(attendanceId);
    if (!existing) throw new Error(`Attendance ${attendanceId} not found`);
    const updated = { ...existing, ...updates };
    this.attendances.set(attendanceId, updated);
    return updated;
  }

  async updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void> {
    for (const { attendanceId, updates: upd } of updates) {
      await this.updateAttendance(attendanceId, upd);
    }
  }

  async countAttendancesBySession(sessionId: string): Promise<number> {
    return (await this.listAttendancesBySession(sessionId)).length;
  }

  // Reviews
  async getLatestReview(sessionId: string): Promise<PreReleaseReviewRecord | null> {
    return this.reviews.get(sessionId) ?? null;
  }

  async upsertReview(review: PreReleaseReviewRecord): Promise<PreReleaseReviewRecord> {
    this.reviews.set(review.sessionId, { ...review });
    return review;
  }

  // Workers
  async isWorkerActive(workerNumber: WorkerNumber): Promise<boolean> {
    const emp = this.employees.get(String(workerNumber));
    return emp?.active ?? false;
  }

  async getEmployeeInfo(workerNumber: WorkerNumber): Promise<EmployeeInfo | null> {
    return this.employees.get(String(workerNumber)) ?? null;
  }

  // Trainings
  async getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null> {
    return this.trainings.get(trainingId) ?? null;
  }

  // Reportes archivados
  async archiveReport(
    record: ReportEvidenceRecord,
    content: Uint8Array,
  ): Promise<ReportEvidenceRecord> {
    if (this.reports.has(record.evidenceId)) {
      // La evidencia es inmutable: reescribirla borraría el hecho que respalda.
      throw new Error(`La evidencia ${record.evidenceId} ya existe y es inmutable`);
    }
    this.reports.set(record.evidenceId, { ...record });
    this.reportContent.set(record.evidenceId, Uint8Array.from(content));
    return record;
  }

  async listReportsBySession(sessionId: string): Promise<readonly ReportEvidenceRecord[]> {
    return Array.from(this.reports.values())
      .filter((r) => r.sessionId === sessionId)
      .sort((l, r) => r.createdAt.localeCompare(l.createdAt));
  }

  async getReportById(evidenceId: string): Promise<ReportEvidenceRecord | null> {
    return this.reports.get(evidenceId) ?? null;
  }

  async getReportContent(evidenceId: string): Promise<Uint8Array | null> {
    return this.reportContent.get(evidenceId) ?? null;
  }

  // Audit
  async recordAudit(
    event: Omit<AuditEventRecord, "eventId" | "occurredAt">,
  ): Promise<AuditEventRecord> {
    this.auditSequence += 1;
    const full: AuditEventRecord = {
      ...event,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      sequence: this.auditSequence,
    };
    this.audits.push(full);
    return full;
  }

  async recordManyAudits(
    events: readonly Omit<AuditEventRecord, "eventId" | "occurredAt">[],
  ): Promise<void> {
    for (const event of events) {
      await this.recordAudit(event);
    }
  }

  async findAuditEvent(filter: {
    sessionId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null> {
    for (const audit of this.audits) {
      if (filter.sessionId && audit.sessionId !== filter.sessionId) continue;
      if (filter.entityType && audit.entityType !== filter.entityType) continue;
      if (filter.entityId && audit.entityId !== filter.entityId) continue;
      if (filter.action && audit.action !== filter.action) continue;
      if (filter.requestId && audit.requestId !== filter.requestId) continue;
      return audit;
    }
    return null;
  }

  // Lock
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let resolve: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(key, promise);
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      resolve!();
    }
  }

  // Test helpers
  getAllAudits(): readonly AuditEventRecord[] {
    return [...this.audits];
  }

  getReview(sessionId: string): PreReleaseReviewRecord | undefined {
    return this.reviews.get(sessionId);
  }

  getAttendance(attendanceId: string): AttendanceRecord | undefined {
    return this.attendances.get(attendanceId);
  }
}
