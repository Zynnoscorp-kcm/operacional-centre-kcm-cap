import type { WorkerNumber } from "../comun/numero-trabajador.ts";
import type { DateProvenance } from "../importacion-matriz/tipos.ts";

export type ReleasePhase =
  "PENDIENTE" | "MATRIZ_APLICADA" | "DOMINIO_APLICADO" | "COMPLETADO" | "CONFLICTO";

export type ReleaseBatchStatus = "PENDIENTE" | "COMPLETADO" | "CONFLICTO";

export const TERMINAL_PHASES: readonly ReleasePhase[] = Object.freeze(["COMPLETADO", "CONFLICTO"]);

export function isTerminalPhase(phase: ReleasePhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

export type SessionReleaseOutcome = "LIBERADA_TOTAL" | "LIBERADA_PARCIAL";

export type OverwritePolicy = "NO_OVERWRITE" | "OVERWRITE_WITH_HISTORY";

export const OVERWRITE_POLICIES: readonly OverwritePolicy[] = Object.freeze([
  "NO_OVERWRITE",
  "OVERWRITE_WITH_HISTORY",
]);

export type MatrixWriteStatus =
  | "READY"
  | "READY_OVERWRITE"
  | "WRITTEN"
  | "OVERWRITTEN"
  | "ALREADY_APPLIED"
  | "RECOVERED"
  | "ATOMIC_BATCH_ABORTED"
  | "EMPLOYEE_NOT_FOUND"
  | "COURSE_NOT_FOUND"
  | "EXISTING_VALUE_CONFLICT"
  | "OVERWRITE_NOT_ALLOWED"
  | "NEWER_DATE_PRESENT"
  | "OVERWRITE_REASON_REQUIRED"
  | "IDEMPOTENCY_CONFLICT";

export const EFFECTIVE_STATUSES: readonly MatrixWriteStatus[] = Object.freeze([
  "WRITTEN",
  "OVERWRITTEN",
  "ALREADY_APPLIED",
  "RECOVERED",
]);

export const READY_STATUSES: readonly MatrixWriteStatus[] = Object.freeze([
  "READY",
  "READY_OVERWRITE",
]);

export function isEffective(status: MatrixWriteStatus): boolean {
  return EFFECTIVE_STATUSES.includes(status);
}

export function isReady(status: MatrixWriteStatus): boolean {
  return READY_STATUSES.includes(status);
}

export function isConflict(status: MatrixWriteStatus): boolean {
  return !isEffective(status) && !isReady(status);
}

export type XlsbAckStatus =
  | "PENDIENTE_ACUSE"
  | "APPLIED"
  | "RECOVERED"
  | "HEADER_MISMATCH"
  | "EXISTING_VALUE"
  | "DESTINATION_MISSING"
  | "REJECTED";

export interface MatrixMapping {
  readonly trainingId: string;
  readonly destinationName: string;
  readonly destinationSheet: string;
  readonly destinationColumn: string;
  readonly destinationHeader: string;
  readonly headerRow: number;
  readonly mappingVersion: string;
  readonly overwritePolicy: OverwritePolicy;
  readonly active: boolean;
}

export interface PlanEntry {
  readonly attendanceId: string;
  readonly employeeId: string;
  readonly trainingId: string;
  readonly mappingVersion: string;
  readonly idempotencyKey: string;
  readonly completionDate: string;
}

export interface PlanSession {
  readonly sessionId: string;
  readonly trainingId: string;
  readonly date: string;
}

export interface WritePlan {
  readonly session: PlanSession;
  readonly mapping: MatrixMapping;
  readonly completionDate: string;
  readonly entries: readonly PlanEntry[];
}

export interface MatrixWriteResult {
  readonly attendanceId: string;
  readonly employeeId: string;
  readonly trainingId: string;
  readonly mappingVersion: string;
  readonly idempotencyKey: string;
  readonly completionDate: string;
  readonly status: MatrixWriteStatus;
  readonly previousDate?: string | null;
  readonly previousProvenance?: DateProvenance | null;
}

export interface ReleaseBatch {
  readonly batchId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly mappingVersion: string;
  readonly planHash: string;
  readonly plan: string;
  readonly journalMac: string;
  readonly results: string;
  readonly phase: ReleasePhase;
  readonly status: ReleaseBatchStatus;
  readonly sessionOutcome: SessionReleaseOutcome | null;
  readonly overwriteReason: string;
  readonly totalCandidates: number;
  readonly totalWritten: number;
  readonly totalConflicts: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly contractVersion: string;
}

export interface ReleaseEffect {
  readonly releaseId: string;
  readonly idempotencyKey: string;
  readonly batchId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly attendanceId: string;
  readonly employeeId: string;
  readonly trainingId: string;
  readonly effectiveDate: string;
  readonly mappingVersion: string;
  readonly result: MatrixWriteStatus;
  readonly marker: string;
  readonly xlsbAckStatus: XlsbAckStatus;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ReleaseInput {
  readonly sessionId: string;
  readonly requestId: string;
  readonly overwriteReason?: string;
}

export interface ReleasePreviewCounts {
  readonly total: number;
  readonly included: number;
  readonly excluded: number;
  readonly overwrites: number;
}

export interface ExcludedEntry {
  readonly attendanceId: string | null;
  readonly employeeId: string | null;
  readonly reasons: readonly string[];
}

export interface ExistingDate {
  readonly employeeId: string;
  readonly previousDate: string;
  readonly provenance: string;
  readonly newer: boolean;
}

export interface ReleasePreview {
  readonly sessionId: string;
  readonly mapping: MatrixMapping;
  readonly completionDate: string;
  readonly included: readonly MatrixWriteResult[];
  readonly excluded: readonly ExcludedEntry[];
  readonly counts: ReleasePreviewCounts;
  readonly overwriteRequiresReason: boolean;
  readonly atomicBatchReady: boolean;
}

export interface ReleaseOutcome {
  readonly batchId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly phase: ReleasePhase;
  readonly status: ReleaseBatchStatus;
  readonly sessionOutcome: SessionReleaseOutcome | null;
  readonly repeated: boolean;
  readonly effectiveWrites: number;
  readonly results: readonly MatrixWriteResult[];
  readonly excluded: readonly ExcludedEntry[];
}

export interface OverwriteHistoryEntry {
  readonly historyId: string;
  readonly recordId: string;
  readonly workerNumber: WorkerNumber;
  readonly trainingId: string;
  readonly changeType: "SOBRESCRITA";
  readonly previousCompletionDate: string;
  readonly completionDate: string;
  readonly previousProvenance: DateProvenance;
  readonly provenance: "SESSION_RELEASE";
  readonly actorId: string;
  readonly reason: string;
  readonly requestId: string;
  readonly batchId: string;
  readonly sessionId: string;
  readonly recordedAt: string;
}

export const CONTRACT_VERSION = "1.0.0";

export const MAX_ENTRIES_PER_BATCH = 40;

export const MAX_OVERWRITE_REASON_LENGTH = 200;

export const RELEASABLE_SESSION_STATUSES = Object.freeze([
  "LISTA_PARA_LIBERAR",
  "LIBERADA_PARCIAL",
] as const);

export const RELEASE_ROLES = Object.freeze(["CAPACITACION", "ADMINISTRADOR"] as const);
export const RELEASE_READ_ROLES = Object.freeze([
  "CAPACITACION",
  "ADMINISTRADOR",
  "AUDITOR",
] as const);
