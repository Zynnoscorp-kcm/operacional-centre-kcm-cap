/**
 * Piezas comunes del módulo DC-3.
 *
 * El módulo es una plataforma dentro de la plataforma: tiene su propia barra
 * —con sus secciones, la cuenta de lo que falta emitir y un buscador de
 * trabajadores que lleva directo al expediente— y la misma forma de enseñar un
 * curso, una fecha o una emisión en todas sus pantallas. Lo que se repite se
 * escribe aquí una vez: escrito por pantalla es como acabaron discrepando, en
 * otras consolas, dos listas que decían salir del mismo padrón.
 */

import { sumarDiasIso } from "../../../../../packages/dc3/fechas.js";
import { etiquetaCortaDeCurso } from "../../../domain/dc3/constancia.ts";
import { CORTE_DE_CONSTANCIAS } from "../../../domain/dc3/corte.ts";
import type {
  Dc3Candidate,
  Dc3CandidateOrder,
  Dc3CourseCoverage,
  Dc3EmissionSummary,
  Dc3PlanSummary,
  Dc3PlanTab,
} from "../../../ports/dc3-constancia.port.ts";
import { fechaCorta } from "../../kit/fechas.ts";
import { html, type Html, rawHtml } from "../../kit/html.ts";

export { etiquetaCortaDeCurso, fechaCorta };

/** Lo que la bandeja pide a la bitácora. Sin valor en la dirección: sólo lo que falta. */
export type VistaDeEmision = "pendientes" | "emitidas" | "parciales" | "todas";

/** Los filtros tal como viajan por la dirección. */
export interface FiltrosDc3 {
  readonly courseKey?: string | undefined;
  readonly area?: string | undefined;
  readonly payrollType?: string | undefined;
  readonly query?: string | undefined;
  /** Sin valor, sólo lo que falta emitir: la bandeja es de pendientes. */
  readonly emission?: VistaDeEmision | undefined;
  /** Sin valor, los cursos desde el corte; `anteriores`, los de años anteriores. */
  readonly period?: "anteriores" | undefined;
}

export interface DestinoDeEmision {
  readonly pestana?: Dc3PlanTab;
  readonly orden?: Dc3CandidateOrder;
  readonly pagina?: number;
  /** Con `false`, el enlace no lleva al ancla de la lista. */
  readonly ancla?: boolean;
}

/** El orden de la bandeja cuando nadie pide otro. */
export const ORDEN_POR_OMISION: Dc3CandidateOrder = "nombre";

/** El año del corte, para los rótulos: «Desde 2026». */
export const ANIO_DEL_CORTE = CORTE_DE_CONSTANCIAS.slice(0, 4);

/**
 * El enlace de la bandeja con todo su estado.
 *
 * Los valores de omisión no se escriben —`pestana=listos`, `orden=nombre`,
 * `pagina=1`, `emision=pendientes`, el periodo desde el corte—, y no es por estética: así la dirección de
 * la bandeja recién abierta es `/dc3` a secas, los marcadores guardados siguen
 * valiendo y las pruebas que comparan direcciones no cambian de forma cada vez
 * que se añade un control.
 */
export function enlaceDeEmision(filtros: FiltrosDc3, destino: DestinoDeEmision = {}): string {
  const parametros = new URLSearchParams();
  if (destino.pestana && destino.pestana !== "listos") parametros.set("pestana", destino.pestana);
  if (destino.orden && destino.orden !== ORDEN_POR_OMISION) parametros.set("orden", destino.orden);
  if (destino.pagina && destino.pagina > 1) parametros.set("pagina", String(destino.pagina));
  if (filtros.query) parametros.set("q", filtros.query);
  if (filtros.courseKey) parametros.set("curso", filtros.courseKey);
  if (filtros.area) parametros.set("area", filtros.area);
  if (filtros.payrollType) parametros.set("payrollType", filtros.payrollType);
  if (filtros.emission && filtros.emission !== "pendientes") {
    parametros.set("emision", filtros.emission);
  }
  if (filtros.period) parametros.set("periodo", filtros.period);
  const cola = parametros.toString();
  const ancla = destino.ancla === false ? "" : "#plan";
  return `/dc3${cola ? `?${cola}` : ""}${ancla}`;
}

