/**
 * Registro de eventos sin datos personales.
 *
 * La bitácora es el lugar más fácil por donde se fuga un dato personal: nadie
 * revisa un `log.info` con la atención con que revisa una respuesta HTTP, y una
 * ruta como `/trabajador/01234` publica un número de nómina sin que nadie lo
 * haya decidido. Por eso el saneamiento no es responsabilidad de quien
 * escribe la línea: se aplica en el transporte, a todo lo que pase por él.
 *
 * Regla de la máscara: se enmascara texto, nunca números. Un `responseTime`
 * o un `statusCode` viajan como número y sobreviven intactos; un número de
 * nómina o una CURP siempre llegan como texto —el invariante del proyecto es
 * justamente que el número de trabajador jamás se convierte a número— y ahí es
 * donde muerde la máscara.
 *
 * Lo que esto no es: anonimización. Es una última barrera para el descuido.
 * La regla vigente sigue siendo que no se procesan datos personales reales
 * antes del gate de producción.
 */

import type { Writable } from "node:stream";
import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "../config/environment.ts";

/** Cinco dígitos exactos: el patrón del número de trabajador, `^\d{5}$`. */
const NUMERO_TRABAJADOR = /(?<!\d)\d{5}(?!\d)/gu;

/** CURP: cuatro letras, seis dígitos de fecha, H o M, cinco letras, homoclave. */
const CURP = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b/giu;

const CORREO = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;

const MASCARA_NUMERO_TRABAJADOR = "#####";
const MASCARA_CURP = "«curp-oculta»";
const MASCARA_CORREO = "«correo-oculto»";

/** Tope de recursión al sanear objetos: una estructura cíclica no debe colgar el logger. */
const PROFUNDIDAD_MAXIMA = 6;

export function scrubPersonalData(texto: string): string {
  return texto
    .replace(CURP, MASCARA_CURP)
    .replace(CORREO, MASCARA_CORREO)
    .replace(NUMERO_TRABAJADOR, MASCARA_NUMERO_TRABAJADOR);
}

/**
 * Sanea cualquier valor que vaya a la bitácora. Cadenas enmascaradas; números,
 * booleanos y nulos intactos; objetos y arreglos recorridos hasta el tope.
 *
 * Sólo se reconstruyen los objetos planos. Un objeto con prototipo propio
 * —la petición de Fastify, un `Error`— se deja pasar tal cual, para que lo
 * atienda su serializador. Reconstruirlo con `Object.entries` lo rompería: la
 * petición expone `url` y `method` como descriptores del prototipo, no como
 * propiedades propias, así que la copia plana los perdería y el saneamiento
 * acabaría destruyendo justo la ruta que venía a limpiar. Costó un fallo de
 * prueba descubrirlo y por eso queda escrito.
 */
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

/**
 * Construye las opciones del registro para Fastify.
 *
 * Las cabeceras, el cuerpo y la dirección de origen no se serializan nunca.
 * Fastify no registra cuerpos por omisión, y aquí además se sustituyen los
 * serializadores de `req` y `res` por unos que sólo emiten campos declarados:
 * agregar un campo a la bitácora tiene que ser una decisión, no un efecto
 * colateral de que el framework lo traiga.
 */
export function buildLoggerOptions(
  config: AppConfig,
  destino?: Writable,
): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.logLevel,
    ...(destino === undefined ? {} : { stream: destino }),

    // Segunda red, por si una futura ejecución agrega un serializador propio.
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
        // El rastro de pila sí se conserva, en cualquier entorno: es bitácora
        // del servidor, no respuesta al cliente, y sin él una falla de
        // producción se investiga a ciegas. Va saneado como todo lo demás.
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
