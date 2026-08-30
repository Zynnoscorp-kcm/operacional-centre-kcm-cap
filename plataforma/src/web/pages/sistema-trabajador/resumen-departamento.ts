/**
 * Resumen por departamento (Función 8 - Sistema general por trabajador).
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import type { DepartmentSummaryItem } from "../../../domain/sistema-trabajador/tipos.ts";

export interface DatosResumenDepartamentos {
  readonly departments: readonly DepartmentSummaryItem[];
  readonly entorno: EnvironmentName;
}

export function renderDepartmentSummaryPage(datos: DatosResumenDepartamentos): string {
  const { departments, entorno } = datos;

  const totalTrabajadores = departments.reduce((acc, d) => acc + d.activeWorkersCount, 0);
  const completados = departments.reduce((acc, d) => acc + d.completadosCount, 0);
  const reforzar = departments.reduce((acc, d) => acc + d.reforzarCount, 0);
  const pendientes = departments.reduce((acc, d) => acc + d.pendientesCount, 0);
  const insuficientes = departments.reduce((acc, d) => acc + d.datosInsuficientesCount, 0);

  const contenido = html`
    <nav class="miga-de-pan" aria-label="Navegación secundaria">
      <a href="/">Inicio</a> &rsaquo;
      <a href="/trabajadores">Directorio de trabajadores</a> &rsaquo;
      <span>Resumen por departamento</span>
    </nav>

    <span class="capta-rotulo">Cobertura DNC</span>
    <h2 class="capta-titulo">Capacitación por departamento</h2>

    <dl class="kpi-tira">
      <div class="kpi">
        <dt class="kpi-etiqueta">Plantilla activa</dt>
        <dd class="kpi-dato">
          <span class="kpi-cifra">${totalTrabajadores}</span>
          <span class="kpi-unidad">en ${departments.length} deptos.</span>
        </dd>
        <p class="kpi-pista">Trabajadores activos al corte.</p>
      </div>
      <div class="kpi kpi-ok">
        <dt class="kpi-etiqueta">Completados vigentes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${completados}</span></dd>
        <p class="kpi-pista">Acreditados y dentro de vigencia.</p>
      </div>
      <div class="kpi kpi-aviso">
        <dt class="kpi-etiqueta">Por reforzar</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${reforzar}</span></dd>
        <p class="kpi-pista">Vencidos; requieren reprogramación.</p>
      </div>
      <div class="kpi kpi-alerta">
        <dt class="kpi-etiqueta">Pendientes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${pendientes}</span></dd>
        <p class="kpi-pista">Sin registro del curso exigible.</p>
      </div>
      <div class="kpi">
        <dt class="kpi-etiqueta">Datos insuficientes</dt>
        <dd class="kpi-dato"><span class="kpi-cifra">${insuficientes}</span></dd>
        <p class="kpi-pista">No se concluye sin puesto ni área.</p>
      </div>
    </dl>

    <section class="tarjeta" aria-labelledby="titulo-departamentos">
      <div class="seccion-cabecera">
        <h2 id="titulo-departamentos">Detalle por departamento</h2>
        <p class="seccion-subtitulo">Total activo: ${totalTrabajadores} trabajadores.</p>
        <div class="aviso-publicacion">
          <span class="insignia insignia-aviso">Auditoría DNC</span>
          <span>Porcentajes pendientes de autorización de poblaciones definitivas.</span>
        </div>
      </div>

      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Departamento</th>
              <th scope="col" class="celda-numero">Plantilla activa</th>
              <th scope="col" class="celda-numero">Completados vigentes</th>
              <th scope="col" class="celda-numero">Por reforzar</th>
              <th scope="col" class="celda-numero">Pendientes</th>
              <th scope="col" class="celda-numero">Programados</th>
              <th scope="col" class="celda-numero">Datos insuficientes</th>
            </tr>
          </thead>
          <tbody>
            ${departments.map(renderFilaDepartamento)}
          </tbody>
        </table>
      </div>
    </section>
  `;

  return renderLayout({
    titulo: "Resumen por departamento",
    rutaActiva: "/trabajadores/departamentos",
    subtitulo: "Cobertura y situación de capacitación por departamento",
    entorno,
    contenido,
    estado: html`<span class="insignia insignia-departamento"
      >${departments.length} departamentos</span
    >`,
  });
}

function renderFilaDepartamento(dep: DepartmentSummaryItem): Html {
  return html`
    <tr>
      <td class="celda-destacada">
        <a href="/trabajadores?department=${encodeURIComponent(dep.department)}">
          ${dep.department}
        </a>
      </td>
      <td class="celda-numero"><strong>${dep.activeWorkersCount}</strong></td>
      <td class="celda-numero celda-completado">${dep.completadosCount}</td>
      <td class="celda-numero celda-reforzar">${dep.reforzarCount}</td>
      <td class="celda-numero celda-pendiente">${dep.pendientesCount}</td>
      <td class="celda-numero celda-programado">${dep.programadosCount}</td>
      <td class="celda-numero ${dep.datosInsuficientesCount > 0 ? "celda-alerta" : ""}">
        ${dep.datosInsuficientesCount}
      </td>
    </tr>
  `;
}
