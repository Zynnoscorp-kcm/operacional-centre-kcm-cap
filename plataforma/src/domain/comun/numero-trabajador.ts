import { DomainError } from "./errores.ts";

const PATRON_NUMERO_TRABAJADOR = /^\d{5}$/u;

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

function describirRechazo(valor: unknown): string {
  if (typeof valor === "number") return "se recibió un número; debe ser texto";
  if (typeof valor !== "string") return `se recibió ${typeof valor}; debe ser texto`;
  if (valor.length !== 5) return `longitud ${String(valor.length)}; deben ser 5 dígitos`;
  return "contiene caracteres que no son dígitos";
}
