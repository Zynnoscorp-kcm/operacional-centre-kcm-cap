/**
 * Departamentos: la capacitación de la planta, departamento por departamento.
 *
 * Una fila por departamento con la misma barra de avance que la cobertura por
 * curso, de menor a mayor avance: arriba, donde está el rezago. El nombre lleva
 * a su plantilla en el directorio. Era dos pantallas —una tabla y una retícula
 * de tarjetas con las mismas cifras—; ahora es una.
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import type { DepartmentSummaryItem } from "../../../domain/sistema-trabajador/tipos.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import {
  type PartesDeAvance,
  proporcionAcreditada,
  renderBarraDeAvance,
  renderLeyendaDeAvance,
} from "./avance.ts";

export interface DatosResumenDepartamentos {
  readonly departments: readonly DepartmentSummaryItem[];
  readonly entorno: EnvironmentName;
}

/** Cómo guarda la base a quien no tiene departamento. En pantalla se dice en palabras. */
const SIN_DEPARTAMENTO = "SIN_DEPARTAMENTO";

function partesDe(dep: DepartmentSummaryItem): PartesDeAvance {
  return {
    acreditados: dep.completadosCount,
    reforzar: dep.reforzarCount,
    programados: dep.programadosCount,
    pendientes: dep.pendientesCount,
  };
}

export function renderDepartmentSummaryPage(datos: DatosResumenDepartamentos): string {
  const { entorno } = datos;
  const departments = [...datos.departments].sort(
    (a, b) =>
      proporcionAcreditada(partesDe(a)) - proporcionAcreditada(partesDe(b)) ||
      b.pendientesCount - a.pendientesCount ||
      a.department.localeCompare(b.department, "es-MX"),
  );

  const totalTrabajadores = departments.reduce((acc, d) => acc + d.activeWorkersCount, 0);
  const completados = departments.reduce((acc, d) => acc + d.completadosCount, 0);
  const reforzar = departments.reduce((acc, d) => acc + d.reforzarCount, 0);
  const pendientes = departments.reduce((acc, d) => acc + d.pendientesCount, 0);
  const insuficientes = departments.reduce((acc, d) => acc + d.datosInsuficientesCount, 0);

  const contenido = html`
    <dl class="kpi-tira">
      <div class="kpi">
        <dt class="kpi-etiqueta">Plantilla activa</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${totalTrabajadores}</span></dd>
        <p class="kpi-pista">
          En ${departments.length} ${departments.length === 1 ? "departamento" : "departamentos"}.
        </p>
      </div>
      <div class="kpi kpi-ok">
        <dt class="kpi-etiqueta">Acreditados vigentes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${completados}</span></dd>
        <p class="kpi-pista">Cursos exigibles al día.</p>
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
      ${
        insuficientes > 0
          ? html`<div class="kpi kpi-texto">
              <dt class="kpi-etiqueta">Sin datos para evaluar</dt>
              <dd class="kpi-dato"><span class="kpi-cifra">${insuficientes}</span></dd>
              <p class="kpi-pista">Sin departamento ni área en el padrón.</p>
            </div>`
          : ""
      }
    </dl>

    <section class="tarjeta" aria-labelledby="titulo-departamentos">
      <div class="seccion-cabecera cabecera-fila">
        <div>
          <h3 id="titulo-departamentos">Avance por departamento</h3>
          <p>De menor a mayor avance. El nombre abre su plantilla en el directorio.</p>
        </div>
        ${renderLeyendaDeAvance()}
      </div>
      ${
        departments.length === 0
          ? html`<p class="texto-vacio">Sin departamentos con plantilla activa.</p>`
          : html`<ul class="avance-cursos">
              ${departments.map(renderDepartamento)}
            </ul>`
      }
    </section>
  `;

  return renderLayout({
    titulo: "Departamentos",
    rutaActiva: "/trabajadores/departamentos",
    subtitulo: "Avance de capacitación de cada departamento",
    entorno,
    contenido,
  });
}

function renderDepartamento(dep: DepartmentSummaryItem): Html {
  const sinDepartamento = dep.department === SIN_DEPARTAMENTO;
  const nombre = sinDepartamento ? "Sin departamento" : dep.department;
  const trabajadores = `${String(dep.activeWorkersCount)} ${
    dep.activeWorkersCount === 1 ? "trabajador" : "trabajadores"
  }`;

  return html`<li class="avance-curso">
    <span class="avance-nombre" title="${nombre}">
      ${
        sinDepartamento
          ? nombre
          : html`<a href="/trabajadores?department=${encodeURIComponent(dep.department)}"
              >${nombre}</a
            >`
      }
      <span class="avance-detalle">${trabajadores}</span>
    </span>
    ${renderBarraDeAvance(partesDe(dep))}
  </li>`;
}
