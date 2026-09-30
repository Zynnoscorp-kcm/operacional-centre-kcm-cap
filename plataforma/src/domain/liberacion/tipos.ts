/**
 * Tipos de dominio para Liberación a la matriz (Función 5).
 *
 * Referencias:
 * - `packages/core/release-service.js` — referencia ejecutable de las reglas.
 * - `database/migrations/0011_liberacion.sql` y `0012_destinos_mapeo.sql` — enums y columnas.
 *
 * Lo que esta capa no hace: escribir el XLSB. La escritura al libro maestro es
 * exclusiva del cliente VBA, sobre destinos declarados y nunca desde Node. Aquí
 * se aplica la fecha a la réplica consultable en SQL y se deja el efecto en
 * espera de acuse; el empuje físico lo realiza el cliente.
 */

import type { WorkerNumber } from "../comun/numero-trabajador.ts";
import type { DateProvenance } from "../importacion-matriz/tipos.ts";

// ---------------------------------------------------------------------------
// Fases y estados — se alinean con los enums de `database/migrations/0001_fundamentos.sql`
// ---------------------------------------------------------------------------

/** `comun.fase_liberacion` más el terminal de conflicto. */
export type ReleasePhase =
  "PENDIENTE" | "MATRIZ_APLICADA" | "DOMINIO_APLICADO" | "COMPLETADO" | "CONFLICTO";

/** `comun.estado_liberacion`. */
export type ReleaseBatchStatus = "PENDIENTE" | "COMPLETADO" | "CONFLICTO";

/** Fases de las que ya no se sale: reabrirlas produciría un segundo efecto. */
export const TERMINAL_PHASES: readonly ReleasePhase[] = Object.freeze(["COMPLETADO", "CONFLICTO"]);

