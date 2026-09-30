import { DomainError } from "../comun/errores.ts";

export class ReleaseConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICTO_LIBERACION", message);
    this.name = "ReleaseConflictError";
  }
}

export class InvalidReleaseStateError extends DomainError {
  constructor(message: string) {
    super("ESTADO_LIBERACION_INVALIDO", message);
    this.name = "InvalidReleaseStateError";
  }
}

export class ReleaseInputError extends DomainError {
  constructor(message: string) {
    super("ENTRADA_LIBERACION_INVALIDA", message);
    this.name = "ReleaseInputError";
  }
}

export class ReleaseIntegrityError extends DomainError {
  constructor(message: string) {
    super("INTEGRIDAD_LIBERACION", message);
    this.name = "ReleaseIntegrityError";
  }
}

export class ReleaseForbiddenError extends DomainError {
  constructor(message: string) {
    super("LIBERACION_NO_AUTORIZADA", message);
    this.name = "ReleaseForbiddenError";
  }
}
