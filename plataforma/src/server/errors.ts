/**
 * Errores de la capa web y su traducción a respuesta pública.
 *
 * Regla: lo interno no sale. Un 5xx siempre responde el mismo texto
 * genérico, cualquiera que sea la causa. El detalle vive en la bitácora, atado
 * al `requestId`, que es lo que la persona puede reportar sin que el mensaje de
 * error se convierta en un mapa del sistema.
 */

import { DomainError } from "../domain/comun/errores.ts";
import type { EnvironmentName } from "../config/environment.ts";

export type ErrorCode =
  | "SOLICITUD_INVALIDA"
  | "NO_AUTENTICADO"
  | "SIN_PERMISO"
  | "NO_ENCONTRADO"
  | "CONFLICTO"
  | "DEMASIADAS_SOLICITUDES"
  | "ERROR_INTERNO";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** El texto que sí se puede mostrar. `message` queda para la bitácora. */
  readonly publicMessage: string;

  constructor(
    code: ErrorCode,
    statusCode: number,
    publicMessage: string,
    internalMessage?: string,
  ) {
    super(internalMessage ?? publicMessage);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

export function badRequest(publicMessage: string, internalMessage?: string): AppError {
  return new AppError("SOLICITUD_INVALIDA", 400, publicMessage, internalMessage);
}

export function notFound(publicMessage = "No se encontró el recurso solicitado."): AppError {
  return new AppError("NO_ENCONTRADO", 404, publicMessage);
}

export interface ErrorPublico {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly message: string;
}

const MENSAJE_INTERNO_GENERICO =
  "Ocurrió un error en el servidor. El evento quedó registrado con el identificador de esta petición.";

/**
 * Códigos de dominio que no son «solicitud inválida».
 *
 * La traducción vive aquí y no en el error porque el dominio no conoce HTTP.
 * Sin esta tabla, pedir algo que no existe y pedir algo imposible responden lo
 * mismo, y quien integra no puede distinguir entre reintentar y corregir.
 *
 * Cada ejecución agrega los suyos; lo que no esté listado sigue cayendo en 400.
 */
const TRADUCCION_DE_DOMINIO: Readonly<Record<string, readonly [number, ErrorCode]>> = {
  // Preliberación (Función 4)
  PRELIBERACION_NO_ENCONTRADA: [404, "NO_ENCONTRADO"],
  DUPLICADO_PRELIBERACION: [409, "CONFLICTO"],
  CONFLICTO_PRELIBERACION: [409, "CONFLICTO"],
  ESTADO_PRELIBERACION_INVALIDO: [409, "CONFLICTO"],
  CAPACIDAD_PRELIBERACION: [409, "CONFLICTO"],
  // Salas, DC-3 y Excel (Funciones 6, 9 y 10)
  ROOM_NOT_FOUND: [404, "NO_ENCONTRADO"],
  ROOM_OVERLAP: [409, "CONFLICTO"],
  ROOM_REQUEST_CONFLICT: [409, "CONFLICTO"],
  DC3_JOB_BUSY: [409, "CONFLICTO"],
  UNAUTHORIZED_EXCEL: [401, "NO_AUTENTICADO"],
  EXCEL_CREDENTIAL_NOT_FOUND: [404, "NO_ENCONTRADO"],
  EXCEL_CREDENTIAL_ALREADY_ACTIVE: [409, "CONFLICTO"],
  EXCEL_IMPORT_NOT_FOUND: [404, "NO_ENCONTRADO"],
  EXCEL_ACK_CONFLICT: [409, "CONFLICTO"],
  // Consola interna: campos declarados y explorador de la base
  CAMPO_NO_ENCONTRADO: [404, "NO_ENCONTRADO"],
  CAMPO_DUPLICADO: [409, "CONFLICTO"],
  // Inexistente y vedada dan lo mismo a propósito: distinguirlas confirmaría
  // por el código de estado cuáles son las tablas que no se quieren enseñar.
  TABLA_NO_DISPONIBLE: [404, "NO_ENCONTRADO"],
};

/**
 * Traduce cualquier error a lo que se puede responder.
 *
 * `environment` no cambia el texto público: se recibe para dejar explícito que
 * la decisión de no filtrar detalle no depende del entorno. Un mensaje
 * interno que sólo se ocultara en producción se acabaría filtrando el día que
 * alguien despliegue con la variable mal puesta.
 */
export function toPublicError(error: unknown, _environment: EnvironmentName): ErrorPublico {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, code: error.code, message: error.publicMessage };
  }

  if (error instanceof DomainError) {
    const traduccion = TRADUCCION_DE_DOMINIO[error.code];
    if (traduccion) {
      return { statusCode: traduccion[0], code: traduccion[1], message: error.message };
    }
    return { statusCode: 400, code: "SOLICITUD_INVALIDA", message: error.message };
  }

  // Fastify marca sus fallas de validación y de formato con un statusCode 4xx
  // propio. Son culpa de la petición, no del servidor, y conviene distinguirlas.
  const statusCode = leerStatusCode(error);
  if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
    return {
      statusCode,
      code: statusCode === 404 ? "NO_ENCONTRADO" : "SOLICITUD_INVALIDA",
      message: "La solicitud no se pudo procesar tal como llegó.",
    };
  }

  return { statusCode: 500, code: "ERROR_INTERNO", message: MENSAJE_INTERNO_GENERICO };
}

function leerStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const valor = (error as { statusCode?: unknown }).statusCode;
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}
