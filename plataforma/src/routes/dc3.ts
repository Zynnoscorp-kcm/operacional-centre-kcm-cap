import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { systemClock } from "../adapters/sistema/reloj-sistema.ts";
import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import {
  type Dc3CertificateService,
  claveDc3,
  etiquetaCortaDeCurso,
  formatoDeLaConstancia,
  leerClaveDc3,
} from "../domain/dc3/constancia.ts";
import { hoyEnPlanta, sumarDias } from "../domain/comun/dia-de-planta.ts";
import type {
  Dc3CandidateFilter,
  Dc3CandidateOrder,
  Dc3EmissionFilter,
  Dc3PlanTab,
} from "../ports/dc3-constancia.port.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { WorkerSystemRepositoryPort } from "../ports/sistema-trabajador.port.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { empaquetarZip } from "../server/zip.ts";
import { renderDc3ConfirmarPage } from "../web/pages/dc3-confirmar.ts";
import { renderDc3Page } from "../web/pages/dc3.ts";
import { agruparPorPersona, renderDc3BusquedaPage } from "../web/pages/dc3/buscar.ts";
import { renderDc3DatosPage } from "../web/pages/dc3/datos.ts";
import { renderDc3ExpedientePage } from "../web/pages/dc3/expediente.ts";
import {
  renderDc3HistorialPage,
  type FiltrosDeHistorial,
  type PeriodoDeHistorial,
} from "../web/pages/dc3/historial.ts";
import {
  ORDEN_POR_OMISION,
  enPlanta,
  motivoDeFallo,
  type AcuseDeEmision,
  type FiltrosDc3,
  type VistaDeEmision,
} from "../web/pages/dc3/kit.ts";
import { renderDc3PanelPage } from "../web/pages/dc3/panel.ts";

/**
 * Renglones por página. Cincuenta caben en una pantalla de escritorio sin
 * desplazar tres veces, y son pocos como para que el navegador los dibuje al
 * instante.
 */
const POR_PAGINA = 50;

/** Tope del CSV. Es alto porque el archivo se abre en Excel, no en la pantalla. */
const MAXIMO_DEL_CSV = 5000;

/** Fallas que el acuse nombra una por una; del resto dice cuántas son. */
const FALLAS_NOMBRADAS = 20;

/** Asientos por página del historial. Es un registro: se lee de corrido. */
const POR_PAGINA_DEL_HISTORIAL = 100;

/** Renglones que trae la búsqueda: unas sesenta personas, tres cursos cada una. */
const MAXIMO_DE_BUSQUEDA = 180;

/** Quien emite cuando no hay sesión nominal: el acceso abierto del piloto. */
const ACTOR_POR_OMISION = "USUARIO_CAPACITACION";

interface Topes {
  readonly tanda: number;
  readonly zip: number;
  readonly reimpresion: number;
  readonly reimpresionZip: number;
}

/**
 * Cuántas constancias salen de una vez.
 *
 * Una constancia suelta pesa de veinte a doscientos kilobytes según lleve o no
 * el logotipo del sindicato. En un solo PDF el logotipo se guarda una vez y
 * cada constancia suma unos cuantos kilobytes: dos mil caben en un archivo que
 * el equipo local entrega sin problema. En un ZIP cada archivo lleva el suyo.
 * En la nube la respuesta se corta a los 4.5 MB, y por eso allá los topes son
 * menores.
 */
export const TOPES_LOCALES: Topes = {
  tanda: 2000,
  zip: 300,
  reimpresion: 2000,
  reimpresionZip: 300,
};
export const TOPES_EN_LA_NUBE: Topes = {
  tanda: 400,
  zip: 15,
  reimpresion: 400,
  reimpresionZip: 15,
};

function topes(config: AppConfig): Topes {
  return config.role === "nube" ? TOPES_EN_LA_NUBE : TOPES_LOCALES;
}

const PESTANAS: readonly Dc3PlanTab[] = ["listos", "incompletos", "sin-curso"];

function pestanaDe(valor: unknown): Dc3PlanTab {
  const pedida = texto(valor);
  return PESTANAS.find((p) => p === pedida) ?? "listos";
}

/**
 * Los órdenes que la pantalla sabe pedir. Se comprueba contra la lista y no se
 * confía en lo que venga en la dirección: el valor acaba componiendo el
 * `ORDER BY` de la consulta, así que cualquier cosa que no sea uno de éstos cae
 * al orden de la bandeja.
 */
const ORDENES: readonly Dc3CandidateOrder[] = ["nombre", "personal"];

