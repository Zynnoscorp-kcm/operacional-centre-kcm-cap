/**
 * Emitidas: el historial de constancias DC-3.
 *
 * Una constancia DC-3 es un documento legal con datos personales, y la pregunta
 * que llega después de emitirla es siempre de este tipo: «¿qué salió hoy?»,
 * «¿qué emitió tal cuenta la semana pasada?», «¿ya se le entregó la de LOTO a
 * este trabajador?», «necesito otra copia».
 *
 * Lee `sistema.bitacora_auditoria`, la fuente que no se reescribe, y la enseña agrupada por
 * día de la planta. Reimprimir compone de nuevo lo ya asentado sin asentarlo
 * otra vez: aquí no se emite ni se borra nada.
 */

import type { AppConfig } from "../../../config/environment.ts";
import type { Dc3EmissionRecord, Dc3EmissionTotals } from "../../../ports/dc3-constancia.port.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import {
  ICONO_DESCARGA,
  ICONO_IMPRESORA,
  enPlanta,
  etiquetaCortaDeCurso,
  fechaCorta,
  fichaDeCurso,
  renderBarraDeModulo,
} from "./kit.ts";

/** Los periodos que se ofrecen como opción de un clic. */
export type PeriodoDeHistorial = "hoy" | "semana" | "mes" | "todo";

export interface FiltrosDeHistorial {
  readonly periodo: PeriodoDeHistorial;
  readonly courseKey?: string | undefined;
  readonly actor?: string | undefined;
  readonly outcome?: "completas" | "parciales" | undefined;
  readonly query?: string | undefined;
}

