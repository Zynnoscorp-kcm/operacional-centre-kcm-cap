/**
 * Tipos de dominio para Preliberación (Función 4).
 *
 * Fuente: `docs/arquitectura/MODELO_DATOS.md`, hojas ASISTENCIAS y
 * PRELIBERACION_REVISION.
 *
 * El reconocimiento óptico quedó fuera de alcance, de modo que no existe
 * compuerta de revisión de imágenes previa a la preliberación.
 */

import type { SessionStatus } from "../quiosco/tipos.ts";

// ---------------------------------------------------------------------------
// Estados de revisión de preliberación
// ---------------------------------------------------------------------------

export type PreReleaseReviewStatus = "SIN_REVISION" | "CON_HALLAZGOS" | "SIN_HALLAZGOS";

// ---------------------------------------------------------------------------
// Resultado de examen — los tres estados + el inicial
// ---------------------------------------------------------------------------

export type ExamOutcome =
  "EXAMEN_PENDIENTE" | "EXAMEN_CONFIRMADO" | "EXAMEN_NO_ENCONTRADO" | "EXAMEN_REPROBADO";

export const VALID_EXAM_OUTCOMES: readonly ExamOutcome[] = Object.freeze([
  "EXAMEN_PENDIENTE",
  "EXAMEN_CONFIRMADO",
  "EXAMEN_NO_ENCONTRADO",
  "EXAMEN_REPROBADO",
]);

/**
 * Las tres alternativas que el revisor ve y puede escoger.
 * `EXAMEN_PENDIENTE` queda fuera a propósito: es el valor inicial del registro,
 * no una decisión. En el banco de trabajo un examen parte como aprobado y sólo
 * se mueve a reprobado o no entregado; para volver a "no calificado" no hay
 * botón, porque eso sería deshacer la revisión, no registrarla.
 */
export const SELECTABLE_EXAM_OUTCOMES: readonly ExamOutcome[] = Object.freeze([
  "EXAMEN_CONFIRMADO",
  "EXAMEN_REPROBADO",
  "EXAMEN_NO_ENCONTRADO",
]);

export const EXAM_OUTCOME_LABELS: Readonly<Record<ExamOutcome, string>> = Object.freeze({
  EXAMEN_PENDIENTE: "No calificado",
  EXAMEN_CONFIRMADO: "Aprobado",
  EXAMEN_NO_ENCONTRADO: "No entregado",
  EXAMEN_REPROBADO: "Reprobado",
});

// ---------------------------------------------------------------------------
// Hallazgos de preliberación
// ---------------------------------------------------------------------------

export interface FindingDefinition {
  readonly label: string;
  readonly derived: boolean;
}

/** Hallazgos derivados (calcula el servidor, no se declaran a mano). */
export const DERIVED_FINDINGS = Object.freeze([
  "EXAMENES_FALTANTES",
  "EXAMENES_REPROBADOS",
  "EXAMENES_EXCEDENTES",
  "COLABORADORES_EXCLUIDOS",
  "ASISTENCIA_NO_COTEJADA",
] as const);

/** Hallazgos declarados (inspección de la lista física). */
export const DECLARED_FINDINGS = Object.freeze([
  "FIRMA_INSTRUCTOR_FALTANTE",
  "FIRMAS_COLABORADORES_FALTANTES",
  "EXAMENES_SIN_CALIFICAR",
  "LISTA_FISICA_ILEGIBLE",
  "DATOS_SESION_INCORRECTOS",
] as const);

export type FindingCode = (typeof DERIVED_FINDINGS)[number] | (typeof DECLARED_FINDINGS)[number];

export const PRERELEASE_FINDINGS: Readonly<Record<FindingCode, FindingDefinition>> = Object.freeze({
  EXAMENES_FALTANTES: { label: "Exámenes faltantes", derived: true },
  EXAMENES_REPROBADOS: { label: "Exámenes reprobados", derived: true },
  EXAMENES_EXCEDENTES: { label: "Exámenes excedentes", derived: true },
  COLABORADORES_EXCLUIDOS: { label: "Trabajadores excluidos", derived: true },
  ASISTENCIA_NO_COTEJADA: { label: "Asistencia no cotejada", derived: true },
  FIRMA_INSTRUCTOR_FALTANTE: { label: "Firma del instructor faltante", derived: false },
  FIRMAS_COLABORADORES_FALTANTES: { label: "Firmas de trabajadores faltantes", derived: false },
  EXAMENES_SIN_CALIFICAR: { label: "Exámenes sin calificar", derived: false },
  LISTA_FISICA_ILEGIBLE: { label: "Lista física ilegible", derived: false },
  DATOS_SESION_INCORRECTOS: { label: "Datos de sesión incorrectos", derived: false },
});

