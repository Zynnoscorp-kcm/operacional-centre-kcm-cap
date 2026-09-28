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
