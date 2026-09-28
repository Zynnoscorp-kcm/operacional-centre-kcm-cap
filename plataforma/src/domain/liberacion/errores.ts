/**
 * Errores de dominio para Liberación.
 *
 * Se separan a propósito de los de preliberación: un conflicto de liberación
 * significa que hubo o pudo haber un efecto sobre el dato histórico, y esa es
 * la clase de falla que debe distinguirse de una entrada mal formada.
 */

import { DomainError } from "../comun/errores.ts";

/** El lote no puede continuar sin que alguien resuelva la discrepancia. */
export class ReleaseConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICTO_LIBERACION", message);
    this.name = "ReleaseConflictError";
  }
}

/** La sesión no está en un estado desde el que se pueda liberar. */
export class InvalidReleaseStateError extends DomainError {
  constructor(message: string) {
    super("ESTADO_LIBERACION_INVALIDO", message);
    this.name = "InvalidReleaseStateError";
  }
}

/** La solicitud llegó mal formada; nada se tocó. */
export class ReleaseInputError extends DomainError {
  constructor(message: string) {
    super("ENTRADA_LIBERACION_INVALIDA", message);
    this.name = "ReleaseInputError";
  }
}

/**
 * El journal dejó de ser auténtico o íntegro. Es distinto de un conflicto de
 * negocio: aquí lo que falló es la prueba de que el lote es el que se firmó.
 */
export class ReleaseIntegrityError extends DomainError {
  constructor(message: string) {
    super("INTEGRIDAD_LIBERACION", message);
    this.name = "ReleaseIntegrityError";
  }
}

/** Falta autorización para el efecto solicitado. */
export class ReleaseForbiddenError extends DomainError {
  constructor(message: string) {
    super("LIBERACION_NO_AUTORIZADA", message);
    this.name = "ReleaseForbiddenError";
  }
}
