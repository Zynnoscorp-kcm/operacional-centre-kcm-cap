/**
 * Puerto de modelo de lenguaje.
 *
 * El agente de ocupaciones no sabe qué proveedor contesta. Pide un objeto JSON
 * con un esquema y recibe el objeto, quién lo produjo y cuánto costó en tokens.
 * Así cambiar de Groq a Gemini —o sumar un respaldo— es cambiar el adaptador y
 * no el grafo, y las pruebas corren contra un modelo de mentira sin red.
 *
 * Lo que viaja por aquí es sólo lo que el dominio arma: puesto, centro de costos
 * y fragmentos del catálogo. Ningún adaptador debe añadir datos por su cuenta.
 */

export interface SolicitudJson {
  /** Instrucciones del paso: el mensaje de sistema. */
  readonly instrucciones: string;
  /** El caso y las opciones: el mensaje del usuario. */
  readonly mensaje: string;
  /** Esquema JSON que la respuesta debe cumplir. El dominio vuelve a validarla al recibirla. */
  readonly esquema: {
    readonly nombre: string;
    readonly definicion: Readonly<Record<string, unknown>>;
  };
  /**
   * Si la respuesta tiene la forma pedida. Una que no la tiene es una falla de
   * ese modelo, como si no fuera JSON, y la cadena pasa al respaldo.
   */
  readonly validar?: (datos: unknown) => boolean;
}

export interface RespuestaJson {
  /** El objeto ya interpretado, todavía sin validar contra el esquema. */
  readonly datos: unknown;
  /** Proveedor y modelo que respondieron de verdad; con respaldo puede no ser el primero. */
  readonly proveedor: string;
  readonly modelo: string;
  readonly tokensDeEntrada: number | null;
  readonly tokensDeSalida: number | null;
  readonly milisegundos: number;
  /** Modelos de la cadena que fallaron antes del que respondió, con su motivo. */
  readonly desvios: readonly string[];
}

export interface OpcionesDeLlamada {
  /**
   * Lo que le queda al caso. El adaptador corta la llamada antes, aunque su
   * propio tope sea mayor: una respuesta que llega tarde ya no sirve.
   */
  readonly tiempoMaximoMs?: number;
}

export interface ModeloDeLenguajePort {
  /** `proveedor/modelo` del primero de la cadena; lo que se anota en la huella de configuración. */
  readonly nombre: string;
  responderJson(solicitud: SolicitudJson, opciones?: OpcionesDeLlamada): Promise<RespuestaJson>;
}

/**
 * Por qué no hubo respuesta. Cualquier motivo pasa al siguiente modelo de la
 * cadena de respaldo; el motivo sólo decide si vale la pena reintentar después.
 *
 * - `LIMITE`: 429, tope del plan. Se reintenta: el tope por minuto se repone.
 * - `NO_DISPONIBLE`: 5xx, tiempo agotado o red. Se reintenta.
 * - `RESPUESTA`: contestó algo que no es el JSON pedido. Se reintenta.
 * - `DEMASIADO_GRANDE`: 413, la petición no cabe en el plan. Reintentar no sirve.
 * - `MODELO`: 404, el modelo no existe o se retiró del plan gratuito.
 * - `LLAVE`: 401 o 403. Una llave mala no mejora esperando.
 * - `SOLICITUD`: cualquier otro 4xx; un defecto del lado de la plataforma.
 */
export type MotivoDeFalla =
  "LIMITE" | "NO_DISPONIBLE" | "RESPUESTA" | "DEMASIADO_GRANDE" | "MODELO" | "LLAVE" | "SOLICITUD";

const SE_REINTENTAN: ReadonlySet<MotivoDeFalla> = new Set(["LIMITE", "NO_DISPONIBLE", "RESPUESTA"]);

/**
 * Falla de un proveedor. El mensaje nunca lleva el texto de la petición ni de
 * la respuesta: termina en la bitácora del servidor.
 */
export class FallaDeModelo extends Error {
  readonly motivo: MotivoDeFalla;
  /** Espera sugerida por el proveedor (`retry-after`), si la dio. */
  readonly esperaMs: number | null;

  constructor(motivo: MotivoDeFalla, mensaje: string, esperaMs: number | null = null) {
    super(mensaje);
    this.name = "FallaDeModelo";
    this.motivo = motivo;
    this.esperaMs = esperaMs;
  }

  get seReintenta(): boolean {
    return SE_REINTENTAN.has(this.motivo);
  }
}
