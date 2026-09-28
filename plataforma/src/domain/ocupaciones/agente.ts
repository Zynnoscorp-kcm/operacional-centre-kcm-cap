/**
 * El agente de ocupaciones, como grafo de LangGraph.
 *
 * Un caso —puesto y centro de costos— lo resuelven dos modelos **a la vez y
 * sin verse**, cada uno en su propio subgrafo, y un nodo sin modelo concilia:
 *
 *            ┌─ papel_principal:   subareas → ocupacion → validacion ─┐
 *   START ───┤                                                        ├─→ conciliacion → END
 *            └─ papel_verificador: subareas → ocupacion → validacion ─┘
 *
 * - `subareas` y `ocupacion` son los únicos nodos que hablan con un modelo.
 *   Una falla transitoria se reintenta con la política del propio nodo; agotada,
 *   el nodo anota la falla y su papel termina, sin excepción a media corrida.
 * - `validacion` no usa modelo: el código tiene que existir y estar entre las
 *   opciones mostradas. Un código fuera de la lista se pide de nuevo una vez,
 *   con el motivo, y después se da por fallido.
 * - `conciliacion` decide con reglas fijas. Si los dos papeles coinciden sin
 *   confianza baja, «sugerida»; en cualquier otra combinación, «revisar».
 *
 * Los dos papeles corren en paralelo porque juntos no caben uno tras otro en
 * los 120 s de la función publicada: medido el 2026-09-26, el principal tarda
 * ~35 s y el verificador ~60 s. Además cada caso tiene un plazo, y ningún papel
 * empieza una llamada que no alcance a terminar dentro de él: si uno no llega,
 * el otro conserva su propuesta y el caso va a «revisar».
 *
 * Cada nodo deja un paso en la traza: qué modelo contestó, cuánto tardó,
 * cuántos tokens usó y qué decidió. La traza no sale de la plataforma: no hay
 * LangSmith ni punto de control en ninguna base.
 */

import {
  Annotation,
  Command,
  END,
  GraphRecursionError,
  START,
  StateGraph,
} from "@langchain/langgraph";

import {
  FallaDeModelo,
  type ModeloDeLenguajePort,
  type RespuestaJson,
} from "../../ports/modelo-de-lenguaje.port.ts";
import type { CatalogoDeOcupaciones } from "./catalogo.ts";
import {
  armarBloques,
  codigoLimpio,
  codigosMostrados,
  conciliarPropuestas,
  propuestaDesde,
  subareasValidas,
  type EstadoDeSugerencia,
  type PasoDeTraza,
  type PropuestaValidada,
} from "./comunes.ts";
import {
  RespuestaDeOcupacion,
  RespuestaDeSubareas,
  solicitudDeOcupacion,
  solicitudDeSubareas,
  type CasoDeOcupacion,
} from "./instrucciones.ts";

export interface LimitesDelAgente {
  /** Cuántas subáreas puede proponer el primer paso. */
  readonly maxSubareas: number;
  /** Tope de opciones que se muestran en el segundo paso; la segunda subárea se omite si lo rebasa. */
  readonly maxOpciones: number;
  /** Cuántas veces se vuelve a pedir la ocupación cuando el código no está en la lista. */
  readonly reintentosPorCodigoInvalido: number;
  /** Intentos por llamada ante una falla transitoria del proveedor, contando el primero. */
  readonly intentosPorLlamada: number;
  /** Espera antes del primer reintento; se duplica en cada uno. */
  readonly esperaInicialMs: number;
  /** Tope de pasos de cada grafo: freno contra cualquier ciclo que no debería existir. */
  readonly limiteDePasos: number;
  /** Plazo del caso completo, por debajo del corte de la función publicada. */
  readonly tiempoMaximoMs: number;
  /** Con menos tiempo que esto por delante, un papel ya no empieza otra llamada. */
  readonly tiempoMinimoPorLlamadaMs: number;
}

export type { EstadoDeSugerencia, PasoDeTraza, PropuestaValidada } from "./comunes.ts";