/** Las tres situaciones del plan, en el orden del trabajo. */
export const SITUACIONES = [
  {
    clave: "listos" as const,
    titulo: "Listos",
    explicacion: "Con todos los datos para una constancia completa.",
    cuenta: (plan: Dc3PlanSummary) => plan.ready,
    tono: "punto-ok",
  },
  {
    clave: "incompletos" as const,
    titulo: "Faltan datos",
    explicacion: "Con algún dato por completar; ese recuadro sale en blanco.",
    cuenta: (plan: Dc3PlanSummary) => plan.incomplete,
    tono: "punto-aviso",
  },
  {
    clave: "sin-curso" as const,
    titulo: "Sin el curso",
    explicacion: "Sin registro del curso. El formato sale con la fecha en blanco.",
    cuenta: (plan: Dc3PlanSummary) => plan.withoutDate,
    tono: "punto-alerta",
  },
] as const;

export function situacion(clave: Dc3PlanTab): (typeof SITUACIONES)[number] {
  return SITUACIONES.find((s) => s.clave === clave) ?? SITUACIONES[0];
}

/** Las cuatro vistas de la bitácora, con el rótulo con que se ofrecen. */
export const VISTAS_DE_EMISION: readonly {
  readonly clave: VistaDeEmision;
  readonly titulo: string;
}[] = [
  { clave: "pendientes", titulo: "Sin emitir" },
  { clave: "emitidas", titulo: "Ya emitidas" },
  { clave: "parciales", titulo: "Emitidas con blancos" },
  { clave: "todas", titulo: "Todas" },
];

/**
 * Los filtros puestos, uno por chip y cada uno con su aspa.
 *
 * Antes sólo existía «Limpiar filtros», que es todo o nada: para pasar de
 * «QMS + FLEXOGRAFICA + sindicalizados» a «QMS + sindicalizados» había que
 * limpiar los tres y volver a poner dos. Cada chip quita el suyo y deja los
 * demás, que es como se recorre un padrón cuando se busca a alguien.
 */
export function chipsDeFiltro(
  filtros: FiltrosDc3,
  destino: DestinoDeEmision,
  cursos: readonly { readonly courseKey: string; readonly courseName: string }[] = [],
): Html {
  const puestos: { etiqueta: string; sin: FiltrosDc3 }[] = [];
  if (filtros.query) {
    puestos.push({ etiqueta: `«${filtros.query}»`, sin: { ...filtros, query: undefined } });
  }
  if (filtros.courseKey) {
    const nombre = cursos.find((c) => c.courseKey === filtros.courseKey)?.courseName;
    puestos.push({
      etiqueta: nombre ? etiquetaCortaDeCurso(nombre) : filtros.courseKey,
      sin: { ...filtros, courseKey: undefined },
    });
  }
  if (filtros.area) {
    puestos.push({ etiqueta: filtros.area, sin: { ...filtros, area: undefined } });
  }
  if (filtros.payrollType) {
    puestos.push({
      etiqueta: filtros.payrollType === "NS" ? "Sindicalizados" : "Confianza",
      sin: { ...filtros, payrollType: undefined },
    });
  }
  if (filtros.period) {
    puestos.push({
      etiqueta: `Anteriores a ${ANIO_DEL_CORTE}`,
      sin: { ...filtros, period: undefined },
    });
  }
  if (filtros.emission && filtros.emission !== "pendientes") {
    const vista = VISTAS_DE_EMISION.find((v) => v.clave === filtros.emission);
    puestos.push({
      etiqueta: vista?.titulo ?? filtros.emission,
      sin: { ...filtros, emission: undefined },
    });
  }
  if (puestos.length === 0) return html``;

  return html`<p class="chips-filtro">
    <span class="chips-rotulo">Filtros:</span>
    ${puestos.map(
      (chip) =>
        html`<a
          class="chip-filtro"
          href="${enlaceDeEmision(chip.sin, destino)}"
          title="Quitar este filtro"
          >${chip.etiqueta}<span class="chip-aspa" aria-hidden="true">×</span
          ><span class="solo-lectores">, quitar</span></a
        >`,
    )}
    <a class="chip-limpiar" href="${enlaceDeEmision({}, destino)}">Quitar todos</a>
  </p>`;
}

