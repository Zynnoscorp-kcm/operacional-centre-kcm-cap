/**
 * Gateway de escritura a la réplica consultable de la matriz.
 *
 * Aplica fechas validadas sobre registros con procedencia. Aquí vive la
 * sobrescritura gobernada.
 *
 * Tres reglas gobiernan todo lo que sigue:
 *
 * 1. Preflight antes de cualquier efecto. `inspect` no escribe nada; sólo
 *    clasifica. `write` vuelve a inspeccionar y aborta si algo cambió.
 * 2. Atomicidad por lote. Un solo conflicto convierte las entradas listas
 *    en `ATOMIC_BATCH_ABORTED` y el lote no escribe nada. Media liberación es
 *    peor que ninguna: deja la sesión en un estado que nadie declaró.
 * 3. Sobrescribir sí, borrar no. El historial se arma y se persiste antes
 *    que el valor nuevo, con actor, motivo, momento y procedencia anterior.
 */

import { randomUUID } from "node:crypto";

import { parseWorkerNumber } from "../comun/numero-trabajador.ts";
import type { HcRecord } from "../importacion-matriz/tipos.ts";
import type { MatrixWriteOperation, MatrixWritePort } from "../../ports/liberacion.port.ts";
import type { DurableContext } from "./journal.ts";
import { markerFor } from "./journal.ts";
import { ReleaseConflictError } from "./errores.ts";
import { assertMapping, validateResults } from "./plan-de-escritura.ts";
import {
  isConflict,
  isEffective,
  isReady,
  type MatrixWriteResult,
  type PlanEntry,
  type WritePlan,
} from "./tipos.ts";

export interface MatrixGatewayDeps {
  readonly matrix: MatrixWritePort;
  readonly secret: string;
  readonly clock: { now(): Date };
}

export interface InspectOptions {
  /** Motivo capturado para la sobrescritura. Vacío significa "no autorizada". */
  readonly overwriteReason?: string;
  /** Contexto durable del lote; ausente durante la vista previa. */
  readonly context?: DurableContext;
}

export interface ApplyOptions extends InspectOptions {
  readonly context: DurableContext;
  readonly actorId: string;
  readonly requestId: string;
}

export class MatrixGateway {
  readonly #matrix: MatrixWritePort;
  readonly #secret: string;
  readonly #clock: { now(): Date };

  constructor(deps: MatrixGatewayDeps) {
    this.#matrix = deps.matrix;
    this.#secret = deps.secret;
    this.#clock = deps.clock;
  }

  // -------------------------------------------------------------------------
  // Preflight
  // -------------------------------------------------------------------------

