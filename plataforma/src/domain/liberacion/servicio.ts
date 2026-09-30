import { randomUUID } from "node:crypto";

import type { Clock } from "../../ports/reloj.port.ts";
import type { ReleaseRepositoryPort } from "../../ports/liberacion.port.ts";
import { esCodigoDeSesion, normalizarCodigoDeSesion } from "../quiosco/codigo-de-sesion.ts";
import type { ActorIdentity, AttendanceRecord, SessionRecord } from "../quiosco/tipos.ts";
import { blockingReasons } from "../preliberacion/servicio.ts";
import {
  InvalidReleaseStateError,
  ReleaseConflictError,
  ReleaseForbiddenError,
  ReleaseInputError,
} from "./errores.ts";
import {
  assertBatchIntegrity,
  buildContext,
  canonicalResultsJson,
  markerFor,
  planEnvelope,
  reseal,
  restorePlan,
  signBatch,
} from "./journal.ts";
import type { MatrixGateway } from "./pasarela-matriz.ts";
import {
  assertIdentifier,
  buildWritePlan,
  validateResults,
  validateWritePlan,
} from "./plan-de-escritura.ts";
import {
  CONTRACT_VERSION,
  MAX_OVERWRITE_REASON_LENGTH,
  RELEASABLE_SESSION_STATUSES,
  isConflict,
  isEffective,
  isTerminalPhase,
  type ExcludedEntry,
  type ExistingDate,
  type MatrixWriteResult,
  type MatrixMapping,
  type ReleaseBatch,
  type ReleaseEffect,
  type ReleaseInput,
  type ReleaseOutcome,
  type ReleasePhase,
  type ReleasePreview,
  type SessionReleaseOutcome,
  type WritePlan,
} from "./tipos.ts";

export interface ReleaseServiceDeps {
  readonly repository: ReleaseRepositoryPort;
  readonly gateway: MatrixGateway;
  readonly clock: Clock;
  readonly secret: string;
}

interface EligibilitySplit {
  readonly eligible: readonly AttendanceRecord[];
  readonly excluded: readonly ExcludedEntry[];
}

export class ReleaseService {
  readonly #repo: ReleaseRepositoryPort;
  readonly #gateway: MatrixGateway;
  readonly #clock: Clock;
  readonly #secret: string;

  constructor(deps: ReleaseServiceDeps) {
    this.#repo = deps.repository;
    this.#gateway = deps.gateway;
    this.#clock = deps.clock;
    this.#secret = deps.secret;
  }

  async resolveSessionReference(reference: string): Promise<string> {
    const value = assertIdentifier(reference, "sessionId");
    const codigo = normalizarCodigoDeSesion(value);
    const session = esCodigoDeSesion(codigo)
      ? await this.#repo.getSessionByCode(codigo)
      : await this.#repo.getSessionById(value);
    if (!session) {
      throw new InvalidReleaseStateError("La sesión no existe");
    }
    return session.sessionId;
  }

