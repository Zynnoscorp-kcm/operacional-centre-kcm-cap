/**
 * Directorio de trabajadores: la plantilla activa, con búsqueda y filtros.
 *
 * Seis columnas, las que sirven para encontrar a alguien: nómina, nombre con
 * su puesto, área con su departamento, tipo de personal, ingreso y planta. El
 * nombre lleva a la ficha; no hace falta un botón aparte en cada renglón.
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { plantLabel } from "../../../domain/sistema-trabajador/planta.ts";
import type { WorkerRecord } from "../../../domain/sistema-trabajador/tipos.ts";
import { fechaCorta } from "../../kit/fechas.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";

export interface DatosListaTrabajadores {
  readonly workers: readonly WorkerRecord[];
  readonly departments: readonly string[];
  readonly areas: readonly string[];
  readonly selectedDepartment?: string | undefined;
  readonly selectedArea?: string | undefined;
  readonly selectedPayrollType?: string | undefined;
  readonly hireDateFrom?: string | undefined;
  readonly hireDateTo?: string | undefined;
  readonly query?: string | undefined;
  readonly entorno: EnvironmentName;
}

export function renderWorkerListPage(datos: DatosListaTrabajadores): string {
  const {
    workers,
    departments,
    areas,
    selectedDepartment,
    selectedArea,
    selectedPayrollType,
    hireDateFrom,
    hireDateTo,
    query,
    entorno,
  } = datos;
  const hayFiltros = Boolean(
    query ||
    selectedDepartment ||
    selectedArea ||
    selectedPayrollType ||
    hireDateFrom ||
    hireDateTo,
  );

  const contenido = html`
    <section class="tarjeta tarjeta-busqueda" aria-label="Buscar en la plantilla">
      <form method="GET" action="/trabajadores" class="formulario-busqueda" role="search">
        <div class="campo-busqueda campo-busqueda-ancho">
          <label for="campo-query" class="etiqueta-formulario">Nómina o nombre</label>
          <input
            type="search"
            id="campo-query"
            name="q"
            value="${query ?? ""}"
            placeholder="Ej. 01234 o JUAN PEREZ"
            class="input-kcm"
          />
        </div>

        <div class="campo-busqueda">
          <label for="campo-departamento" class="etiqueta-formulario">Departamento</label>
          <select id="campo-departamento" name="department" class="select-kcm">
            <option value="">Todos</option>
            ${departments.map((d) => renderOpcion(d, selectedDepartment))}
          </select>
        </div>

        <div class="campo-busqueda">
          <label for="campo-area" class="etiqueta-formulario">Área</label>
          <select id="campo-area" name="area" class="select-kcm">
            <option value="">Todas</option>
            ${areas.map((area) => renderOpcion(area, selectedArea))}
          </select>
        </div>

        <div class="campo-busqueda">
          <label for="campo-nomina" class="etiqueta-formulario">Tipo de personal</label>
          <select id="campo-nomina" name="payrollType" class="select-kcm">
            <option value="">Sindicalizados y confianza</option>
            <option value="NS" ${selectedPayrollType === "NS" ? "selected" : ""}>
              Sindicalizados (NS)
            </option>
            <option value="NQ" ${selectedPayrollType === "NQ" ? "selected" : ""}>
              Empleados de confianza (NQ)
            </option>
          </select>
        </div>

        <div class="campo-busqueda campo-busqueda-fecha">
          <label for="campo-ingreso-desde" class="etiqueta-formulario">Ingreso desde</label>
          <input
            id="campo-ingreso-desde"
            type="date"
            name="hireDateFrom"
            value="${hireDateFrom ?? ""}"
            class="input-kcm"
          />
        </div>

        <div class="campo-busqueda campo-busqueda-fecha">
          <label for="campo-ingreso-hasta" class="etiqueta-formulario">Ingreso hasta</label>
          <input
            id="campo-ingreso-hasta"
            type="date"
            name="hireDateTo"
            value="${hireDateTo ?? ""}"
            class="input-kcm"
          />
        </div>

        <div class="acciones-busqueda">
          <button type="submit" class="boton-kcm">Buscar</button>
          ${hayFiltros ? html`<a href="/trabajadores" class="boton-secundario">Limpiar</a>` : ""}
        </div>
      </form>
    </section>

    <section class="tarjeta" aria-labelledby="titulo-tabla-trabajadores">
      <div class="seccion-cabecera cabecera-fila">
        <h3 id="titulo-tabla-trabajadores">Plantilla activa</h3>
        <p class="texto-nota">
          ${workers.length}
          ${workers.length === 1 ? "trabajador" : "trabajadores"}${
            hayFiltros ? " con estos filtros" : ""
          }
        </p>
      </div>

      ${
        workers.length === 0
          ? html`<p class="texto-vacio">Ningún trabajador coincide con los filtros.</p>`
          : html`
              <div class="tabla-contenedor">
                <table class="tabla-kcm">
                  <thead>
                    <tr>
                      <th scope="col">Nómina</th>
                      <th scope="col">Trabajador</th>
                      <th scope="col">Área</th>
                      <th scope="col">Personal</th>
                      <th scope="col">Ingreso</th>
                      <th scope="col">Planta</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${workers.map(renderFilaTrabajador)}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;

  return renderLayout({
    titulo: "Directorio de trabajadores",
    rutaActiva: "/trabajadores",
    subtitulo: "Plantilla activa y su situación de capacitación",
    entorno,
    contenido,
  });
}

function renderOpcion(valor: string, seleccionado?: string): Html {
  return html`<option value="${valor}" ${valor === seleccionado ? "selected" : ""}>
    ${valor}
  </option>`;
}

function renderFilaTrabajador(w: WorkerRecord): Html {
  const planta = plantLabel(w.plant);
  return html`<tr>
    <td class="celda-mono">
      <a href="/trabajadores/${w.employeeId}" class="enlace-nomina">${w.employeeId}</a>
    </td>
    <td class="celda-persona">
      <a class="persona-nombre" href="/trabajadores/${w.employeeId}">${w.name}</a>
      <span class="persona-meta">${w.position || "Sin puesto"}</span>
    </td>
    <td>
      ${w.area || html`<span class="texto-atenuado">Sin área</span>`}
      <span class="persona-meta">${w.department || "Sin departamento"}</span>
    </td>
    <td>${etiquetaNomina(w.payrollType)}</td>
    <td class="celda-fecha">${w.hireDate ? fechaCorta(w.hireDate) : "—"}</td>
    <td title="${w.plant ?? ""}">${planta || "—"}</td>
  </tr>`;
}

function etiquetaNomina(value: string | null | undefined): string {
  if (value === "NS") return "Sindicalizado";
  if (value === "NQ") return "Confianza";
  return value || "—";
}
