/**
 * Autenticidad e integridad del journal de liberación.
 *
 * El plan se
 * serializa de forma canónica, su SHA-256 queda fijado en la fila, y la fila
 * entera se firma con HMAC. Reanudar un lote exige que ambas pruebas pasen.
 *
 * Por qué tanto aparato para un lote de cuarenta filas: la reanudación lee del
 * almacén el plan que va a aplicar. Sin firma, quien pueda escribir esa fila
 * decide qué fecha se escribe en el historial de un trabajador, y el efecto
 * saldría con toda la apariencia de legítimo.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { ReleaseIntegrityError } from "./errores.ts";
import type { MatrixWriteResult, PlanEntry, ReleaseBatch, WritePlan } from "./tipos.ts";

const MARKER_PREFIX = "KCM_RELEASE_V2";
const PURPOSE_JOURNAL = "RELEASE_JOURNAL_V1";
const PURPOSE_MARKER = "MATRIX_MARKER_V2";
const HEX64 = /^[a-f0-9]{64}$/;

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacHex(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\n${value}`, "utf8").digest("hex");
}

/**
 * Comparación en tiempo constante. `timingSafeEqual` exige longitudes iguales,
 * así que se normaliza por hash: comparar los digests preserva la propiedad y
 * evita filtrar la longitud del valor esperado.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash("sha256")
    .update(String(left ?? ""), "utf8")
    .digest();
  const b = createHash("sha256")
    .update(String(right ?? ""), "utf8")
    .digest();
  return timingSafeEqual(a, b);
}

export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Serialización canónica
// ---------------------------------------------------------------------------

/**
 * El orden de las claves se escribe a mano, no se hereda del objeto recibido.
 * Un `JSON.stringify` sobre el objeto tal como llegó produciría hashes
 * distintos para planes idénticos según cómo se hubiera construido el objeto,
 * y la reanudación fallaría sin que nada estuviera mal.
 */
export function canonicalPlanJson(plan: WritePlan): string {
  return JSON.stringify({
    session: {
      sessionId: plan.session.sessionId,
      trainingId: plan.session.trainingId,
      date: plan.session.date,
    },
    mapping: {
      trainingId: plan.mapping.trainingId,
      destinationName: plan.mapping.destinationName,
      destinationSheet: plan.mapping.destinationSheet,
      destinationColumn: plan.mapping.destinationColumn,
      destinationHeader: plan.mapping.destinationHeader,
      headerRow: plan.mapping.headerRow,
      mappingVersion: plan.mapping.mappingVersion,
      overwritePolicy: plan.mapping.overwritePolicy,
      // Se congela junto con el resto. Que el mapeo estuviera vigente al armar
      // el plan es parte de lo que el hash certifica; que lo siga estando es
      // cosa de la revalidación, no del journal.
      active: plan.mapping.active,
    },
    completionDate: plan.completionDate,
    entries: plan.entries.map((entry) => ({
      attendanceId: entry.attendanceId,
      employeeId: entry.employeeId,
      trainingId: entry.trainingId,
      mappingVersion: entry.mappingVersion,
      idempotencyKey: entry.idempotencyKey,
      completionDate: entry.completionDate,
    })),
  });
}

export function canonicalResultsJson(results: readonly MatrixWriteResult[]): string {
  return JSON.stringify(
    results.map((result) => ({
      attendanceId: result.attendanceId,
      employeeId: result.employeeId,
      trainingId: result.trainingId,
      mappingVersion: result.mappingVersion,
      idempotencyKey: result.idempotencyKey,
      completionDate: result.completionDate,
      status: result.status,
      previousDate: result.previousDate ?? null,
      previousProvenance: result.previousProvenance ?? null,
    })),
  );
}

export interface PlanEnvelope {
  readonly serialized: string;
  readonly hash: string;
}

export function planEnvelope(plan: WritePlan): PlanEnvelope {
  const serialized = canonicalPlanJson(plan);
  return { serialized, hash: sha256(serialized) };
}

// ---------------------------------------------------------------------------
// Firma de la fila del journal
// ---------------------------------------------------------------------------

/**
 * Todo campo que gobierne un efecto entra a la carga firmada. Si un campo
 * queda fuera, ese campo se puede cambiar sin romper la firma, que es
 * exactamente el agujero que la firma existe para cerrar.
 */
function journalPayload(batch: Omit<ReleaseBatch, "journalMac">): string {
  return [
    batch.batchId,
    batch.sessionId,
    batch.requestId,
    batch.mappingVersion,
    batch.planHash,
    batch.plan,
    batch.results,
    batch.phase,
    batch.status,
    batch.sessionOutcome ?? "",
    batch.overwriteReason,
    String(batch.totalCandidates),
    String(batch.totalWritten),
    String(batch.totalConflicts),
    batch.createdBy,
    batch.createdAt,
    batch.updatedAt,
    batch.completedAt ?? "",
    batch.contractVersion,
  ].join("\n");
}

export function signBatch(secret: string, batch: Omit<ReleaseBatch, "journalMac">): string {
  return hmacHex(secret, PURPOSE_JOURNAL, journalPayload(batch));
}