/**
 * La barra de cobertura de un curso.
 *
 * Es un `<progress>` y no tres tramos de colores con anchos calculados, y la
 * razón es la política de contenido: `style-src 'self'` sin `'unsafe-inline'`
 * descarta el atributo `style`, así que un ancho proporcional tendría que salir
 * de una escala de clases —«cinco por ciento», «diez por ciento»— que nadie
 * mantiene sin equivocarse. El elemento nativo recibe el valor como atributo,
 * lo dibuja exacto y lo anuncia solo a los lectores de pantalla.
 *
 * Mide una cosa: cuántas constancias están listas del total obligado. Lo que
 * falta para ese total —datos por capturar o el curso sin tomar— se lee en sus
 * columnas, al lado, y no en tramos de color que exigirían su propia leyenda.
 */
export function barraDeCobertura(curso: Dc3CourseCoverage): Html {
  const rotulo =
    `${String(curso.ready)} de ${String(curso.total)} listos; ` +
    `${String(curso.incomplete)} con datos por capturar y ` +
    `${String(curso.withoutDate)} sin el curso`;

  return html`<progress
    class="cobertura-barra"
    value="${String(curso.ready)}"
    max="${String(Math.max(1, curso.total))}"
    title="${rotulo}"
  >
    ${porcentaje(curso.ready, curso.total)}
  </progress>`;
}

/** Porcentaje entero y honesto en los extremos: ni 100 % con uno pendiente. */
export function porcentaje(parte: number, total: number): string {
  if (total <= 0) return "—";
  if (parte >= total) return "100 %";
  if (parte <= 0) return "0 %";
  return `${Math.min(99, Math.max(1, Math.round((parte / total) * 100))).toFixed(0)} %`;
}

/** Las mismas etiquetas del directorio: la clave sola no la lee nadie. */
export function etiquetaNomina(tipo: string | null): string {
  const clave = (tipo ?? "").trim().toUpperCase();
  if (clave === "NS") return "Sindicalizado";
  if (clave === "NQ") return "Confianza";
  return clave || "—";
}

/** El nombre DC-3 de LOTO tiene 150 caracteres y rompe cualquier columna. */
export function acortar(nombre: string, tope = 44): string {
  return nombre.length > tope ? `${nombre.slice(0, tope - 1)}…` : nombre;
}

/** La clave con la que viaja un renglón: nómina y curso, como en la bitácora. */
export function claveDeRenglon(fila: { workerNumber: string; courseKey: string }): string {
  return `${fila.workerNumber}:${fila.courseKey}`;
}

/** Identificador de elemento a partir de una clave: sin dos puntos ni símbolos. */
export function idDeClave(prefijo: string, clave: string): string {
  return `${prefijo}-${clave.replace(/[^A-Za-z0-9_-]/gu, "-")}`;
}

/**
 * El último día del curso, como lo imprime la constancia: la fecha registrada
 * más los días del periodo. La inducción son tres jornadas y cierra dos días
 * después; los cursos de un día empiezan y terminan el mismo.
 */
export function terminoDe(
  curso: Pick<Dc3Candidate, "completionDate" | "periodDays">,
): string | null {
  return curso.completionDate ? sumarDiasIso(curso.completionDate, curso.periodDays) : null;
}

/** El día y la hora de un instante, en la hora de la planta. */
export function enPlanta(iso: string): { readonly dia: string; readonly hora: string } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const buscar = (tipo: string): string => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const hora = buscar("hour") === "24" ? "00" : buscar("hour");
  return {
    dia: `${buscar("year")}-${buscar("month")}-${buscar("day")}`,
    hora: `${hora}:${buscar("minute")}`,
  };
}

