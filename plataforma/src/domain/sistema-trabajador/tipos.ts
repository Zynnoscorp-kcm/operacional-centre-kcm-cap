/**
 * Tipos de dominio para el Sistema General por Trabajador (Función 8).
 */

import type { WorkerNumber } from "../comun/numero-trabajador.ts";

export type DncStatus =
  "COMPLETADO" | "REFORZAR" | "PENDIENTE" | "PROGRAMADO" | "NO_APLICA" | "DATOS_INSUFICIENTES";

export interface WorkerRecord {
  readonly employeeId: WorkerNumber;
  readonly name: string;
  readonly department: string;
  readonly area: string;
  readonly position: string;
  /** Código de nómina de la matriz; NS = sindicalizado y NQ = confianza. */
  readonly payrollType?: string | null;
  /** Como viene de la matriz: `ECATEPEC I`, `ECATEPEC II`, `MANTTO INGENIERIA`… */
  readonly plant?: string;
  readonly hireDate: string | null; // ISO YYYY-MM-DD
  readonly active: boolean;
  readonly schoolingDeclared?: string;
  readonly photoUrl?: string | null;
}

export interface SeniorityCalculation {
  readonly years: number;
  readonly months: number;
  readonly days: number;
  readonly formatted: string;
  readonly isAvailable: boolean;
}

export interface DerivedCategory {
  readonly category: "OPERATIVO" | "TECNICO" | "MANDO_MEDIO" | "ADMINISTRATIVO" | "GERENCIAL";
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly sourcePosition: string;
  readonly description: string;
}

export interface DerivedSchooling {
  readonly level: string;
  readonly isDeclaredByDefault: boolean;
  readonly disclaimer: string;
}

export interface PhotoPlaceholder {
  readonly initials: string;
  readonly accentColor: string;
  readonly ariaLabel: string;
}

export interface WorkerCourseEvaluation {
  readonly employeeId: WorkerNumber;
  readonly trainingId: string;
  readonly canonicalCourseName: string;
  readonly status: DncStatus;
  readonly isApplicable: boolean;
  readonly ruleId: string | null;
  readonly ruleVersion: string | null;
  readonly ruleLevel: "DEPARTMENT" | "AREA" | null;
  readonly lastCompletionDate: string | null;
  readonly expirationDate: string | null;
  readonly scheduledSessionId: string | null;
  readonly evaluatedAt: string;
  readonly details: string;
}

export interface WorkerEvaluationMetrics {
  readonly totalCourses: number;
  readonly applicableCourses: number;
  readonly completados: number;
  readonly reforzar: number;
  readonly pendientes: number;
  readonly programados: number;
  readonly noAplica: number;
  readonly datosInsuficientes: number;
  readonly porcentajeCumplimiento: number;
  readonly publicacionAutorizada: boolean;
  readonly notaPublicacion: string;
}

export type ProvenanceType = "XLSB_IMPORT" | "SESSION_RELEASE" | "MANUAL_ADJUSTMENT";

export interface CourseTrajectoryEntry {
  readonly recordId: string;
  readonly trainingId: string;
  readonly courseName: string;
  readonly completionDate: string;
  readonly provenance: ProvenanceType;
  readonly sourceBatchId?: string;
  readonly recordedAt: string;
  readonly actor: string;
}

export interface Dc3WorkerLogEntry {
  readonly courseId: string;
  readonly courseName: string; // Inducción a la empresa, QMS, LOTO
  readonly isEligible: boolean;
  readonly isIssued: boolean;
  readonly issuedAt: string | null;
  readonly documentFolio: string | null;
  readonly blockingReasons: readonly string[];
}

/**
 * Cuántos trabajadores del área de una persona tienen vigente cada curso que les
 * aplica. Es la referencia contra la que la ficha dibuja a la persona: sin ella,
 * una telaraña con casi todo pendiente no dice si eso es lo normal del área o
 * un rezago propio.
 */
export interface AreaCourseCompletion {
  readonly trainingId: string;
  readonly applicable: number;
  readonly completed: number;
}

export interface DerivedWorkerProfile {
  readonly worker: WorkerRecord;
  readonly seniority: SeniorityCalculation;
  readonly category: DerivedCategory;
  readonly schooling: DerivedSchooling;
  readonly photo: PhotoPlaceholder;
  readonly courseEvaluations: readonly WorkerCourseEvaluation[];
  readonly metrics: WorkerEvaluationMetrics;
  readonly trajectory: readonly CourseTrajectoryEntry[];
  readonly dc3Log: readonly Dc3WorkerLogEntry[];
  /** Ausente si el área no se pudo medir: la ficha se dibuja igual, sin la referencia. */
  readonly areaComparison?: readonly AreaCourseCompletion[];
}

export interface DepartmentSummaryItem {
  readonly department: string;
  readonly activeWorkersCount: number;
  readonly completadosCount: number;
  readonly reforzarCount: number;
  readonly pendientesCount: number;
  readonly programadosCount: number;
  readonly datosInsuficientesCount: number;
  readonly publicacionAutorizada: boolean;
}

export interface CourseCoverageSummaryItem {
  readonly trainingId: string;
  readonly canonicalName: string;
  readonly ruleLevel: "DEPARTMENT" | "AREA";
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly applicableWorkersCount: number;
  readonly completadosCount: number;
  readonly reforzarCount: number;
  readonly pendientesCount: number;
  readonly programadosCount: number;
  readonly publicacionAutorizada: boolean;
}

export interface PlantComparisonReport {
  readonly totalWorkers: number;
  readonly totalDepartments: number;
  readonly generatedAt: string;
  readonly departments: readonly DepartmentSummaryItem[];
  readonly publicacionAutorizada: boolean;
}
