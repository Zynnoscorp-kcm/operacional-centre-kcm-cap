import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import {
  FallaDeModelo,
  type ModeloDeLenguajePort,
  type RespuestaJson,
} from "../../ports/modelo-de-lenguaje.port.ts";
import { DomainError } from "../comun/errores.ts";
import type { CatalogoDeOcupaciones } from "./catalogo.ts";
import {
  armarBloques,
  codigoLimpio,
  codigosMostrados,
  conciliarPropuestas,
  propuestaDesde,
  subareasValidas,
  type Conciliacion,
  type PasoDeTraza,
  type PropuestaValidada,
} from "./comunes.ts";
import {
  CONFIANZAS,
  RespuestaDeOcupacionEnLote,
  RespuestaDeSubareasEnLote,
  solicitudDeOcupacionEnLote,
  solicitudDeSubareasEnLote,
  type CasoEnLote,
} from "./instrucciones.ts";
import { leerCaso } from "./servicio.ts";

export interface LimitesDelLote {
  readonly casosPorCorrida: number;
  readonly casosPorTandaDeSubarea: number;
  readonly casosPorTandaDeOcupacion: number;
  readonly tandasEnParaleloPorPapel: number;
  readonly maxSubareas: number;
  readonly maxOpciones: number;
  readonly intentosPorCaso: number;
  readonly fallasSeguidasPorPapel: number;
  readonly tandasFallidasPorCaso: number;
  readonly esperaTrasFallaMs: number;
  readonly tiempoPorPasoMs: number;
  readonly tiempoMinimoPorTandaMs: number;
  readonly limiteDePasos: number;
}

type Rol = "principal" | "verificador";
const ROLES: readonly Rol[] = ["principal", "verificador"];

export interface PapelEnLote {
  readonly subareas: Readonly<Record<string, readonly string[]>>;
  readonly propuestas: Readonly<Record<string, PropuestaValidada>>;
  readonly intentosDeSubarea: Readonly<Record<string, number>>;
  readonly intentosDeOcupacion: Readonly<Record<string, number>>;
  readonly avisos: Readonly<Record<string, string>>;
  readonly fallas: Readonly<Record<string, string>>;
  readonly tandasFallidas: Readonly<Record<string, number>>;
  readonly fallasSeguidas: number;
  readonly caido: string;
}

export interface EstadoDelLote {
  readonly version: string;
  readonly huella: string;
  readonly casos: readonly CasoEnLote[];
  readonly principal: PapelEnLote;
  readonly verificador: PapelEnLote;
  readonly consultas: number;
  readonly traza: readonly PasoDeTraza[];
}

export interface ResultadoDeCaso extends Conciliacion {
  readonly id: string;
}

export interface AvanceDelLote {
  readonly estado: EstadoDelLote;
  readonly terminado: boolean;
  readonly resultados: readonly ResultadoDeCaso[] | null;
}

interface CambioDePapel {
  readonly subareas?: Readonly<Record<string, readonly string[]>>;
  readonly propuestas?: Readonly<Record<string, PropuestaValidada>>;
  readonly intentosDeSubarea?: Readonly<Record<string, number>>;
  readonly intentosDeOcupacion?: Readonly<Record<string, number>>;
  readonly avisos?: Readonly<Record<string, string>>;
  readonly fallas?: Readonly<Record<string, string>>;
  readonly tandasFallidas?: Readonly<Record<string, number>>;
  readonly fallasSeguidas?: number;
  readonly exito?: boolean;
  readonly fallaDelProveedor?: boolean;
  readonly caido?: string;
}

export const PAPEL_VACIO: PapelEnLote = {
  subareas: {},
  propuestas: {},
  intentosDeSubarea: {},
  intentosDeOcupacion: {},
  avisos: {},
  fallas: {},
  tandasFallidas: {},
  fallasSeguidas: 0,
  caido: "",
};

