import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import { catalogoDeLaPlataforma, SUBAREAS_CNO } from "../domain/ocupaciones/catalogo.ts";
import { escribirCodigosEnXlsx } from "../domain/ocupaciones/escritor-xlsx.ts";
import { planearClasificacion, type PlanDeClasificacion } from "../domain/ocupaciones/plan.ts";
import type { ServicioDeOcupacionesPort } from "../domain/ocupaciones/servicio.ts";
import type { PadronLeido } from "../domain/padron/tipos.ts";
import { MultipartError, parseMultipart, type ArchivoRecibido } from "../server/multipart.ts";
import type { HojaDeEstilos } from "../web/estaticos.ts";
import { renderOccupationsPage, type BusquedaEnCatalogo } from "../web/pages/ocupaciones.ts";

const MAXIMO_DEL_ARCHIVO = 8 * 1024 * 1024;
const MAXIMO_EN_LA_NUBE = 4 * 1024 * 1024;
const LIMITE_DE_BUSQUEDA = 60;
const CASOS_POR_CORRIDA = 15;
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const POLITICA_DE_OCUPACIONES = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SIN_BUSQUEDA: BusquedaEnCatalogo = {
  texto: "",
  subarea: "",
  realizada: false,
  total: 0,
  ocupaciones: [],
};

function texto(valor: unknown): string {
  const uno: unknown = Array.isArray(valor) ? valor[0] : valor;
  return typeof uno === "string" ? uno.trim() : "";
}

function busquedaDe(consulta: Record<string, unknown>): BusquedaEnCatalogo {
  const palabras = texto(consulta.q).slice(0, 120);
  const pedida = texto(consulta.subarea);
  const subarea = SUBAREAS_CNO.some((item) => item.clave === pedida) ? pedida : "";
  if (palabras === "" && subarea === "") return SIN_BUSQUEDA;
  const { total, ocupaciones } = catalogoDeLaPlataforma().buscar({
    texto: palabras,
    subarea,
    limite: LIMITE_DE_BUSQUEDA,
  });
  return { texto: palabras, subarea, realizada: true, total, ocupaciones };
}

function leerFormulario(peticion: FastifyRequest): {
  readonly archivo: ArchivoRecibido;
  readonly campos: Readonly<Record<string, string>>;
} {
  let formulario;
  try {
    formulario = parseMultipart(peticion.body as Buffer, peticion.headers["content-type"]);
  } catch (error) {
    if (!(error instanceof MultipartError)) throw error;
    throw new DomainError("FORMULARIO_DANADO", "El formulario llegó incompleto o dañado.");
  }
  const archivo = formulario.archivos.find((parte) => parte.campo === "archivo");
  if (!archivo || archivo.contenido.length === 0) {
    throw new DomainError("SIN_ARCHIVO", "No se recibió ningún archivo.");
  }
  return { archivo, campos: formulario.campos };
}

function planDe(
  archivo: ArchivoRecibido,
  extraer: (archivo: Buffer) => PadronLeido,
): PlanDeClasificacion {
  let padron: PadronLeido;
  try {
    padron = extraer(archivo.contenido);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    throw new DomainError(
      "PADRON_ILEGIBLE",
      `El archivo no tiene la forma del padrón semanal: ${mensaje}`,
    );
  }
  return planearClasificacion(padron, CASOS_POR_CORRIDA);
}

function codigosDelPlan(
  enviados: string | undefined,
  plan: PlanDeClasificacion,
): Array<{ casoId: string; codigo: string }> {
  let lista: unknown;
  try {
    lista = JSON.parse(enviados ?? "");
  } catch {
    lista = undefined;
  }
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new DomainError("SIN_CLAVES", "No llegaron claves que escribir.");
  }
  const casos = new Map(plan.casos.map((caso) => [caso.id, caso]));
  const catalogo = catalogoDeLaPlataforma();
  const codigos = new Map<string, string>();
  for (const elemento of lista as unknown[]) {
    const campos: Record<string, unknown> =
      typeof elemento === "object" && elemento !== null
        ? (elemento as Record<string, unknown>)
        : {};
    const caso = typeof campos.casoId === "string" ? casos.get(campos.casoId) : undefined;
    const codigo = campos.codigo;
    if (
      !caso ||
      caso.puesto !== campos.puesto ||
      caso.centroDeCostos !== campos.centroDeCostos ||
      typeof codigo !== "string" ||
      !catalogo.ocupacion(codigo)
    ) {
      throw new DomainError(
        "CLAVES_DE_OTRO_PLAN",
        "Las claves no corresponden a los casos de este padrón. Hace falta clasificarlo de nuevo.",
      );
    }
    codigos.set(caso.id, codigo);
  }
  return [...codigos].map(([casoId, codigo]) => ({ casoId, codigo }));
}