export interface ResultadoDelAgente {
  readonly estado: EstadoDeSugerencia;
  /** La clave que se escribiría: la del principal o, si él falló, la del verificador. */
  readonly sugerencia: PropuestaValidada | null;
  readonly principal: PropuestaValidada | null;
  readonly verificador: PropuestaValidada | null;
  /** Por qué el caso quedó en ese estado, en una frase. */
  readonly razon: string;
  readonly traza: readonly PasoDeTraza[];
}

export interface DependenciasDelAgente {
  readonly catalogo: CatalogoDeOcupaciones;
  readonly principal: ModeloDeLenguajePort;
  /** Sin verificador, sólo la confianza alta del principal llega a «sugerida». */
  readonly verificador?: ModeloDeLenguajePort;
  readonly limites: LimitesDelAgente;
  /** Milisegundos actuales; inyectable para que la traza sea determinista en pruebas. */
  readonly reloj?: () => number;
}

type Rol = "principal" | "verificador";

interface EstadoDeRol {
  readonly subareas: readonly string[];
  /** Subáreas propuestas que no se mostraron por el tope de opciones. */
  readonly omitidas: readonly string[];
  readonly respuesta: RespuestaDeOcupacion | null;
  readonly propuesta: PropuestaValidada | null;
  /** Motivo del reintento pendiente; vacío si no hay que volver a preguntar. */
  readonly aviso: string;
  readonly reintentos: number;
  /** Por qué este papel no dejó propuesta; vacío mientras no haya fallado. */
  readonly falla: string;
}

const ROL_VACIO: EstadoDeRol = {
  subareas: [],
  omitidas: [],
  respuesta: null,
  propuesta: null,
  aviso: "",
  reintentos: 0,
  falla: "",
};

const reemplazar = <T>(_anterior: T, nuevo: T): T => nuevo;
const acumular = (anterior: PasoDeTraza[], nuevos: PasoDeTraza[]): PasoDeTraza[] =>
  anterior.concat(nuevos);

/** Lo que recorre el subgrafo de un papel. */
const EstadoDelPapel = Annotation.Root({
  caso: Annotation<CasoDeOcupacion>(),
  /** Momento, en ms, en que vence el plazo del caso. */
  vence: Annotation<number>(),
  papel: Annotation<EstadoDeRol>({ reducer: reemplazar, default: () => ROL_VACIO }),
  traza: Annotation<PasoDeTraza[]>({ reducer: acumular, default: () => [] }),
});

/** Lo que recorre el grafo del caso. */
const EstadoDelCaso = Annotation.Root({
  caso: Annotation<CasoDeOcupacion>(),
  vence: Annotation<number>(),
  principal: Annotation<EstadoDeRol>({ reducer: reemplazar, default: () => ROL_VACIO }),
  verificador: Annotation<EstadoDeRol>({ reducer: reemplazar, default: () => ROL_VACIO }),
  traza: Annotation<PasoDeTraza[]>({ reducer: acumular, default: () => [] }),
  resultado: Annotation<ResultadoDelAgente | null>({ reducer: reemplazar, default: () => null }),
});

type Papel = typeof EstadoDelPapel.State;
type ActualizacionDePapel = typeof EstadoDelPapel.Update;
type Caso = typeof EstadoDelCaso.State;
type ActualizacionDeCaso = typeof EstadoDelCaso.Update;

function descripcionDeFalla(error: unknown): string {
  if (error instanceof FallaDeModelo) return error.message;
  if (error instanceof GraphRecursionError) return "el caso rebasó el tope de pasos del grafo";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "se agotó el tiempo del caso";
  }
  return "falla inesperada del agente";
}

/** Las piezas del subgrafo de un papel; separadas para poder nombrar su tipo compilado. */
interface NodosDelPapel {
  readonly subareas: (estado: Papel) => Promise<ActualizacionDePapel>;
  readonly ocupacion: (estado: Papel) => Promise<ActualizacionDePapel>;
  readonly validacion: (estado: Papel) => ActualizacionDePapel;
  readonly alFallar: (nodo: string) => (estado: Papel, falla: { readonly error: Error }) => Command;
}