function fusionar(actual: PapelEnLote, cambio: CambioDePapel): PapelEnLote {
  return {
    subareas: { ...actual.subareas, ...cambio.subareas },
    propuestas: { ...actual.propuestas, ...cambio.propuestas },
    intentosDeSubarea: { ...actual.intentosDeSubarea, ...cambio.intentosDeSubarea },
    intentosDeOcupacion: { ...actual.intentosDeOcupacion, ...cambio.intentosDeOcupacion },
    avisos: { ...actual.avisos, ...cambio.avisos },
    fallas: { ...actual.fallas, ...cambio.fallas },
    tandasFallidas: { ...actual.tandasFallidas, ...cambio.tandasFallidas },
    fallasSeguidas:
      cambio.fallasSeguidas ??
      (cambio.exito
        ? 0
        : cambio.fallaDelProveedor
          ? actual.fallasSeguidas + 1
          : actual.fallasSeguidas),
    caido: cambio.caido || actual.caido,
  };
}

const reemplazar = <T>(_anterior: T, nuevo: T): T => nuevo;

const EstadoDelGrafo = Annotation.Root({
  casos: Annotation<readonly CasoEnLote[]>(),
  vence: Annotation<number>(),
  principal: Annotation<PapelEnLote, CambioDePapel>({
    reducer: fusionar,
    default: () => PAPEL_VACIO,
  }),
  verificador: Annotation<PapelEnLote, CambioDePapel>({
    reducer: fusionar,
    default: () => PAPEL_VACIO,
  }),
  consultas: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  traza: Annotation<PasoDeTraza[]>({
    reducer: (anterior, nuevos) => anterior.concat(nuevos),
    default: () => [],
  }),
  resultados: Annotation<ResultadoDeCaso[] | null>({ reducer: reemplazar, default: () => null }),
});

const EntradaDeTanda = Annotation.Root({
  rol: Annotation<Rol>(),
  tipo: Annotation<"subarea" | "ocupacion">(),
  casos: Annotation<readonly CasoEnLote[]>(),
  subareas: Annotation<readonly string[]>(),
  avisos: Annotation<Readonly<Record<string, string>>>(),
  intentos: Annotation<Readonly<Record<string, number>>>(),
  fallidas: Annotation<Readonly<Record<string, number>>>(),
  fallasSeguidas: Annotation<number>(),
  vence: Annotation<number>(),
});

type Grafo = typeof EstadoDelGrafo.State;
type Actualizacion = typeof EstadoDelGrafo.Update;
type Tanda = typeof EntradaDeTanda.State;

const PropuestaGuardada = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  consecutivo: z.string(),
  subarea: z.string(),
  denominacionDeSubarea: z.string(),
  alternativa: z.object({ codigo: z.string(), descripcion: z.string() }).nullable(),
  confianza: z.enum(CONFIANZAS),
  motivo: z.string(),
});

const PapelGuardado = z.object({
  subareas: z.record(z.string(), z.array(z.string())),
  propuestas: z.record(z.string(), PropuestaGuardada),
  intentosDeSubarea: z.record(z.string(), z.number().int().min(0)),
  intentosDeOcupacion: z.record(z.string(), z.number().int().min(0)),
  avisos: z.record(z.string(), z.string()),
  fallas: z.record(z.string(), z.string()),
  tandasFallidas: z.record(z.string(), z.number().int().min(0)),
  fallasSeguidas: z.number().int().min(0),
  caido: z.string(),
});

const EstadoGuardado = z.object({
  version: z.string(),
  huella: z.string(),
  casos: z.array(z.object({ id: z.string(), puesto: z.string(), centroDeCostos: z.string() })),
  principal: PapelGuardado,
  verificador: PapelGuardado,
  consultas: z.number().int().min(0),
  traza: z.array(
    z.object({
      nodo: z.string(),
      proveedor: z.string().nullable(),
      modelo: z.string().nullable(),
      milisegundos: z.number(),
      tokensDeEntrada: z.number().nullable(),
      tokensDeSalida: z.number().nullable(),
      nota: z.string(),
    }),
  ),
});

