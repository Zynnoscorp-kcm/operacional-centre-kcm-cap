import type { WorkerNumber } from "../comun/numero-trabajador.ts";

export type ImportBatchId = string & { readonly __marca: "ImportBatchId" };
export type RequestId = string & { readonly __marca: "RequestId" };
export type TrainingId = string & { readonly __marca: "TrainingId" };
export type CourseSourceKey = string & { readonly __marca: "CourseSourceKey" };

export type ImportScope = "FULL" | "DELTA";

export type BatchPhase =
  "RECIBIDO" | "PREPARADO" | "VALIDADO" | "APROBADO" | "CONFIRMADO" | "RECHAZADO" | "CONFLICTO";

export type DateProvenance = "XLSB_IMPORT" | "SESSION_RELEASE";

export type RecordStatus = "VIGENTE" | "RETIRADO";

export type ChangeType = "ALTA" | "CORREGIDA" | "RETIRADA" | "REACTIVADA" | "SOBRESCRITA";

export interface SnapshotEmployee {
  readonly employeeId: WorkerNumber;
  readonly displayName: string;
  readonly hireDate: string | null;
  readonly payrollType: string | null;
  readonly position: string | null;
  readonly department: string | null;
  readonly area: string | null;
  readonly plant: string | null;
}

export interface SnapshotCourse {
  readonly sourceKey: string;
  readonly sourceColumn: string;
  readonly displayName: string;
  readonly normalizedName: string;
}

export interface SnapshotCompletion {
  readonly employeeId: WorkerNumber;
  readonly sourceKey: string;
  readonly completionDate: string;
}

export interface SnapshotDiagnosticsCounts {
  readonly employeeCount: number;
  readonly courseCount: number;
  readonly completionCount: number;
  readonly skippedEmployeeCount: number;
  readonly skippedCourseCount: number;
  readonly skippedCompletionCount: number;
  readonly formulaCellCount: number;
  readonly formulaCachedValueCount: number;
  readonly formulaErrorCount: number;
  readonly externalLinkCount: number;
  readonly mergedCellCount: number;
}

export interface DiagnosticIssue {
  readonly code: string;
  readonly count: number;
  readonly detail?: string;
}

export interface SnapshotDiagnostics {
  readonly counts: SnapshotDiagnosticsCounts;
  readonly issues: readonly DiagnosticIssue[];
}

export interface MatrixSnapshotSource {
  readonly fileName: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly sheetName: string;
}

export interface MatrixSnapshot {
  readonly schemaVersion: "HC_SNAPSHOT_V1";
  readonly source: MatrixSnapshotSource;
  readonly extractedAt: string;
  readonly employees: readonly SnapshotEmployee[];
  readonly courses: readonly SnapshotCourse[];
  readonly completions: readonly SnapshotCompletion[];
  readonly diagnostics: SnapshotDiagnostics;
}

export interface CourseMapping {
  readonly sourceKey: string;
  readonly trainingId: string;
}

export interface ImportBatchCounts {
  totalEmployees: number;
  totalCourses: number;
  totalCompletions: number;
  insertedCount: number;
  correctedCount: number;
  retiredCount: number;
  reactivatedCount: number;
  conflictCount: number;
  pendingMasterCount: number;
}

export interface ImportBatch {
  readonly importId: string;
  readonly requestId: string;
  readonly sourceSha256: string;
  readonly snapshotSha256: string;
  readonly sourceFileName: string;
  readonly sourceSheetName: string;
  readonly sourceExtractedAt: string;
  phase: BatchPhase;
  scope: ImportScope;
  counts: ImportBatchCounts;
  diagnostics: SnapshotDiagnostics;
  readonly createdBy: string;
  readonly createdAt: string;
  completedAt: string | null;
  rejectionReason: string | null;
  approvalActorId: string | null;
  approvalReason: string | null;
  version: number;
}

export interface HcRecord {
  readonly recordId: string;
  readonly idempotencyKey: string;
  readonly workerNumber: WorkerNumber;
  readonly trainingId: string;
  completionDate: string;
  provenance: DateProvenance;
  status: RecordStatus;
  sessionId: string | null;
  releaseId: string | null;
  mappingVersion: string;
  batchId: string | null;
  marker: string | null;
  importId: string | null;
  requestId: string | null;
  readonly createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HcRecordHistory {
  readonly historyId: string;
  readonly recordId: string;
  readonly workerNumber: WorkerNumber;
  readonly trainingId: string;
  readonly changeType: ChangeType;
  readonly previousCompletionDate: string | null;
  readonly completionDate: string | null;
  readonly previousStatus: RecordStatus | null;
  readonly status: RecordStatus;
  readonly provenance: DateProvenance;
  readonly actorId: string;
  readonly reason: string;
  readonly requestId: string | null;
  readonly importId: string | null;
  readonly recordedAt: string;
}

export interface CandidateCourse {
  readonly candidateId: string;
  readonly sourceKey: string;
  readonly detectedName: string;
  readonly normalizedName: string;
  readonly sourceOrigin: "XLSB_MATRIZ" | "EXTRACTO_EXTERNO";
  status: "PENDIENTE" | "INCORPORADO" | "DECLARADO_ALIAS" | "RECHAZADO";
  assignedTrainingId: string | null;
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  readonly createdAt: string;
}

export interface CandidateWorker {
  readonly candidateId: string;
  readonly workerNumber: WorkerNumber;
  readonly detectedName: string;
  readonly laborData: Record<string, unknown>;
  readonly sourceOrigin: "XLSB_MATRIZ" | "EXTRACTO_EXTERNO";
  status: "PENDIENTE" | "INCORPORADO" | "RECHAZADO";
  assignedWorkerId: string | null;
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  readonly createdAt: string;
}

export interface WorkerCatalogEntry {
  readonly workerNumber: WorkerNumber;
  displayName: string;
  hireDate: string | null;
  payrollType: string | null;
  position: string | null;
  department: string | null;
  area: string | null;
  plant: string | null;
  active: boolean;
  seenInRoster?: boolean;
  seenInMatrix?: boolean;
  sourceHash: string | null;
  updatedAt: string;
}

export interface CourseCatalogEntry {
  readonly trainingId: string;
  sourceKey: string;
  sourceName: string;
  normalizedName: string;
  aliases: readonly string[];
  active: boolean;
  firstSeenImportId: string;
  lastSeenImportId: string;
  updatedAt: string;
}

export interface ConflictDetail {
  readonly workerNumber: WorkerNumber;
  readonly trainingId: string;
  readonly existingDate: string;
  readonly existingProvenance: DateProvenance;
  readonly snapshotDate: string;
  readonly reason: string;
}

export interface BatchValidationResult {
  readonly phase: "VALIDADO" | "CONFLICTO" | "RECHAZADO";
  readonly counts: ImportBatchCounts;
  readonly conflicts: readonly ConflictDetail[];
  readonly unknownCourses: readonly SnapshotCourse[];
  readonly unknownWorkers: readonly SnapshotEmployee[];
  readonly issues: readonly DiagnosticIssue[];
}

export interface BatchApplicationResult {
  readonly importId: string;
  readonly requestId: string;
  readonly status: "COMPLETADO" | "REPETIDO" | "CONFLICTO" | "RECHAZADO";
  readonly repeated: boolean;
  readonly counts: ImportBatchCounts;
  readonly validation: BatchValidationResult;
}