function construirSubgrafo(nodos: NodosDelPapel, limites: LimitesDelAgente) {
  // El manejador de error es un nodo aparte y no hereda las aristas del que
  // falló: sin destino explícito, el papel se quedaría ahí. Se va al final.
  const conModelo = (nodo: string) => ({
    retryPolicy: {
      maxAttempts: limites.intentosPorLlamada,
      initialInterval: limites.esperaInicialMs,
      backoffFactor: 2,
      jitter: false,
      logWarning: false,
      retryOn: (error: unknown) => error instanceof FallaDeModelo && error.seReintenta,
    },
    ends: [END],
    errorHandler: nodos.alFallar(nodo),
  });

  return new StateGraph(EstadoDelPapel)
    .addNode("subareas", nodos.subareas, conModelo("subareas"))
    .addNode("ocupacion", nodos.ocupacion, conModelo("ocupacion"))
    .addNode("validacion", nodos.validacion)
    .addEdge(START, "subareas")
    .addEdge("subareas", "ocupacion")
    .addEdge("ocupacion", "validacion")
    .addConditionalEdges(
      "validacion",
      (estado: Papel) => (estado.papel.aviso !== "" && !estado.papel.falla ? "ocupacion" : END),
      ["ocupacion", END],
    )
    .compile();
}

type Subgrafo = ReturnType<typeof construirSubgrafo>;

interface NodosDelCaso {
  readonly principal: (estado: Caso) => Promise<ActualizacionDeCaso>;
  readonly verificador: (estado: Caso) => Promise<ActualizacionDeCaso>;
  readonly conciliacion: (estado: Caso) => ActualizacionDeCaso;
}

function construirGrafo(nodos: NodosDelCaso) {
  return (
    new StateGraph(EstadoDelCaso)
      .addNode("papel_principal", nodos.principal)
      .addNode("papel_verificador", nodos.verificador)
      .addNode("conciliacion", nodos.conciliacion)
      // Los dos papeles salen del inicio a la vez; la conciliación espera a ambos.
      .addEdge(START, "papel_principal")
      .addEdge(START, "papel_verificador")
      .addEdge(["papel_principal", "papel_verificador"], "conciliacion")
      .addEdge("conciliacion", END)
      .compile()
  );
}

type Grafo = ReturnType<typeof construirGrafo>;

export class AgenteDeOcupaciones {
  readonly #deps: DependenciasDelAgente;
  readonly #reloj: () => number;
  readonly #grafo: Grafo;
  readonly #subgrafos: Readonly<Record<Rol, Subgrafo>>;

  /** Los nodos que deja en la traza cada papel, en orden, y el de conciliación. */
  static readonly NODOS = [
    "principal_subareas",
    "principal_ocupacion",
    "principal_validacion",
    "verificador_subareas",
    "verificador_ocupacion",
    "verificador_validacion",
    "conciliacion",
  ] as const;

