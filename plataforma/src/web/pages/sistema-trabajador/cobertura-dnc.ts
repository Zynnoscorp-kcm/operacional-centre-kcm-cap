/**
 * Cobertura DNC: cuántos cursos exigibles tiene cubiertos cada trabajador.
 *
 * Arriba, el estado de los datos: se mira después de cargar una matriz o un
 * padrón nuevos, y contesta si las fuentes cuadran. Una CURP faltante o un
 * trabajador sin cursos asignados delata un archivo desalineado. Debajo, la
 * lista por trabajador con sus filtros.
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import type { DncCoverageRow, DncReconciliation } from "../../../ports/sistema-trabajador.port.ts";
import { fechaCorta } from "../../kit/fechas.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";

export interface DatosCoberturaDnc {
  readonly rows: readonly DncCoverageRow[];
  readonly reconciliation: DncReconciliation;
  readonly plants: readonly string[];
  readonly areas: readonly string[];
  readonly courses: readonly string[];
  readonly selected: {
    readonly planta?: string | undefined;
    readonly area?: string | undefined;
    readonly curso?: string | undefined;
    readonly estado?: string | undefined;
  };
  readonly entorno: EnvironmentName;
}

/** Tope de renglones que devuelve la consulta del tablero. */
const TOPE_DE_RENGLONES = 2000;

function renderOpciones(valores: readonly string[], elegido?: string): Html {
  return html`${valores.map(
    (v) => html`<option value="${v}" ${v === elegido ? "selected" : ""}>${v}</option>`,
  )}`;
}

function renderKpi(etiqueta: string, cifra: number, pista: string, tono = ""): Html {
  return html`<div class="kpi ${tono}">
    <dt class="kpi-etiqueta">${etiqueta}</dt>
    <dd class="kpi-dato"><span class="kpi-cifra">${cifra}</span></dd>
    <p class="kpi-pista">${pista}</p>
  </div>`;
}

function renderFila(r: DncCoverageRow): Html {
  return html`<tr>
    <td class="celda-mono">
      <a class="enlace-nomina" href="/trabajadores/${r.numeroTrabajador}">${r.numeroTrabajador}</a>
    </td>
    <td class="celda-persona">
      <a class="persona-nombre" href="/trabajadores/${r.numeroTrabajador}">${r.nombreCompleto}</a>
      <span class="persona-meta">${r.area || "Sin área"}</span>
    </td>
    <td>${r.planta || "—"}</td>
    <td>
      <div class="celda-cobertura">
        <progress
          class="cobertura-barra"
          value="${String(r.cursosCubiertos)}"
          max="${String(Math.max(1, r.cursosRequeridos))}"
          title="${r.cursosCubiertos} de ${r.cursosRequeridos} cursos cubiertos"
        >
          ${r.cursosCubiertos} de ${r.cursosRequeridos}
        </progress>
        <span class="cobertura-cifra">${r.cursosCubiertos}/${r.cursosRequeridos}</span>
      </div>
    </td>
    <td class="celda-numero ${r.cursosFaltantes > 0 ? "celda-alerta" : ""}">
      ${r.cursosFaltantes}
    </td>
  </tr>`;
}