// ---------------------------------------------------------------------------
// Estados de sesión válidos para cada operación
// ---------------------------------------------------------------------------

/** Sesiones que aparecen en la lista revisable del workbench. */
export const EDITABLE_STATUSES: readonly SessionStatus[] = Object.freeze([
  "CERRADA",
  "PRELIBERACION",
  "LIBERADA_PARCIAL",
]);

/** Sesiones válidas para entrar a PRELIBERACION. */
export const PRE_RELEASE_ENTRY_STATUSES: readonly SessionStatus[] = Object.freeze(["CERRADA"]);

export const RELEASE_QUEUE_STATUS: SessionStatus = "LISTA_PARA_LIBERAR";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const REVIEW_ROLES = Object.freeze(["CAPACITACION", "ADMINISTRADOR"] as const);
export const READ_ROLES = Object.freeze([
  "CAPACITACION",
  "ADMINISTRADOR",
  "AUDITOR",
  "CAPACITADOR",
] as const);

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const MAX_COMMENT_LENGTH = 1500;
export const MAX_REASON_LENGTH = 200;
export const MAX_ROSTER_SIZE = 200;
export const MAX_FINDINGS_COUNT = 20;
/** Tope de la bandeja de revisión; el legado usa el mismo corte. */
export const MAX_LISTED_SESSIONS = 200;

// ---------------------------------------------------------------------------
// Motivos de bloqueo para liberación
// ---------------------------------------------------------------------------

export type BlockingReason =
  | "IDENTIDAD_INVALIDA"
  | "NUMERO_NO_IDENTIFICADO"
  | "ASISTENCIA_NO_COMPROBADA"
  | "EXAMEN_NO_ENCONTRADO"
  | "EXAMEN_REPROBADO"
  | "EXAMEN_NO_CONFIRMADO"
  | "EXCLUIDO_EN_REVISION"
  | "SESION_NO_AUTORIZADA"
  | "YA_LIBERADO_PREVIAMENTE";

/**
 * Los motivos, con el nombre que los lee quien recibe el reporte impreso.
 *
 * La clave es el contrato entre capas y no cambia; esto es sólo su traducción
 * para una hoja de papel, donde `SESION_NO_AUTORIZADA` no significa nada para
 * quien no conoce el sistema.
 */
export const BLOCKING_REASON_LABELS: Readonly<Record<BlockingReason, string>> = Object.freeze({
  IDENTIDAD_INVALIDA: "Identidad no validada",
  NUMERO_NO_IDENTIFICADO: "Número no identificado",
  ASISTENCIA_NO_COMPROBADA: "Asistencia no comprobada",
  EXAMEN_NO_ENCONTRADO: "Examen no entregado",
  EXAMEN_REPROBADO: "Examen reprobado",
  EXAMEN_NO_CONFIRMADO: "Examen sin calificar",
  EXCLUIDO_EN_REVISION: "Excluido en la revisión",
  SESION_NO_AUTORIZADA: "Sesión no autorizada",
  YA_LIBERADO_PREVIAMENTE: "Ya liberado antes",
});

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ParticipantAttendance {
  readonly attendanceId: string;
  readonly sessionId: string;
  readonly employeeId: string;
  readonly captureRoute: string;
  readonly identityValidated: boolean;
  readonly attendanceProven: boolean;
  readonly examStatus: string;
  readonly sessionAuthorized: boolean;
  readonly released: boolean;
  readonly excludedFromRelease: boolean;
  readonly exclusionReason: string;
  readonly blockingReasons: readonly BlockingReason[];
}

export interface RosterRow {
  readonly attendanceId: string;
  readonly employeeId: string;
  readonly displayName: string;
  readonly area: string;
  readonly position: string;
  readonly knownEmployee: boolean;
  readonly captureRoute: string;
  readonly identityValidated: boolean;
  readonly attendanceProven: boolean;
  readonly examStatus: ExamOutcome;
  readonly examDefaulted: boolean;
  readonly excludedFromRelease: boolean;
  readonly exclusionReason: string;
  readonly released: boolean;
  readonly blockingReasons: readonly string[];
  readonly eligible: boolean;
}