const ID_DE_CASO = /^C\d{3,5}$/u;

const AVISO_FALTANTE = "faltó en la respuesta";
const AVISO_FUERA_DE_LISTA = "el código elegido no está en la lista de opciones";
const AVISOS_VALIDOS: ReadonlySet<string> = new Set(["", AVISO_FALTANTE, AVISO_FUERA_DE_LISTA]);

export interface DependenciasDelLote {
  readonly catalogo: CatalogoDeOcupaciones;
  readonly principal: ModeloDeLenguajePort;
  readonly verificador?: ModeloDeLenguajePort;
  readonly limites: LimitesDelLote;
  readonly version: string;
  readonly huella: string;
  readonly reloj?: () => number;
  readonly esperar?: (milisegundos: number) => Promise<void>;
}

interface NodosDelLote {
  readonly tanda: (tanda: Tanda) => Promise<Actualizacion>;
  readonly repartir: (estado: Grafo) => Send[] | "conciliacion" | typeof END;
  readonly conciliar: (estado: Grafo) => Actualizacion;
}

function construirGrafoDelLote(nodos: NodosDelLote) {
  return new StateGraph(EstadoDelGrafo)
    .addNode("planificacion", () => ({}))
    .addNode("tanda", nodos.tanda, { input: EntradaDeTanda })
    .addNode("conciliacion", nodos.conciliar)
    .addEdge(START, "planificacion")
    .addConditionalEdges("planificacion", nodos.repartir, ["tanda", "conciliacion", END])
    .addEdge("tanda", "planificacion")
    .addEdge("conciliacion", END)
    .compile();
}

type GrafoDelLote = ReturnType<typeof construirGrafoDelLote>;

export class ClasificadorPorLotes {
  readonly #deps: DependenciasDelLote;
  readonly #reloj: () => number;
  readonly #esperar: (milisegundos: number) => Promise<void>;
  readonly #grafo: GrafoDelLote;

