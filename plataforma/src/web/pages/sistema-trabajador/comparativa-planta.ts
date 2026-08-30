/**
 * Comparativa de planta (Función 8 - Sistema general por trabajador).
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import type {
  PlantComparisonReport,
  DepartmentSummaryItem,
} from "../../../domain/sistema-trabajador/tipos.ts";

export interface DatosComparativaPlanta {
  readonly report: PlantComparisonReport;
  readonly entorno: EnvironmentName;
}

export function renderPlantComparisonPage(datos: DatosComparativaPlanta): string {
  const { report, entorno } = datos;

  const contenido = html`
    <dl class="kpi-tira">
      <div class="kpi">
        <dt class="kpi-etiqueta">Trabajadores</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${report.totalWorkers}</span></dd>
        <p class="kpi-pista">Plantilla considerada en el corte.</p>
      </div>
      <div class="kpi">
        <dt class="kpi-etiqueta">Departamentos</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${report.totalDepartments}</span></dd>
        <p class="kpi-pista">Unidades con plantilla registrada.</p>
      </div>
      <div class="kpi kpi-texto">
        <dt class="kpi-etiqueta">Corte</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${report.generatedAt}</span></dd>
        <p class="kpi-pista">Fecha de generación del reporte.</p>
      </div>
    </dl>

    <section class="tarjeta" aria-labelledby="titulo-comparativa">
      <div class="seccion-cabecera">
        <h2 id="titulo-comparativa">Detalle por departamento</h2>
        <p class="seccion-subtitulo">
          Departamentos y gerencias al corte del ${report.generatedAt}.
        </p>
        <div class="aviso-publicacion">
          <span class="insignia insignia-aviso">Auditoría DNC</span>
          <span>Porcentajes pendientes de aprobación de poblaciones y vigencias.</span>
        </div>
      </div>

      <div class="grilla-comparativa">${report.departments.map(renderTarjetaDepartamento)}</div>
    </section>
  `;

  return renderLayout({
    titulo: "Comparativa de planta",
    rutaActiva: "/trabajadores/comparativa",
    subtitulo: `Total: ${report.totalWorkers} trabajadores en ${report.totalDepartments} departamentos`,
    entorno,
    contenido,
    estado: html`<span class="insignia insignia-planta">Corte: ${report.generatedAt}</span>`,
  });
}

function renderTarjetaDepartamento(dep: DepartmentSummaryItem): Html {
  return html`
    <article class="tarjeta-departamento-item">
      <div class="tarjeta-dep-cabecera">
        <h3 class="tarjeta-dep-nombre">${dep.department}</h3>
        <span class="insignia insignia-nomina">${dep.activeWorkersCount} activos</span>
      </div>

      <div class="tarjeta-dep-metricas">
        <div class="dep-metrica-fila celda-completado">
          <span>Completados vigentes:</span>
          <strong>${dep.completadosCount}</strong>
        </div>
        <div class="dep-metrica-fila celda-reforzar">
          <span>Por reforzar (vencidos):</span>
          <strong>${dep.reforzarCount}</strong>
        </div>
        <div class="dep-metrica-fila celda-pendiente">
          <span>Pendientes:</span>
          <strong>${dep.pendientesCount}</strong>
        </div>
        <div class="dep-metrica-fila celda-programado">
          <span>Programados:</span>
          <strong>${dep.programadosCount}</strong>
        </div>
        ${
          dep.datosInsuficientesCount > 0
            ? html`
                <div class="dep-metrica-fila celda-alerta">
                  <span>Datos insuficientes:</span>
                  <strong>${dep.datosInsuficientesCount}</strong>
                </div>
              `
            : ""
        }
      </div>

      <div class="tarjeta-dep-pie">
        <a
          href="/trabajadores?department=${encodeURIComponent(dep.department)}"
          class="enlace-detalle"
        >
          Ver plantilla
        </a>
      </div>
    </article>
  `;
}
