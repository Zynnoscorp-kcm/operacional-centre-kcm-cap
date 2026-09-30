import type { Writable } from "node:stream";
import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "../config/environment.ts";

const NUMERO_TRABAJADOR = /(?<!\d)\d{5}(?!\d)/gu;

const CURP = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b/giu;

const CORREO = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;

const MASCARA_NUMERO_TRABAJADOR = "#####";
const MASCARA_CURP = "«curp-oculta»";
const MASCARA_CORREO = "«correo-oculto»";

const PROFUNDIDAD_MAXIMA = 6;

export function scrubPersonalData(texto: string): string {
  return texto
    .replace(CURP, MASCARA_CURP)
    .replace(CORREO, MASCARA_CORREO)
    .replace(NUMERO_TRABAJADOR, MASCARA_NUMERO_TRABAJADOR);
}

export function scrubUnknown(valor: unknown, profundidad = 0): unknown {
  if (typeof valor === "string") return scrubPersonalData(valor);
  if (valor === null || typeof valor !== "object") return valor;
  if (profundidad >= PROFUNDIDAD_MAXIMA) return "«profundidad-excedida»";

  if (Array.isArray(valor)) {
    return valor.map((elemento) => scrubUnknown(elemento, profundidad + 1));
  }
  if (!esObjetoPlano(valor)) return valor;

  const saneado: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    saneado[clave] = scrubUnknown(contenido, profundidad + 1);
  }
  return saneado;
}

function esObjetoPlano(valor: object): boolean {
  const prototipo: unknown = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

interface PeticionRegistrable {
  readonly id: unknown;
  readonly method: string;
  readonly url: string;
}

interface RespuestaRegistrable {
  readonly statusCode: number;
}

export function buildLoggerOptions(
  config: AppConfig,
  destino?: Writable,
): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.logLevel,
    ...(destino === undefined ? {} : { stream: destino }),

    redact: {
      paths: [
        "req.headers",
        "res.headers",
        "headers",
        "body",
        "password",
        "token",
        "curp",
        "employeeId",
        "*.curp",
        "*.employeeId",
      ],
      censor: "«oculto»",
    },

    serializers: {
      req(peticion: PeticionRegistrable) {
        return {
          requestId: String(peticion.id),
          method: peticion.method,
          url: scrubPersonalData(peticion.url),
        };
      },
      res(respuesta: RespuestaRegistrable) {
        return { statusCode: respuesta.statusCode };
      },
      err(error: Error) {
        return {
          type: error.name,
          message: scrubPersonalData(error.message),
          stack: error.stack === undefined ? "" : scrubPersonalData(error.stack),
        };
      },
    },

    formatters: {
      log(objeto: Record<string, unknown>): Record<string, unknown> {
        return scrubUnknown(objeto) as Record<string, unknown>;
      },
    },

    hooks: {
      logMethod(argumentos: unknown[], metodo: (...args: unknown[]) => void): void {
        metodo.apply(
          this,
          argumentos.map((argumento) => scrubUnknown(argumento)),
        );
      },
    },
  };
}