/** Lo que dice la bitácora de una constancia, en una ficha. */
export function fichaDeEmision(resumen: Dc3EmissionSummary | undefined): Html {
  if (!resumen) return html``;
  const dia = fechaCorta(enPlanta(resumen.lastAt).dia);
  const veces = resumen.count > 1 ? ` · ${String(resumen.count)} veces` : "";
  const titulo = `Última emisión: ${dia}, por ${resumen.lastActor}${veces}`;
  return resumen.anyComplete
    ? html`<span class="insignia insignia-completado" title="${titulo}">Emitida ${dia}</span>`
    : html`<span class="insignia insignia-aviso" title="${titulo}"
        >Emitida con blancos ${dia}</span
      >`;
}

/**
 * La palomita verde junto al nombre: ya salió al menos una constancia suya.
 * Va en todas las vistas del módulo para que no haga falta abrir el historial
 * para saberlo.
 */
export function marcaDeEmitida(emitida: boolean, detalle = "Constancia DC-3 ya emitida"): Html {
  if (!emitida) return html``;
  return html`<span class="marca-emitida" title="${detalle}" role="img" aria-label="${detalle}"
    >${ICONO_PALOMITA}</span
  >`;
}

/** Ficha con la etiqueta corta del curso y su nombre completo al pasar el puntero. */
export function fichaDeCurso(nombre: string): Html {
  return html`<span class="curso-ficha" title="${nombre}">${etiquetaCortaDeCurso(nombre)}</span>`;
}

// ── Iconos ─────────────────────────────────────────────────────────────────
// Trazos de 20×20 en `currentColor`, en línea: la política de contenido no
// admite un paquete de iconos por CDN, y un `<svg>` en el marcado no es un
// guion ni una hoja externa.

function icono(trazo: string, tamano = 15): Html {
  return rawHtml(
    `<svg viewBox="0 0 20 20" width="${String(tamano)}" height="${String(tamano)}" fill="none" ` +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      `aria-hidden="true" focusable="false">${trazo}</svg>`,
  );
}

export const ICONO_OJO = icono(
  '<path d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10Z"/>' +
    '<circle cx="10" cy="10" r="2.4"/>',
);

/**
 * El símbolo de combinar: dos círculos que se traslapan. Va en línea y con el
 * mismo trazo que el ojo, porque la política de contenido no admite un paquete
 * de iconos por CDN.
 */
export const ICONO_COMBINAR = icono(
  '<circle cx="7.6" cy="10" r="4.9"/><circle cx="12.4" cy="10" r="4.9"/>',
);

export const ICONO_DESCARGA = icono(
  '<path d="M10 3.4v9.2M6.2 9.2 10 12.9l3.8-3.7M3.6 16.2h12.8"/>',
);

export const ICONO_IMPRESORA = icono(
  '<path d="M5.6 7.4V3.4h8.8v4"/><rect x="2.8" y="7.4" width="14.4" height="6.6" rx="1.6"/>' +
    '<path d="M5.6 11.8h8.8v4.8H5.6z"/>',
);

const ICONO_PALOMITA = icono('<path d="m5.2 10.4 3.2 3.2 6.4-7"/>', 12);

export const ICONO_BUSCAR = icono('<circle cx="8.8" cy="8.8" r="5.2"/><path d="m13 13 4 4"/>', 16);

const ICONO_BANDEJA = icono(
  '<path d="M3 11.2 5.2 4.6h9.6l2.2 6.6v4.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>' +
    '<path d="M3 11.2h4.2l1 2h3.6l1-2H17"/>',
  16,
);
const ICONO_HISTORIAL = icono(
  '<path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.5"/><path d="M3.4 3.6v3.2h3.2"/><path d="M10 6.6V10l2.4 1.6"/>',
  16,
);
const ICONO_COBERTURA = icono(
  '<path d="M3.6 16.4V9.8M8.2 16.4V5.4M12.8 16.4v-4.2M17.4 16.4V3.6"/>',
  16,
);
const ICONO_FORMATO = icono(
  '<path d="M11.4 2.9H6.3a1.4 1.4 0 0 0-1.4 1.4v11.4a1.4 1.4 0 0 0 1.4 1.4h7.4a1.4 1.4 0 0 0 1.4-1.4V6.5z"/>' +
    '<path d="M11.4 2.9v3.6h3.7"/><path d="M7.6 10.6h4.8M7.6 13.4h3.2"/>',
  16,
);
const ICONO_PERSONA = icono(
  '<circle cx="10" cy="7" r="3.2"/><path d="M4 16.8a6 6 0 0 1 12 0"/>',
  16,
);

