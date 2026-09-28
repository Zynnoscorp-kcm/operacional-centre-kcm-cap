/**
 * Cobertura: cuánto falta, por curso y por área.
 *
 * La bandeja dice «qué falta emitir»; esta pantalla dice **cuánto y dónde**:
 * cuántas constancias debe la planta desde el corte, cuántas ya salieron y en
 * qué áreas se acumula lo pendiente. Es la pantalla para rendir cuentas —la que
 * se abre cuando un jefe de área pregunta cómo va la suya— y por eso cada cifra
 * lleva a la bandeja ya filtrada por lo que cuenta.
 *
 * Los universos salen de contar en la base, no de sumar lo que una página
 * alcanzó a traer. La tabla por área es una tabla y no un mapa de colores: las
 * áreas son decenas, y más de siete tonos con significado no se distinguen; la
 * cifra se lee, y el medidor acompaña.
 */

import type { AppConfig } from "../../../config/environment.ts";
import type {
  Dc3AreaCoverage,
  Dc3CourseCoverage,
  Dc3EmissionRecord,
} from "../../../ports/dc3-constancia.port.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import {
  ANIO_DEL_CORTE,
  enPlanta,
  enlaceDeEmision,
  etiquetaCortaDeCurso,
  fechaCorta,
  fichaDeCurso,
  porcentaje,
  renderBarraDeModulo,
} from "./kit.ts";

export interface Dc3PanelInput {
  readonly config: AppConfig;
  /** Cuentas por curso de los cursos tomados desde el corte. */
  readonly coverage: readonly Dc3CourseCoverage[];
  readonly porArea: readonly Dc3AreaCoverage[];
  readonly emisiones: readonly Dc3EmissionRecord[];
  readonly porEmitir?: number | undefined;
  readonly sinBase: boolean;
}

type Columna =
  "total" | "ready" | "incomplete" | "withoutDate" | "emitted" | "pending" | "beforeCutoff";

/** Suma una columna de la cobertura. Son unos cuantos cursos: no hay nada que optimizar. */
function total(coverage: readonly Dc3CourseCoverage[], campo: Columna): number {
  return coverage.reduce((suma, curso) => suma + curso[campo], 0);
}

function renderKpi(
  etiqueta: string,
  cifra: number | string,
  pista: Html | string,
  tono = "",
  destino?: string,
): Html {
  return html`<div class="kpi ${tono}">
    <dt class="kpi-etiqueta">${etiqueta}</dt>
    <dd class="kpi-dato"><span class="kpi-cifra">${cifra}</span></dd>
    <p class="kpi-pista">${destino ? html`<a href="${destino}">${pista}</a>` : pista}</p>
  </div>`;
}

/**
 * El avance de entrega de un curso: de quienes ya tienen fecha del curso,
 * cuántos tienen su constancia. Es un medidor y no tres tramos de color: mide
 * una sola razón, y lo que falta se lee en las columnas de al lado.
 */
function medidorDeEntrega(emitidas: number, conFecha: number, rotulo: string): Html {
  return html`<progress
    class="cobertura-barra cobertura-entrega"
    value="${String(Math.min(emitidas, conFecha))}"
    max="${String(Math.max(1, conFecha))}"
    title="${rotulo}"
  >
    ${porcentaje(emitidas, conFecha)}
  </progress>`;
}

