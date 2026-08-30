/**
 * Número de trabajador.
 *
 * Invariante de la Parte 1 del plan, y el único que el andamiaje ya implementa:
 * es texto de cinco dígitos con patrón `^\d{5}$` y jamás se convierte a
 * número. `01234` y `1234` no son la misma persona, y `Number("01234")` borra
 * esa distinción en silencio.
 *
 * Se siembra aquí porque toda ejecución posterior lo necesita, no depende de
 * ninguna decisión abierta y da al dominio un habitante real que prueba que la
 * separación entre dominio, puertos, adaptadores y web funciona de punta a
 * punta.
 */

import { DomainError } from "./errores.ts";

const PATRON_NUMERO_TRABAJADOR = /^\d{5}$/u;

/**
 * Cadena marcada. El marcador sólo existe en tiempo de tipos: en ejecución esto
 * es un `string`, así que nunca hay un objeto envolvente que alguien pueda
 * pasar por accidente a `Number()`.
 */
export type WorkerNumber = string & { readonly __marca: "WorkerNumber" };

export class InvalidWorkerNumberError extends DomainError {
  constructor(descripcion: string) {
    super("NUMERO_TRABAJADOR_INVALIDO", `Número de trabajador inválido: ${descripcion}`);
    this.name = "InvalidWorkerNumberError";
  }
}

export function isWorkerNumber(valor: unknown): valor is WorkerNumber {
  return typeof valor === "string" && PATRON_NUMERO_TRABAJADOR.test(valor);
}

/**
 * Devuelve el número validado o `null`. No normaliza, no rellena con ceros y no
 * recorta espacios: un valor que llega mal formado es un hecho del origen y se
 * reporta, no se repara por adivinanza.
 */
export function tryParseWorkerNumber(valor: unknown): WorkerNumber | null {
  return isWorkerNumber(valor) ? valor : null;
}

export function parseWorkerNumber(valor: unknown): WorkerNumber {
  const validado = tryParseWorkerNumber(valor);
  if (validado === null) {
    throw new InvalidWorkerNumberError(describirRechazo(valor));
  }
  return validado;
}

/**
 * Describe por qué se rechazó sin reproducir el valor. El número de
 * trabajador es dato personal y este texto viaja a la bitácora y a la respuesta
 * de error.
 */
function describirRechazo(valor: unknown): string {
  if (typeof valor === "number") return "se recibió un número; debe ser texto";
  if (typeof valor !== "string") return `se recibió ${typeof valor}; debe ser texto`;
  if (valor.length !== 5) return `longitud ${String(valor.length)}; deben ser 5 dígitos`;
  return "contiene caracteres que no son dígitos";
}