function ordenDe(valor: unknown): Dc3CandidateOrder {
  const pedido = texto(valor);
  return ORDENES.find((o) => o === pedido) ?? ORDEN_POR_OMISION;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Página pedida, siempre un entero positivo: la dirección la escribe cualquiera. */
function paginaDe(valor: unknown): number {
  const numero = Number.parseInt(texto(valor), 10);
  return Number.isFinite(numero) && numero > 1 ? numero : 1;
}

/** Lo que la bandeja pide a la bitácora; lo que no reconoce es la bandeja de siempre. */
function vistaDe(valor: unknown): VistaDeEmision | undefined {
  const pedida = texto(valor);
  return pedida === "emitidas" || pedida === "parciales" || pedida === "todas" ? pedida : undefined;
}

/** Los filtros de la bandeja tal como llegan en la dirección o en un formulario. */
function filtrosDe(consulta: Record<string, unknown>): FiltrosDc3 {
  const vista = vistaDe(consulta["emision"]);
  return {
    ...(texto(consulta["curso"]) ? { courseKey: texto(consulta["curso"]) } : {}),
    ...(texto(consulta["area"]) ? { area: texto(consulta["area"]) } : {}),
    ...(texto(consulta["payrollType"]) ? { payrollType: texto(consulta["payrollType"]) } : {}),
    ...(texto(consulta["q"]) ? { query: texto(consulta["q"]).slice(0, 80) } : {}),
    ...(vista ? { emission: vista } : {}),
    ...(texto(consulta["periodo"]) === "anteriores" ? { period: "anteriores" as const } : {}),
  };
}

/**
 * Los filtros de la pantalla traducidos a los del puerto.
 *
 * Sin vista pedida, la bandeja enseña lo que falta emitir: es la pregunta de
 * todos los días. «Todas» es la única vista que no filtra por la bitácora. Sin
 * periodo pedido, sólo cuentan los cursos desde el corte.
 */
function filtroDelPuerto(filtros: FiltrosDc3): Dc3CandidateFilter {
  const vista = filtros.emission ?? "pendientes";
  return {
    ...(filtros.courseKey ? { courseKey: filtros.courseKey } : {}),
    ...(filtros.area ? { area: filtros.area } : {}),
    ...(filtros.payrollType ? { payrollType: filtros.payrollType } : {}),
    ...(filtros.query ? { query: filtros.query } : {}),
    ...(vista === "todas" ? {} : { emission: vista }),
    period: filtros.period ?? "desde-corte",
  };
}

/** Un campo del formulario que puede llegar repetido, como las casillas. */
function lista(valor: unknown): readonly string[] {
  if (Array.isArray(valor)) return valor.map((v) => String(v).trim()).filter(Boolean);
  const uno = texto(valor);
  return uno ? [uno] : [];
}

/** Una celda de CSV que no rompe el archivo aunque el dato traiga comas. */
function celda(valor: string | null | undefined): string {
  const limpio = (valor ?? "").replace(/"/gu, '""');
  return `"${limpio}"`;
}

/** Un CSV que Excel en Windows abre con los acentos en su sitio. */
function csv(encabezado: readonly string[], filas: readonly (readonly string[])[]): string {
  // El BOM no es capricho: sin él, Excel en Windows lee el archivo como
  // Latin-1 y los nombres con acento salen rotos, que es justo la lista que
  // alguien va a imprimir para repartir.
  return `\uFEFF${[encabezado.join(","), ...filas.map((fila) => fila.join(","))].join("\r\n")}\r\n`;
}

/** Los parámetros del acuse: se quitan de la dirección de regreso antes de poner los nuevos. */
const PARAMETROS_DE_ACUSE = [
  "emitidas",
  "solicitud",
  "clave",
  "blancos",
  "fallidas",
  "fallaron",
  "formato",
  "entrega",
  "editable",
  "contexto",
  "marcar",
] as const;

/** El número de una solicitud, tal como lo genera el servidor. */
const SOLICITUD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * La dirección a la que vuelve una emisión, validada.
 *
 * Viaja en el formulario, así que la escribe quien quiera: sólo se acepta una
 * dirección de este mismo módulo, sin esquema ni anfitrión. Cualquier otra cosa
 * sería una redirección abierta hacia donde el formulario dijera.
 */
function volverSeguro(valor: unknown): string | undefined {
  const pedido = texto(valor);
  if (!/^\/dc3(?:\/[A-Za-z0-9_/-]*)?(?:\?[^#\s]*)?$/u.test(pedido) || pedido.includes("//")) {
    return undefined;
  }
  const url = new URL(pedido, "http://kcm.invalid");
  for (const parametro of PARAMETROS_DE_ACUSE) url.searchParams.delete(parametro);
  return `${url.pathname}${url.search}`;
}

/**
 * Lo que una emisión deja en la dirección de regreso.
 *
 * No viajan las claves de lo emitido sino el número de la solicitud que las
 * asentó: dos mil claves no caben en una dirección, y el número basta para que
 * la descarga las encuentre en la bitácora, en este equipo o en cualquier otro.
 */
interface ResultadoParaVolver {
  readonly emitidas: number;
  readonly solicitud: string;
  /** La clave, cuando fue una sola: el acuse dice de quién. */
  readonly clave?: string | undefined;
  readonly blancos: number;
  readonly fallidas: readonly { readonly clave: string; readonly codigo: string }[];
  readonly formato: "pdf" | "zip";
  readonly entrega: boolean;
  readonly editable: boolean;
  readonly contexto?: string | undefined;
}

type AcuseLeido = Omit<ResultadoParaVolver, "solicitud"> & {
  readonly solicitud?: string | undefined;
  readonly fallidasTotal: number;
};

/** La dirección de regreso con el acuse puesto. */
function conAcuse(volver: string, resultado: ResultadoParaVolver): string {
  const url = new URL(volver, "http://kcm.invalid");
  if (resultado.emitidas > 0) {
    url.searchParams.set("emitidas", String(resultado.emitidas));
    url.searchParams.set("solicitud", resultado.solicitud);
  }
  if (resultado.clave) url.searchParams.set("clave", resultado.clave);
  if (resultado.blancos) url.searchParams.set("blancos", String(resultado.blancos));
  if (resultado.fallidas.length) {
    url.searchParams.set(
      "fallidas",
      resultado.fallidas
        .slice(0, FALLAS_NOMBRADAS)
        .map((fallo) => `${fallo.clave}~${fallo.codigo}`)
        .join(","),
    );
    if (resultado.fallidas.length > FALLAS_NOMBRADAS) {
      url.searchParams.set("fallaron", String(resultado.fallidas.length));
    }
  }
  url.searchParams.set("formato", resultado.formato);
  if (resultado.entrega) url.searchParams.set("entrega", "1");
  if (resultado.editable) url.searchParams.set("editable", "1");
  if (resultado.contexto) url.searchParams.set("contexto", resultado.contexto);
  return `${url.pathname}${url.search}`;
}

/** La dirección del documento de lo recién emitido, que no vuelve a asentarlo. */
function direccionDeDocumento(resultado: {
  readonly solicitud: string;
  readonly formato: "pdf" | "zip";
  readonly entrega: boolean;
  readonly editable: boolean;
  readonly contexto?: string | undefined;
}): string {
  const parametros = new URLSearchParams({ solicitud: resultado.solicitud });
  if (resultado.formato === "zip") parametros.set("formato", "zip");
  if (resultado.entrega) parametros.set("entrega", "1");
  if (resultado.editable) parametros.set("editable", "1");
  if (resultado.contexto) parametros.set("contexto", resultado.contexto);
  return `/dc3/documentos?${parametros.toString()}`;
}

/** Un entero no negativo de la dirección; lo que no lo sea es cero. */
function cuenta(valor: unknown): number {
  return Math.max(0, Number.parseInt(texto(valor), 10) || 0);
}

/** Lee el acuse que trae la dirección, si lo trae. */
function acuseDe(consulta: Record<string, unknown>): AcuseLeido | undefined {
  const emitidas = cuenta(consulta["emitidas"]);
  const solicitud = texto(consulta["solicitud"]);
  const clave = texto(consulta["clave"]);
  const fallidas = texto(consulta["fallidas"])
    .split(",")
    .map((fallo) => {
      const [claveFallida = "", codigo = ""] = fallo.split("~");
      return { clave: claveFallida.slice(0, 90), codigo: codigo.slice(0, 40) };
    })
    .filter((fallo) => fallo.clave !== "")
    .slice(0, FALLAS_NOMBRADAS);
  if (emitidas === 0 && fallidas.length === 0) return undefined;
  const contexto = texto(consulta["contexto"]).slice(0, 120);
  return {
    emitidas,
    ...(SOLICITUD.test(solicitud) ? { solicitud } : {}),
    ...(leerClaveDc3(clave) ? { clave } : {}),
    fallidas,
    fallidasTotal: Math.max(fallidas.length, cuenta(consulta["fallaron"])),
    blancos: cuenta(consulta["blancos"]),
    formato: texto(consulta["formato"]) === "zip" ? "zip" : "pdf",
    entrega: texto(consulta["entrega"]) === "1",
    editable: texto(consulta["editable"]) === "1",
    ...(contexto ? { contexto } : {}),
  };
}

/** El acuse como lo pinta la pantalla, con la descarga de lo emitido. */
function acuseParaPantalla(
  leido: AcuseLeido,
  una: { readonly workerName: string; readonly courseName: string } | undefined,
): AcuseDeEmision {
  return {
    emitidas: leido.emitidas,
    blancos: leido.blancos,
    fallidas: leido.fallidas,
    fallidasTotal: leido.fallidasTotal,
    formato: leido.formato,
    ...(una ? { una } : {}),
    ...(leido.emitidas > 0 && leido.solicitud
      ? { descarga: direccionDeDocumento({ ...leido, solicitud: leido.solicitud }) }
      : {}),
  };
}

/** De qué va una tanda, para el encabezado de su hoja de entrega. */
function contextoDeTanda(
  filtros: FiltrosDc3,
  cursos: readonly { readonly courseKey: string; readonly courseName: string }[],
): string | undefined {
  const partes: string[] = [];
  if (filtros.area) partes.push(`Área ${filtros.area}`);
  if (filtros.courseKey) {
    const curso = cursos.find((c) => c.courseKey === filtros.courseKey);
    partes.push(curso ? etiquetaCortaDeCurso(curso.courseName) : filtros.courseKey);
  }
  if (filtros.payrollType === "NS") partes.push("Sindicalizados");
  if (filtros.payrollType === "NQ") partes.push("Empleados de confianza");
  return partes.length ? partes.join(" · ") : undefined;
}

/** El periodo del historial y el día desde el que cuenta. */
function periodoDe(valor: unknown): PeriodoDeHistorial {
  const pedido = texto(valor);
  return pedido === "hoy" || pedido === "semana" || pedido === "mes" ? pedido : "todo";
}

function diasDeCorte(hoy: string): { today: string; week: string; month: string } {
  return { today: hoy, week: sumarDias(hoy, -6), month: `${hoy.slice(0, 7)}-01` };
}

/** Por qué no se puede emitir una lista entera, dicho sin culpar a nadie. */
function listaDemasiadoLarga(tope: number): string {
  return (
    `Se emiten hasta ${String(tope)} constancias de una vez y la lista tiene más. ` +
    "Filtrada por curso o por área, cabe en una sola emisión."
  );
}

export function registerDc3Routes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    /** La emisión. Ausente sin base: la pantalla lo explica. */
    readonly certificates?: Dc3CertificateService;
    /**
     * El mismo repositorio que sirve las áreas en `/trabajadores`. Se reutiliza
     * en vez de escribir otra consulta: dos listas de áreas que se calculan
     * distinto acaban ofreciendo opciones distintas para el mismo padrón.
     */
    readonly workers?: WorkerSystemRepositoryPort;
    /**
     * Las sesiones de la consola, para firmar cada emisión con la cuenta de
     * quien la hizo. Sin ellas —o con el acceso abierto del piloto— la bitácora
     * recibe el actor de servicio.
     */
    readonly sessions?: ConsoleSessionCodec;
    readonly clock?: Clock;
  },
): void {
  const clock = deps.clock ?? systemClock;
  const limites = topes(deps.config);

  /** La cuenta de consola que está emitiendo, o el actor de servicio. */
  const actorDe = (peticion: FastifyRequest): string =>
    deps.sessions?.leer(peticion.headers.cookie, clock.now())?.usuario ?? ACTOR_POR_OMISION;

  const hoy = (): string => hoyEnPlanta(clock.now());

  /** Lo que falta emitir desde el corte: la cifra de la barra del módulo. */
  const cuentaPorEmitir = async (): Promise<number | undefined> => {
    if (!deps.certificates) return undefined;
    const plan = await deps.certificates.summarizePlan({
      emission: "pendientes",
      period: "desde-corte",
    });
    return plan.ready + plan.incomplete;
  };

  /**
   * La bandeja: una sola lista, poblada desde el primer momento. La pregunta de
   * esta pantalla es qué falta emitir, y la contesta sin pedir un botón antes.
   */
  const pintar = async (
    peticion: FastifyRequest,
    respuesta: FastifyReply,
    extra: { aviso?: string; error?: string } = {},
  ): Promise<FastifyReply> => {
    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const selected = filtrosDe(consulta);
    const pestana = pestanaDe(consulta["pestana"]);
    const orden = ordenDe(consulta["orden"]);
    let pagina = paginaDe(consulta["pagina"]);
    const marcados = texto(consulta["marcar"]) === "1";

    if (!deps.certificates) {
      return respuesta.type("text/html; charset=utf-8").send(
        renderDc3Page({
          config: deps.config,
          courses: [],
          areas: [],
          candidates: [],
          total: 0,
          pagina: 1,
          porPagina: POR_PAGINA,
          selected,
          sinBase: true,
          pestana,
          orden,
          marcados,
          topeDeTanda: limites.tanda,
          topeDeZip: limites.zip,
          ...(extra.aviso ? { aviso: extra.aviso } : {}),
          ...(extra.error ? { error: extra.error } : {}),
        }),
      );
    }

    const certificados = deps.certificates;
    const base = filtroDelPuerto(selected);
    const conPestana: Dc3CandidateFilter = { ...base, status: pestana };
    const { courseKey: _curso, ...sinCurso } = conPestana;

    const [courses, areas, total, plan, porCurso, emisiones, porEmitir] = await Promise.all([
      certificados.listDc3Courses(),
      deps.workers ? deps.workers.listAreas() : Promise.resolve([]),
      certificados.countCandidates(conPestana),
      certificados.summarizePlan(conPestana),
      certificados.countByCourse(sinCurso),
      certificados.emissionIndex(),
      cuentaPorEmitir(),
    ]);
    // Una página que ya no existe —la lista se vació al emitir— cae en la última.
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    if (pagina > paginas) pagina = paginas;
    const candidates = await certificados.listCandidates(
      conPestana,
      POR_PAGINA,
      orden,
      (pagina - 1) * POR_PAGINA,
    );

    const leido = acuseDe(consulta);
    let acuse: AcuseDeEmision | undefined;
    if (leido) {
      const [una] = leido.clave ? await certificados.buscar([leido.clave]) : [undefined];
      acuse = acuseParaPantalla(
        leido,
        una ? { workerName: una.workerName, courseName: una.courseName } : undefined,
      );
    }

    return respuesta.type("text/html; charset=utf-8").send(
      renderDc3Page({
        config: deps.config,
        courses,
        areas,
        candidates,
        total,
        pagina,
        porPagina: POR_PAGINA,
        selected,
        sinBase: false,
        pestana,
        orden,
        plan,
        porCurso,
        emisiones,
        marcados,
        porEmitir,
        topeDeTanda: limites.tanda,
        topeDeZip: limites.zip,
        ...(acuse ? { acuse } : {}),
        ...(extra.aviso ? { aviso: extra.aviso } : {}),
        ...(extra.error ? { error: extra.error } : {}),
      }),
    );
  };

  app.get("/dc3", (peticion, respuesta) => pintar(peticion, respuesta));

  /**
   * El buscador de la barra del módulo.
   *
   * Una nómina que existe va directo a su expediente, y un nombre que sólo
   * encaja con una persona también: la ventanilla quiere a la persona, no una
   * lista de un renglón.
   */
  app.get("/dc3/buscar", async (peticion, respuesta) => {
    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const q = texto(consulta["q"]).slice(0, 80);
    if (!q) return respuesta.redirect("/dc3", 303);

    if (!deps.certificates) {
      return respuesta.type("text/html; charset=utf-8").send(
        renderDc3BusquedaPage({
          config: deps.config,
          consulta: q,
          personas: [],
          recortada: false,
          emisiones: new Map(),
          sinBase: true,
        }),
      );
    }

    if (/^\d{5}$/u.test(q)) {
      const cursos = await deps.certificates.listWorkerCandidates(q);
      if (cursos.length > 0) return respuesta.redirect(`/dc3/trabajador/${q}`, 303);
    }

    const [filas, emisiones, porEmitir] = await Promise.all([
      deps.certificates.listCandidates({ query: q }, MAXIMO_DE_BUSQUEDA, "nombre"),
      deps.certificates.emissionIndex(),
      cuentaPorEmitir(),
    ]);
    const personas = agruparPorPersona(filas);
    const [unica] = personas;
    if (unica && personas.length === 1 && filas.length < MAXIMO_DE_BUSQUEDA) {
      return respuesta.redirect(`/dc3/trabajador/${unica.workerNumber}`, 303);
    }

    return respuesta.type("text/html; charset=utf-8").send(
      renderDc3BusquedaPage({
        config: deps.config,
        consulta: q,
        personas,
        recortada: filas.length >= MAXIMO_DE_BUSQUEDA,
        emisiones,
        porEmitir,
        sinBase: false,
      }),
    );
  });

  /** El expediente DC-3 de una persona: sus cursos y lo que ya salió. */
  app.get(
    "/dc3/trabajador/:numero",
    async (peticion: FastifyRequest<{ Params: { numero: string } }>, respuesta: FastifyReply) => {
      const numero = peticion.params.numero;
      // La nómina es texto de cinco dígitos. Lo que no lo sea no llega a la base.
      if (!/^\d{5}$/u.test(numero)) {
        return respuesta
          .code(404)
          .type("text/html; charset=utf-8")
          .send(
            renderDc3ExpedientePage({
              config: deps.config,
              workerNumber: "",
              cursos: [],
              emisiones: new Map(),
              historial: [],
            }),
          );
      }
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin conexión con la base de datos: no hay expedientes que consultar.",
        });
      }

      const [cursos, indice, historial, porEmitir] = await Promise.all([
        deps.certificates.listWorkerCandidates(numero),
        deps.certificates.emissionIndex(),
        deps.certificates.listEmissions({ workerNumber: numero }, 60),
        cuentaPorEmitir(),
      ]);
      const emisiones = new Map([...indice].filter(([clave]) => clave.startsWith(`${numero}:`)));

      const consulta = (peticion.query ?? {}) as Record<string, unknown>;
      const leido = acuseDe(consulta);
      const una = leido?.clave ? cursos.find((c) => claveDc3(c) === leido.clave) : undefined;
      const acuse: AcuseDeEmision | undefined = leido
        ? acuseParaPantalla(
            leido,
            una ? { workerName: una.workerName, courseName: una.courseName } : undefined,
          )
        : undefined;

      return respuesta
        .code(cursos.length === 0 ? 404 : 200)
        .type("text/html; charset=utf-8")
        .send(
          renderDc3ExpedientePage({
            config: deps.config,
            workerNumber: numero,
            cursos,
            emisiones,
            historial,
            porEmitir,
            ...(acuse ? { acuse } : {}),
          }),
        );
    },
  );

  /** Cobertura: cuánto falta por curso y por área, de los cursos desde el corte. */
  app.get("/dc3/panel", async (_peticion, respuesta) => {
    const desdeElCorte: Dc3CandidateFilter = { period: "desde-corte" };
    const [coverage, porArea, emisiones, porEmitir] = await Promise.all([
      deps.certificates ? deps.certificates.coverage(desdeElCorte) : Promise.resolve([]),
      deps.certificates ? deps.certificates.coverageByArea(desdeElCorte) : Promise.resolve([]),
      deps.certificates ? deps.certificates.listEmissions({}, 6) : Promise.resolve([]),
      cuentaPorEmitir(),
    ]);

    return respuesta.type("text/html; charset=utf-8").send(
      renderDc3PanelPage({
        config: deps.config,
        coverage,
        porArea,
        emisiones,
        porEmitir,
        sinBase: deps.certificates === undefined,
      }),
    );
  });

  /** Datos del formato: qué imprime cada curso y qué sale en blanco. */
  app.get("/dc3/datos", async (_peticion, respuesta) => {
    const [cursos, huecos, combinaciones, porEmitir] = deps.certificates
      ? await Promise.all([
          deps.certificates.listCourseMetadata(),
          deps.certificates.dataGaps(),
          deps.certificates.listOccupationGaps(25),
          cuentaPorEmitir(),
        ])
      : [[], undefined, [], undefined];

    return respuesta.type("text/html; charset=utf-8").send(
      renderDc3DatosPage({
        config: deps.config,
        cursos,
        formato: deps.certificates?.formatoVisible() ?? formatoDeLaConstancia(),
        huecos,
        combinaciones,
        porEmitir,
        sinBase: deps.certificates === undefined,
      }),
    );
  });

  /**
   * Los trabajadores activos sin clave de ocupación, para completar el padrón.
   *
   * Sale ordenado por área y puesto, que es como se decide la clave, con la
   * columna de la clave vacía y titulada como la espera el padrón. No lleva
   * CURP: lo que hace falta ahí es a quién le falta, no su dato personal.
   */
  app.get("/dc3/sin-ocupacion.csv", async (peticion, respuesta) => {
    if (!deps.certificates) {
      return pintar(peticion, respuesta, {
        error: "Sin conexión con la base de datos: no hay padrón del que sacar la lista.",
      });
    }
    const filas = await deps.certificates.listWorkersWithoutOccupation(5000);
    return respuesta
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="dc3-sin-clave-de-ocupacion.csv"')
      .header("cache-control", "no-store")
      .send(
        csv(
          ["numero_trabajador", "nombre", "area", "puesto", "tipo_nomina", "Clave de ocupación"],
          filas.map((fila) => [
            celda(fila.workerNumber),
            celda(fila.workerName),
            celda(fila.area),
            celda(fila.position),
            celda(fila.payrollType),
            celda(""),
          ]),
        ),
      );
  });

  /** Los filtros del historial tal como llegan en la dirección. */
  const filtrosDelHistorial = (consulta: Record<string, unknown>): FiltrosDeHistorial => {
    const como = texto(consulta["como"]);
    return {
      periodo: periodoDe(consulta["periodo"]),
      ...(texto(consulta["curso"]) ? { courseKey: texto(consulta["curso"]) } : {}),
      ...(texto(consulta["actor"]) ? { actor: texto(consulta["actor"]).slice(0, 80) } : {}),
      ...(como === "completas" || como === "parciales" ? { outcome: como } : {}),
      ...(texto(consulta["q"]) ? { query: texto(consulta["q"]).slice(0, 80) } : {}),
    };
  };

  const filtroDeEmisiones = (filtros: FiltrosDeHistorial, dia: string): Dc3EmissionFilter => {
    const cortes = diasDeCorte(dia);
    const desde =
      filtros.periodo === "hoy"
        ? cortes.today
        : filtros.periodo === "semana"
          ? cortes.week
          : filtros.periodo === "mes"
            ? cortes.month
            : undefined;
    return {
      ...(desde ? { from: desde } : {}),
      ...(filtros.courseKey ? { courseKey: filtros.courseKey } : {}),
      ...(filtros.actor ? { actor: filtros.actor } : {}),
      ...(filtros.outcome ? { outcome: filtros.outcome } : {}),
      ...(filtros.query ? { query: filtros.query } : {}),
    };
  };

  app.get("/dc3/historial", async (peticion, respuesta) => {
    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const filtros = filtrosDelHistorial(consulta);
    const dia = hoy();
    const pagina = paginaDe(consulta["pagina"]);

    if (!deps.certificates) {
      return respuesta.type("text/html; charset=utf-8").send(
        renderDc3HistorialPage({
          config: deps.config,
          emisiones: [],
          total: 0,
          pagina: 1,
          porPagina: POR_PAGINA_DEL_HISTORIAL,
          filtros,
          actores: [],
          cursos: [],
          hoy: dia,
          sinBase: true,
          topeDeReimpresion: limites.reimpresion,
        }),
      );
    }

    const filtro = filtroDeEmisiones(filtros, dia);
    const [emisiones, total, totales, actores, cursos, porEmitir] = await Promise.all([
      deps.certificates.listEmissions(
        filtro,
        POR_PAGINA_DEL_HISTORIAL,
        (pagina - 1) * POR_PAGINA_DEL_HISTORIAL,
      ),
      deps.certificates.countEmissions(filtro),
      deps.certificates.summarizeEmissions(diasDeCorte(dia)),
      deps.certificates.listEmissionActors(),
      deps.certificates.listDc3Courses(),
      cuentaPorEmitir(),
    ]);

    return respuesta.type("text/html; charset=utf-8").send(
      renderDc3HistorialPage({
        config: deps.config,
        emisiones,
        total,
        pagina,
        porPagina: POR_PAGINA_DEL_HISTORIAL,
        filtros,
        totales,
        actores,
        cursos,
        hoy: dia,
        porEmitir,
        sinBase: false,
        topeDeReimpresion: limites.reimpresion,
      }),
    );
  });

  /**
   * El historial en CSV, con los filtros puestos.
   *
   * Lo pide cualquier revisión: «enséñame lo que emitiste este mes». Sale con
   * las mismas columnas de la pantalla y en el mismo orden, para que el archivo
   * y la pantalla no puedan contar cosas distintas. La hora es la de la planta.
   */
  app.get("/dc3/historial.csv", async (peticion, respuesta) => {
    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const emisiones = deps.certificates
      ? await deps.certificates.listEmissions(
          filtroDeEmisiones(filtrosDelHistorial(consulta), hoy()),
          MAXIMO_DEL_CSV * 2,
        )
      : [];

    return respuesta
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="dc3-historial.csv"')
      .header("cache-control", "no-store")
      .send(
        csv(
          ["cuando", "numero_trabajador", "nombre", "curso", "como_salio", "actor"],
          emisiones.map((emision) => {
            const momento = enPlanta(emision.at);
            return [
              celda(`${momento.dia} ${momento.hora}`),
              celda(emision.workerNumber),
              celda(emision.workerName),
              celda(emision.courseName ?? emision.courseKey),
              celda(emision.partial ? "con recuadros en blanco" : "completa"),
              celda(emision.actor),
            ];
          }),
        ),
      );
  });

  /**
   * La lista en CSV.
   *
   * Sin CURP y sin tope de página: el archivo se abre en Excel para repartir o
   * cotejar, y ahí el dato que hace falta es a quién le toca y qué le falta. La
   * CURP vive en la constancia, que es donde tiene que estar.
   */
  app.get("/dc3/pendientes.csv", async (peticion, respuesta) => {
    if (!deps.certificates) {
      return pintar(peticion, respuesta, {
        error: "Sin conexión con la base de datos: no hay padrón del que emitir.",
      });
    }

    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const pestana = pestanaDe(consulta["pestana"]);
    const filtro = filtroDelPuerto(filtrosDe(consulta));

    const [filas, emitidas] = await Promise.all([
      deps.certificates.listCandidates(
        { ...filtro, status: pestana },
        MAXIMO_DEL_CSV,
        ordenDe(consulta["orden"]),
      ),
      deps.certificates.emittedKeys(),
    ]);

    return respuesta
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="dc3-pendientes-${pestana}.csv"`)
      .header("cache-control", "no-store")
      .send(
        csv(
          [
            "numero_trabajador",
            "nombre",
            "area",
            "puesto",
            "tipo_nomina",
            "curso",
            "fecha_del_curso",
            "recuadros_en_blanco",
            "ya_emitida",
          ],
          filas.map((fila) => [
            celda(fila.workerNumber),
            celda(fila.workerName),
            celda(fila.area),
            celda(fila.position),
            celda(fila.payrollType),
            celda(fila.courseName),
            celda(fila.completionDate),
            celda(
              [...fila.missing, ...(fila.completionDate ? [] : ["fecha del curso"])].join("; "),
            ),
            celda(emitidas.has(`${fila.workerNumber}:${fila.courseKey}`) ? "sí" : "no"),
          ]),
        ),
      );
  });

  /**
   * Emitir varias de una vez.
   *
   * Las marcadas —o la lista entera con sus filtros— se leen juntas, se
   * componen para comprobar que salen y se asientan en un solo viaje a la base.
   * La respuesta no es el archivo: es la vuelta a la misma lista, con el acuse
   * arriba y el documento bajando solo. Así una recarga no vuelve a emitir, y
   * quien emite sigue donde estaba.
   *
   * Es `POST` por lo mismo que la emisión individual: deja huella, y eso no
   * puede dispararse navegando a una dirección ni recargando una pestaña vieja.
   */
  app.post("/dc3/emitir-tanda", async (peticion, respuesta) => {
    if (!deps.certificates) {
      return pintar(peticion, respuesta, {
        error: "Sin conexión con la base de datos: no hay padrón del que emitir.",
      });
    }

    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
    const pestana = pestanaDe(cuerpo["pestana"]);
    const formato = texto(cuerpo["formato"]) === "zip" ? "zip" : "pdf";
    const tope = formato === "zip" ? limites.zip : limites.tanda;
    const volver = volverSeguro(cuerpo["volver"]) ?? "/dc3";
    const filtros = filtrosDe(cuerpo);
    let claves = lista(cuerpo["clave"]);

    if (texto(cuerpo["todo"]) === "1") {
      const filas = await deps.certificates.listCandidates(
        { ...filtroDelPuerto(filtros), status: pestana },
        tope + 1,
        ordenDe(cuerpo["orden"]),
      );
      if (filas.length > tope) {
        return pintar(peticion, respuesta, { error: listaDemasiadoLarga(tope) });
      }
      claves = filas.map((fila) => `${fila.workerNumber}:${fila.courseKey}`);
    }

    if (claves.length === 0) {
      return pintar(peticion, respuesta, {
        error: "No se marcó ninguna constancia: no se emitió nada.",
      });
    }
    if (claves.length > tope) {
      return pintar(peticion, respuesta, {
        error:
          `Se emiten hasta ${String(tope)} constancias de una vez y se marcaron ` +
          `${String(claves.length)}.`,
      });
    }

    let resultado;
    try {
      resultado = await deps.certificates.emitirVarias({
        claves,
        actor: actorDe(peticion),
        requestId: String(peticion.id),
        allowMissingDate: pestana !== "listos",
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return pintar(peticion, respuesta, { error: error.message });
    }

    if (resultado.emitidas.length === 0) {
      const [primera] = resultado.fallidas;
      return pintar(peticion, respuesta, {
        error:
          (claves.length === 1
            ? "La constancia no se pudo emitir"
            : `Ninguna de las ${String(claves.length)} constancias se pudo emitir`) +
          (primera
            ? `: ${primera.clave.replace(":", " · ")} ${motivoDeFallo(primera.codigo)}.`
            : "."),
      });
    }

    peticion.log.info(
      {
        emitidas: resultado.emitidas.length,
        fallidas: resultado.fallidas.length,
        pestana,
        formato,
      },
      "constancias DC-3 emitidas",
    );

    const cursos = await deps.certificates.listDc3Courses();
    return respuesta.redirect(
      conAcuse(volver, {
        emitidas: resultado.emitidas.length,
        solicitud: String(peticion.id),
        blancos: resultado.emitidas.filter((emision) => emision.blankFields.length > 0).length,
        fallidas: resultado.fallidas,
        formato,
        entrega: texto(cuerpo["entrega"]) === "1",
        editable: false,
        contexto: contextoDeTanda(filtros, cursos),
      }),
      303,
    );
  });

  /**
   * Lo ya emitido, compuesto otra vez: la descarga que sigue a una emisión y la
   * reimpresión del historial y del expediente.
   *
   * No asienta nada, y por eso sólo compone lo que ya está asentado: una
   * reimpresión masiva de lo que nunca se emitió sería una emisión sin rastro.
   * Mirar una constancia que no ha salido sigue siendo la vista previa, de una
   * en una. Lo recién emitido se pide por el número de la solicitud que lo
   * asentó; lo que se reimprime, por clave.
   */
  app.get("/dc3/documentos", async (peticion, respuesta) => {
    if (!deps.certificates) {
      return pintar(peticion, respuesta, {
        error: "Sin conexión con la base de datos: no hay constancias que componer.",
      });
    }

    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const solicitud = texto(consulta["solicitud"]);
    const claves = [
      ...(solicitud ? await deps.certificates.clavesDeLaSolicitud(solicitud) : []),
      ...lista(consulta["clave"]),
      ...texto(consulta["claves"])
        .split(",")
        .map((clave) => clave.trim())
        .filter(Boolean),
    ];
    const formato = texto(consulta["formato"]) === "zip" ? "zip" : "pdf";
    const tope = formato === "zip" ? limites.reimpresionZip : limites.reimpresion;

    if (claves.length === 0) {
      return pintar(peticion, respuesta, {
        error: solicitud
          ? "No se encontraron constancias emitidas en esa solicitud."
          : "No se pidió ninguna constancia.",
      });
    }
    if (claves.length > tope) {
      return pintar(peticion, respuesta, {
        error: `Se descargan hasta ${String(tope)} constancias de una vez y se pidieron ${String(claves.length)}.`,
      });
    }

    try {
      const documento = await deps.certificates.componerDocumento({
        claves,
        formato,
        entrega: texto(consulta["entrega"]) === "1",
        editable: texto(consulta["editable"]) === "1",
        actor: actorDe(peticion),
        fecha: hoy(),
        soloEmitidas: true,
        ...(texto(consulta["contexto"])
          ? { contexto: texto(consulta["contexto"]).slice(0, 120) }
          : {}),
      });

      if (documento.formato === "zip") {
        return (
          respuesta
            .type("application/zip")
            .header("content-disposition", `attachment; filename="${documento.nombre}"`)
            // Lleva nombre, CURP y puesto de varias personas: no se guarda en caché.
            .header("cache-control", "no-store")
            .send(empaquetarZip(documento.archivos ?? []))
        );
      }
      const disposicion = texto(consulta["ver"]) === "1" ? "inline" : "attachment";
      return respuesta
        .type("application/pdf")
        .header("content-disposition", `${disposicion}; filename="${documento.nombre}"`)
        .header("cache-control", "no-store")
        .send(Buffer.from(documento.pdf ?? new Uint8Array()));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      peticion.log.warn({ codigo: error.code }, "documento DC-3 rechazado");
      return pintar(peticion, respuesta, { error: error.message });
    }
  });

  /**
   * La constancia de una persona, compuesta sin registrarla.
   *
   * Es la ruta del ojo de vista previa. Mirar el documento no es una emisión
   * nueva: no puede ensuciar la bitácora ni hacer que un renglón aparezca
   * emitido dos veces.
   *
   * El generador es determinista, así que el PDF que se ve aquí es byte por
   * byte el que queda registrado al emitir.
   */
  app.get(
    "/dc3/vista-previa/:workerNumber/:courseKey",
    async (
      peticion: FastifyRequest<{ Params: { workerNumber: string; courseKey: string } }>,
      respuesta: FastifyReply,
    ) => {
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin conexión con la base de datos: no hay padrón del que emitir.",
        });
      }

      const consulta = (peticion.query ?? {}) as {
        editable?: unknown;
        enBlanco?: unknown;
        descargar?: unknown;
      };

      try {
        const constancia = await deps.certificates.emitir({
          workerNumber: peticion.params.workerNumber,
          courseKey: peticion.params.courseKey,
          actor: actorDe(peticion),
          requestId: String(peticion.id),
          editable: texto(consulta.editable) === "1",
          allowMissingDate: texto(consulta.enBlanco) === "1",
          preview: true,
        });

        const disposicion = texto(consulta.descargar) === "1" ? "attachment" : "inline";
        return respuesta
          .type("application/pdf")
          .header("content-disposition", `${disposicion}; filename="${constancia.fileName}"`)
          .header("cache-control", "no-store")
          .send(Buffer.from(constancia.pdf));
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "vista previa DC-3 rechazada");
        return pintar(peticion, respuesta, { error: error.message });
      }
    },
  );

  /**
   * La advertencia previa a emitir, como pantalla.
   *
   * La bandeja pregunta encima del renglón; esta pantalla es el respaldo del
   * navegador que no entiende `popover`. Aquí todavía no pasa nada: se compone
   * la constancia en modo vista previa —que no registra— para poder decir de
   * quién es y qué recuadros saldrían vacíos. Las compuertas de siempre siguen
   * delante: sin fecha y sin declararlo, ni se llega a preguntar.
   */
  app.get(
    "/dc3/constancia/:workerNumber/:courseKey",
    async (
      peticion: FastifyRequest<{ Params: { workerNumber: string; courseKey: string } }>,
      respuesta: FastifyReply,
    ) => {
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin conexión con la base de datos: no hay padrón del que emitir.",
        });
      }

      const consulta = (peticion.query ?? {}) as Record<string, unknown>;
      const editable = texto(consulta["editable"]) === "1";
      const enBlanco = texto(consulta["enBlanco"]) === "1";
      const pestana = pestanaDe(consulta["pestana"]);
      const volver =
        volverSeguro(consulta["volver"]) ??
        (pestana === "listos" ? "/dc3" : `/dc3?pestana=${pestana}`);

      try {
        const previa = await deps.certificates.emitir({
          workerNumber: peticion.params.workerNumber,
          courseKey: peticion.params.courseKey,
          actor: actorDe(peticion),
          requestId: String(peticion.id),
          editable,
          allowMissingDate: enBlanco,
          preview: true,
        });

        const cola = `${encodeURIComponent(peticion.params.workerNumber)}/${encodeURIComponent(peticion.params.courseKey)}`;
        return respuesta
          .type("text/html; charset=utf-8")
          .header("cache-control", "no-store")
          .send(
            renderDc3ConfirmarPage({
              config: deps.config,
              workerNumber: previa.workerNumber,
              workerName: previa.workerName,
              courseName: previa.courseName,
              accion: `/dc3/constancia/${cola}`,
              ocultos: [
                ["volver", volver],
                ...(editable ? ([["editable", "1"]] as const) : []),
                ...(enBlanco ? ([["enBlanco", "1"]] as const) : []),
              ],
              regreso: volver,
              blankFields: previa.blankFields,
            }),
          );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "emisión individual DC-3 rechazada");
        return pintar(peticion, respuesta, { error: error.message });
      }
    },
  );

  /**
   * La emisión de verdad: el «sí» de la advertencia.
   *
   * Es `POST` porque deja huella —asienta la constancia en la bitácora— y eso no
   * se puede disparar por navegar a una dirección ni por recargar. Responde con
   * la vuelta a la lista de donde se emitió, con el acuse arriba y el PDF
   * bajando solo: quien emite varias seguidas no pierde ni la página ni los
   * filtros, y una recarga no emite otra vez.
   */
  app.post(
    "/dc3/constancia/:workerNumber/:courseKey",
    async (
      peticion: FastifyRequest<{ Params: { workerNumber: string; courseKey: string } }>,
      respuesta: FastifyReply,
    ) => {
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin conexión con la base de datos: no hay padrón del que emitir.",
        });
      }

      const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
      const volver = volverSeguro(cuerpo["volver"]) ?? "/dc3";

      try {
        const constancia = await deps.certificates.emitir({
          workerNumber: peticion.params.workerNumber,
          courseKey: peticion.params.courseKey,
          actor: actorDe(peticion),
          requestId: String(peticion.id),
          editable: texto(cuerpo["editable"]) === "1",
          // Lo piden los renglones que ya se sabe que salen con blancos, y sólo
          // ellos: sin la bandera, quien no tiene fecha del curso sigue sin
          // recibir constancia.
          allowMissingDate: texto(cuerpo["enBlanco"]) === "1",
        });

        peticion.log.info(
          { curso: peticion.params.courseKey, enBlanco: constancia.blankFields.length },
          "constancia DC-3 individual emitida",
        );

        return respuesta.redirect(
          conAcuse(volver, {
            emitidas: 1,
            solicitud: String(peticion.id),
            clave: `${constancia.workerNumber}:${peticion.params.courseKey}`,
            blancos: constancia.blankFields.length > 0 ? 1 : 0,
            fallidas: [],
            formato: "pdf",
            entrega: false,
            editable: constancia.editable,
          }),
          303,
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "emisión individual DC-3 rechazada");
        return pintar(peticion, respuesta, { error: error.message });
      }
    },
  );
}
