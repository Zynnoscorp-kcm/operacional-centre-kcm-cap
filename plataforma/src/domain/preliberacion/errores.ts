/**
 * Errores de dominio para Preliberación.
 */

import { DomainError } from "../errores.ts";

export class PreReleaseNotFoundError extends DomainError {
  constructor(message = "La revisión de preliberación no existe.") {
    super("PRELIBERACION_NO_ENCONTRADA", message);
    this.name = "PreReleaseNotFoundError";
  }
}

export class InvalidPreReleaseStateError extends DomainError {
  constructor(message: string) {
    super("ESTADO_PRELIBERACION_INVALIDO", message);
    this.name = "InvalidPreReleaseStateError";
  }
}

export class PreReleaseConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICTO_PRELIBERACION", message);
    this.name = "PreReleaseConflictError";
  }
}

export class PreReleaseDuplicateError extends DomainError {
  constructor(message: string) {
    super("DUPLICADO_PRELIBERACION", message);
    this.name = "PreReleaseDuplicateError";
  }
}

export class PreReleaseCapacityError extends DomainError {
  constructor(message = "La sesión alcanzó el máximo de registros.") {
    super("CAPACIDAD_PRELIBERACION", message);
    this.name = "PreReleaseCapacityError";
  }
}

export class PreReleaseInputError extends DomainError {
  constructor(message: string) {
    super("ENTRADA_PRELIBERACION_INVALIDA", message);
    this.name = "PreReleaseInputError";
  }
}