  /**
   * Clasifica cada entrada del plan contra el destino sin tocarlo.
   *
   * El resultado ya viene con la regla de atomicidad aplicada: si hay algún
   * conflicto, ninguna entrada queda en estado listo.
   */
  async inspect(plan: WritePlan, options: InspectOptions = {}): Promise<MatrixWriteResult[]> {
    assertMapping(plan.mapping);

    const results: MatrixWriteResult[] = [];
    for (const entry of plan.entries) {
      results.push(await this.#classify(plan, entry, options));
    }

    return applyAtomicity(results);
  }

  async #classify(
    plan: WritePlan,
    entry: PlanEntry,
    options: InspectOptions,
  ): Promise<MatrixWriteResult> {
    const base = {
      attendanceId: entry.attendanceId,
      employeeId: entry.employeeId,
      trainingId: entry.trainingId,
      mappingVersion: entry.mappingVersion,
      idempotencyKey: entry.idempotencyKey,
      completionDate: entry.completionDate,
    };

    const workerNumber = parseWorkerNumber(entry.employeeId);

    if (!(await this.#matrix.workerExists(workerNumber))) {
      return { ...base, status: "EMPLOYEE_NOT_FOUND" };
    }
    if (!(await this.#matrix.trainingExists(entry.trainingId))) {
      return { ...base, status: "COURSE_NOT_FOUND" };
    }

    const existing = await this.#matrix.getHcRecord(workerNumber, entry.trainingId);

    // Celda libre: el caso normal.
    if (!existing || existing.status !== "VIGENTE" || !existing.completionDate) {
      return { ...base, status: "READY" };
    }

    // ¿La escribió este mismo lote? Es lo que convierte un reintento en
    // recuperación y no en un segundo efecto.
    if (options.context && this.#isOwnEffect(plan, entry, existing, options.context)) {
      return { ...base, status: "RECOVERED" };
    }

    // Mismo valor ya presente: no hay nada que escribir ni que historiar. El
    // esquema además rechaza un historial cuya fecha anterior iguale la nueva.
    if (existing.completionDate === entry.completionDate) {
      return plan.mapping.overwritePolicy === "OVERWRITE_WITH_HISTORY"
        ? { ...base, status: "ALREADY_APPLIED" }
        : { ...base, status: "EXISTING_VALUE_CONFLICT" };
    }

    // La matriz ya trae una fecha más reciente que la que se libera: nunca se
    // reemplaza lo nuevo por lo viejo, ni con motivo. Las fechas son ISO
    // `YYYY-MM-DD`, así que el orden de texto es el orden cronológico.
    if (existing.completionDate > entry.completionDate) {
      return {
        ...base,
        status: "NEWER_DATE_PRESENT",
        previousDate: existing.completionDate,
        previousProvenance: existing.provenance,
      };
    }

    // Hay un valor distinto. Aquí decide la política declarada del destino.
    if (plan.mapping.overwritePolicy !== "OVERWRITE_WITH_HISTORY") {
      return {
        ...base,
        status: "OVERWRITE_NOT_ALLOWED",
        previousDate: existing.completionDate,
        previousProvenance: existing.provenance,
      };
    }

    if (!String(options.overwriteReason ?? "").trim()) {
      return {
        ...base,
        status: "OVERWRITE_REASON_REQUIRED",
        previousDate: existing.completionDate,
        previousProvenance: existing.provenance,
      };
    }

    return {
      ...base,
      status: "READY_OVERWRITE",
      previousDate: existing.completionDate,
      previousProvenance: existing.provenance,
    };
  }

  #isOwnEffect(
    plan: WritePlan,
    entry: PlanEntry,
    existing: HcRecord,
    context: DurableContext,
  ): boolean {
    if (existing.batchId !== context.batchId) return false;
    if (existing.completionDate !== entry.completionDate) return false;
    if (existing.mappingVersion !== entry.mappingVersion) return false;
    if (existing.sessionId !== plan.session.sessionId) return false;
    const expected = markerFor(this.#secret, plan, context, entry);
    return String(existing.marker ?? "") === expected;
  }

  // -------------------------------------------------------------------------
  // Efecto
  // -------------------------------------------------------------------------

  /**
   * Aplica el lote. Vuelve a inspeccionar antes de escribir: entre el
   * preflight y aquí pudo entrar una importación que ocupara la celda.
   */
  async write(plan: WritePlan, options: ApplyOptions): Promise<MatrixWriteResult[]> {
    const inspected = await this.inspect(plan, options);

    if (inspected.some((result) => isConflict(result.status))) {
      return inspected;
    }

    // Nada que escribir: el lote entero ya estaba aplicado.
    if (!inspected.some((result) => isReady(result.status))) {
      return inspected;
    }

    const nowIso = this.#clock.now().toISOString();
    const operations: MatrixWriteOperation[] = [];
    const applied: MatrixWriteResult[] = [];

    for (const result of inspected) {
      if (!isReady(result.status)) {
        applied.push(result);
        continue;
      }

      const entry = plan.entries.find(
        (candidate) => candidate.idempotencyKey === result.idempotencyKey,
      );
      if (!entry) {
        throw new ReleaseConflictError("Un resultado no corresponde a ninguna entrada del plan");
      }

      const workerNumber = parseWorkerNumber(entry.employeeId);
      const existing = await this.#matrix.getHcRecord(workerNumber, entry.trainingId);
      const marker = markerFor(this.#secret, plan, options.context, entry);
      // `operacion.historial_capacitacion.registro_id` e `historial_id` son UUID en PostgreSQL.
      // El prefijo que se usaba en memoria era válido allí, pero no puede
      // cruzar la frontera del adaptador Supabase.
      const recordId = existing?.recordId ?? randomUUID();

      const record: HcRecord = {
        recordId,
        idempotencyKey: entry.idempotencyKey,
        workerNumber,
        trainingId: entry.trainingId,
        completionDate: entry.completionDate,
        provenance: "SESSION_RELEASE",
        status: "VIGENTE",
        sessionId: plan.session.sessionId,
        releaseId: options.context.batchId,
        mappingVersion: entry.mappingVersion,
        batchId: options.context.batchId,
        marker,
        importId: null,
        requestId: options.requestId,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
        version: (existing?.version ?? 0) + 1,
      };

      // El historial sólo existe cuando de verdad se sustituye un valor. La
      // entrada se arma aquí y el adaptador la persiste antes que el registro.
      const history =
        result.status === "READY_OVERWRITE" && existing?.completionDate
          ? {
              historyId: randomUUID(),
              recordId,
              workerNumber,
              trainingId: entry.trainingId,
              changeType: "SOBRESCRITA" as const,
              previousCompletionDate: existing.completionDate,
              completionDate: entry.completionDate,
              previousProvenance: existing.provenance,
              provenance: "SESSION_RELEASE" as const,
              actorId: options.actorId,
              reason: String(options.overwriteReason ?? "").trim(),
              requestId: options.requestId,
              batchId: options.context.batchId,
              sessionId: plan.session.sessionId,
              recordedAt: nowIso,
            }
          : null;

      operations.push({
        idempotencyKey: entry.idempotencyKey,
        record,
        history,
        isUpdate: Boolean(existing),
        attendanceId: entry.attendanceId,
        result: result.status === "READY_OVERWRITE" ? "OVERWRITTEN" : "WRITTEN",
      });

      applied.push({
        ...result,
        status: result.status === "READY_OVERWRITE" ? "OVERWRITTEN" : "WRITTEN",
      });
    }

    await this.#matrix.applyWrites(operations);

    return applied;
  }

  // -------------------------------------------------------------------------
  // Verificación
  // -------------------------------------------------------------------------

  /**
   * Confirma que el destino sostiene los efectos que el journal afirma.
   *
   * Se llama antes de avanzar de fase y en cada reanudación. Sin ella, un
   * journal que dijera "matriz aplicada" bastaría para dar por escrita una
   * fecha que nunca se escribió.
   */
  async verifyApplied(
    plan: WritePlan,
    context: DurableContext,
    expected: readonly MatrixWriteResult[],
  ): Promise<readonly MatrixWriteResult[]> {
    validateResults(plan, expected);

    for (const result of expected) {
      if (!isEffective(result.status)) {
        throw new ReleaseConflictError("El journal no contiene un lote de matriz efectivo");
      }
    }

    const expectedByKey = new Map(expected.map((result) => [result.idempotencyKey, result]));

    for (const entry of plan.entries) {
      const declared = expectedByKey.get(entry.idempotencyKey);
      if (!declared) {
        throw new ReleaseConflictError("La matriz no confirma los efectos autenticados del lote");
      }

      const workerNumber = parseWorkerNumber(entry.employeeId);
      const actual = await this.#matrix.getHcRecord(workerNumber, entry.trainingId);

      if (
        !actual ||
        actual.status !== "VIGENTE" ||
        actual.completionDate !== entry.completionDate ||
        actual.mappingVersion !== entry.mappingVersion
      ) {
        throw new ReleaseConflictError("La matriz no confirma los efectos autenticados del lote");
      }

      // `ALREADY_APPLIED` reconoce un valor que este lote no escribió: exigirle
      // el marcador propio lo declararía falsamente ajeno.
      if (
        declared.status !== "ALREADY_APPLIED" &&
        !this.#isOwnEffect(plan, entry, actual, context)
      ) {
        throw new ReleaseConflictError("La matriz no confirma los efectos autenticados del lote");
      }
    }

    return expected;
  }
}

// ---------------------------------------------------------------------------
// Atomicidad
// ---------------------------------------------------------------------------

/**
 * Un conflicto en cualquier entrada aborta el lote entero. Las entradas que
 * iban a escribirse conservan su rastro como `ATOMIC_BATCH_ABORTED`, para que
 * quien revise distinga "esta fila falló" de "esta fila no llegó a intentarse".
 */
export function applyAtomicity(results: readonly MatrixWriteResult[]): MatrixWriteResult[] {
  const blocked = results.some((result) => isConflict(result.status));
  if (!blocked) return [...results];

  return results.map((result) =>
    isReady(result.status) ? { ...result, status: "ATOMIC_BATCH_ABORTED" } : result,
  );
}
