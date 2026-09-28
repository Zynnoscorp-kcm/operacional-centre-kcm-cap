/**
 * Modelos que hablan el formato «chat completions»: Groq, Gemini (por su
 * puerta compatible) y OpenRouter.
 *
 * Es `fetch` y nada más. Los tres proveedores aceptan la misma forma de
 * petición, así que un cliente por proveedor sería añadir dependencias para
 * cambiar una URL. El respaldo entre proveedores vive en `ModeloConRespaldo`.
 *
 * Lo que este archivo cuida:
 *
 * - **Nada del contenido llega a la bitácora.** Los mensajes de falla dicen el
 *   proveedor y el código HTTP, nunca el texto enviado ni el recibido.
 * - **La llave sólo viaja en la cabecera** y no aparece en ningún mensaje.
 * - **Cada llamada tiene su propio tiempo máximo**, por debajo del que el grafo
 *   da al caso completo.
 */

import { setTimeout as esperar } from "node:timers/promises";

import {
  FallaDeModelo,
  type ModeloDeLenguajePort,
  type MotivoDeFalla,
  type OpcionesDeLlamada,
  type RespuestaJson,
  type SolicitudJson,
} from "../../ports/modelo-de-lenguaje.port.ts";

export type EsfuerzoDeRazonamiento = "low" | "medium" | "high";

export interface DestinoDeModelo {
  readonly proveedor: string;
  /** Base de la API, sin barra final: `https://api.groq.com/openai/v1`. */
  readonly url: string;
  readonly modelo: string;
  readonly llave: string;
  /**
   * Sólo para modelos que lo aceptan. Algunos (Qwen en Groq) responden 400 si
   * se les manda, por eso es opcional y se declara modelo por modelo.
   */
  readonly esfuerzo?: EsfuerzoDeRazonamiento;
  /**
   * `json_schema` pide decodificación restringida al esquema; `json_object`
   * sólo pide JSON, para modelos que no aceptan esquema. En los dos casos el
   * dominio vuelve a validar la respuesta.
   */
  readonly formato: "json_schema" | "json_object";
  readonly maxTokensDeSalida: number;
  /**
   * Nombre del tope de salida en el cuerpo. OpenAI y Groq usan
   * `max_completion_tokens`; OpenRouter documenta `max_tokens`.
   */
  readonly campoDeTope?: "max_tokens" | "max_completion_tokens";
  /**
   * Campos propios del proveedor que se agregan tal cual al cuerpo, como el
   * `reasoning` y el `provider` de OpenRouter. Viven en la configuración
   * versionada y entran en la huella.
   */
  readonly extras?: Readonly<Record<string, unknown>>;
  readonly tiempoMaximoMs: number;
}

type Fetch = typeof fetch;

function motivoPorEstado(estado: number): MotivoDeFalla {
  if (estado === 429) return "LIMITE";
  if (estado === 413) return "DEMASIADO_GRANDE";
  if (estado === 404) return "MODELO";
  if (estado === 401 || estado === 403) return "LLAVE";
  if (estado === 408 || estado >= 500) return "NO_DISPONIBLE";
  return "SOLICITUD";
}

/** `retry-after` en segundos o como fecha; `null` si no vino o no se entiende. */
function esperaSugerida(respuesta: Response, ahora: number): number | null {
  const valor = respuesta.headers.get("retry-after");
  if (!valor) return null;
  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) return Math.round(segundos * 1000);
  const fecha = Date.parse(valor);
  return Number.isFinite(fecha) ? Math.max(0, fecha - ahora) : null;
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function entero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : null;
}

/**
 * El texto de la respuesta como objeto. Tolera el cerco ```json y un bloque
 * `<think>` inicial, que algunos modelos ponen aun cuando se les pide JSON puro.
 */