/** Las secciones del módulo, en el orden del trabajo. */
export type SeccionDc3 = "bandeja" | "historial" | "cobertura" | "datos" | "trabajador";

const SECCIONES: readonly {
  readonly clave: Exclude<SeccionDc3, "trabajador">;
  readonly nombre: string;
  readonly href: string;
  readonly icono: Html;
}[] = [
  { clave: "bandeja", nombre: "Por emitir", href: "/dc3", icono: ICONO_BANDEJA },
  { clave: "historial", nombre: "Emitidas", href: "/dc3/historial", icono: ICONO_HISTORIAL },
  { clave: "cobertura", nombre: "Cobertura", href: "/dc3/panel", icono: ICONO_COBERTURA },
  { clave: "datos", nombre: "Datos del formato", href: "/dc3/datos", icono: ICONO_FORMATO },
];

export interface BarraDeModulo {
  readonly activa: SeccionDc3;
  /** Constancias con fecha del curso y sin asentar: la cifra de la bandeja. */
  readonly porEmitir?: number | undefined;
  /** Lo que quedó escrito en el buscador. */
  readonly busqueda?: string | undefined;
  /** En el expediente, a quién se está viendo. */
  readonly trabajador?: { readonly numero: string; readonly nombre: string } | undefined;
}

/**
 * La barra del módulo.
 *
 * Sustituye a la tira genérica de sub-pestañas en las pantallas DC-3, y es lo
 * que las hace sentirse una sola aplicación: las secciones con su icono, la
 * cifra de lo que falta emitir siempre a la vista, y un buscador de
 * trabajadores que contesta desde cualquier pantalla la pregunta de la
 * ventanilla —«¿qué constancias tiene esta persona?»—.
 *
 * Lleva su propio nombre de transición de vista, distinto del de la tira
 * genérica: al moverse entre pantallas del módulo la barra se queda quieta y la
 * píldora se desliza; al llegar desde otra sección, la tira se funde en ella.
 */
export function renderBarraDeModulo(barra: BarraDeModulo): Html {
  return html`<nav class="modulo" aria-label="Secciones de constancias DC-3">
    <ul class="modulo-secciones">
      ${SECCIONES.map(
        (seccion) =>
          html`<li>
            <a
              class="modulo-pestana"
              href="${seccion.href}"
              ${barra.activa === seccion.clave ? html`aria-current="page"` : ""}
              >${seccion.icono}<span>${seccion.nombre}</span>${
                seccion.clave === "bandeja" && barra.porEmitir !== undefined
                  ? html`<span
                      class="modulo-cuenta"
                      title="Constancias pendientes de emitir desde ${ANIO_DEL_CORTE}"
                      >${barra.porEmitir}</span
                    >`
                  : ""
              }</a
            >
          </li>`,
      )}
      ${
        barra.trabajador
          ? html`<li>
              <a
                class="modulo-pestana"
                href="/dc3/trabajador/${barra.trabajador.numero}"
                aria-current="page"
                title="${barra.trabajador.nombre}"
                >${ICONO_PERSONA}<span>Expediente ${barra.trabajador.numero}</span></a
              >
            </li>`
          : ""
      }
    </ul>
    <form class="modulo-busqueda" method="get" action="/dc3/buscar" role="search">
      <label class="solo-lectores" for="dc3-buscar">Buscar trabajador por nómina o nombre</label>
      <span class="modulo-busqueda-icono">${ICONO_BUSCAR}</span>
      <input
        type="search"
        id="dc3-buscar"
        name="q"
        value="${barra.busqueda ?? ""}"
        placeholder="Nómina o nombre"
        autocomplete="off"
        class="modulo-busqueda-campo"
      />
      <button type="submit" class="modulo-busqueda-boton">Buscar</button>
    </form>
  </nav>`;
}

/** El ojo de vista previa: compone la constancia sin asentarla, en otra pestaña. */
export function ojoDeVistaPrevia(destino: string): Html {
  return html`<a
    class="boton-pequeno boton-icono"
    href="${destino}"
    target="_blank"
    rel="noopener"
    title="Ver la constancia sin emitirla ni registrarla"
    aria-label="Vista previa de la constancia"
    >${ICONO_OJO}</a
  >`;
}