export function assertBatchIntegrity(secret: string, batch: ReleaseBatch): ReleaseBatch {
  if (!batch || typeof batch !== "object" || !HEX64.test(String(batch.journalMac ?? ""))) {
    throw new ReleaseIntegrityError("El journal de liberación no conserva su autenticidad");
  }
  const { journalMac: _ignored, ...unsigned } = batch;
  if (!constantTimeEqual(signBatch(secret, unsigned), batch.journalMac)) {
    throw new ReleaseIntegrityError("El journal de liberación no conserva su autenticidad");
  }
  return batch;
}

/** Vuelve a firmar el lote tras aplicarle un parche. */
export function reseal(
  secret: string,
  batch: ReleaseBatch,
  patch: Partial<Omit<ReleaseBatch, "journalMac">>,
  updatedAt: string,
): ReleaseBatch {
  assertBatchIntegrity(secret, batch);
  const { journalMac: _ignored, ...unsigned } = batch;
  const intended = { ...unsigned, ...patch, updatedAt };
  return { ...intended, journalMac: signBatch(secret, intended) };
}

// ---------------------------------------------------------------------------
// Restauración del plan
// ---------------------------------------------------------------------------

/**
 * Recupera el plan congelado. Comprueba la firma de la fila, el hash del plan
 * y que el plan describa la misma sesión y versión de mapeo que la fila. Un
 * plan que no supere las tres pruebas no se aplica: se declara conflicto.
 */
export function restorePlan(secret: string, batch: ReleaseBatch): WritePlan {
  assertBatchIntegrity(secret, batch);

  const serialized = String(batch.plan ?? "");
  if (!HEX64.test(String(batch.planHash ?? "")) || sha256(serialized) !== batch.planHash) {
    throw new ReleaseIntegrityError("El journal de liberación no conserva su integridad");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ReleaseIntegrityError("El journal de liberación está corrupto");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ReleaseIntegrityError("El journal de liberación está corrupto");
  }

  const plan = parsed as WritePlan;
  if (
    plan.session?.sessionId !== batch.sessionId ||
    plan.mapping?.mappingVersion !== batch.mappingVersion
  ) {
    throw new ReleaseIntegrityError("El journal de liberación no coincide con su sesión");
  }

  // Volver a serializar debe reproducir byte a byte lo firmado. Si no, el
  // objeto trae campos que el hash no cubre.
  if (canonicalPlanJson(plan) !== serialized) {
    throw new ReleaseIntegrityError("El journal de liberación está corrupto");
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Contexto durable y marcador por efecto
// ---------------------------------------------------------------------------

export interface DurableContext {
  readonly batchId: string;
  readonly requestId: string;
  readonly planHash: string;
  readonly journalMac: string;
  readonly contextMac: string;
}

function contextPayload(plan: WritePlan, parts: Omit<DurableContext, "contextMac">): string {
  return [
    parts.batchId,
    plan.session.sessionId,
    parts.requestId,
    parts.planHash,
    plan.mapping.mappingVersion,
    parts.journalMac,
  ].join("|");
}

export function buildContext(secret: string, batch: ReleaseBatch, plan: WritePlan): DurableContext {
  assertBatchIntegrity(secret, batch);
  const parts = {
    batchId: batch.batchId,
    requestId: batch.requestId,
    planHash: batch.planHash,
    journalMac: batch.journalMac,
  };
  return {
    ...parts,
    contextMac: hmacHex(secret, "MATRIX_CONTEXT_V1", contextPayload(plan, parts)),
  };
}

export function assertContext(
  secret: string,
  plan: WritePlan,
  context: DurableContext,
): DurableContext {
  if (!context || typeof context !== "object") {
    throw new ReleaseIntegrityError("Falta el contexto durable de liberación");
  }
  if (
    !HEX64.test(String(context.planHash ?? "")) ||
    !HEX64.test(String(context.journalMac ?? "")) ||
    !HEX64.test(String(context.contextMac ?? ""))
  ) {
    throw new ReleaseIntegrityError("El contexto durable de liberación es inválido");
  }
  const expected = hmacHex(secret, "MATRIX_CONTEXT_V1", contextPayload(plan, context));
  if (!constantTimeEqual(expected, context.contextMac)) {
    throw new ReleaseIntegrityError(
      "El contexto durable de liberación no conserva su autenticidad",
    );
  }
  return context;
}

/**
 * Marcador por efecto. Es lo que permite distinguir "esta fecha la escribió
 * este lote" de "esta fecha ya estaba", y por lo tanto lo que convierte un
 * reintento en `RECOVERED` en vez de en un segundo efecto.
 */
export function markerFor(
  secret: string,
  plan: WritePlan,
  context: DurableContext,
  entry: PlanEntry,
): string {
  const payload = [
    context.batchId,
    plan.session.sessionId,
    context.requestId,
    context.planHash,
    plan.mapping.mappingVersion,
    entry.idempotencyKey,
  ].join("|");
  return `${MARKER_PREFIX}:${context.batchId}:${hmacHex(secret, PURPOSE_MARKER, payload)}`;
}