function interpretar(contenido: string): unknown {
  const sinCerco = contenido
    // Algunos modelos anteponen su razonamiento entre etiquetas aunque se les
    // pida no devolverlo; lo que importa es el JSON que viene después.
    .replace(/^\s*<think>[\s\S]*?<\/think>/iu, "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  return JSON.parse(sinCerco) as unknown;
}

/**
 * Cuánto se espera, como máximo, cuando el proveedor dice «vuelve en N
 * segundos» por un 429. En los planes gratuitos el tope por minuto se repone
 * pronto y esperar es mejor que saltar al respaldo; más allá de esto se salta.
 */
const ESPERA_MAXIMA_POR_LIMITE_MS = 20_000;

export class ModeloChatCompatible implements ModeloDeLenguajePort {
  readonly nombre: string;
  readonly #destino: DestinoDeModelo;
  readonly #fetch: Fetch;
  readonly #reloj: () => number;
  readonly #esperaMaximaPorLimiteMs: number;

  constructor(
    destino: DestinoDeModelo,
    opciones: {
      readonly fetch?: Fetch;
      readonly reloj?: () => number;
      readonly esperaMaximaPorLimiteMs?: number;
    } = {},
  ) {
    this.#destino = destino;
    this.#fetch = opciones.fetch ?? fetch;
    this.#reloj = opciones.reloj ?? Date.now;
    this.#esperaMaximaPorLimiteMs = opciones.esperaMaximaPorLimiteMs ?? ESPERA_MAXIMA_POR_LIMITE_MS;
    this.nombre = `${destino.proveedor}/${destino.modelo}`;
  }

  /**
   * Una llamada; ante un 429 con espera corta, espera lo pedido y lo intenta
   * una vez más, siempre que la espera y la segunda llamada quepan en el tiempo
   * que le queda al caso.
   */
  async responderJson(
    solicitud: SolicitudJson,
    opciones: OpcionesDeLlamada = {},
  ): Promise<RespuestaJson> {
    const comienzo = this.#reloj();
    const limite = Math.min(
      this.#destino.tiempoMaximoMs,
      opciones.tiempoMaximoMs ?? Number.POSITIVE_INFINITY,
    );
    try {
      return await this.#llamar(solicitud, limite);
    } catch (error) {
      const espera =
        error instanceof FallaDeModelo && error.motivo === "LIMITE" ? error.esperaMs : null;
      if (espera === null || espera > this.#esperaMaximaPorLimiteMs) throw error;
      const restante = limite - (this.#reloj() - comienzo) - espera;
      if (restante < 1000) throw error;
      await esperar(espera);
      return this.#llamar(solicitud, restante);
    }
  }

  async #llamar(solicitud: SolicitudJson, limiteMs: number): Promise<RespuestaJson> {
    const destino = this.#destino;
    const inicio = this.#reloj();
    const cuerpo = {
      model: destino.modelo,
      messages: [
        { role: "system", content: solicitud.instrucciones },
        { role: "user", content: solicitud.mensaje },
      ],
      [destino.campoDeTope ?? "max_completion_tokens"]: destino.maxTokensDeSalida,
      response_format:
        destino.formato === "json_schema"
          ? {
              type: "json_schema",
              json_schema: {
                name: solicitud.esquema.nombre,
                schema: solicitud.esquema.definicion,
                strict: true,
              },
            }
          : { type: "json_object" },
      ...(destino.esfuerzo ? { reasoning_effort: destino.esfuerzo } : {}),
      ...destino.extras,
    };

    let respuesta: Response;
    try {
      respuesta = await this.#fetch(`${destino.url}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${destino.llave}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(Math.max(1, Math.floor(limiteMs))),
      });
    } catch (error) {
      const tiempo = error instanceof Error && error.name === "TimeoutError";
      throw new FallaDeModelo(
        "NO_DISPONIBLE",
        tiempo
          ? `${this.nombre} no respondió en ${String(Math.floor(limiteMs))} ms`
          : `${this.nombre} no se pudo alcanzar`,
      );
    }

    if (!respuesta.ok) {
      // El cuerpo del error se descarta sin leerlo: podría repetir la petición.
      await respuesta.body?.cancel();
      throw new FallaDeModelo(
        motivoPorEstado(respuesta.status),
        `${this.nombre} respondió ${String(respuesta.status)}`,
        esperaSugerida(respuesta, this.#reloj()),
      );
    }

    let json: Record<string, unknown> | null;
    try {
      json = comoObjeto(await respuesta.json());
    } catch {
      json = null;
    }
    const eleccion = Array.isArray(json?.choices) ? comoObjeto(json.choices[0]) : null;
    // Un modelo que razona mucho puede gastar el tope antes de cerrar el JSON:
    // se dice así, y no como «respondió algo que no es JSON», para saber qué ajustar.
    if (eleccion?.finish_reason === "length") {
      throw new FallaDeModelo(
        "RESPUESTA",
        `${this.nombre} se cortó al llegar al tope de ${String(destino.maxTokensDeSalida)} tokens de salida`,
      );
    }
    const contenido = comoObjeto(eleccion?.message)?.content;
    if (typeof contenido !== "string" || contenido.trim() === "") {
      throw new FallaDeModelo("RESPUESTA", `${this.nombre} respondió sin contenido`);
    }

    let datos: unknown;
    try {
      datos = interpretar(contenido);
    } catch {
      throw new FallaDeModelo("RESPUESTA", `${this.nombre} respondió algo que no es JSON`);
    }
    if (solicitud.validar && !solicitud.validar(datos)) {
      throw new FallaDeModelo("RESPUESTA", `${this.nombre} respondió JSON con otra forma`);
    }

    const uso = comoObjeto(json?.usage);
    return {
      datos,
      proveedor: destino.proveedor,
      modelo: typeof json?.model === "string" && json.model ? json.model : destino.modelo,
      tokensDeEntrada: entero(uso?.prompt_tokens),
      tokensDeSalida: entero(uso?.completion_tokens),
      milisegundos: this.#reloj() - inicio,
      desvios: [],
    };
  }
}

export interface OpcionesDelRespaldo {
  /**
   * Cuánto se salta un modelo que no contestó a tiempo o se quedó sin cupo. Sin
   * esto, cada llamada esperaría al colgado hasta su tope y al respaldo le
   * quedaría muy poco tiempo para contestar.
   */
  readonly enfriamientoMs?: number;
  /** Con menos tiempo que esto no se empieza el siguiente modelo: gastaría cupo sin alcanzar. */
  readonly tiempoMinimoMs?: number;
  readonly reloj?: () => number;
}

/**
 * Una cadena de modelos: responde el primero que pueda.
 *
 * Cualquier falla pasa al siguiente, y cada salto queda en `desvios` para que
 * la traza diga quién contestó y por qué no fue el primero. Si fallan todos,
 * la falla se reintenta más tarde sólo si alguno de los motivos lo amerita.
 *
 * Un modelo que no contestó a tiempo o se quedó sin cupo se salta durante el
 * enfriamiento, y mientras tanto el siguiente recibe el tiempo completo. El
 * último de la cadena nunca se salta.
 */
export class ModeloConRespaldo implements ModeloDeLenguajePort {
  readonly nombre: string;
  readonly #cadena: readonly ModeloDeLenguajePort[];
  readonly #enfriamientoMs: number;
  readonly #tiempoMinimoMs: number;
  readonly #reloj: () => number;
  /** Hasta cuándo se salta cada eslabón, por su posición en la cadena. */
  readonly #saltarHasta = new Map<number, number>();

  constructor(cadena: readonly ModeloDeLenguajePort[], opciones: OpcionesDelRespaldo = {}) {
    const [primero] = cadena;
    if (!primero) throw new Error("Una cadena de respaldo necesita al menos un modelo.");
    this.#cadena = cadena;
    this.nombre = cadena.map((modelo) => modelo.nombre).join(" → ");
    this.#enfriamientoMs = opciones.enfriamientoMs ?? 0;
    this.#tiempoMinimoMs = opciones.tiempoMinimoMs ?? 1000;
    this.#reloj = opciones.reloj ?? Date.now;
  }

  async responderJson(
    solicitud: SolicitudJson,
    opciones: OpcionesDeLlamada = {},
  ): Promise<RespuestaJson> {
    const desvios: string[] = [];
    let reintentable = false;
    let ultima: FallaDeModelo | null = null;
    const comienzo = this.#reloj();
    for (const [indice, modelo] of this.#cadena.entries()) {
      const esElUltimo = indice === this.#cadena.length - 1;
      if (!esElUltimo && (this.#saltarHasta.get(indice) ?? 0) > this.#reloj()) {
        desvios.push(`${modelo.nombre} se saltó: falló hace poco`);
        continue;
      }
      // El respaldo sólo recibe lo que dejó el anterior, no el tiempo completo.
      const restante =
        opciones.tiempoMaximoMs === undefined
          ? undefined
          : opciones.tiempoMaximoMs - (this.#reloj() - comienzo);
      if (restante !== undefined && restante < this.#tiempoMinimoMs) {
        desvios.push(`${modelo.nombre} no se intentó: no quedaba tiempo`);
        break;
      }
      try {
        const respuesta = await modelo.responderJson(
          solicitud,
          restante === undefined ? {} : { tiempoMaximoMs: restante },
        );
        this.#saltarHasta.delete(indice);
        return desvios.length === 0
          ? respuesta
          : { ...respuesta, desvios: [...desvios, ...respuesta.desvios] };
      } catch (error) {
        if (!(error instanceof FallaDeModelo)) throw error;
        desvios.push(error.message);
        reintentable ||= error.seReintenta;
        ultima = error;
        if (
          !esElUltimo &&
          this.#enfriamientoMs > 0 &&
          (error.motivo === "NO_DISPONIBLE" || error.motivo === "LIMITE")
        ) {
          this.#saltarHasta.set(indice, this.#reloj() + this.#enfriamientoMs);
        }
      }
    }
    throw new FallaDeModelo(
      reintentable ? "NO_DISPONIBLE" : (ultima?.motivo ?? "NO_DISPONIBLE"),
      desvios.join("; "),
      ultima?.esperaMs ?? null,
    );
  }
}