export interface ReviewDto {
  readonly revisionId: string;
  readonly findings: readonly string[];
  readonly declaredFindings: readonly string[];
  readonly comments: string;
  readonly status: PreReleaseReviewStatus;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly reportEvidenceId: string;
}

export interface PreReleaseCounters {
  readonly expectedExams: number;
  readonly receivedExams: number;
  readonly approvedExams: number;
  readonly failedExams: number;
  readonly missingExams: number;
  readonly extraExams: number;
  readonly excludedCount: number;
  readonly eligibleCount: number;
}

export interface SessionHeader {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly trainingId: string;
  readonly trainingName: string;
  readonly date: string;
  readonly instructor: string;
  readonly status: string;
  readonly authorized: boolean;
  readonly attendanceCount: number;
  readonly excludedCount: number;
  readonly pendingExamCount: number;
}

export interface WorkbenchState {
  readonly session: SessionHeader;
  readonly roster: readonly RosterRow[];
  readonly counters: PreReleaseCounters;
  readonly review: ReviewDto;
  readonly derivedFindings: readonly string[];
  readonly findings: readonly string[];
  readonly findingCatalog: readonly { code: string; label: string; derived: boolean }[];
  readonly examOutcomes: readonly { code: string; label: string }[];
  readonly editable?: boolean;
  readonly releaseAvailable?: boolean;
}

export interface PreReleaseReviewRecord {
  readonly revisionId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly expectedExams: number;
  readonly receivedExams: number;
  readonly approvedExams: number;
  readonly failedExams: number;
  readonly missingExams: number;
  readonly extraExams: number;
  readonly findings: string;
  readonly comments: string;
  readonly excludedCount: number;
  readonly status: PreReleaseReviewStatus;
  readonly reportEvidenceId: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SaveReviewInput {
  readonly sessionId: string;
  readonly requestId: string;
  readonly examOutcomes: readonly {
    readonly employeeId: string;
    readonly examStatus: ExamOutcome;
  }[];
  readonly exclusions: readonly {
    readonly employeeId: string;
    readonly excluded: boolean;
    readonly reason?: string;
  }[];
  readonly findings: readonly string[];
  readonly comments: string;
}

export interface AddWorkerInput {
  readonly sessionId: string;
  readonly employeeId: string;
  readonly requestId: string;
}

export interface EmployeeInfo {
  readonly employeeId: string;
  readonly displayName: string;
  readonly area: string;
  readonly position: string;
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Reporte de preliberación
// ---------------------------------------------------------------------------

/**
 * Los dos modos del reporte. `VISTA_PREVIA` no deja rastro: se puede pedir
 * cuantas veces se quiera sin cambiar la revisión ni la etapa de la sesión.
 * `ARCHIVO` sí, y por eso deja evidencia inmutable y un asiento de auditoría.
 */
export type ReportMode = "VISTA_PREVIA" | "ARCHIVO";

export const REPORT_KIND = "REPORTE_PRELIBERACION";
export const REPORT_MIME_TYPE = "application/pdf";

/** Tope de tamaño; un reporte que lo rebase indica un padrón corrupto, no un PDF grande. */
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

/**
 * Fila de `operacion.sesion_evidencia` para un reporte archivado. Sólo describe el archivo:
 * los bytes viven en el almacén de objetos, referenciados por `storagePath`.
 */
export interface ReportEvidenceRecord {
  readonly evidenceId: string;
  readonly sessionId: string;
  readonly kind: typeof REPORT_KIND;
  readonly fileName: string;
  readonly mimeType: typeof REPORT_MIME_TYPE;
  readonly sha256: string;
  readonly byteSize: number;
  readonly storagePath: string;
  readonly immutable: true;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Lo que devuelve generar un reporte, con o sin archivo. */
export interface PreReleaseReport {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly mode: ReportMode;
  /** Sin hallazgos: el reporte es un talón de sesión concluida, no un acta. */
  readonly clean: boolean;
  readonly findings: readonly string[];
  readonly counters: PreReleaseCounters;
  readonly fileName: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly archived: boolean;
  readonly evidenceId: string;
  readonly content: Uint8Array;
}
