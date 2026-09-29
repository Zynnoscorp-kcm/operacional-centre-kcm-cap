/**
 * Errores de dominio para Quiosco y Sesiones.
 */

import { DomainError } from "../comun/errores.ts";

export class SessionNotFoundError extends DomainError {
  constructor(message = "La sesión no existe o no está disponible.") {
    super("SESION_NO_ENCONTRADA", message);
    this.name = "SessionNotFoundError";
  }
}

export class InvalidSessionStateError extends DomainError {
  constructor(message: string) {
    super("ESTADO_SESION_INVALIDO", message);
    this.name = "InvalidSessionStateError";
  }
}

export class SessionConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICTO_SESION", message);
    this.name = "SessionConflictError";
  }
}

export class KioskAuthError extends DomainError {
  constructor(message = "El acceso no está autorizado o expiró.") {
    super("QUIOSCO_NO_AUTORIZADO", message);
    this.name = "KioskAuthError";
  }
}

export class RateLimitExceededError extends DomainError {
  constructor(message = "Demasiados intentos; espere unos minutos antes de reintentar.") {
    super("LIMITE_TASA_EXCEDIDO", message);
    this.name = "RateLimitExceededError";
  }
}

export class CapacityExceededError extends DomainError {
  constructor(message = "El cupo máximo de la sesión ha sido alcanzado.") {
    super("CUPO_EXCEDIDO", message);
    this.name = "CapacityExceededError";
  }
}

export class InvalidInputError extends DomainError {
  constructor(message: string) {
    super("ENTRADA_INVALIDA", message);
    this.name = "InvalidInputError";
  }
}

/**
 * Otra sesión se quedó con el código que se iba a dar. Pasa cuando dos
 * sesiones se crean a la vez y las dos piden el mismo consecutivo: la base lo
 * impide con su unicidad, el repositorio lo avisa con este error y el servicio
 * vuelve a pedir el siguiente. No llega a la pantalla.
 */
export class SessionCodeTakenError extends DomainError {
  constructor(message = "El código de sesión ya lo tiene otra sesión.") {
    super("CODIGO_DE_SESION_OCUPADO", message);
    this.name = "SessionCodeTakenError";
  }
}

/** Ya se dio `KC-9999`, el último código de cuatro cifras. */
export class SessionCodesExhaustedError extends DomainError {
  constructor(
    message = "Ya se dio el código KC-9999, el último de cuatro cifras: no hay código para una sesión nueva.",
  ) {
    super("CODIGOS_DE_SESION_AGOTADOS", message);
    this.name = "SessionCodesExhaustedError";
  }
}