  constructor(deps: DependenciasDelLote) {
    this.#deps = deps;
    this.#reloj = deps.reloj ?? Date.now;
    this.#esperar =
      deps.esperar ?? ((milisegundos) => new Promise((listo) => setTimeout(listo, milisegundos)));
    this.#grafo = construirGrafoDelLote({
      tanda: (tanda) => this.#tanda(tanda),
      repartir: (estado) => this.#repartir(estado),
      conciliar: (estado) => this.#conciliar(estado),
    });
  }

  iniciar(casos: readonly CasoEnLote[]): EstadoDelLote {
    this.#revisarCasos(casos);
    return {
      version: this.#deps.version,
      huella: this.#deps.huella,
      casos,
      principal: PAPEL_VACIO,
      verificador: PAPEL_VACIO,
      consultas: 0,
      traza: [],
    };
  }

  leer(texto: string): EstadoDelLote {
    let crudo: unknown;
    try {
      crudo = JSON.parse(texto);
    } catch {
      throw new DomainError("LOTE_INVALIDO", "El estado del lote no es JSON.");
    }
    const lectura = EstadoGuardado.safeParse(crudo);
    if (!lectura.success) {
      throw new DomainError("LOTE_INVALIDO", "El estado del lote no tiene la forma esperada.");
    }
    const estado = lectura.data;
    if (estado.version !== this.#deps.version || estado.huella !== this.#deps.huella) {
      throw new DomainError(
        "LOTE_DE_OTRA_VERSION",
        "El lote empezó con otra configuración del agente; se vuelve a clasificar desde el principio.",
      );
    }
    const invalido = (mensaje: string) => new DomainError("LOTE_INVALIDO", mensaje);
    const revisar = (papel: typeof estado.principal): PapelEnLote => {
      const subareas = Object.fromEntries(
        Object.entries(papel.subareas).map(([id, lista]) => {
          const validas = subareasValidas(
            this.#deps.catalogo,
            lista,
            this.#deps.limites.maxSubareas,
          );
          if (lista.length === 0 || validas.length !== lista.length) {
            throw invalido("El estado del lote trae una subárea que no está en el catálogo.");
          }
          return [id, validas];
        }),
      );
      if (Object.values(papel.avisos).some((aviso) => !AVISOS_VALIDOS.has(aviso))) {
        throw invalido("El estado del lote trae un aviso que la plataforma no escribe.");
      }
      return {
        ...papel,
        subareas,
        propuestas: Object.fromEntries(
          Object.entries(papel.propuestas).map(([id, propuesta]) => {
            const ocupacion = this.#deps.catalogo.ocupacion(propuesta.codigo);
            const alterna = propuesta.alternativa
              ? this.#deps.catalogo.ocupacion(propuesta.alternativa.codigo)
              : undefined;
            if (!ocupacion || (propuesta.alternativa && !alterna)) {
              throw invalido("El estado del lote trae una clave que no está en el catálogo.");
            }
            return [
              id,
              {
                ...propuesta,
                descripcion: ocupacion.descripcion,
                consecutivo: ocupacion.consecutivo,
                subarea: ocupacion.subarea,
                denominacionDeSubarea:
                  this.#deps.catalogo.subarea(ocupacion.subarea)?.denominacion ?? "",
                alternativa: alterna
                  ? { codigo: alterna.codigo, descripcion: alterna.descripcion }
                  : null,
              },
            ];
          }),
        ),
      };
    };
    this.#revisarCasos(estado.casos);
    const casos = estado.casos.map((caso) => ({
      id: caso.id,
      ...leerCaso({ puesto: caso.puesto, centroDeCostos: caso.centroDeCostos }),
    }));
    return {
      ...estado,
      casos,
      principal: revisar(estado.principal),
      verificador: revisar(estado.verificador),
    };
  }

  async avanzar(estado: EstadoDelLote): Promise<AvanceDelLote> {
    const { limites } = this.#deps;
    const final = await this.#grafo.invoke(
      {
        casos: estado.casos,
        vence: this.#reloj() + limites.tiempoPorPasoMs,
        principal: estado.principal,
        verificador: estado.verificador,
        consultas: estado.consultas,
        traza: [...estado.traza],
      },
      { recursionLimit: limites.limiteDePasos },
    );
    const siguiente: EstadoDelLote = {
      ...estado,
      principal: final.principal,
      verificador: final.verificador,
      consultas: final.consultas,
      traza: final.traza,
    };
    return {
      estado: siguiente,
      terminado: final.resultados !== null,
      resultados: final.resultados,
    };
  }

  #revisarCasos(casos: readonly { readonly id: string }[]): void {
    if (casos.length > this.#deps.limites.casosPorCorrida) {
      throw new DomainError(
        "LOTE_INVALIDO",
        `Un lote admite hasta ${String(this.#deps.limites.casosPorCorrida)} casos.`,
      );
    }
    const vistos = new Set<string>();
    for (const { id } of casos) {
      if (!ID_DE_CASO.test(id) || vistos.has(id)) {
        throw new DomainError(
          "LOTE_INVALIDO",
          "Un caso del lote no tiene un identificador válido o viene repetido.",
        );
      }
      vistos.add(id);
    }
  }

  #modelo(rol: Rol): ModeloDeLenguajePort | undefined {
    return rol === "principal" ? this.#deps.principal : this.#deps.verificador;
  }

  #papelCaido(estado: Grafo, rol: Rol): string {
    const papel = estado[rol];
    if (papel.caido) return papel.caido;
    if (papel.fallasSeguidas >= this.#deps.limites.fallasSeguidasPorPapel) {
      return `el proveedor falló ${String(papel.fallasSeguidas)} tandas seguidas`;
    }
    return "";
  }

  #trabajoDe(rol: Rol, estado: Grafo): Tanda[] {
    const { limites } = this.#deps;
    if (!this.#modelo(rol) || this.#papelCaido(estado, rol)) return [];
    const papel = estado[rol];
    const casos = rol === "principal" ? [...estado.casos] : [...estado.casos].reverse();
    const vivos = casos.filter((caso) => !papel.fallas[caso.id]);
    const base = {
      rol,
      avisos: papel.avisos,
      vence: estado.vence,
      fallidas: papel.tandasFallidas,
      fallasSeguidas: papel.fallasSeguidas,
    };

    const sinSubarea = vivos.filter((caso) => !papel.subareas[caso.id]);
    const tipo = sinSubarea.length > 0 ? "subarea" : "ocupacion";
    const pendientes =
      tipo === "subarea" ? sinSubarea : vivos.filter((caso) => !papel.propuestas[caso.id]);
    const tope =
      tipo === "subarea" ? limites.casosPorTandaDeSubarea : limites.casosPorTandaDeOcupacion;
    const grupos = new Map<
      string,
      { casos: CasoEnLote[]; subareas: readonly string[]; tamano: number }
    >();
    for (const caso of pendientes) {
      const nivel = papel.tandasFallidas[caso.id] ?? 0;
      const subareas = tipo === "subarea" ? [] : (papel.subareas[caso.id] ?? []);
      const clave = `${String(nivel)}|${subareas.join("+")}`;
      const grupo = grupos.get(clave) ?? {
        casos: [],
        subareas,
        tamano: Math.max(1, Math.floor(tope / 2 ** nivel)),
      };
      grupo.casos.push(caso);
      grupos.set(clave, grupo);
    }

    const tandas: Tanda[] = [];
    for (const grupo of grupos.values()) {
      for (let i = 0; i < grupo.casos.length; i += grupo.tamano) {
        if (tandas.length >= limites.tandasEnParaleloPorPapel) return tandas;
        tandas.push({
          ...base,
          tipo,
          casos: grupo.casos.slice(i, i + grupo.tamano),
          subareas: grupo.subareas,
          intentos: tipo === "subarea" ? papel.intentosDeSubarea : papel.intentosDeOcupacion,
        });
      }
    }
    return tandas;
  }

  #repartir(estado: Grafo): Send[] | "conciliacion" | typeof END {
    const tandas = ROLES.flatMap((rol) => this.#trabajoDe(rol, estado));
    if (tandas.length === 0) return "conciliacion";
    if (estado.vence - this.#reloj() < this.#deps.limites.tiempoMinimoPorTandaMs) return END;
    return tandas.map((tanda) => new Send("tanda", tanda));
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

  #reintentar(
    id: string,
    motivo: string,
    tanda: Tanda,
    intentos: Record<string, number>,
    fallas: Record<string, string>,
  ): void {
    const hechos = (tanda.intentos[id] ?? 0) + 1;
    intentos[id] = hechos;
    if (hechos >= this.#deps.limites.intentosPorCaso) {
      fallas[id] = `${motivo} tras ${String(hechos)} intentos`;
    }
  }

  async #tanda(tanda: Tanda): Promise<Actualizacion> {
    const modelo = this.#modelo(tanda.rol);
    if (!modelo) return {};
    const inicio = this.#reloj();
    const nodo = `${tanda.rol}_${tanda.tipo}`;
    const conPapel = (cambio: CambioDePapel, paso: PasoDeTraza): Actualizacion => ({
      ...(tanda.rol === "principal" ? { principal: cambio } : { verificador: cambio }),
      consultas: 1,
      traza: [paso],
    });

    try {
      return tanda.tipo === "subarea"
        ? await this.#tandaDeSubareas(modelo, tanda, inicio, nodo, conPapel)
        : await this.#tandaDeOcupacion(modelo, tanda, inicio, nodo, conPapel);
    } catch (error) {
      if (!(error instanceof FallaDeModelo)) throw error;
      const nota = `falló con ${String(tanda.casos.length)} casos: ${error.message}`;
      const definitiva = !error.seReintenta && error.motivo !== "DEMASIADO_GRANDE";
      if (definitiva) return conPapel({ caido: error.message }, this.#paso(nodo, inicio, nota));

      const { limites } = this.#deps;
      const delProveedor = error.motivo !== "DEMASIADO_GRANDE";
      const seCae = delProveedor && tanda.fallasSeguidas + 1 >= limites.fallasSeguidasPorPapel;
      const tandasFallidas: Record<string, number> = {};
      const fallas: Record<string, string> = {};
      for (const caso of tanda.casos) {
        const veces = (tanda.fallidas[caso.id] ?? 0) + 1;
        tandasFallidas[caso.id] = veces;
        if (veces >= limites.tandasFallidasPorCaso && !seCae) {
          fallas[caso.id] = `falló en ${String(veces)} tandas: ${error.message}`;
        }
      }
      if (delProveedor && !seCae) await this.#esperarTrasFalla(tanda, error);
      return conPapel(
        { tandasFallidas, fallas, fallaDelProveedor: delProveedor },
        this.#paso(nodo, inicio, nota),
      );
    }
  }

  async #esperarTrasFalla(tanda: Tanda, error: FallaDeModelo): Promise<void> {
    const { limites } = this.#deps;
    const sugerida = error.esperaMs ?? limites.esperaTrasFallaMs * 2 ** tanda.fallasSeguidas;
    const cabe = tanda.vence - this.#reloj() - limites.tiempoMinimoPorTandaMs;
    const espera = Math.min(sugerida, cabe);
    if (espera > 0) await this.#esperar(espera);
  }

  async #tandaDeSubareas(
    modelo: ModeloDeLenguajePort,
    tanda: Tanda,
    inicio: number,
    nodo: string,
    conPapel: (cambio: CambioDePapel, paso: PasoDeTraza) => Actualizacion,
  ): Promise<Actualizacion> {
    const { catalogo, limites } = this.#deps;
    const respuesta = await modelo.responderJson(solicitudDeSubareasEnLote(tanda.casos), {
      tiempoMaximoMs: tanda.vence - this.#reloj(),
    });
    const lectura = RespuestaDeSubareasEnLote.safeParse(respuesta.datos);
    if (!lectura.success) {
      throw new FallaDeModelo("RESPUESTA", "El modelo devolvió las subáreas con otra forma.");
    }
    const porId = new Map(lectura.data.resultados.map((fila) => [fila.id.trim(), fila]));
    const subareas: Record<string, readonly string[]> = {};
    const intentos: Record<string, number> = {};
    const fallas: Record<string, string> = {};
    for (const caso of tanda.casos) {
      const fila = porId.get(caso.id);
      const validas = fila ? subareasValidas(catalogo, fila.subareas, limites.maxSubareas) : [];
      if (validas.length > 0) subareas[caso.id] = validas;
      else
        this.#reintentar(
          caso.id,
          fila ? "sin subárea del catálogo" : "sin respuesta",
          tanda,
          intentos,
          fallas,
        );
    }
    const resueltos = Object.keys(subareas).length;
    const tandasFallidas = Object.fromEntries(Object.keys(subareas).map((id) => [id, 0]));
    return conPapel(
      { subareas, intentosDeSubarea: intentos, fallas, tandasFallidas, exito: true },
      this.#paso(
        nodo,
        inicio,
        `${String(resueltos)} de ${String(tanda.casos.length)} casos con subárea`,
        respuesta,
      ),
    );
  }

  async #tandaDeOcupacion(
    modelo: ModeloDeLenguajePort,
    tanda: Tanda,
    inicio: number,
    nodo: string,
    conPapel: (cambio: CambioDePapel, paso: PasoDeTraza) => Actualizacion,
  ): Promise<Actualizacion> {
    const { catalogo, limites } = this.#deps;
    const { bloques, omitidas } = armarBloques(catalogo, tanda.subareas, limites.maxOpciones);
    const avisos = Object.fromEntries(
      tanda.casos.map((caso) => [caso.id, tanda.avisos[caso.id] ?? ""]),
    );
    const respuesta = await modelo.responderJson(
      solicitudDeOcupacionEnLote(tanda.casos, bloques, avisos),
      { tiempoMaximoMs: tanda.vence - this.#reloj() },
    );
    const lectura = RespuestaDeOcupacionEnLote.safeParse(respuesta.datos);
    if (!lectura.success) {
      throw new FallaDeModelo("RESPUESTA", "El modelo devolvió las ocupaciones con otra forma.");
    }
    const mostrados = codigosMostrados(bloques);
    const porId = new Map(lectura.data.resultados.map((fila) => [fila.id.trim(), fila]));
    const propuestas: Record<string, PropuestaValidada> = {};
    const nuevosAvisos: Record<string, string> = {};
    const intentos: Record<string, number> = {};
    const fallas: Record<string, string> = {};
    for (const caso of tanda.casos) {
      const fila = porId.get(caso.id);
      if (!fila) {
        nuevosAvisos[caso.id] = AVISO_FALTANTE;
        this.#reintentar(caso.id, "sin respuesta", tanda, intentos, fallas);
        continue;
      }
      const codigo = codigoLimpio(fila.codigo);
      const ocupacion = mostrados.has(codigo) ? catalogo.ocupacion(codigo) : undefined;
      if (!ocupacion) {
        const motivo = `el código ${codigo || "(vacío)"} no está en la lista de opciones`;
        nuevosAvisos[caso.id] = AVISO_FUERA_DE_LISTA;
        this.#reintentar(caso.id, motivo, tanda, intentos, fallas);
        continue;
      }
      propuestas[caso.id] = propuestaDesde(catalogo, ocupacion, fila);
      nuevosAvisos[caso.id] = "";
    }
    const opciones = bloques.reduce((suma, bloque) => suma + bloque.ocupaciones.length, 0);
    const nota =
      `${String(Object.keys(propuestas).length)} de ${String(tanda.casos.length)} casos con ` +
      `ocupación válida entre ${String(opciones)} opciones de ${tanda.subareas.join(", ")}` +
      (omitidas.length > 0 ? `; se omitió ${omitidas.join(", ")} por el tope` : "");
    return conPapel(
      {
        propuestas,
        avisos: nuevosAvisos,
        intentosDeOcupacion: intentos,
        fallas,
        exito: true,
      },
      this.#paso(nodo, inicio, nota, respuesta),
    );
  }

  #conciliar(estado: Grafo): Actualizacion {
    const inicio = this.#reloj();
    const hayVerificador = this.#deps.verificador !== undefined;
    const caidoP = this.#papelCaido(estado, "principal");
    const caidoV = this.#papelCaido(estado, "verificador");
    const resultados = estado.casos.map((caso): ResultadoDeCaso => {
      const falla = (rol: Rol, caido: string) =>
        estado[rol].fallas[caso.id] ?? (caido ? `el papel se detuvo: ${caido}` : "");
      return {
        id: caso.id,
        ...conciliarPropuestas({
          principal: estado.principal.propuestas[caso.id] ?? null,
          verificador: estado.verificador.propuestas[caso.id] ?? null,
          hayVerificador,
          fallaDelPrincipal: falla("principal", caidoP),
          fallaDelVerificador: falla("verificador", caidoV),
        }),
      };
    });
    const cuenta = (estadoBuscado: string) =>
      resultados.filter((resultado) => resultado.estado === estadoBuscado).length;
    return {
      resultados,
      traza: [
        this.#paso(
          "conciliacion",
          inicio,
          `${String(cuenta("sugerida"))} sugeridas, ${String(cuenta("revisar"))} a revisar, ` +
            `${String(cuenta("sin_respuesta"))} sin respuesta`,
        ),
      ],
    };
  }
}
