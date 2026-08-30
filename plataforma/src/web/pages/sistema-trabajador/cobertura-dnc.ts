/**
 * Tablero DNC: cobertura por trabajador con filtros y panel de concordancia.
 *
 * El panel de arriba es lo que se mira después de cargar una matriz o un padrón
 * nuevos. No reingiere nada —eso lo hacen el puente VBA y el ingestor del
 * padrón—, sólo contesta si las fuentes cuadran, que es la pregunta real: un
 * número de CURP faltantes o de trabajadores sin regla delata al instante un
 * archivo desalineado.
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import type { DncCoverageRow, DncReconciliation } from "../../../ports/sistema-trabajador.port.ts";

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

function renderOpciones(valores: readonly string[], elegido?: string): Html {
  return html`${valores.map(
    (v) => html`<option value="${v}" ${v === elegido ? "selected" : ""}>${v}</option>`,
  )}`;
}

function renderFicha(etiqueta: string, valor: number, alerta = false): Html {
  return html`
    <div class="ficha ${alerta && valor > 0 ? "ficha-alerta" : ""}">
      <span class="ficha-valor">${valor}</span>
      <span class="ficha-etiqueta">${etiqueta}</span>
    </div>
  `;
}

function renderFila(r: DncCoverageRow): Html {
  return html`
    <tr>
      <td class="celda-codigo">
        <a href="/trabajadores/${r.numeroTrabajador}">${r.numeroTrabajador}</a>
      </td>
      <td class="celda-destacada">${r.nombreCompleto}</td>
      <td>${r.planta}</td>
      <td>${r.area}</td>
      <td class="celda-numero">${r.cursosRequeridos}</td>
      <td class="celda-numero celda-completado">${r.cursosCubiertos}</td>
      <td class="celda-numero celda-pendiente">${r.cursosFaltantes}</td>
      <td class="celda-numero">${r.porcentaje}%</td>
    </tr>
  `;
}

export function renderDncCoveragePage(datos: DatosCoberturaDnc): string {
  const c = datos.reconciliation;
  const cuadra = c.sinCurp === 0 && c.sinReglaDnc === 0;

  const contenido = html`
    <section class="tarjeta">
      <h2>Concordancia de fuentes</h2>
      <p class="texto-nota">
        ${
          cuadra
            ? "Las fuentes cuadran: todo trabajador activo tiene CURP y regla aplicable."
            : "Hay trabajadores sin CURP o sin regla DNC. Suele indicar matriz o padrón desactualizados."
        }
      </p>
      <div class="rejilla-fichas">
        ${renderFicha("Trabajadores activos", c.trabajadoresActivos)}
        ${renderFicha("Con CURP", c.conCurp)} ${renderFicha("Sin CURP", c.sinCurp, true)}
        ${renderFicha("Sin regla DNC", c.sinReglaDnc, true)}
        ${renderFicha("Cursos cubiertos", c.paresCubiertos)}
        ${renderFicha("Cursos faltantes", c.paresFaltantes)}
        ${renderFicha("Candidatos DC-3", c.candidatosDc3)}
      </div>
      <p class="texto-nota">
        Última fecha en HC: ${c.ultimoRegistroHc ?? "—"}. Última carga de inducciones:
        ${c.ultimaInduccion ?? "—"}.
      </p>
      <p class="texto-nota">
        El padrón semanal se recarga con
        <code>node scripts/ingest-roster.js &lt;ruta&gt; --aplicar</code>.
      </p>
    </section>

    <form class="formulario-filtros" method="get" action="/trabajadores/cobertura">
      <label
        >Planta
        <select name="planta">
          <option value="">Todas</option>
          ${renderOpciones(datos.plants, datos.selected.planta)}
        </select>
      </label>
      <label
        >Área
        <select name="area">
          <option value="">Todas</option>
          ${renderOpciones(datos.areas, datos.selected.area)}
        </select>
      </label>
      <label
        >Curso
        <select name="curso">
          <option value="">Todos</option>
          ${renderOpciones(datos.courses, datos.selected.curso)}
        </select>
      </label>
      <label
        >Estado
        <select name="estado">
          <option value="">Todos</option>
          <option value="FALTANTE" ${datos.selected.estado === "FALTANTE" ? "selected" : ""}>
            Faltante
          </option>
          <option value="CUBIERTO" ${datos.selected.estado === "CUBIERTO" ? "selected" : ""}>
            Cubierto
          </option>
        </select>
      </label>
      <button type="submit">Filtrar</button>
      <a href="/trabajadores/cobertura" class="boton-enlace">Limpiar filtros</a>
    </form>

    ${
      datos.rows.length === 0
        ? html`<p class="texto-nota">Sin trabajadores que coincidan con los filtros.</p>`
        : html`
            <table class="tabla-datos">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Nombre</th>
                  <th>Planta</th>
                  <th>Área</th>
                  <th class="celda-numero">Requeridos</th>
                  <th class="celda-numero">Cubiertos</th>
                  <th class="celda-numero">Faltantes</th>
                  <th class="celda-numero">Avance</th>
                </tr>
              </thead>
              <tbody>
                ${datos.rows.map(renderFila)}
              </tbody>
            </table>
            <p class="texto-nota">
              ${datos.rows.length} trabajadores. Listado limitado a 2 000 filas.
            </p>
          `
    }
  `;

  return renderLayout({
    titulo: "Cobertura DNC",
    rutaActiva: "/trabajadores/cobertura",
    subtitulo: "Cursos requeridos, cubiertos y faltantes",
    entorno: datos.entorno,
    contenido,
    estado: html`<span class="insignia insignia-curso">${c.paresFaltantes} pendientes</span>`,
  });
}