export function isTerminalPhase(phase: ReleasePhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/** Resultado sobre la sesión una vez aplicado el lote. */
export type SessionReleaseOutcome = "LIBERADA_TOTAL" | "LIBERADA_PARCIAL";

// ---------------------------------------------------------------------------
// Política de sobrescritura — `comun.politica_sobrescritura`
// ---------------------------------------------------------------------------

/**
 * Sólo existen estos dos valores. El segundo es gobernado y no hay un tercero:
 * sobrescribir sí, borrar no.
 */
export type OverwritePolicy = "NO_OVERWRITE" | "OVERWRITE_WITH_HISTORY";

export const OVERWRITE_POLICIES: readonly OverwritePolicy[] = Object.freeze([
  "NO_OVERWRITE",
  "OVERWRITE_WITH_HISTORY",
]);

// ---------------------------------------------------------------------------
// Resultado por efecto
// ---------------------------------------------------------------------------

/**
 * Estado de cada entrada del plan frente al destino.
 *
 * - `READY` / `READY_OVERWRITE`: preflight favorable; todavía no hay efecto.
 * - `WRITTEN` / `OVERWRITTEN` / `ALREADY_APPLIED` / `RECOVERED`: efectivos.
 * - el resto: conflicto, y un solo conflicto aborta el lote entero.
 */
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

/** Estados que confirman un efecto sobre el destino. */
export const EFFECTIVE_STATUSES: readonly MatrixWriteStatus[] = Object.freeze([
  "WRITTEN",
  "OVERWRITTEN",
  "ALREADY_APPLIED",
  "RECOVERED",
]);

/** Estados de preflight favorable: aún no tocaron nada. */
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

/** Un conflicto es todo lo que no es efectivo ni preflight favorable. */
export function isConflict(status: MatrixWriteStatus): boolean {
  return !isEffective(status) && !isReady(status);
}

// ---------------------------------------------------------------------------
// Acuse del cliente VBA — `comun.estado_acuse`
// ---------------------------------------------------------------------------

/**
 * Node aplica la fecha a la réplica en SQL; el XLSB lo escribe el cliente VBA.
 * Hasta que llegue su acuse, el efecto queda declarado como pendiente. E11
 * consume esta cola por `RELEASE_PULL_V1` y la cierra con `RELEASE_ACK_V1`.
 */
export type XlsbAckStatus =
  | "PENDIENTE_ACUSE"
  | "APPLIED"
  | "RECOVERED"
  | "HEADER_MISMATCH"
  | "EXISTING_VALUE"
  | "DESTINATION_MISSING"
  | "REJECTED";

// ---------------------------------------------------------------------------
// Mapeo de destino declarado
// ---------------------------------------------------------------------------

/**
 * Hoja `MATRIZ_MAPEO`. No existe escritura a un destino no declarado: el
 * mapeo trae hoja, columna, encabezado esperado y política propia, y el
 * encabezado se coteja antes de cualquier efecto.
 */
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

// ---------------------------------------------------------------------------
// Plan de escritura
// ---------------------------------------------------------------------------

export interface PlanEntry {
  readonly attendanceId: string;
  readonly employeeId: string;
  readonly trainingId: string;
  readonly mappingVersion: string;
  readonly idempotencyKey: string;
  readonly completionDate: string; // YYYY-MM-DD
}

export interface PlanSession {
  readonly sessionId: string;
  readonly trainingId: string;
  readonly date: string; // YYYY-MM-DD
}

/**
 * El plan se congela antes del primer efecto y se vuelve inmutable: su hash
 * entra al journal y cada reanudación lo revalida contra el mismo hash.
 */
export interface WritePlan {
  readonly session: PlanSession;
  readonly mapping: MatrixMapping;
  readonly completionDate: string;
  readonly entries: readonly PlanEntry[];
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

export interface MatrixWriteResult {
  readonly attendanceId: string;
  readonly employeeId: string;
  readonly trainingId: string;
  readonly mappingVersion: string;
  readonly idempotencyKey: string;
  readonly completionDate: string;
  readonly status: MatrixWriteStatus;
  /** Valor que había en el destino cuando el efecto lo sustituyó. */
  readonly previousDate?: string | null;
  /** Procedencia del valor sustituido; distingue maestro de plataforma. */
  readonly previousProvenance?: DateProvenance | null;
}

// ---------------------------------------------------------------------------
// Journal durable
// ---------------------------------------------------------------------------

/**
 * Journal autenticado del lote. `journalMac` firma la fila completa y
 * `planHash` fija el plan: adulterar cualquiera de los dos rompe la
 * reanudación en lugar de producir un efecto silencioso.
 */
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

/** Efecto individual persistido. Su clave idempotente es única y no se repite. */
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

// ---------------------------------------------------------------------------
// Entradas del servicio
// ---------------------------------------------------------------------------

export interface ReleaseInput {
  readonly sessionId: string;
  readonly requestId: string;
  /**
   * Obligatorio cuando el lote sobrescribe algún valor previo. Sin motivo no
   * hay sobrescritura: se exigen actor y motivo, y un motivo por omisión sería
   * una firma en blanco.
   */
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

/** Una fecha que la copia de la matriz ya tiene para alguien de la sesión. */
export interface ExistingDate {
  readonly employeeId: string;
  readonly previousDate: string;
  readonly provenance: string;
  /** Más reciente que la de la sesión: liberar no la reemplaza. */
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

// ---------------------------------------------------------------------------
// Historial de sobrescritura
// ---------------------------------------------------------------------------

/**
 * Hoja `HC_REGISTROS_HISTORIAL`. Se escribe antes de tocar el valor: si el
 * efecto falla después, el hecho original ya quedó conservado. Al revés se
 * perdería exactamente lo que el historial existe para no perder.
 */
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

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const CONTRACT_VERSION = "1.0.0";

/** El quiosco topa en 40 por sesión; el lote no puede exceder ese universo. */
export const MAX_ENTRIES_PER_BATCH = 40;

export const MAX_OVERWRITE_REASON_LENGTH = 200;

/** Sesiones desde las que se puede liberar. */
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