  async preview(sessionId: string, overwriteReason = ""): Promise<ReleasePreview> {
    const sid = assertIdentifier(sessionId, "sessionId");
    const session = await this.#requireSession(sid);
    const mapping = await this.#requireMapping(session.trainingId);

    const attendances = await this.#repo.listAttendancesBySession(sid);
    const split = splitEligibility(attendances, session);

    if (split.eligible.length === 0) {
      return {
        sessionId: sid,
        mapping,
        completionDate: session.date,
        included: [],
        excluded: split.excluded,
        counts: {
          total: attendances.length,
          included: 0,
          excluded: split.excluded.length,
          overwrites: 0,
        },
        overwriteRequiresReason: false,
        atomicBatchReady: false,
      };
    }

    const plan = buildWritePlan(
      { sessionId: sid, trainingId: session.trainingId, date: session.date },
      mapping,
      split.eligible.map((attendance) => ({
        attendanceId: attendance.attendanceId,
        employeeId: String(attendance.workerNumber),
      })),
    );

    let results = await this.#gateway.inspect(plan, { overwriteReason });
    const faltaSoloMotivo =
      !overwriteReason.trim() &&
      results.some((result) => result.status === "OVERWRITE_REASON_REQUIRED") &&
      results.every(
        (result) =>
          !isConflict(result.status) ||
          result.status === "OVERWRITE_REASON_REQUIRED" ||
          result.status === "ATOMIC_BATCH_ABORTED",
      );
    if (faltaSoloMotivo) {
      results = await this.#gateway.inspect(plan, { overwriteReason: "(motivo por capturar)" });
    }

    const included = results.filter((result) => !isConflict(result.status));
    const blocked: ExcludedEntry[] = results
      .filter((result) => isConflict(result.status))
      .map((result) => ({
        attendanceId: result.attendanceId,
        employeeId: result.employeeId,
        reasons: [result.status],
      }));

    const overwrites = results.filter(
      (result) =>
        result.status === "READY_OVERWRITE" || result.status === "OVERWRITE_REASON_REQUIRED",
    ).length;

    return {
      sessionId: sid,
      mapping,
      completionDate: plan.completionDate,
      included,
      excluded: [...split.excluded, ...blocked],
      counts: {
        total: attendances.length,
        included: included.length,
        excluded: split.excluded.length + blocked.length,
        overwrites,
      },
      overwriteRequiresReason:
        faltaSoloMotivo || results.some((result) => result.status === "OVERWRITE_REASON_REQUIRED"),
      atomicBatchReady: !faltaSoloMotivo && blocked.length === 0 && included.length > 0,
    };
  }

  async release(input: ReleaseInput, identity: ActorIdentity): Promise<ReleaseOutcome> {
    const sessionId = assertIdentifier(input.sessionId, "sessionId");
    const requestId = assertIdentifier(input.requestId, "requestId");
    const overwriteReason = this.#normalizeReason(input.overwriteReason);

    this.#assertRole(identity);

    return this.#repo.withLock(`release:session:${sessionId}`, async () => {
      const sessionBatches = await this.#loadSessionBatches(sessionId);

      const own = sessionBatches.filter((batch) => batch.requestId === requestId);
      if (own.length > 1) {
        throw new ReleaseConflictError("El requestId tiene más de un lote de liberación");
      }

      let batch = own[0] ?? null;
      let plan: WritePlan;
      let results: readonly MatrixWriteResult[];

      if (batch) {
        plan = validateWritePlan(restorePlan(this.#secret, batch));

        if (isTerminalPhase(batch.phase)) {
          return this.#replayTerminal(batch, plan, identity);
        }
      } else {
        const open = sessionBatches.filter((candidate) => !isTerminalPhase(candidate.phase));
        if (open.length > 0) {
          throw new ReleaseConflictError(
            "Existe un lote de liberación pendiente; reintente con su requestId original",
          );
        }

        const created = await this.#createBatch(sessionId, requestId, overwriteReason, identity);
        batch = created.batch;
        plan = created.plan;

        if (created.conflicts.length > 0) {
          return this.#recordConflict(batch, plan, created.conflicts, identity);
        }
      }

      if (batch.phase === "PENDIENTE") {
        await this.#revalidateDomain(plan, { allowReleased: false, allowFinalized: false });

        const context = buildContext(this.#secret, batch, plan);
        const written = await this.#gateway.write(plan, {
          context,
          actorId: identity.actor,
          requestId,
          overwriteReason: batch.overwriteReason,
        });

        if (written.some((result) => isConflict(result.status))) {
          return this.#recordConflict(batch, plan, written, identity);
        }

        batch = await this.#patch(batch, {
          results: canonicalResultsJson(written),
          phase: "MATRIZ_APLICADA",
          status: "PENDIENTE",
          totalWritten: written.filter((result) => isEffective(result.status)).length,
        });
      }

