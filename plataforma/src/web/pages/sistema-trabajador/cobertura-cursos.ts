/**
 * Perfil de cobertura por curso (Función 8 - Sistema general por trabajador).
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import type { CourseCoverageSummaryItem } from "../../../domain/sistema-trabajador/tipos.ts";

export interface DatosCoberturaCursos {
  readonly courses: readonly CourseCoverageSummaryItem[];
  readonly entorno: EnvironmentName;
}

/** Suma una columna del catálogo. Los conteos ya vienen resueltos del dominio. */
function sumar(
  courses: readonly CourseCoverageSummaryItem[],
  campo: (curso: CourseCoverageSummaryItem) => number,
): number {
  return courses.reduce((total, curso) => total + campo(curso), 0);
}

export function renderCourseCoveragePage(datos: DatosCoberturaCursos): string {
  const { courses, entorno } = datos;

  const exigible = sumar(courses, (c) => c.applicableWorkersCount);
  const completados = sumar(courses, (c) => c.completadosCount);
  const reforzar = sumar(courses, (c) => c.reforzarCount);
  const pendientes = sumar(courses, (c) => c.pendientesCount);

  const contenido = html`
    <nav class="miga-de-pan" aria-label="Navegación secundaria">
      <a href="/">Inicio</a> &rsaquo;
      <a href="/trabajadores">Directorio de trabajadores</a> &rsaquo;
      <span>Perfil de cobertura por curso</span>
    </nav>

    <span class="capta-rotulo">Catálogo unificado · Reglas DNC</span>
    <h2 class="capta-titulo">Cobertura por curso</h2>

    <dl class="kpi-tira">
      <div class="kpi">
        <dt class="kpi-etiqueta">Cursos unificados</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${courses.length}</span></dd>
        <p class="kpi-pista">Evaluados en dos niveles de regla.</p>
      </div>
      <div class="kpi">
        <dt class="kpi-etiqueta">Plantilla exigible</dt>
        <dd class="kpi-dato">
          <span class="kpi-cifra">${exigible}</span>
          <span class="kpi-unidad">obligaciones</span>
        </dd>
        <p class="kpi-pista">Suma de trabajadores por curso aplicable.</p>
      </div>
      <div class="kpi kpi-ok">
        <dt class="kpi-etiqueta">Completados vigentes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${completados}</span></dd>
        <p class="kpi-pista">Con vigencia comprobada al corte.</p>
      </div>
      <div class="kpi kpi-aviso">
        <dt class="kpi-etiqueta">Por reforzar</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${reforzar}</span></dd>
        <p class="kpi-pista">Vencidos; requieren reprogramación.</p>
      </div>
      <div class="kpi kpi-alerta">
        <dt class="kpi-etiqueta">Pendientes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${pendientes}</span></dd>
        <p class="kpi-pista">Sin registro alguno del curso.</p>
      </div>
    </dl>

    <section class="tarjeta" aria-labelledby="titulo-cursos">
      <div class="seccion-cabecera">
        <h2 id="titulo-cursos">Detalle por curso</h2>
        <p class="seccion-subtitulo">
          Evaluación contra reglas DNC por departamento y área técnica.
        </p>
        <div class="aviso-publicacion">
          <span class="insignia insignia-aviso">Auditoría DNC</span>
          <span>Porcentajes en validación. Se reportan conteos de cumplimiento.</span>
        </div>
      </div>

      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Curso</th>
              <th scope="col">Nivel / regla</th>
              <th scope="col" class="celda-numero">Plantilla exigible</th>
              <th scope="col" class="celda-numero">Completados</th>
              <th scope="col" class="celda-numero">Por reforzar</th>
              <th scope="col" class="celda-numero">Pendientes</th>
              <th scope="col" class="celda-numero">Programados</th>
            </tr>
          </thead>
          <tbody>
            ${courses.map(renderFilaCurso)}
          </tbody>
        </table>
      </div>
    </section>
  `;

  return renderLayout({
    titulo: "Cobertura por curso",
    rutaActiva: "/trabajadores/cursos",
    subtitulo: "Catálogo de cursos unificados y reglas DNC",
    entorno,
    contenido,
    estado: html`<span class="insignia insignia-curso">${courses.length} cursos</span>`,
  });
}

function renderFilaCurso(c: CourseCoverageSummaryItem): Html {
  return html`
    <tr>
      <td class="celda-codigo">${c.trainingId}</td>
      <td class="celda-destacada">${c.canonicalName}</td>
      <td>
        <span class="insignia insignia-regla" title="Regla ${c.ruleId} v${c.ruleVersion}">
          ${c.ruleLevel}
        </span>
      </td>
      <td class="celda-numero"><strong>${c.applicableWorkersCount}</strong></td>
      <td class="celda-numero celda-completado">${c.completadosCount}</td>
      <td class="celda-numero celda-reforzar">${c.reforzarCount}</td>
      <td class="celda-numero celda-pendiente">${c.pendientesCount}</td>
      <td class="celda-numero celda-programado">${c.programadosCount}</td>
    </tr>
  `;
}