export function renderDncCoveragePage(datos: DatosCoberturaDnc): string {
  const c = datos.reconciliation;
  const cuadra = c.sinCurp === 0 && c.sinReglaDnc === 0;
  const { selected } = datos;
  const hayFiltros = Boolean(selected.planta || selected.area || selected.curso || selected.estado);

  const contenido = html`
    <section class="tarjeta" aria-labelledby="titulo-datos">
      <div class="seccion-cabecera">
        <h3 id="titulo-datos">Estado de los datos</h3>
        <p>
          ${
            cuadra
              ? "Las fuentes cuadran: cada trabajador activo tiene CURP y cursos asignados."
              : "Hay trabajadores sin CURP o sin cursos asignados: la matriz o el padrón pueden estar desactualizados."
          }
        </p>
      </div>
      <dl class="kpi-tira">
        ${renderKpi("Trabajadores activos", c.trabajadoresActivos, "En el padrón vigente.")}
        ${renderKpi("Sin CURP", c.sinCurp, "Se completa en el padrón.", c.sinCurp > 0 ? "kpi-alerta" : "kpi-ok")}
        ${renderKpi(
          "Sin cursos asignados",
          c.sinReglaDnc,
          "Su departamento o área no tiene cursos exigibles.",
          c.sinReglaDnc > 0 ? "kpi-aviso" : "kpi-ok",
        )}
        ${renderKpi("Cursos cubiertos", c.paresCubiertos, "Trabajador y curso, acreditados.", "kpi-ok")}
        ${renderKpi(
          "Cursos faltantes",
          c.paresFaltantes,
          "Trabajador y curso, sin acreditar.",
          c.paresFaltantes > 0 ? "kpi-alerta" : "kpi-ok",
        )}
      </dl>
      <p class="texto-nota nota-bajo-tira">
        Último registro de la matriz: ${fechaCorta(c.ultimoRegistroHc)} · Última inducción
        registrada: ${fechaCorta(c.ultimaInduccion)}
      </p>
    </section>

    <section class="tarjeta" aria-labelledby="titulo-lista-cobertura">
      <div class="seccion-cabecera cabecera-fila">
        <h3 id="titulo-lista-cobertura">Cobertura por trabajador</h3>
        <p class="texto-nota">
          ${datos.rows.length} ${datos.rows.length === 1 ? "trabajador" : "trabajadores"}
        </p>
      </div>

      <form class="formulario-busqueda" method="get" action="/trabajadores/cobertura">
        <div class="campo-busqueda">
          <label class="etiqueta-formulario" for="cobertura-planta">Planta</label>
          <select id="cobertura-planta" name="planta" class="select-kcm">
            <option value="">Todas</option>
            ${renderOpciones(datos.plants, selected.planta)}
          </select>
        </div>
        <div class="campo-busqueda">
          <label class="etiqueta-formulario" for="cobertura-area">Área</label>
          <select id="cobertura-area" name="area" class="select-kcm">
            <option value="">Todas</option>
            ${renderOpciones(datos.areas, selected.area)}
          </select>
        </div>
        <div class="campo-busqueda">
          <label class="etiqueta-formulario" for="cobertura-curso">Curso</label>
          <select id="cobertura-curso" name="curso" class="select-kcm">
            <option value="">Todos</option>
            ${renderOpciones(datos.courses, selected.curso)}
          </select>
        </div>
        <div class="campo-busqueda">
          <label class="etiqueta-formulario" for="cobertura-estado">Situación</label>
          <select id="cobertura-estado" name="estado" class="select-kcm">
            <option value="">Todas</option>
            <option value="FALTANTE" ${selected.estado === "FALTANTE" ? "selected" : ""}>
              Con cursos faltantes
            </option>
            <option value="CUBIERTO" ${selected.estado === "CUBIERTO" ? "selected" : ""}>
              Con todo cubierto
            </option>
          </select>
        </div>
        <div class="acciones-busqueda">
          <button type="submit" class="boton-kcm">Filtrar</button>
          ${
            hayFiltros
              ? html`<a href="/trabajadores/cobertura" class="boton-secundario">Limpiar</a>`
              : ""
          }
        </div>
      </form>

      ${
        datos.rows.length === 0
          ? html`<p class="texto-vacio">Ningún trabajador coincide con los filtros.</p>`
          : html`<div class="tabla-contenedor">
                <table class="tabla-kcm">
                  <thead>
                    <tr>
                      <th scope="col">Nómina</th>
                      <th scope="col">Trabajador</th>
                      <th scope="col">Planta</th>
                      <th scope="col" class="columna-ancha">Cursos cubiertos</th>
                      <th scope="col" class="celda-numero">Faltantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${datos.rows.map(renderFila)}
                  </tbody>
                </table>
              </div>
              ${
                datos.rows.length >= TOPE_DE_RENGLONES
                  ? html`<p class="texto-nota">
                      Se muestran los primeros ${TOPE_DE_RENGLONES}; los filtros acotan la lista.
                    </p>`
                  : ""
              }`
      }
    </section>
  `;

  return renderLayout({
    titulo: "Cobertura DNC",
    rutaActiva: "/trabajadores/cobertura",
    subtitulo: "Cursos exigibles cubiertos y faltantes por trabajador",
    entorno: datos.entorno,
    contenido,
  });
}
