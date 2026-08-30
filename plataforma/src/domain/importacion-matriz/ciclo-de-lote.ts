/**
 * Máquina de estados para el ciclo de vida de lotes de importación de matriz.
 *
 * Fases:
 * 1. RECIBIDO: Se recibe el archivo o snapshot y se calculan hashes de integridad.
 * 2. PREPARADO: Se parsea el contenido y se extraen entidades y diagnósticos.
 * 3. VALIDADO: Se corre el preflight de conciliación, detectando candidatos, novedades y conflictos.
 * 4. APROBADO: Un actor autorizado aprueba el lote y sus mapeos.
 * 5. CONFIRMADO: Se aplican los cambios a las tablas de forma atómica.
 *
 * Terminales:
 * - RECHAZADO: Rechazado explícitamente por el operador o por fallo irrecuperable.
 * - CONFLICTO: Detecta contradicciones con fechas de plataforma o catálogo sin resolver.
 */

import { InvalidBatchPhaseError, MatrixConflictError } from "./errores.ts";
import type { ImportBatch, ImportBatchCounts, ImportScope, SnapshotDiagnostics } from "./tipos.ts";

export interface CreateBatchParams {
  readonly importId: string;
  readonly requestId: string;
  readonly sourceSha256: string;
  readonly snapshotSha256: string;
  readonly sourceFileName: string;
  readonly sourceSheetName: string;
  readonly sourceExtractedAt: string;
  readonly createdBy: string;
  readonly scope?: ImportScope;
}

export function createImportBatch(params: CreateBatchParams): ImportBatch {
  const initialCounts: ImportBatchCounts = {
    totalEmployees: 0,
    totalCourses: 0,
    totalCompletions: 0,
    insertedCount: 0,
    correctedCount: 0,
    retiredCount: 0,
    reactivatedCount: 0,
    conflictCount: 0,
    pendingMasterCount: 0,
  };

  const emptyDiagnostics: SnapshotDiagnostics = {
    counts: {
      employeeCount: 0,
      courseCount: 0,
      completionCount: 0,
      skippedEmployeeCount: 0,
      skippedCourseCount: 0,
      skippedCompletionCount: 0,
      formulaCellCount: 0,
      formulaCachedValueCount: 0,
      formulaErrorCount: 0,
      externalLinkCount: 0,
      mergedCellCount: 0,
    },
    issues: [],
  };

  return {
    importId: params.importId,
    requestId: params.requestId,
    sourceSha256: params.sourceSha256,
    snapshotSha256: params.snapshotSha256,
    sourceFileName: params.sourceFileName,
    sourceSheetName: params.sourceSheetName,
    sourceExtractedAt: params.sourceExtractedAt,
    phase: "RECIBIDO",
    scope: params.scope ?? "FULL",
    counts: initialCounts,
    diagnostics: emptyDiagnostics,
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    completedAt: null,
    rejectionReason: null,
    approvalActorId: null,
    approvalReason: null,
    version: 1,
  };
}

export function transitionToPrepared(
  batch: ImportBatch,
  scope: ImportScope,
  diagnostics: SnapshotDiagnostics,
  counts: Partial<ImportBatchCounts>,
): ImportBatch {
  if (batch.phase !== "RECIBIDO") {
    throw new InvalidBatchPhaseError(batch.phase, "RECIBIDO");
  }

  batch.phase = "PREPARADO";
  batch.scope = scope;
  batch.diagnostics = diagnostics;
  batch.counts = { ...batch.counts, ...counts };
  batch.version += 1;
  return batch;
}

export function transitionToValidated(
  batch: ImportBatch,
  counts: ImportBatchCounts,
  hasConflicts: boolean,
): ImportBatch {
  if (batch.phase !== "PREPARADO" && batch.phase !== "RECIBIDO") {
    throw new InvalidBatchPhaseError(batch.phase, "PREPARADO");
  }

  batch.counts = { ...counts };
  if (hasConflicts || counts.conflictCount > 0) {
    batch.phase = "CONFLICTO";
  } else {
    batch.phase = "VALIDADO";
  }
  batch.version += 1;
  return batch;
}

export function transitionToApproved(
  batch: ImportBatch,
  approverActorId: string,
  approvalReason: string,
): ImportBatch {
  if (batch.phase !== "VALIDADO") {
    if (batch.phase === "CONFLICTO") {
      throw new MatrixConflictError("No se puede aprobar un lote con conflictos no resueltos");
    }
    throw new InvalidBatchPhaseError(batch.phase, "VALIDADO");
  }

  batch.phase = "APROBADO";
  batch.approvalActorId = approverActorId;
  batch.approvalReason = approvalReason;
  batch.version += 1;
  return batch;
}

export function transitionToConfirmed(
  batch: ImportBatch,
  finalCounts?: Partial<ImportBatchCounts>,
): ImportBatch {
  if (batch.phase !== "APROBADO" && batch.phase !== "VALIDADO") {
    throw new InvalidBatchPhaseError(batch.phase, "APROBADO");
  }

  batch.phase = "CONFIRMADO";
  if (finalCounts) {
    batch.counts = { ...batch.counts, ...finalCounts };
  }
  batch.completedAt = new Date().toISOString();
  batch.version += 1;
  return batch;
}

export function transitionToRejected(batch: ImportBatch, reason: string): ImportBatch {
  if (batch.phase === "CONFIRMADO") {
    throw new InvalidBatchPhaseError(batch.phase, "NO_CONFIRMADO");
  }

  batch.phase = "RECHAZADO";
  batch.rejectionReason = reason;
  batch.completedAt = new Date().toISOString();
  batch.version += 1;
  return batch;
}