function nombreDeSalida(original: string): string {
  const base = original.trim().replace(/\.xlsx$/iu, "");
  return `${base || "padron"} con ocupaciones.xlsx`;
}

function adjunto(nombre: string): string {
  const ascii =
    nombre
      .normalize("NFD")
      .replace(/[^\x20-\x7e]/gu, "")
      .replace(/["\\]/gu, "") || "padron con ocupaciones.xlsx";
  const codificado = encodeURIComponent(nombre).replace(
    /['()*]/gu,
    (letra) => `%${letra.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${codificado}`;
}

function sinAgente(peticion: FastifyRequest, respuesta: FastifyReply): FastifyReply {
  return respuesta.code(503).send({
    error: {
      code: "IA_SIN_CONFIGURAR",
      message: "El agente de ocupaciones está apagado.",
      requestId: String(peticion.id),
    },
  });
}

export function registerOccupationRoutes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    readonly extraer: (archivo: Buffer) => PadronLeido;
    readonly servicio?: () => Promise<ServicioDeOcupacionesPort>;
    readonly guion?: HojaDeEstilos;
  },
): void {
  const bodyLimit = deps.config.role === "nube" ? MAXIMO_EN_LA_NUBE : MAXIMO_DEL_ARCHIVO;

  app.get("/ocupaciones", (peticion, respuesta) =>
    respuesta
      .type("text/html; charset=utf-8")
      .header("content-security-policy", POLITICA_DE_OCUPACIONES)
      .code(200)
      .send(
        renderOccupationsPage({
          entorno: deps.config.environment,
          iaDisponible: deps.servicio !== undefined,
          subareas: SUBAREAS_CNO,
          tamanoDelCatalogo: catalogoDeLaPlataforma().tamano,
          limiteDeBusqueda: LIMITE_DE_BUSQUEDA,
          busqueda: busquedaDe((peticion.query ?? {}) as Record<string, unknown>),
          guion: deps.guion,
        }),
      ),
  );

  app.post("/api/ocupaciones/plan", { bodyLimit }, (peticion, respuesta) => {
    if (!deps.servicio) return sinAgente(peticion, respuesta);
    const { archivo } = leerFormulario(peticion);
    const plan = planDe(archivo, deps.extraer);
    const trabajadores = new Map<string, number>();
    for (const fila of plan.filas) {
      trabajadores.set(fila.caso, (trabajadores.get(fila.caso) ?? 0) + 1);
    }
    return respuesta.send({
      casos: plan.casos.map((caso) => ({
        id: caso.id,
        puesto: caso.puesto,
        centroDeCostos: caso.centroDeCostos,
        trabajadores: trabajadores.get(caso.id) ?? 0,
      })),
      trabajadores: plan.filas.length,
      conClave: plan.conClave,
      pendientes: plan.pendientes,
    });
  });

  app.post("/api/ocupaciones/sugerir", async (peticion, respuesta) => {
    if (!deps.servicio) return sinAgente(peticion, respuesta);
    const servicio = await deps.servicio();
    const inicio = Date.now();
    const sugerencia = await servicio.sugerir(peticion.body);
    peticion.log.info(
      {
        estado: sugerencia.estado,
        pasos: sugerencia.traza.length,
        milisegundos: Date.now() - inicio,
        version: sugerencia.version,
      },
      "ocupación sugerida",
    );
    return respuesta.send(sugerencia);
  });

  app.post("/api/ocupaciones/escribir", { bodyLimit }, (peticion, respuesta) => {
    const { archivo, campos } = leerFormulario(peticion);
    const plan = planDe(archivo, deps.extraer);
    const codigos = codigosDelPlan(campos.codigos, plan);
    const { buffer, celdasEscritas } = escribirCodigosEnXlsx(
      archivo.contenido,
      plan.filas,
      codigos,
    );
    peticion.log.info(
      { casos: codigos.length, celdas: celdasEscritas },
      "claves de ocupación escritas en la copia del padrón",
    );
    return respuesta
      .type(TIPO_XLSX)
      .header("content-disposition", adjunto(nombreDeSalida(archivo.nombre)))
      .header("x-kcm-celdas-escritas", String(celdasEscritas))
      .code(200)
      .send(buffer);
  });
}