  constructor(deps: DependenciasDelAgente) {
    this.#deps = deps;
    this.#reloj = deps.reloj ?? Date.now;
    const subgrafo = (rol: Rol) =>
      construirSubgrafo(
        {
          subareas: (estado) => this.#subareas(rol, estado),
          ocupacion: (estado) => this.#ocupacion(rol, estado),
          validacion: (estado) => this.#validacion(rol, estado),
          alFallar: (nodo) => this.#alFallar(rol, nodo),
        },
        deps.limites,
      );
    this.#subgrafos = { principal: subgrafo("principal"), verificador: subgrafo("verificador") };
    this.#grafo = construirGrafo({
      principal: (estado) => this.#papel("principal", estado),
      verificador: (estado) => this.#papel("verificador", estado),
      conciliacion: (estado) => this.#conciliar(estado),
    });
  }

  async clasificar(caso: CasoDeOcupacion): Promise<ResultadoDelAgente> {
    const { limites } = this.#deps;
    try {
      const final = await this.#grafo.invoke(
        { caso, vence: this.#reloj() + limites.tiempoMaximoMs },
        {
          recursionLimit: limites.limiteDePasos,
          // Último freno: los papeles ya respetan el plazo por su cuenta.
          signal: AbortSignal.timeout(limites.tiempoMaximoMs + 10_000),
        },
      );
      if (final.resultado) return final.resultado;
      return this.#sinRespuesta("el grafo terminó sin conciliar", final.traza);
    } catch (error) {
      return this.#sinRespuesta(descripcionDeFalla(error), []);
    }
  }

  #sinRespuesta(razon: string, traza: readonly PasoDeTraza[]): ResultadoDelAgente {
    return {
      estado: "sin_respuesta",
      sugerencia: null,
      principal: null,
      verificador: null,
      razon,
      traza,
    };
  }

  #modelo(rol: Rol): ModeloDeLenguajePort | undefined {
    return rol === "principal" ? this.#deps.principal : this.#deps.verificador;
  }

  /** Corre el subgrafo de un papel y devuelve sólo lo nuevo: su estado y sus pasos. */
  async #papel(rol: Rol, estado: Caso): Promise<ActualizacionDeCaso> {
    if (!this.#modelo(rol)) return {};
    const final = await this.#subgrafos[rol].invoke(
      { caso: estado.caso, vence: estado.vence },
      { recursionLimit: this.#deps.limites.limiteDePasos },
    );
    return rol === "principal"
      ? { principal: final.papel, traza: final.traza }
      : { verificador: final.papel, traza: final.traza };
  }

  #paso(
    nodo: string,
    inicio: number,
    nota: string,
    respuesta: RespuestaJson | null = null,
  ): PasoDeTraza {
    return {
      nodo,
      proveedor: respuesta?.proveedor ?? null,
      modelo: respuesta?.modelo ?? null,
      milisegundos: this.#reloj() - inicio,
      tokensDeEntrada: respuesta?.tokensDeEntrada ?? null,
      tokensDeSalida: respuesta?.tokensDeSalida ?? null,
      nota:
        respuesta && respuesta.desvios.length > 0
          ? `${nota} (respondió el respaldo: ${respuesta.desvios.join("; ")})`
          : nota,
    };
  }

  /**
   * Lo que le queda al caso para una llamada, o `null` si ya no alcanza para
   * empezarla. Así un papel lento no se come el plazo del otro.
   */
  #tiempoParaLlamar(estado: Papel): number | null {
    const restante = estado.vence - this.#reloj();
    return restante < this.#deps.limites.tiempoMinimoPorLlamadaMs ? null : restante;
  }

  #sinTiempo(rol: Rol, nodo: string, estado: Papel): ActualizacionDePapel {
    const motivo = "no alcanzó el plazo del caso";
    return {
      papel: { ...estado.papel, falla: motivo },
      traza: [this.#paso(`${rol}_${nodo}`, this.#reloj(), motivo)],
    };
  }

  #bloques(subareas: readonly string[]) {
    return armarBloques(this.#deps.catalogo, subareas, this.#deps.limites.maxOpciones);
  }

  async #subareas(rol: Rol, estado: Papel): Promise<ActualizacionDePapel> {
    const modelo = this.#modelo(rol);
    if (!modelo) return {};
    const tiempo = this.#tiempoParaLlamar(estado);
    if (tiempo === null) return this.#sinTiempo(rol, "subareas", estado);
    const inicio = this.#reloj();
    const respuesta = await modelo.responderJson(solicitudDeSubareas(estado.caso), {
      tiempoMaximoMs: tiempo,
    });
    const lectura = RespuestaDeSubareas.safeParse(respuesta.datos);
    if (!lectura.success) {
      throw new FallaDeModelo("RESPUESTA", "El modelo devolvió las subáreas con otra forma.");
    }
    const subareas = subareasValidas(
      this.#deps.catalogo,
      lectura.data.subareas,
      this.#deps.limites.maxSubareas,
    );
    if (subareas.length === 0) {
      throw new FallaDeModelo("RESPUESTA", "El modelo no devolvió ninguna subárea del catálogo.");
    }
    return {
      papel: { ...estado.papel, subareas },
      traza: [this.#paso(`${rol}_subareas`, inicio, `subáreas ${subareas.join(", ")}`, respuesta)],
    };
  }

  async #ocupacion(rol: Rol, estado: Papel): Promise<ActualizacionDePapel> {
    const modelo = this.#modelo(rol);
    const actual = estado.papel;
    if (!modelo || actual.falla) return {};
    const tiempo = this.#tiempoParaLlamar(estado);
    if (tiempo === null) return this.#sinTiempo(rol, "ocupacion", estado);
    const inicio = this.#reloj();
    const { bloques, omitidas } = this.#bloques(actual.subareas);
    const respuesta = await modelo.responderJson(
      solicitudDeOcupacion(estado.caso, bloques, actual.aviso),
      { tiempoMaximoMs: tiempo },
    );
    const lectura = RespuestaDeOcupacion.safeParse(respuesta.datos);
    if (!lectura.success) {
      throw new FallaDeModelo("RESPUESTA", "El modelo devolvió la ocupación con otra forma.");
    }
    const mostradas = bloques.reduce((suma, bloque) => suma + bloque.ocupaciones.length, 0);
    const nota =
      `${String(mostradas)} opciones` +
      (omitidas.length > 0 ? `; se omitió ${omitidas.join(", ")} por el tope` : "") +
      `; eligió ${codigoLimpio(lectura.data.codigo) || "(vacío)"}`;
    return {
      papel: { ...actual, omitidas, respuesta: lectura.data, aviso: "" },
      traza: [this.#paso(`${rol}_ocupacion`, inicio, nota, respuesta)],
    };
  }

  #validacion(rol: Rol, estado: Papel): ActualizacionDePapel {
    const actual = estado.papel;
    if (!this.#modelo(rol) || actual.falla || !actual.respuesta) return {};
    const inicio = this.#reloj();
    const { catalogo, limites } = this.#deps;
    const { bloques } = this.#bloques(actual.subareas);
    const mostrados = codigosMostrados(bloques);
    const codigo = codigoLimpio(actual.respuesta.codigo);
    const ocupacion = mostrados.has(codigo) ? catalogo.ocupacion(codigo) : undefined;

    if (!ocupacion) {
      const motivo = `el código ${codigo || "(vacío)"} no está en la lista de opciones`;
      if (actual.reintentos < limites.reintentosPorCodigoInvalido) {
        return {
          papel: { ...actual, respuesta: null, aviso: motivo, reintentos: actual.reintentos + 1 },
          traza: [this.#paso(`${rol}_validacion`, inicio, `${motivo}; se pide de nuevo`)],
        };
      }
      return {
        papel: { ...actual, falla: `${motivo} tras ${String(actual.reintentos + 1)} intentos` },
        traza: [this.#paso(`${rol}_validacion`, inicio, motivo)],
      };
    }

    const propuesta = propuestaDesde(catalogo, ocupacion, actual.respuesta);
    return {
      papel: { ...actual, propuesta },
      traza: [
        this.#paso(
          `${rol}_validacion`,
          inicio,
          `${propuesta.codigo} en ${propuesta.subarea}, confianza ${propuesta.confianza}`,
        ),
      ],
    };
  }

  /** Tras una falla agotada, el nodo anota por qué y el papel termina. */
  #alFallar(rol: Rol, nodo: string) {
    return (estado: Papel, falla: { readonly error: Error }): Command => {
      const motivo = descripcionDeFalla(falla.error);
      return new Command({
        update: {
          papel: { ...estado.papel, falla: motivo },
          traza: [this.#paso(`${rol}_${nodo}`, this.#reloj(), `falló: ${motivo}`)],
        },
        goto: END,
      });
    };
  }

  #conciliar(estado: Caso): ActualizacionDeCaso {
    const inicio = this.#reloj();
    const resultado = conciliarPropuestas({
      principal: estado.principal.propuesta,
      verificador: estado.verificador.propuesta,
      hayVerificador: this.#deps.verificador !== undefined,
      fallaDelPrincipal: estado.principal.falla,
      fallaDelVerificador: estado.verificador.falla,
    });
    const paso = this.#paso("conciliacion", inicio, `${resultado.estado}: ${resultado.razon}`);
    return {
      traza: [paso],
      resultado: { ...resultado, traza: [...estado.traza, paso] },
    };
  }
}
