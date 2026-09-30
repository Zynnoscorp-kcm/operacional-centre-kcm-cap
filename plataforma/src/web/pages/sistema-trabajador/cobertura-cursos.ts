import type { EnvironmentName } from "../../../config/environment.ts";
import type { CourseCoverageSummaryItem } from "../../../domain/sistema-trabajador/tipos.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import {
  type PartesDeAvance,
  proporcionAcreditada,
  renderBarraDeAvance,
  renderLeyendaDeAvance,
} from "./avance.ts";

export interface DatosCoberturaCursos {
  readonly courses: readonly CourseCoverageSummaryItem[];
  readonly entorno: EnvironmentName;
}

function sumar(
  courses: readonly CourseCoverageSummaryItem[],
  campo: (curso: CourseCoverageSummaryItem) => number,
): number {
  return courses.reduce((total, curso) => total + campo(curso), 0);
}

function avance(curso: CourseCoverageSummaryItem): number {
  return proporcionAcreditada(partesDelCurso(curso));
}

export function renderCourseCoveragePage(datos: DatosCoberturaCursos): string {
  const { courses, entorno } = datos;
  const exigibles = courses
    .filter((curso) => curso.applicableWorkersCount > 0)
    .sort(
      (a, b) =>
        avance(a) - avance(b) ||
        b.pendientesCount - a.pendientesCount ||
        a.canonicalName.localeCompare(b.canonicalName, "es-MX"),
    );
  const sinPlantilla = courses.filter((curso) => curso.applicableWorkersCount === 0);

  const obligaciones = sumar(exigibles, (c) => c.applicableWorkersCount);
  const acreditados = sumar(exigibles, (c) => c.completadosCount);
  const reforzar = sumar(exigibles, (c) => c.reforzarCount);
  const pendientes = sumar(exigibles, (c) => c.pendientesCount);

  const contenido = html`
    <dl class="kpi-tira">
      <div class="kpi">
        <dt class="kpi-etiqueta">Cursos exigibles</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${exigibles.length}</span></dd>
        <p class="kpi-pista">De ${courses.length} en el catálogo.</p>
      </div>
      <div class="kpi kpi-ok">
        <dt class="kpi-etiqueta">Acreditados vigentes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${acreditados}</span></dd>
        <p class="kpi-pista">De ${obligaciones} obligaciones de la plantilla.</p>
      </div>
      <div class="kpi kpi-aviso">
        <dt class="kpi-etiqueta">Por reforzar</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${reforzar}</span></dd>
        <p class="kpi-pista">Acreditados con la vigencia vencida.</p>
      </div>
      <div class="kpi kpi-alerta">
        <dt class="kpi-etiqueta">Pendientes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${pendientes}</span></dd>
        <p class="kpi-pista">Sin registro del curso.</p>
      </div>
    </dl>

    <section class="tarjeta" aria-labelledby="titulo-cursos">
      <div class="seccion-cabecera cabecera-fila">
        <div>
          <h3 id="titulo-cursos">Avance por curso</h3>
          <p>De menor a mayor avance: arriba, los cursos con más rezago.</p>
        </div>
        ${renderLeyendaDeAvance()}
      </div>
      ${
        exigibles.length === 0
          ? html`<p class="texto-vacio">Ningún curso tiene trabajadores a los que aplique.</p>`
          : html`<ul class="avance-cursos">
              ${exigibles.map(renderCurso)}
            </ul>`
      }
      ${
        sinPlantilla.length > 0
          ? html`<details class="avance-sin-plantilla">
              <summary>
                ${sinPlantilla.length}
                ${sinPlantilla.length === 1 ? "curso del catálogo" : "cursos del catálogo"} sin
                trabajadores a los que aplique
              </summary>
              <p class="texto-nota">
                ${sinPlantilla.map((curso) => curso.canonicalName).join(" · ")}
              </p>
            </details>`
          : ""
      }
    </section>
  `;

  return renderLayout({
    titulo: "Cobertura por curso",
    rutaActiva: "/trabajadores/cursos",
    subtitulo: "Avance de la plantilla en cada curso exigible",
    entorno,
    contenido,
  });
}

function renderCurso(curso: CourseCoverageSummaryItem): Html {
  return html`<li class="avance-curso">
    <span class="avance-nombre" title="${curso.canonicalName}">${curso.canonicalName}</span>
    ${renderBarraDeAvance(partesDelCurso(curso))}
  </li>`;
}

function partesDelCurso(curso: CourseCoverageSummaryItem): PartesDeAvance {
  return {
    acreditados: curso.completadosCount,
    reforzar: curso.reforzarCount,
    programados: curso.programadosCount,
    pendientes: Math.max(
      0,
      curso.applicableWorkersCount -
        curso.completadosCount -
        curso.reforzarCount -
        curso.programadosCount,
    ),
  };
}
