/**
 * Banco de trabajo de preliberación — operaciones con mutación de estado.
 *
 * Banco de trabajo de preliberación y reconciliación de exámenes.
 * Cada operación que muta es serializada con lock, idempotente por requestId
 * y deja auditoría antes de persistir.
 *
 * Invariantes de E9:
 * - Guardar NO cambia el estado de la sesión
 * - Excluir exige motivo
 * - Una asistencia ya liberada no admite exclusión
 * - Alta manual idempotente por requestId, rechaza duplicados
 * - Transiciones bloqueadas, idempotentes y auditadas
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../ports/reloj.ts";
import type { PreReleaseRepositoryPort } from "../../ports/preliberacion.port.ts";
import type {
  ActorIdentity,
  AttendanceRecord,
  AuditEventRecord,
  SessionRecord,
} from "../quiosco/tipos.ts";
import type { WorkerNumber } from "../numero-trabajador.ts";
import { parseWorkerNumber } from "../numero-trabajador.ts";
import {
  InvalidPreReleaseStateError,
  PreReleaseDuplicateError,
  PreReleaseCapacityError,
  PreReleaseInputError,
  PreReleaseNotFoundError,
} from "./errores.ts";
import {
  buildRosterRow,
  counters,
  derivedFindings,
  reviewDto,
  sessionHeader,
} from "./servicio.ts";
import type {
  AddWorkerInput,
  EmployeeInfo,
  ExamOutcome,
  FindingCode,
  PreReleaseReviewRecord,
  RosterRow,
  SaveReviewInput,
  SessionHeader,
  WorkbenchState,
} from "./tipos.ts";
import {
  EDITABLE_STATUSES,
  EXAM_OUTCOME_LABELS,
  MAX_COMMENT_LENGTH,
  MAX_FINDINGS_COUNT,
  MAX_LISTED_SESSIONS,
  MAX_REASON_LENGTH,
  MAX_ROSTER_SIZE,
  PRE_RELEASE_ENTRY_STATUSES,
  PRERELEASE_FINDINGS,
  RELEASE_QUEUE_STATUS,
  SELECTABLE_EXAM_OUTCOMES,
} from "./tipos.ts";

export interface WorkbenchServiceDeps {
  readonly repository: PreReleaseRepositoryPort;
  readonly clock: Clock;
}

export class WorkbenchService {
  private readonly repo: PreReleaseRepositoryPort;
  private readonly clock: Clock;

  constructor(deps: WorkbenchServiceDeps) {
    this.repo = deps.repository;
    this.clock = deps.clock;
  }

  // -----------------------------------------------------------------------
  // Consultas
  // -----------------------------------------------------------------------

  /** Abre el workbench para una sesión revisable. */
  async open(sessionId: string): Promise<WorkbenchState> {
    const session = await this.requireSession(sessionId);
    this.assertReviewable(session);
    return this.buildState(session);
  }

  /**
   * Abre el banco en la modalidad que corresponda a la etapa: editable mientras
   * la sesión se revisa, sólo lectura una vez que pasó a la bandeja de
   * liberación. Es lo que usa la pantalla, que no debería tener que adivinar
   * cuál de los dos caminos tomar ni provocar un error para averiguarlo.
   */
  async openForStage(sessionId: string): Promise<WorkbenchState> {
    const session = await this.requireSession(sessionId);
    if (session.status === RELEASE_QUEUE_STATUS) {
      const state = await this.buildState(session);
      return { ...state, editable: false, releaseAvailable: false };
    }
    this.assertReviewable(session);
    return this.buildState(session);
  }

  /** Vista de sólo lectura desde la bandeja de liberación. */
  async releaseReview(sessionId: string): Promise<WorkbenchState> {
    const session = await this.requireSession(sessionId);
    if (session.status !== RELEASE_QUEUE_STATUS) {
      throw new InvalidPreReleaseStateError("La sesión no está en la bandeja de liberación");
    }
    const state = await this.buildState(session);
    return { ...state, editable: false, releaseAvailable: false };
  }

  /**
   * Bandeja de revisión: sesiones en etapa revisable. Devuelve encabezados, nunca
   * el padrón, para que la lista inicial no exponga identidades que la vista no
   * necesita.
   */
  async listEditableSessions(identity: ActorIdentity): Promise<readonly SessionHeader[]> {
    return this.listSessionHeaders(EDITABLE_STATUSES, identity);
  }

  /** Bandeja de liberación: lo que ya pasó la revisión y espera a la función 5. */
  async listReleaseQueue(identity: ActorIdentity): Promise<readonly SessionHeader[]> {
    return this.listSessionHeaders([RELEASE_QUEUE_STATUS], identity);
  }

  private async listSessionHeaders(
    statuses: readonly string[],
    identity: ActorIdentity,
  ): Promise<readonly SessionHeader[]> {
    const sessions = await this.repo.listSessionsByStatuses(statuses);

    // Un capacitador sólo ve lo que él creó. Los demás roles de revisión ven la
    // bandeja completa.
    const visible =
      identity.role === "CAPACITADOR"
        ? sessions.filter((s) => s.createdBy === identity.actor)
        : sessions;

    const headers: SessionHeader[] = [];
    for (const session of visible) {
      const attendances = await this.repo.listAttendancesBySession(session.sessionId);
      const training = await this.repo.getTrainingById(session.trainingId);
      headers.push(
        sessionHeader(session, training ? training.name : session.trainingId, attendances),
      );
    }

    return headers
      .sort(
        (left, right) =>
          right.date.localeCompare(left.date) || left.sessionCode.localeCompare(right.sessionCode),
      )
      .slice(0, MAX_LISTED_SESSIONS);
  }

  // -----------------------------------------------------------------------
  // Mutaciones
  // -----------------------------------------------------------------------

  /**
   * Guarda la revisión completa en una sola operación serializada.
   * Idempotente por sesión: la fila de revisión se reemplaza.
   * El rastro de cada cambio queda en auditoría.
   *
   * INVARIANTE: Guardar NO cambia el estado de la sesión.
   */
  async save(input: SaveReviewInput, identity: ActorIdentity): Promise<WorkbenchState> {
    const sessionId = this.requireIdentifier(input.sessionId, "sessionId");
    const requestId = this.requireIdentifier(input.requestId, "requestId");

    return this.repo.withLock(`prerelease:save:${sessionId}`, async () => {
      const session = await this.requireSession(sessionId);
      this.assertReviewable(session);

      const attendances = await this.repo.listAttendancesBySession(sessionId);
      const employees = await this.resolveEmployees(attendances);
      const roster = this.buildRoster(attendances, session, employees);

      const outcomes = this.validateOutcomes(input.examOutcomes, roster);
      const exclusions = this.validateExclusions(input.exclusions, roster);
      const declared = this.validateDeclaredFindings(input.findings);
      const comments = this.validateText(input.comments || "", "comments", MAX_COMMENT_LENGTH);

      const now = this.clock.now().toISOString();
      const auditInputs: Omit<AuditEventRecord, "eventId" | "occurredAt">[] = [];
      const attendancePatches = new Map<string, Partial<AttendanceRecord>>();

      // Apply exam outcomes
      for (const entry of outcomes) {
        const attendance = attendances.find((a) => String(a.workerNumber) === entry.employeeId);
        if (!attendance) continue;
        if (attendance.examStatus === entry.examStatus) continue;

        const patch = attendancePatches.get(attendance.attendanceId) ?? {};
        attendancePatches.set(attendance.attendanceId, {
          ...patch,
          examStatus: entry.examStatus as AttendanceRecord["examStatus"],
          updatedAt: now,
        });
        auditInputs.push({
          actor: identity.actor,
          role: identity.role,
          entityType: "Attendance",
          entityId: attendance.attendanceId,
          action: "EXAM_STATUS_RECONCILED",
          previousState: attendance.examStatus,
          newState: entry.examStatus,
          sessionId,
          requestId,
          provenance: "PLATAFORMA",
          contractVersion: "1.0.0",
        });
      }

      // Apply exclusions
      for (const entry of exclusions) {
        const attendance = attendances.find((a) => String(a.workerNumber) === entry.employeeId);
        if (!attendance) continue;
        if (
          attendance.excludedFromRelease === entry.excluded &&
          (attendance.exclusionReason ?? "") === entry.reason
        )
          continue;

        // INVARIANTE: una asistencia ya liberada no admite exclusión
        if (attendance.released) {
          throw new InvalidPreReleaseStateError("Una asistencia ya liberada no admite exclusión");
        }

        const patch = attendancePatches.get(attendance.attendanceId) ?? {};
        // Reincorporar limpia motivo, actor y momento con cadena vacía, no
        // borrando el campo: dejar el actor de la exclusión anterior sobre una
        // fila ya reincorporada haría ver responsable a quien ya no lo es. El
        // hecho no se pierde, queda en el asiento de auditoría.
        attendancePatches.set(attendance.attendanceId, {
          ...patch,
          excludedFromRelease: entry.excluded,
          exclusionReason: entry.excluded ? entry.reason : "",
          excludedBy: entry.excluded ? identity.actor : "",
          excludedAt: entry.excluded ? now : "",
          updatedAt: now,
        });
        auditInputs.push({
          actor: identity.actor,
          role: identity.role,
          entityType: "Attendance",
          entityId: attendance.attendanceId,
          action: entry.excluded ? "ATTENDANCE_EXCLUDED" : "ATTENDANCE_REINSTATED",
          previousState: attendance.excludedFromRelease ? "EXCLUIDO" : "INCLUIDO",
          newState: entry.excluded ? "EXCLUIDO" : "INCLUIDO",
          reason: entry.reason,
          sessionId,
          requestId,
          provenance: "PLATAFORMA",
          contractVersion: "1.0.0",
        });
      }

      // Confirm attendance proof for all with validated identity
      for (const attendance of attendances) {
        if (!attendance.identityValidated || attendance.attendanceProven || attendance.released)
          continue;

        const patch = attendancePatches.get(attendance.attendanceId) ?? {};
        attendancePatches.set(attendance.attendanceId, {
          ...patch,
          attendanceProven: true,
          status: "COTEJADA",
          updatedAt: now,
        });
        auditInputs.push({
          actor: identity.actor,
          role: identity.role,
          entityType: "Attendance",
          entityId: attendance.attendanceId,
          action: "PRERELEASE_ATTENDANCE_CONFIRMED",
          previousState: "PENDIENTE_COTEJO",
          newState: "COTEJADA",
          sessionId,
          requestId,
          provenance: "PLATAFORMA",
          contractVersion: "1.0.0",
        });
      }

      // Persist attendance updates
      if (attendancePatches.size > 0) {
        const updates = Array.from(attendancePatches.entries()).map(([id, upd]) => ({
          attendanceId: id,
          updates: upd,
        }));
        await this.repo.updateManyAttendances(updates);
      }

      // Rebuild roster after patches
      const refreshedAttendances = await this.repo.listAttendancesBySession(sessionId);
      const refreshedRoster = this.buildRoster(refreshedAttendances, session, employees);
      const receivedExams = refreshedRoster.filter(
        (r) => r.examStatus !== "EXAMEN_NO_ENCONTRADO",
      ).length;
      const totals = counters(refreshedRoster, receivedExams);
      const derived = derivedFindings(refreshedRoster, receivedExams);
      const allFindings = derived.concat(declared.filter((c) => !derived.includes(c)));

      // Upsert review record
      const existing = await this.repo.getLatestReview(sessionId);
      const record: PreReleaseReviewRecord = {
        revisionId: existing?.revisionId ?? randomUUID(),
        sessionId,
        requestId,
        expectedExams: totals.expectedExams,
        receivedExams: totals.receivedExams,
        approvedExams: totals.approvedExams,
        failedExams: totals.failedExams,
        missingExams: totals.missingExams,
        extraExams: totals.extraExams,
        findings: JSON.stringify(allFindings),
        comments,
        excludedCount: totals.excludedCount,
        status: allFindings.length ? "CON_HALLAZGOS" : "SIN_HALLAZGOS",
        reportEvidenceId: existing?.reportEvidenceId ?? "",
        reviewedBy: identity.actor,
        reviewedAt: now,
        updatedAt: now,
      };
      await this.repo.upsertReview(record);

      // Auditoría
      if (auditInputs.length > 0) {
        await this.repo.recordManyAudits(auditInputs);
      }
      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "PreReleaseReview",
        entityId: record.revisionId,
        action: "PRERELEASE_REVIEW_SAVED",
        newState: record.status,
        reason: allFindings.join(" ").slice(0, 300),
        sessionId,
        requestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      return this.buildState(session, record);
    });
  }

  /**
   * Alta manual de un trabajador en el padrón de la sesión.
   * Idempotente por requestId; otra solicitud para la misma persona falla.
   */
  async addWorker(input: AddWorkerInput, identity: ActorIdentity): Promise<WorkbenchState> {
    if (!input || typeof input !== "object") {
      throw new PreReleaseInputError("Solicitud de alta inválida");
    }
    const sessionId = this.requireIdentifier(input.sessionId, "sessionId");
    const employeeId = String(parseWorkerNumber(input.employeeId));
    const requestId = this.requireIdentifier(input.requestId, "requestId");

    return this.repo.withLock(`prerelease:add:${sessionId}`, async () => {
      const session = await this.requireSession(sessionId);
      this.assertReviewable(session);

      // Verify worker exists and is active
      const employeeInfo = await this.repo.getEmployeeInfo(employeeId as WorkerNumber);
      if (!employeeInfo || !employeeInfo.active) {
        throw new PreReleaseNotFoundError("El número de nómina no pertenece al padrón activo");
      }

      const attendances = await this.repo.listAttendancesBySession(sessionId);
      const existing = attendances.find((a) => String(a.workerNumber) === employeeId);

      if (existing) {
        // Check idempotency — same requestId returns state
        const priorAudit = await this.repo.findAuditEvent({
          sessionId,
          entityType: "Attendance",
          entityId: existing.attendanceId,
          action: "PRERELEASE_ATTENDANCE_ADDED",
          requestId,
        });
        if (priorAudit) {
          return this.buildState(session);
        }
        throw new PreReleaseDuplicateError(
          "El trabajador ya está incluido en el padrón de la sesión",
        );
      }

      // Check capacity
      if (attendances.length >= 40) {
        throw new PreReleaseCapacityError("La sesión alcanzó el máximo de registros");
      }

      // Check requestId reuse with different employee
      const priorAuditByRequest = await this.repo.findAuditEvent({
        sessionId,
        entityType: "Attendance",
        action: "PRERELEASE_ATTENDANCE_ADDED",
        requestId,
      });
      const auditReason = `ALTA_MANUAL_EN_PRELIBERACION:${employeeId}`;
      if (priorAuditByRequest && !String(priorAuditByRequest.reason ?? "").includes(auditReason)) {
        throw new PreReleaseInputError("El requestId ya fue usado para otra alta de trabajador");
      }

      const now = this.clock.now().toISOString();
      const attendanceId = priorAuditByRequest ? priorAuditByRequest.entityId : randomUUID();

      const newAttendance: AttendanceRecord = {
        attendanceId,
        sessionId,
        workerNumber: employeeId as WorkerNumber,
        route: "DIGITAL",
        origin: "ALTA_MANUAL",
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
        status: "COTEJADA",
        excludedFromRelease: false,
        released: false,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

      if (!priorAuditByRequest) {
        await this.repo.recordAudit({
          actor: identity.actor,
          role: identity.role,
          entityType: "Attendance",
          entityId: attendanceId,
          action: "PRERELEASE_ATTENDANCE_ADDED",
          previousState: "NO_REGISTRADO",
          newState: "COTEJADA",
          reason: auditReason,
          sessionId,
          requestId,
          provenance: "PLATAFORMA",
          contractVersion: "1.0.0",
        });
      }

      await this.repo.createAttendance(newAttendance);

      return this.buildState(session);
    });
  }

  /**
   * Confirma la revisión y cambia la sesión a PRELIBERACION.
   * Idempotente: si ya está en PRELIBERACION, devuelve el estado.
   */
  async enterPreRelease(sessionId: string, identity: ActorIdentity): Promise<WorkbenchState> {
    const sid = this.requireIdentifier(sessionId, "sessionId");

    return this.repo.withLock(`prerelease:state:${sid}`, async () => {
      const session = await this.requireSession(sid);

      // Idempotente
      if (session.status === "PRELIBERACION") {
        return this.buildState(session);
      }

      if (!PRE_RELEASE_ENTRY_STATUSES.includes(session.status)) {
        throw new InvalidPreReleaseStateError(
          "La sesión no puede entrar a preliberación desde su estado actual",
        );
      }

      // Must have a saved review
      const review = await this.repo.getLatestReview(sid);
      if (!review || !review.reviewedAt) {
        throw new InvalidPreReleaseStateError(
          "Guarde la revisión antes de pasar la sesión a preliberación",
        );
      }

      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: sid,
        action: "SESSION_STATE_CHANGED",
        previousState: session.status,
        newState: "PRELIBERACION",
        sessionId: sid,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      await this.repo.updateSessionStatus(sid, "PRELIBERACION");

      const updatedSession = await this.requireSession(sid);
      return this.buildState(updatedSession);
    });
  }

  /**
   * Pasa a LISTA_PARA_LIBERAR.
   * Requiere: estado PRELIBERACION, sesión autorizada, todos los exámenes clasificados, revisión guardada.
   */
  async submit(sessionId: string, identity: ActorIdentity): Promise<WorkbenchState> {
    const sid = this.requireIdentifier(sessionId, "sessionId");

    return this.repo.withLock(`prerelease:state:${sid}`, async () => {
      const session = await this.requireSession(sid);

      // If already in release queue, return release review
      if (session.status === RELEASE_QUEUE_STATUS) {
        return this.releaseReview(sid);
      }

      this.assertReviewable(session);

      if (session.status !== "PRELIBERACION") {
        throw new InvalidPreReleaseStateError(
          "La sesión debe completar primero el cotejo de preliberación",
        );
      }

      if (!session.authorized) {
        throw new InvalidPreReleaseStateError("Autorice la sesión antes de pasarla a liberación");
      }

      const review = await this.repo.getLatestReview(sid);
      if (!review || !review.reviewedAt) {
        throw new InvalidPreReleaseStateError("Guarde la revisión antes de pasarla a liberación");
      }

      // All exams must be classified (no EXAMEN_PENDIENTE)
      const attendances = await this.repo.listAttendancesBySession(sid);
      const pending = attendances.filter(
        (a) => (a.examStatus || "EXAMEN_PENDIENTE") === "EXAMEN_PENDIENTE",
      );
      if (pending.length > 0) {
        throw new InvalidPreReleaseStateError(
          "Clasifique todos los exámenes antes de pasar a liberación",
        );
      }

      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: sid,
        action: "SESSION_STATE_CHANGED",
        previousState: "PRELIBERACION",
        newState: RELEASE_QUEUE_STATUS,
        sessionId: sid,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      await this.repo.updateSessionStatus(sid, RELEASE_QUEUE_STATUS);

      const updatedSession = await this.requireSession(sid);
      const state = await this.buildState(updatedSession);
      return { ...state, editable: false, releaseAvailable: false };
    });
  }

  /**
   * Retorna de LISTA_PARA_LIBERAR a PRELIBERACION.
   * Idempotente: si ya está en PRELIBERACION, devuelve el estado.
   */
  async returnToPreRelease(sessionId: string, identity: ActorIdentity): Promise<WorkbenchState> {
    const sid = this.requireIdentifier(sessionId, "sessionId");

    return this.repo.withLock(`prerelease:state:${sid}`, async () => {
      const session = await this.requireSession(sid);

      // Idempotente
      if (session.status === "PRELIBERACION") {
        return this.buildState(session);
      }

      if (session.status !== RELEASE_QUEUE_STATUS) {
        throw new InvalidPreReleaseStateError("La sesión no está en la bandeja de liberación");
      }

      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: sid,
        action: "SESSION_STATE_CHANGED",
        previousState: RELEASE_QUEUE_STATUS,
        newState: "PRELIBERACION",
        sessionId: sid,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      await this.repo.updateSessionStatus(sid, "PRELIBERACION");

      const updatedSession = await this.requireSession(sid);
      return this.buildState(updatedSession);
    });
  }

  // -----------------------------------------------------------------------
  // Internos
  // -----------------------------------------------------------------------

  private assertReviewable(session: SessionRecord): void {
    if (!EDITABLE_STATUSES.includes(session.status)) {
      throw new InvalidPreReleaseStateError("La sesión no está en una etapa revisable");
    }
  }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const session = await this.repo.getSessionById(sessionId);
    if (!session) {
      throw new PreReleaseNotFoundError("La sesión no existe");
    }
    return session;
  }

  private async resolveEmployees(
    attendances: readonly AttendanceRecord[],
  ): Promise<Map<string, EmployeeInfo | null>> {
    const result = new Map<string, EmployeeInfo | null>();
    for (const a of attendances) {
      const wn = String(a.workerNumber) as WorkerNumber;
      if (!result.has(wn)) {
        result.set(wn, await this.repo.getEmployeeInfo(wn));
      }
    }
    return result;
  }

  private buildRoster(
    attendances: readonly AttendanceRecord[],
    session: SessionRecord,
    employees: Map<string, EmployeeInfo | null>,
  ): RosterRow[] {
    return attendances
      .map((a) => buildRosterRow(a, session, employees.get(String(a.workerNumber)) ?? null))
      .sort((l, r) => l.employeeId.localeCompare(r.employeeId));
  }

  private async buildState(
    session: SessionRecord,
    review?: PreReleaseReviewRecord | null,
  ): Promise<WorkbenchState> {
    const attendances = await this.repo.listAttendancesBySession(session.sessionId);
    const employees = await this.resolveEmployees(attendances);
    const roster = this.buildRoster(attendances, session, employees);

    const rev = review ?? (await this.repo.getLatestReview(session.sessionId));
    const dto = reviewDto(rev);

    const receivedExams = roster.filter((r) => r.examStatus !== "EXAMEN_NO_ENCONTRADO").length;
    const derived = derivedFindings(roster, receivedExams);
    const allFindings = derived.concat(dto.declaredFindings.filter((c) => !derived.includes(c)));

    const training = await this.repo.getTrainingById(session.trainingId);
    const trainingName = training ? training.name : session.trainingId;

    return {
      session: sessionHeader(session, trainingName, attendances),
      roster,
      counters: counters(roster, receivedExams),
      review: dto,
      derivedFindings: derived,
      findings: allFindings,
      findingCatalog: Object.entries(PRERELEASE_FINDINGS).map(([code, def]) => ({
        code,
        label: def.label,
        derived: def.derived,
      })),
      // Sólo las tres alternativas que el revisor puede escoger. `EXAMEN_PENDIENTE`
      // existe en el registro pero no se ofrece: es el valor de partida, no una
      // decisión de la revisión.
      examOutcomes: SELECTABLE_EXAM_OUTCOMES.map((code) => ({
        code,
        label: EXAM_OUTCOME_LABELS[code],
      })),
    };
  }

  // -----------------------------------------------------------------------
  // Validación
  // -----------------------------------------------------------------------

  private requireIdentifier(value: string, field: string): string {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
      throw new PreReleaseInputError(`${field} es requerido`);
    }
    return trimmed;
  }

  private validateText(value: string, field: string, maxLength: number): string {
    const trimmed = String(value).trim();
    if (trimmed.length > maxLength) {
      throw new PreReleaseInputError(`${field} excede ${maxLength} caracteres`);
    }
    return trimmed;
  }

  private validateOutcomes(
    entries: SaveReviewInput["examOutcomes"],
    roster: readonly RosterRow[],
  ): { employeeId: string; examStatus: ExamOutcome }[] {
    if (!entries) return [];
    if (entries.length > MAX_ROSTER_SIZE) {
      throw new PreReleaseInputError("La revisión contiene demasiados renglones");
    }

    const byEmployee = new Map(roster.map((r) => [r.employeeId, r]));
    const seen = new Set<string>();
    return entries.map((entry) => {
      const employeeId = String(parseWorkerNumber(entry.employeeId));
      if (seen.has(employeeId)) {
        throw new PreReleaseDuplicateError("La revisión repite un número de trabajador");
      }
      seen.add(employeeId);
      if (!byEmployee.has(employeeId)) {
        throw new PreReleaseNotFoundError(
          "La revisión incluye a alguien que no asistió a la sesión",
        );
      }
      // El cliente sólo puede mandar una de las tres alternativas visibles.
      // Aceptar `EXAMEN_PENDIENTE` por esta vía dejaría revertir una
      // clasificación desde el formulario y volvería a abrir el estado inicial.
      if (!SELECTABLE_EXAM_OUTCOMES.includes(entry.examStatus)) {
        throw new PreReleaseInputError("Resultado de examen no válido");
      }
      return { employeeId, examStatus: entry.examStatus };
    });
  }

  private validateExclusions(
    entries: SaveReviewInput["exclusions"],
    roster: readonly RosterRow[],
  ): { employeeId: string; excluded: boolean; reason: string }[] {
    if (!entries) return [];
    if (entries.length > MAX_ROSTER_SIZE) {
      throw new PreReleaseInputError("La revisión contiene demasiadas exclusiones");
    }

    const byEmployee = new Map(roster.map((r) => [r.employeeId, r]));
    const seen = new Set<string>();
    return entries.map((entry) => {
      const employeeId = String(parseWorkerNumber(entry.employeeId));
      if (seen.has(employeeId)) {
        throw new PreReleaseDuplicateError("La revisión repite una exclusión");
      }
      seen.add(employeeId);
      if (!byEmployee.has(employeeId)) {
        throw new PreReleaseNotFoundError(
          "La exclusión apunta a alguien que no asistió a la sesión",
        );
      }
      const excluded = entry.excluded === true;
      if (excluded && !entry.reason?.trim()) {
        throw new PreReleaseInputError("Excluir exige motivo");
      }
      const reason = excluded
        ? this.validateText(entry.reason ?? "", "reason", MAX_REASON_LENGTH)
        : "";
      return { employeeId, excluded, reason };
    });
  }

  private validateDeclaredFindings(entries: SaveReviewInput["findings"]): string[] {
    if (!entries) return [];
    if (entries.length > MAX_FINDINGS_COUNT) {
      throw new PreReleaseInputError("La revisión declara demasiados hallazgos");
    }

    const seen = new Set<string>();
    return entries.map((code) => {
      const normalized = String(code).trim();
      if (!(normalized in PRERELEASE_FINDINGS)) {
        throw new PreReleaseInputError("Hallazgo no reconocido");
      }
      if (PRERELEASE_FINDINGS[normalized as FindingCode].derived) {
        throw new PreReleaseInputError("Un hallazgo derivado no puede declararse a mano");
      }
      if (seen.has(normalized)) {
        throw new PreReleaseDuplicateError("La revisión repite un hallazgo");
      }
      seen.add(normalized);
      return normalized;
    });
  }
}