function renderCobertura(coverage: readonly Dc3CourseCoverage[]): Html {
  if (coverage.length === 0) {
    return html`<p class="texto-vacio">Ningún curso tiene constancia DC-3 asignada.</p>`;
  }

  return html`<div class="tabla-contenedor">
    <table class="tabla-kcm tabla-cobertura">
      <thead>
        <tr>
          <th scope="col">Curso</th>
          <th scope="col" class="columna-ancha">Avance de entrega</th>
          <th scope="col" class="celda-numero">Con el curso</th>
          <th scope="col" class="celda-numero">Emitidas</th>
          <th scope="col" class="celda-numero">Por emitir</th>
          <th scope="col" class="celda-numero">Sin registro</th>
          <th scope="col" class="celda-numero">Años anteriores</th>
          <th scope="col"><span class="solo-lectores">Ver en Por emitir</span></th>
        </tr>
      </thead>
      <tbody>
        ${coverage.map((curso) => {
          const conFecha = curso.ready + curso.incomplete;
          const entregadas = conFecha - curso.pending;
          const rotulo =
            `${etiquetaCortaDeCurso(curso.courseName)}: ${String(entregadas)} de ` +
            `${String(conFecha)} con el curso tienen su constancia.`;
          return html`<tr>
            <td title="${curso.courseName}">${fichaDeCurso(curso.courseName)}</td>
            <td>
              <div class="celda-cobertura">
                ${medidorDeEntrega(entregadas, conFecha, rotulo)}
                <span class="cobertura-cifra">${porcentaje(entregadas, conFecha)}</span>
              </div>
            </td>
            <td class="celda-numero">${conFecha}</td>
            <td class="celda-numero">${curso.emitted}</td>
            <td class="celda-numero celda-destacada">${curso.pending}</td>
            <td class="celda-numero">${curso.withoutDate}</td>
            <td class="celda-numero">
              ${
                curso.beforeCutoff > 0
                  ? html`<a
                      href="${enlaceDeEmision({ courseKey: curso.courseKey, period: "anteriores" })}"
                      >${curso.beforeCutoff}</a
                    >`
                  : "0"
              }
            </td>
            <td>
              <a
                class="boton-pequeno boton-secundario"
                href="${enlaceDeEmision({ courseKey: curso.courseKey })}"
                title="Lo que falta emitir de este curso"
                >Ver</a
              >
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

/**
 * La cobertura por área: una fila por área, una columna por curso.
 *
 * Cada celda dice cuántas le faltan por emitir y mide el avance de entrega de
 * quienes ya tienen el curso. Van primero las áreas con más pendientes, que es
 * donde está el trabajo, y cada celda con pendientes lleva a la bandeja
 * filtrada por esa área y ese curso.
 */
function renderPorArea(
  porArea: readonly Dc3AreaCoverage[],
  coverage: readonly Dc3CourseCoverage[],
): Html {
  if (porArea.length === 0) {
    return html`<p class="texto-vacio">Sin áreas en el padrón activo.</p>`;
  }

  const cursos = coverage.map((curso) => ({
    courseKey: curso.courseKey,
    courseName: curso.courseName,
  }));
  const areas = new Map<string, Map<string, Dc3AreaCoverage>>();
  for (const fila of porArea) {
    const deArea = areas.get(fila.area) ?? new Map<string, Dc3AreaCoverage>();
    deArea.set(fila.courseKey, fila);
    areas.set(fila.area, deArea);
  }
  const pendientesDe = (deArea: Map<string, Dc3AreaCoverage>): number =>
    [...deArea.values()].reduce((suma, fila) => suma + fila.pending, 0);
  const ordenadas = [...areas].sort(
    ([nombreA, a], [nombreB, b]) =>
      pendientesDe(b) - pendientesDe(a) || nombreA.localeCompare(nombreB),
  );

  return html`<div class="tabla-contenedor">
    <table class="tabla-kcm tabla-areas">
      <thead>
        <tr>
          <th scope="col">Área</th>
          ${cursos.map(
            (curso) =>
              html`<th scope="col" title="${curso.courseName}">
                ${etiquetaCortaDeCurso(curso.courseName)}
              </th>`,
          )}
          <th scope="col" class="celda-numero">Por emitir</th>
        </tr>
      </thead>
      <tbody>
        ${ordenadas.map(([area, deArea]) => {
          const pendientes = pendientesDe(deArea);
          return html`<tr>
            <th scope="row" class="celda-area">${area || "Sin área"}</th>
            ${cursos.map((curso) => {
              const celda = deArea.get(curso.courseKey);
              if (!celda) return html`<td class="texto-atenuado">—</td>`;
              const conFecha = celda.ready + celda.incomplete;
              const emitidas = conFecha - celda.pending;
              const rotulo =
                `${area || "Sin área"} · ${etiquetaCortaDeCurso(curso.courseName)}: ` +
                `${String(emitidas)} de ${String(conFecha)} con el curso tienen constancia; ` +
                `${String(celda.pending)} por emitir.`;
              return html`<td class="celda-area-curso">
                ${
                  conFecha === 0
                    ? html`<span class="texto-atenuado" title="${rotulo}">Sin cursos</span>`
                    : html`${medidorDeEntrega(emitidas, conFecha, rotulo)}
                      ${
                        celda.pending > 0
                          ? html`<a
                              class="area-pendientes"
                              href="${enlaceDeEmision({ area: area || undefined, courseKey: curso.courseKey })}"
                              title="${rotulo}"
                              >${celda.pending} por emitir</a
                            >`
                          : html`<span class="area-al-dia" title="${rotulo}">Al día</span>`
                      }`
                }
              </td>`;
            })}
            <td class="celda-numero celda-destacada">
              ${
                pendientes > 0
                  ? html`<a href="${enlaceDeEmision({ area: area || undefined })}"
                      >${pendientes}</a
                    >`
                  : "0"
              }
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function renderUltimas(emisiones: readonly Dc3EmissionRecord[]): Html {
  if (emisiones.length === 0) {
    return html`<p class="texto-vacio">Sin constancias emitidas todavía.</p>`;
  }

  return html`<ul class="lista-tablero">
    ${emisiones.map((emision) => {
      const momento = enPlanta(emision.at);
      return html`<li class="lista-fila">
        <span class="lista-cuerpo">
          <span class="lista-titulo">
            <a href="/dc3/trabajador/${emision.workerNumber}"
              >${emision.workerName ?? emision.workerNumber}</a
            >
            ${
              emision.partial
                ? html`<span class="insignia insignia-aviso">Con recuadros en blanco</span>`
                : ""
            }
          </span>
          <span class="lista-pista"
            >${emision.workerNumber} ·
            ${etiquetaCortaDeCurso(emision.courseName ?? emision.courseKey)} ·
            ${fechaCorta(momento.dia)} ${momento.hora} · ${emision.actor}</span
          >
        </span>
      </li>`;
    })}
  </ul>`;
}

export function renderDc3PanelPage(input: Dc3PanelInput): string {
  const conFecha = total(input.coverage, "ready") + total(input.coverage, "incomplete");
  const sinCurso = total(input.coverage, "withoutDate");
  const emitidas = total(input.coverage, "emitted");
  const porEmitir = total(input.coverage, "pending");
  const anteriores = total(input.coverage, "beforeCutoff");

  const contenido: Html = html`
    ${
      input.sinBase
        ? html`<section class="tarjeta">
            <p class="texto-vacio">Sin conexión con la base de datos: no hay padrón que medir.</p>
          </section>`
        : html`
            <dl class="kpi-tira">
              ${renderKpi(
                "Por emitir",
                porEmitir,
                `Cursos desde ${ANIO_DEL_CORTE} sin constancia.`,
                porEmitir > 0 ? "kpi-aviso" : "kpi-ok",
                "/dc3",
              )}
              ${renderKpi(
                "Emitidas",
                emitidas,
                "Ver el historial de emisiones.",
                "kpi-ok",
                "/dc3/historial",
              )}
              ${renderKpi(
                "Avance de entrega",
                porcentaje(conFecha - porEmitir, conFecha),
                `De quienes tomaron el curso desde ${ANIO_DEL_CORTE}.`,
                "kpi-texto",
              )}
              ${renderKpi(
                "Sin registro del curso",
                sinCurso,
                "Trabajadores activos que no lo han tomado.",
                "kpi-texto",
                "/dc3?pestana=sin-curso",
              )}
              ${renderKpi(
                "Años anteriores",
                anteriores,
                `Cursos anteriores a ${ANIO_DEL_CORTE}, para consulta.`,
                "kpi-texto",
                "/dc3?periodo=anteriores",
              )}
            </dl>

            <section class="tarjeta" aria-labelledby="titulo-cobertura">
              <div class="seccion-cabecera">
                <h2 id="titulo-cobertura">Cobertura por curso</h2>
                <p>
                  Constancias emitidas sobre los trabajadores que tomaron el curso desde
                  ${ANIO_DEL_CORTE}.
                </p>
              </div>
              ${renderCobertura(input.coverage)}
            </section>

            <section class="tarjeta" aria-labelledby="titulo-areas">
              <div class="seccion-cabecera">
                <h2 id="titulo-areas">Avance por área</h2>
                <p>Primero las áreas con más constancias por emitir.</p>
              </div>
              ${renderPorArea(input.porArea, input.coverage)}
            </section>

            <section class="tarjeta" aria-labelledby="titulo-ultimas">
              <div class="seccion-cabecera cabecera-fila">
                <h2 id="titulo-ultimas">Últimas emisiones</h2>
                <a class="boton-pequeno boton-secundario" href="/dc3/historial">Ver historial</a>
              </div>
              ${renderUltimas(input.emisiones)}
            </section>
          `
    }
  `;

  return renderLayout({
    titulo: "Constancias DC-3",
    rutaActiva: "/dc3/panel",
    subtitulo: "Cobertura",
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({ activa: "cobertura", porEmitir: input.porEmitir }),
    contenido,
  });
}