      if (batch.phase === "MATRIZ_APLICADA") {
        results = this.#restoreResults(batch, plan);
        await this.#revalidateDomain(plan, { allowReleased: true, allowFinalized: false });
        await this.#gateway.verifyApplied(plan, buildContext(this.#secret, batch, plan), results);
        await this.#applyDomainEffects(batch, plan, results, identity);

        batch = await this.#patch(batch, { phase: "DOMINIO_APLICADO", status: "PENDIENTE" });
      }

      if (batch.phase === "DOMINIO_APLICADO") {
        results = this.#restoreResults(batch, plan);
        await this.#revalidateDomain(plan, { allowReleased: true, allowFinalized: true });
        await this.#gateway.verifyApplied(plan, buildContext(this.#secret, batch, plan), results);
        batch = await this.#finalize(batch, plan, results, identity);
      }

      if (batch.phase !== "COMPLETADO") {
        throw new ReleaseConflictError("La liberación no alcanzó un estado terminal");
      }

      results = this.#restoreResults(batch, plan);
      return this.#outcome(batch, results, [], false);
    });
  }

  async getBatch(batchId: string): Promise<ReleaseBatch | null> {
    const batch = await this.#repo.findBatchById(assertIdentifier(batchId, "batchId"));
    if (!batch) return null;
    return assertBatchIntegrity(this.#secret, batch);
  }

  async listBatchesBySession(sessionId: string): Promise<readonly ReleaseBatch[]> {
    return this.#loadSessionBatches(assertIdentifier(sessionId, "sessionId"));
  }

  async #createBatch(
    sessionId: string,
    requestId: string,
    overwriteReason: string,
    identity: ActorIdentity,
  ): Promise<{ batch: ReleaseBatch; plan: WritePlan; conflicts: readonly MatrixWriteResult[] }> {
    const session = await this.#requireSession(sessionId);

    if (
      !RELEASABLE_SESSION_STATUSES.includes(
        session.status as (typeof RELEASABLE_SESSION_STATUSES)[number],
      )
    ) {
      throw new InvalidReleaseStateError("La sesión no está lista para liberar");
    }
    if (!session.authorized) {
      throw new ReleaseForbiddenError("La sesión no ha sido autorizada");
    }

    const mapping = await this.#requireMapping(session.trainingId);
    const attendances = await this.#repo.listAttendancesBySession(sessionId);
    const split = splitEligibility(attendances, session);

    if (split.eligible.length === 0) {
      throw new ReleaseConflictError("No hay registros elegibles para liberar");
    }

    const plan = buildWritePlan(
      { sessionId, trainingId: session.trainingId, date: session.date },
      mapping,
      split.eligible.map((attendance) => ({
        attendanceId: attendance.attendanceId,
        employeeId: String(attendance.workerNumber),
      })),
    );

    const preflight = await this.#gateway.inspect(plan, { overwriteReason });

    const envelope = planEnvelope(plan);
    const nowIso = this.#clock.now().toISOString();

    const unsigned = {
      batchId: randomUUID(),
      sessionId,
      requestId,
      mappingVersion: plan.mapping.mappingVersion,
      planHash: envelope.hash,
      plan: envelope.serialized,
      results: "[]",
      phase: "PENDIENTE" as ReleasePhase,
      status: "PENDIENTE" as const,
      sessionOutcome: null,
      overwriteReason,
      totalCandidates: plan.entries.length,
      totalWritten: 0,
      totalConflicts: 0,
      createdBy: identity.actor,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
      contractVersion: CONTRACT_VERSION,
    };

    const batch: ReleaseBatch = { ...unsigned, journalMac: signBatch(this.#secret, unsigned) };

    const stored = assertBatchIntegrity(this.#secret, await this.#repo.insertBatch(batch));

    await this.#audit(identity, {
      entityType: "ReleaseBatch",
      entityId: stored.batchId,
      action: "RELEASE_BATCH_CREATED",
      previousState: "LISTA_PARA_LIBERAR",
      newState: "PENDIENTE",
      sessionId,
      requestId,
      reason: `${plan.entries.length} candidatos`,
    });

    return {
      batch: stored,
      plan,
      conflicts: preflight.some((result) => isConflict(result.status)) ? preflight : [],
    };
  }

  async #patch(
    batch: ReleaseBatch,
    patch: Partial<Omit<ReleaseBatch, "journalMac">>,
  ): Promise<ReleaseBatch> {
    const nowIso = this.#clock.now().toISOString();
    const resealed = reseal(this.#secret, batch, patch, nowIso);
    const stored = await this.#repo.replaceBatch(resealed);
    return assertBatchIntegrity(this.#secret, stored);
  }

  async #recordConflict(
    batch: ReleaseBatch,
    plan: WritePlan,
    results: readonly MatrixWriteResult[],
    identity: ActorIdentity,
  ): Promise<ReleaseOutcome> {
    validateResults(plan, results);

    const conflicts = results.filter((result) => isConflict(result.status));
    const nowIso = this.#clock.now().toISOString();

    const updated = await this.#patch(batch, {
      results: canonicalResultsJson(results),
      phase: "CONFLICTO",
      status: "CONFLICTO",
      totalConflicts: conflicts.length,
      completedAt: nowIso,
    });

    await this.#audit(identity, {
      entityType: "ReleaseBatch",
      entityId: updated.batchId,
      action: "RELEASE_BLOCKED",
      previousState: "PENDIENTE",
      newState: "CONFLICTO",
      sessionId: updated.sessionId,
      requestId: updated.requestId,
      reason: conflicts.map((result) => result.status).join(","),
    });

    return this.#outcome(updated, results, [], false);
  }

  async #replayTerminal(
    batch: ReleaseBatch,
    plan: WritePlan,
    identity: ActorIdentity,
  ): Promise<ReleaseOutcome> {
    const results = this.#restoreResults(batch, plan);

    if (batch.phase === "CONFLICTO") {
      await this.#audit(identity, {
        entityType: "ReleaseBatch",
        entityId: batch.batchId,
        action: "RELEASE_BLOCKED",
        previousState: "PENDIENTE",
        newState: "CONFLICTO",
        sessionId: batch.sessionId,
        requestId: batch.requestId,
        reason: "reintento sobre lote en conflicto",
      });
      return this.#outcome(batch, results, [], true);
    }

    await this.#gateway.verifyApplied(plan, buildContext(this.#secret, batch, plan), results);
    await this.#applyDomainEffects(batch, plan, results, identity);

    return this.#outcome(batch, results, [], true);
  }

  async #applyDomainEffects(
    batch: ReleaseBatch,
    plan: WritePlan,
    results: readonly MatrixWriteResult[],
    identity: ActorIdentity,
  ): Promise<void> {
    const effective = results.filter((result) => isEffective(result.status));
    if (effective.length === 0) return;

    const attendances = await this.#repo.listAttendancesBySession(batch.sessionId);
    const byId = new Map(attendances.map((attendance) => [attendance.attendanceId, attendance]));
    const nowIso = this.#clock.now().toISOString();

    const updates: { attendanceId: string; updates: Partial<AttendanceRecord> }[] = [];
    const effects: ReleaseEffect[] = [];
    const context = buildContext(this.#secret, batch, plan);

    for (const result of effective) {
      const attendance = byId.get(result.attendanceId);
      if (!attendance || String(attendance.workerNumber) !== result.employeeId) {
        throw new ReleaseConflictError("Una asistencia del journal ya no coincide con el dominio");
      }

      if (!attendance.released || attendance.status !== "LIBERADA") {
        updates.push({
          attendanceId: attendance.attendanceId,
          updates: { released: true, status: "LIBERADA", releasedAt: nowIso, updatedAt: nowIso },
        });
      }

      const existing = await this.#repo.findEffectByIdempotencyKey(result.idempotencyKey);
      if (existing) {
        if (
          existing.batchId !== batch.batchId ||
          existing.effectiveDate !== result.completionDate
        ) {
          throw new ReleaseConflictError("Una liberación efectiva no coincide con su lote durable");
        }
        continue;
      }

      const entry = plan.entries.find(
        (candidate) => candidate.idempotencyKey === result.idempotencyKey,
      );
      if (!entry) {
        throw new ReleaseConflictError("Un efecto no corresponde a ninguna entrada del plan");
      }

      effects.push({
        releaseId: randomUUID(),
        idempotencyKey: result.idempotencyKey,
        batchId: batch.batchId,
        sessionId: batch.sessionId,
        requestId: batch.requestId,
        attendanceId: result.attendanceId,
        employeeId: result.employeeId,
        trainingId: result.trainingId,
        effectiveDate: result.completionDate,
        mappingVersion: result.mappingVersion,
        result: result.status,
        marker: markerFor(this.#secret, plan, context, entry),
        xlsbAckStatus: "PENDIENTE_ACUSE",
        createdBy: batch.createdBy,
        createdAt: nowIso,
      });
    }

    if (updates.length > 0) await this.#repo.updateManyAttendances(updates);
    if (effects.length > 0) await this.#repo.insertEffects(effects);

    for (const result of effective) {
      await this.#audit(identity, {
        entityType: "Attendance",
        entityId: result.attendanceId,
        action: "MATRIX_RELEASED",
        previousState: "ELEGIBLE",
        newState: "LIBERADA",
        sessionId: batch.sessionId,
        requestId: batch.requestId,
        reason:
          result.status === "OVERWRITTEN"
            ? `sobrescrita desde ${result.previousDate ?? ""}`
            : result.status,
      });
    }
  }

  async #finalize(
    batch: ReleaseBatch,
    plan: WritePlan,
    results: readonly MatrixWriteResult[],
    identity: ActorIdentity,
  ): Promise<ReleaseBatch> {
    const attendances = await this.#repo.listAttendancesBySession(batch.sessionId);

    const outcome: SessionReleaseOutcome =
      attendances.length > 0 && attendances.every((attendance) => attendance.released)
        ? "LIBERADA_TOTAL"
        : "LIBERADA_PARCIAL";

    const session = await this.#requireSession(batch.sessionId);
    if (session.status !== outcome) {
      if (
        !RELEASABLE_SESSION_STATUSES.includes(
          session.status as (typeof RELEASABLE_SESSION_STATUSES)[number],
        )
      ) {
        throw new InvalidReleaseStateError("La sesión no permite completar la liberación");
      }

      await this.#audit(identity, {
        entityType: "Session",
        entityId: batch.sessionId,
        action: "SESSION_STATE_CHANGED",
        previousState: session.status,
        newState: outcome,
        sessionId: batch.sessionId,
        requestId: batch.requestId,
      });

      await this.#repo.updateSessionStatus(batch.sessionId, outcome);

      const confirmed = await this.#requireSession(batch.sessionId);
      if (confirmed.status !== outcome) {
        throw new ReleaseConflictError("No fue posible confirmar el estado de la sesión");
      }
    }

    const effectiveWrites = results.filter((result) => isEffective(result.status)).length;
    const nowIso = this.#clock.now().toISOString();

    const updated = await this.#patch(batch, {
      phase: "COMPLETADO",
      status: "COMPLETADO",
      sessionOutcome: outcome,
      totalWritten: effectiveWrites,
      completedAt: nowIso,
    });

    await this.#audit(identity, {
      entityType: "ReleaseBatch",
      entityId: updated.batchId,
      action: "RELEASE_COMPLETED",
      previousState: "PENDIENTE",
      newState: outcome,
      sessionId: updated.sessionId,
      requestId: updated.requestId,
      reason: `${effectiveWrites} efectos`,
    });

    void plan;
    return updated;
  }

  async #revalidateDomain(
    plan: WritePlan,
    options: { allowReleased: boolean; allowFinalized: boolean },
  ): Promise<SessionRecord> {
    const session = await this.#requireSession(plan.session.sessionId);

    const allowed: string[] = [...RELEASABLE_SESSION_STATUSES];
    if (options.allowFinalized) allowed.push("LIBERADA_TOTAL");

    if (
      session.trainingId !== plan.session.trainingId ||
      session.date !== plan.session.date ||
      !allowed.includes(session.status) ||
      !session.authorized
    ) {
      throw new InvalidReleaseStateError(
        "La sesión cambió o dejó de estar autorizada para liberar",
      );
    }

    const mapping = await this.#requireMapping(session.trainingId);
    if (mapping.mappingVersion !== plan.mapping.mappingVersion) {
      throw new ReleaseConflictError("El mapeo activo cambió antes de confirmar la liberación");
    }

    const attendances = await this.#repo.listAttendancesBySession(plan.session.sessionId);
    const byId = new Map<string, AttendanceRecord>();
    for (const attendance of attendances) {
      if (byId.has(attendance.attendanceId)) {
        throw new ReleaseConflictError("La sesión contiene asistencias duplicadas");
      }
      byId.set(attendance.attendanceId, attendance);
    }

    const planned = new Set<string>();
    for (const entry of plan.entries) {
      const attendance = byId.get(entry.attendanceId);
      if (
        !attendance ||
        attendance.sessionId !== plan.session.sessionId ||
        String(attendance.workerNumber) !== entry.employeeId
      ) {
        throw new ReleaseConflictError("Una asistencia del lote ya no coincide con la sesión");
      }

      const reasons = blockingReasons(attendance, session).filter(
        (reason) => reason !== "YA_LIBERADO_PREVIAMENTE",
      );
      if (reasons.length > 0 || (!options.allowReleased && attendance.released)) {
        throw new ReleaseConflictError("Una asistencia del lote dejó de ser elegible");
      }
      planned.add(entry.attendanceId);
    }

    for (const attendance of attendances) {
      if (planned.has(attendance.attendanceId) || attendance.released) continue;
      const reasons = blockingReasons(attendance, session).filter(
        (reason) => reason !== "YA_LIBERADO_PREVIAMENTE",
      );
      if (reasons.length === 0) {
        throw new ReleaseConflictError(
          "La elegibilidad de la sesión cambió después de congelar el lote",
        );
      }
    }

    return session;
  }

  async #loadSessionBatches(sessionId: string): Promise<readonly ReleaseBatch[]> {
    const batches = await this.#repo.listBatchesBySession(sessionId);
    const seen = new Set<string>();

    for (const batch of batches) {
      if (!batch.batchId || seen.has(batch.batchId)) {
        throw new ReleaseConflictError("La sesión contiene lotes de liberación duplicados");
      }
      seen.add(batch.batchId);
      assertBatchIntegrity(this.#secret, batch);
    }

    return batches;
  }

  #restoreResults(batch: ReleaseBatch, plan: WritePlan): readonly MatrixWriteResult[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(batch.results || "[]");
    } catch {
      throw new ReleaseConflictError("Los resultados de liberación están corruptos");
    }
    if (!Array.isArray(parsed)) {
      throw new ReleaseConflictError("Los resultados de liberación están corruptos");
    }
    return validateResults(plan, parsed as MatrixWriteResult[]);
  }

  async existingDates(sessionId: string): Promise<readonly ExistingDate[]> {
    const sid = assertIdentifier(sessionId, "sessionId");
    const session = await this.#requireSession(sid);
    const attendances = await this.#repo.listAttendancesBySession(sid);
    const vistos = new Set<string>();
    const fechas: ExistingDate[] = [];
    for (const attendance of attendances) {
      const employeeId = String(attendance.workerNumber);
      if (vistos.has(employeeId)) continue;
      vistos.add(employeeId);
      const actual = await this.#gateway.currentRecord(employeeId, session.trainingId);
      if (!actual?.completionDate || actual.completionDate === session.date) continue;
      fechas.push({
        employeeId,
        previousDate: actual.completionDate,
        provenance: actual.provenance,
        newer: actual.completionDate > session.date,
      });
    }
    return fechas;
  }

  async #requireSession(sessionId: string): Promise<SessionRecord> {
    const session = await this.#repo.getSessionById(sessionId);
    if (!session) {
      throw new InvalidReleaseStateError("La sesión no existe");
    }
    return session;
  }

  async #requireMapping(trainingId: string): Promise<MatrixMapping> {
    const mappings = await this.#repo.findActiveMapping(trainingId);
    if (mappings.length === 0) {
      throw new ReleaseConflictError("No existe un mapeo vigente para la capacitación");
    }
    if (mappings.length > 1) {
      throw new ReleaseConflictError("La capacitación no tiene exactamente un mapeo vigente");
    }
    return mappings[0] as MatrixMapping;
  }

  #normalizeReason(value: string | undefined): string {
    const text = String(value ?? "").trim();
    if (text.length > MAX_OVERWRITE_REASON_LENGTH) {
      throw new ReleaseInputError(
        `El motivo de sobrescritura excede ${MAX_OVERWRITE_REASON_LENGTH} caracteres`,
      );
    }
    return text;
  }

  #assertRole(identity: ActorIdentity): void {
    if (identity.role !== "CAPACITACION" && identity.role !== "ADMINISTRADOR") {
      throw new ReleaseForbiddenError("El rol no puede liberar a la matriz");
    }
  }

  async #audit(
    identity: ActorIdentity,
    event: {
      entityType: string;
      entityId: string;
      action: string;
      previousState?: string;
      newState?: string;
      sessionId: string;
      requestId: string;
      reason?: string;
    },
  ): Promise<void> {
    const existing = await this.#repo.findAuditEvent({
      entityId: event.entityId,
      action: event.action,
      requestId: event.requestId,
    });
    if (existing) return;

    await this.#repo.recordAudit({
      actor: identity.actor,
      role: identity.role,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      ...(event.previousState === undefined ? {} : { previousState: event.previousState }),
      ...(event.newState === undefined ? {} : { newState: event.newState }),
      ...(event.reason === undefined ? {} : { reason: event.reason }),
      sessionId: event.sessionId,
      requestId: event.requestId,
      provenance: "PLATAFORMA",
      contractVersion: CONTRACT_VERSION,
    });
  }

  #outcome(
    batch: ReleaseBatch,
    results: readonly MatrixWriteResult[],
    excluded: readonly ExcludedEntry[],
    repeated: boolean,
  ): ReleaseOutcome {
    return {
      batchId: batch.batchId,
      requestId: batch.requestId,
      sessionId: batch.sessionId,
      phase: batch.phase,
      status: batch.status,
      sessionOutcome: batch.sessionOutcome,
      repeated,
      effectiveWrites: results.filter((result) => isEffective(result.status)).length,
      results,
      excluded,
    };
  }
}

export function splitEligibility(
  attendances: readonly AttendanceRecord[],
  session: SessionRecord,
): EligibilitySplit {
  const eligible: AttendanceRecord[] = [];
  const excluded: ExcludedEntry[] = [];

  for (const attendance of attendances) {
    const reasons = blockingReasons(attendance, session);
    if (reasons.length === 0) {
      eligible.push(attendance);
    } else {
      excluded.push({
        attendanceId: attendance.attendanceId,
        employeeId: String(attendance.workerNumber),
        reasons,
      });
    }
  }

  return { eligible, excluded };
}