export interface Dc3HistorialInput {
  readonly config: AppConfig;
  readonly emisiones: readonly Dc3EmissionRecord[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
  readonly filtros: FiltrosDeHistorial;
  readonly totales?: Dc3EmissionTotals | undefined;
  readonly actores: readonly string[];
  readonly cursos: readonly { readonly courseKey: string; readonly courseName: string }[];
  readonly hoy: string;
  readonly porEmitir?: number | undefined;
  readonly sinBase: boolean;
  readonly topeDeReimpresion: number;
}

const PERIODOS: readonly {
  readonly clave: PeriodoDeHistorial;
  readonly titulo: string;
  readonly cuenta: (t: Dc3EmissionTotals) => number;
}[] = [
  { clave: "hoy", titulo: "Hoy", cuenta: (t) => t.today },
  { clave: "semana", titulo: "Últimos 7 días", cuenta: (t) => t.week },
  { clave: "mes", titulo: "Este mes", cuenta: (t) => t.month },
  { clave: "todo", titulo: "Todo", cuenta: (t) => t.total },
];

/** La dirección del historial con sus filtros; los de omisión no se escriben. */
export function enlaceDeHistorial(filtros: FiltrosDeHistorial, pagina = 1): string {
  const parametros = new URLSearchParams();
  if (filtros.periodo !== "todo") parametros.set("periodo", filtros.periodo);
  if (filtros.courseKey) parametros.set("curso", filtros.courseKey);
  if (filtros.actor) parametros.set("actor", filtros.actor);
  if (filtros.outcome) parametros.set("como", filtros.outcome);
  if (filtros.query) parametros.set("q", filtros.query);
  if (pagina > 1) parametros.set("pagina", String(pagina));
  const cola = parametros.toString();
  return `/dc3/historial${cola ? `?${cola}` : ""}`;
}

/** «Hoy», «Ayer» o la fecha, para los encabezados de día. */
function nombreDelDia(dia: string, hoy: string): string {
  const ayer = new Date(new Date(`${hoy}T12:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (dia === hoy) return `Hoy · ${fechaCorta(dia)}`;
  if (dia === ayer) return `Ayer · ${fechaCorta(dia)}`;
  return fechaCorta(dia);
}

/** Los asientos, en grupos por día de la planta y en el orden en que llegaron. */
function porDia(emisiones: readonly Dc3EmissionRecord[]): [string, Dc3EmissionRecord[]][] {
  const grupos = new Map<string, Dc3EmissionRecord[]>();
  for (const emision of emisiones) {
    const dia = enPlanta(emision.at).dia;
    const grupo = grupos.get(dia);
    if (grupo) grupo.push(emision);
    else grupos.set(dia, [emision]);
  }
  return [...grupos];
}

function renderFila(emision: Dc3EmissionRecord): Html {
  const clave = `${emision.workerNumber}:${emision.courseKey}`;
  return html`<tr>
    <td class="columna-casilla">
      <input
        type="checkbox"
        name="clave"
        value="${clave}"
        class="casilla-kcm"
        aria-label="Marcar para reimprimir"
      />
    </td>
    <td class="celda-mono celda-hora">${enPlanta(emision.at).hora}</td>
    <td class="celda-persona">
      ${
        emision.workerName
          ? html`<a class="persona-nombre" href="/dc3/trabajador/${emision.workerNumber}"
              >${emision.workerName}</a
            >`
          : html`<span class="texto-atenuado">Fuera del padrón activo</span>`
      }
      <span class="persona-meta celda-mono">${emision.workerNumber}</span>
    </td>
    <td>${fichaDeCurso(emision.courseName ?? emision.courseKey)}</td>
    <td>
      ${
        emision.partial
          ? html`<span class="insignia insignia-aviso">Con recuadros en blanco</span>`
          : html`<span class="insignia insignia-completado">Completa</span>`
      }
    </td>
    <td class="texto-secundario">${emision.actor}</td>
    <td class="celda-acciones">
      <a
        class="boton-pequeno boton-icono"
        href="/dc3/documentos?claves=${encodeURIComponent(clave)}"
        title="Reimprimir sin registrar otra emisión"
        aria-label="Reimprimir la constancia"
        >${ICONO_DESCARGA}</a
      >
    </td>
  </tr>`;
}

function renderFiltros(input: Dc3HistorialInput): Html {
  const { filtros } = input;
  return html`<div class="historial-filtros">
    <nav class="segmentado" aria-label="Periodo">
      ${PERIODOS.map(
        (periodo) =>
          html`<a
            class="segmento"
            href="${enlaceDeHistorial({ ...filtros, periodo: periodo.clave })}"
            ${filtros.periodo === periodo.clave ? html`aria-current="true"` : ""}
            >${periodo.titulo}${
              input.totales
                ? html`<span class="segmento-cuenta">${periodo.cuenta(input.totales)}</span>`
                : ""
            }</a
          >`,
      )}
    </nav>
    <form method="GET" action="/dc3/historial" class="historial-formulario" role="search">
      ${filtros.periodo !== "todo" ? html`<input type="hidden" name="periodo" value="${filtros.periodo}" />` : ""}
      <label class="faceta-campo" for="historial-q">
        <span class="faceta-titulo">Nómina o nombre</span>
        <input
          type="search"
          id="historial-q"
          name="q"
          value="${filtros.query ?? ""}"
          class="input-kcm"
          placeholder="Ej. 01234 o JUAN PEREZ"
        />
      </label>
      <label class="faceta-campo" for="historial-curso">
        <span class="faceta-titulo">Curso</span>
        <select id="historial-curso" name="curso" class="select-kcm">
          <option value="">Todos</option>
          ${input.cursos.map(
            (curso) =>
              html`<option
                value="${curso.courseKey}"
                ${filtros.courseKey === curso.courseKey ? "selected" : ""}
              >
                ${etiquetaCortaDeCurso(curso.courseName)}
              </option>`,
          )}
        </select>
      </label>
      <label class="faceta-campo" for="historial-actor">
        <span class="faceta-titulo">Emitida por</span>
        <select id="historial-actor" name="actor" class="select-kcm">
          <option value="">Cualquiera</option>
          ${input.actores.map(
            (actor) =>
              html`<option value="${actor}" ${filtros.actor === actor ? "selected" : ""}>
                ${actor}
              </option>`,
          )}
        </select>
      </label>
      <label class="faceta-campo" for="historial-como">
        <span class="faceta-titulo">Resultado</span>
        <select id="historial-como" name="como" class="select-kcm">
          <option value="">Completas y con blancos</option>
          <option value="completas" ${filtros.outcome === "completas" ? "selected" : ""}>
            Completas
          </option>
          <option value="parciales" ${filtros.outcome === "parciales" ? "selected" : ""}>
            Con recuadros en blanco
          </option>
        </select>
      </label>
      <button type="submit" class="boton-secundario boton-pequeno">Aplicar</button>
    </form>
  </div>`;
}

export function renderDc3HistorialPage(input: Dc3HistorialInput): string {
  const paginas = Math.max(1, Math.ceil(input.total / input.porPagina));
  const csv = enlaceDeHistorial(input.filtros).replace("/dc3/historial", "/dc3/historial.csv");

  const contenido: Html = input.sinBase
    ? html`<section class="tarjeta">
        <p class="texto-vacio">
          Sin conexión con la base de datos: no hay historial que consultar.
        </p>
      </section>`
    : html`<section class="tarjeta" aria-labelledby="titulo-historial">
        <div class="seccion-cabecera cabecera-fila">
          <div>
            <h2 id="titulo-historial">Constancias emitidas</h2>
            <p>Registro permanente de cada emisión: no se edita ni se borra.</p>
          </div>
          <a class="boton-pequeno boton-secundario" href="${csv}"
            >${ICONO_DESCARGA} Descargar CSV</a
          >
        </div>

        ${renderFiltros(input)}

        <form method="GET" action="/dc3/documentos" class="formulario-tanda">
          <div class="tabla-contenedor">
            <table class="tabla-kcm tabla-historial">
              <thead>
                <tr>
                  <th scope="col" class="columna-casilla">
                    <span class="solo-lectores">Marcar</span>
                  </th>
                  <th scope="col">Hora</th>
                  <th scope="col">Trabajador</th>
                  <th scope="col">Curso</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Emitida por</th>
                  <th scope="col" class="columna-acciones">
                    <span class="solo-lectores">Reimprimir</span>
                  </th>
                </tr>
              </thead>
              ${
                input.emisiones.length === 0
                  ? html`<tbody>
                      <tr>
                        <td colspan="7" class="texto-vacio">
                          Ninguna constancia emitida con estos filtros.
                        </td>
                      </tr>
                    </tbody>`
                  : porDia(input.emisiones).map(
                      ([dia, grupo]) =>
                        html`<tbody>
                          <tr class="fila-dia">
                            <th scope="rowgroup" colspan="7">
                              ${nombreDelDia(dia, input.hoy)}
                              <span class="fila-dia-cuenta"
                                >${grupo.length}
                                ${grupo.length === 1 ? "constancia" : "constancias"}</span
                              >
                            </th>
                          </tr>
                          ${grupo.map(renderFila)}
                        </tbody>`,
                    )
              }
            </table>
          </div>

          <div class="pie-de-tabla">
            <div class="pie-acciones">
              <span class="texto-nota"
                >Reimprimir descarga de nuevo la constancia con los datos actuales, sin registrar
                otra emisión.</span
              >
            </div>
            <div class="paginacion">
              <span class="paginacion-cuenta">
                ${input.total === 0 ? "Sin emisiones" : html`${input.total} ${input.total === 1 ? "emisión" : "emisiones"} · página ${input.pagina} de ${paginas}`}
              </span>
              ${
                input.pagina > 1
                  ? html`<a
                      class="boton-pequeno boton-secundario"
                      href="${enlaceDeHistorial(input.filtros, input.pagina - 1)}"
                      >← Más recientes</a
                    >`
                  : ""
              }
              ${
                input.pagina < paginas
                  ? html`<a
                      class="boton-pequeno boton-secundario"
                      href="${enlaceDeHistorial(input.filtros, input.pagina + 1)}"
                      >Más antiguas →</a
                    >`
                  : ""
              }
            </div>
          </div>

          ${
            input.emisiones.length > 0
              ? html`<div class="barra-seleccion" role="group" aria-label="Constancias marcadas">
                  <p class="seleccion-cuenta">
                    <span class="seleccion-numero" aria-hidden="true"></span>
                    <span>marcadas</span>
                  </p>
                  <label class="casilla-con-rotulo seleccion-opcion">
                    <input type="checkbox" name="entrega" value="1" class="casilla-opcion" />
                    Hoja de entrega
                  </label>
                  <div class="seleccion-acciones">
                    <button type="submit" name="formato" value="pdf" class="boton-kcm">
                      ${ICONO_IMPRESORA} Reimprimir en un PDF
                    </button>
                    <button
                      type="submit"
                      name="formato"
                      value="zip"
                      class="boton-secundario boton-pequeno"
                    >
                      En ZIP
                    </button>
                    <button type="reset" class="boton-enlace">Quitar las marcas</button>
                  </div>
                </div>`
              : ""
          }
        </form>
        <p class="texto-nota">
          Se reimprimen hasta ${input.topeDeReimpresion} constancias de una vez.
        </p>
      </section>`;

  return renderLayout({
    titulo: "Constancias DC-3",
    rutaActiva: "/dc3/historial",
    subtitulo: input.totales
      ? `${String(input.totales.today)} emitidas hoy · ${String(input.totales.total)} en total`
      : "Historial de emisiones",
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({ activa: "historial", porEmitir: input.porEmitir }),
    contenido,
  });
}
