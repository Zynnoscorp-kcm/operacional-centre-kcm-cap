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
  readonly overwriteReason?: string;
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

    if (!existing || existing.status !== "VIGENTE" || !existing.completionDate) {
      return { ...base, status: "READY" };
    }

    if (options.context && this.#isOwnEffect(plan, entry, existing, options.context)) {
      return { ...base, status: "RECOVERED" };
    }

    if (existing.completionDate === entry.completionDate) {
      return plan.mapping.overwritePolicy === "OVERWRITE_WITH_HISTORY"
        ? { ...base, status: "ALREADY_APPLIED" }
        : { ...base, status: "EXISTING_VALUE_CONFLICT" };
    }

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

  async write(plan: WritePlan, options: ApplyOptions): Promise<MatrixWriteResult[]> {
    const inspected = await this.inspect(plan, options);

    if (inspected.some((result) => isConflict(result.status))) {
      return inspected;
    }

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

  currentRecord(employeeId: string, trainingId: string): Promise<HcRecord | null> {
    return this.#matrix.getHcRecord(parseWorkerNumber(employeeId), trainingId);
  }

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

export function applyAtomicity(results: readonly MatrixWriteResult[]): MatrixWriteResult[] {
  const blocked = results.some((result) => isConflict(result.status));
  if (!blocked) return [...results];

  return results.map((result) =>
    isReady(result.status) ? { ...result, status: "ATOMIC_BATCH_ABORTED" } : result,
  );
}
