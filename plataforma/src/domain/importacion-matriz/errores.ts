/**
 * Errores específicos del dominio de importación y reconciliación de matriz.
 */

import { DomainError } from "../comun/errores.ts";

export class MatrixImportError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "MatrixImportError";
  }
}

export class InvalidSnapshotError extends MatrixImportError {
  constructor(message: string) {
    super("SNAPSHOT_INVALIDO", message);
    this.name = "InvalidSnapshotError";
  }
}

export class StaleSnapshotError extends MatrixImportError {
  constructor(message = "El snapshot es anterior al estado actualmente vigente en la plataforma") {
    super("SNAPSHOT_OBSOLETO", message);
    this.name = "StaleSnapshotError";
  }
}

export class MatrixConflictError extends MatrixImportError {
  constructor(message: string) {
    super("CONFLICTO_MATRIZ", message);
    this.name = "MatrixConflictError";
  }
}

export class InvalidBatchPhaseError extends MatrixImportError {
  constructor(actualPhase: string, requiredPhase: string) {
    super(
      "FASE_LOTE_INVALIDA",
      `El lote está en fase '${actualPhase}', pero se requería '${requiredPhase}'`,
    );
    this.name = "InvalidBatchPhaseError";
  }
}

export class UnmappedCourseError extends MatrixImportError {
  constructor(message: string) {
    super("CURSO_NO_MAPEADO", message);
    this.name = "UnmappedCourseError";
  }
}