/** Por qué no salió una constancia de la tanda, en palabras de la ventanilla. */
export function motivoDeFallo(codigo: string): string {
  switch (codigo) {
    case "CANDIDATO_DC3_NO_ENCONTRADO":
      return "no está activo con ese curso";
    case "SIN_FECHA_DE_CURSO":
      return "no tiene fecha del curso";
    case "CONSTANCIA_NO_CABE":
      return "su constancia no cabe en una hoja";
    default:
      return "renglón ilegible";
  }
}

/** El acuse de una emisión: lo que salió, lo que no, y la descarga. */
export interface AcuseDeEmision {
  readonly emitidas: number;
  readonly blancos: number;
  readonly fallidas: readonly { readonly clave: string; readonly codigo: string }[];
  /** Cuántas fallaron en total, cuando son más de las que se nombran. */
  readonly fallidasTotal?: number | undefined;
  /** A quién, cuando fue una sola. */
  readonly una?: { readonly workerName: string; readonly courseName: string } | undefined;
  /** El documento de lo emitido, sin volver a asentarlo. */
  readonly descarga?: string | undefined;
  readonly formato: "pdf" | "zip";
}

/**
 * El acuse arriba de la pantalla, después de emitir.
 *
 * La emisión vuelve a la misma lista, con los mismos filtros y en la misma
 * página: lo emitido sale de la bandeja y el documento baja solo.
 */
export function renderAcuse(acuse: AcuseDeEmision): Html {
  const titulo =
    acuse.emitidas === 0
      ? "No se emitió ninguna constancia"
      : acuse.una
        ? html`Constancia emitida: ${acuse.una.workerName} ·
          ${etiquetaCortaDeCurso(acuse.una.courseName)}`
        : html`${acuse.emitidas}
          ${acuse.emitidas === 1 ? "constancia emitida" : "constancias emitidas"}`;
  const restantes = Math.max(0, (acuse.fallidasTotal ?? 0) - acuse.fallidas.length);
  const blancos =
    acuse.blancos === 0
      ? ""
      : acuse.emitidas === 1
        ? "Sale con recuadros en blanco. "
        : `${String(acuse.blancos)} salen con recuadros en blanco. `;

  return html`<section
    class="acuse ${acuse.emitidas === 0 ? "acuse-fallido" : ""}"
    role="status"
    aria-live="polite"
  >
    <span class="acuse-marca" aria-hidden="true">${acuse.emitidas === 0 ? "!" : "✓"}</span>
    <div class="acuse-cuerpo">
      <p class="acuse-titulo">${titulo}</p>
      ${
        acuse.emitidas > 0 && acuse.descarga
          ? html`<p class="acuse-texto">
              ${blancos}La descarga del ${acuse.formato === "zip" ? "ZIP" : "PDF"} comienza en un
              momento.
            </p>`
          : ""
      }
      ${
        acuse.fallidas.length > 0
          ? html`<p class="acuse-texto acuse-fallas">
              No salieron:
              ${acuse.fallidas.map(
                (fallo, indice) =>
                  html`${indice > 0 ? ", " : ""}<span class="celda-mono"
                      >${fallo.clave.replace(":", " · ")}</span
                    >
                    (${motivoDeFallo(fallo.codigo)})`,
              )}${restantes > 0 ? ` y ${String(restantes)} más` : ""}.
            </p>`
          : ""
      }
    </div>
    ${
      acuse.descarga && acuse.emitidas > 0
        ? html`<div class="acuse-acciones">
            ${
              acuse.formato === "pdf"
                ? html`<a
                    class="boton-pequeno"
                    href="${acuse.descarga}&ver=1"
                    target="_blank"
                    rel="noopener"
                    >${ICONO_IMPRESORA} Abrir para imprimir</a
                  >`
                : ""
            }
            <a class="boton-pequeno boton-secundario" href="${acuse.descarga}"
              >${ICONO_DESCARGA} Descargar</a
            >
          </div>`
        : ""
    }
  </section>`;
}
