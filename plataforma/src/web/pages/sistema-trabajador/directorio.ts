/**
 * Directorio de trabajadores (Función 8 - Sistema general por trabajador).
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import { shortPlantName } from "../../../domain/sistema-trabajador/planta.ts";
import type { WorkerRecord } from "../../../domain/sistema-trabajador/tipos.ts";

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

  const contenido = html`
    <section class="tarjeta tarjeta-busqueda" aria-labelledby="titulo-busqueda">
      <div class="seccion-cabecera">
        <h2 id="titulo-busqueda">Buscar en la plantilla</h2>
      </div>

      <form method="GET" action="/trabajadores" class="formulario-busqueda" role="search">
        <div class="campo-busqueda">
          <label for="campo-query" class="etiqueta-formulario">Buscar por nómina o nombre</label>
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
          <label for="campo-area" class="etiqueta-formulario">Filtrar por área</label>
          <select id="campo-area" name="area" class="select-kcm">
            <option value="">Todas las áreas</option>
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

        <div class="campo-busqueda">
          <label for="campo-ingreso-desde" class="etiqueta-formulario">Ingreso desde</label>
          <input
            id="campo-ingreso-desde"
            type="date"
            name="hireDateFrom"
            value="${hireDateFrom ?? ""}"
            class="input-kcm"
          />
        </div>

        <div class="campo-busqueda">
          <label for="campo-ingreso-hasta" class="etiqueta-formulario">Ingreso hasta</label>
          <input
            id="campo-ingreso-hasta"
            type="date"
            name="hireDateTo"
            value="${hireDateTo ?? ""}"
            class="input-kcm"
          />
        </div>

        <div class="campo-busqueda">
          <label for="campo-departamento" class="etiqueta-formulario"
            >Filtrar por departamento</label
          >
          <select id="campo-departamento" name="department" class="select-kcm">
            <option value="">Todos los departamentos</option>
            ${departments.map((d) => renderOpcionDepartamento(d, selectedDepartment))}
          </select>
        </div>

        <div class="acciones-busqueda">
          <button type="submit" class="boton-kcm">Filtrar</button>
          ${
            query ||
            selectedDepartment ||
            selectedArea ||
            selectedPayrollType ||
            hireDateFrom ||
            hireDateTo
              ? html`<a href="/trabajadores" class="boton-secundario">Limpiar filtros</a>`
              : ""
          }
        </div>
      </form>
    </section>

    <!-- Tabla de Trabajadores -->
    <section class="tarjeta" aria-labelledby="titulo-tabla-trabajadores">
      <div class="seccion-cabecera">
        <h3 id="titulo-tabla-trabajadores">Plantilla registrada</h3>
      </div>

      ${
        workers.length === 0
          ? html`<p class="texto-vacio">Sin trabajadores que coincidan con los filtros.</p>`
          : html`
              <div class="tabla-contenedor">
                <table class="tabla-kcm">
                  <thead>
                    <tr>
                      <th scope="col">Tipo de personal</th>
                      <th scope="col">Nombre</th>
                      <th scope="col">Departamento</th>
                      <th scope="col">Área</th>
                      <th scope="col">Puesto</th>
                      <th scope="col">Nómina</th>
                      <th scope="col">Ingreso</th>
                      <th scope="col">Planta</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Acción</th>
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
    subtitulo: "Plantilla, puestos y situación de capacitación",
    entorno,
    contenido,
    estado: html`<span class="insignia insignia-nomina">${workers.length} trabajadores</span>`,
  });
}

function renderOpcionDepartamento(dep: string, seleccionado?: string): Html {
  return renderOpcion(dep, seleccionado);
}

function renderOpcion(valor: string, seleccionado?: string): Html {
  return html`
    <option value="${valor}" ${valor === seleccionado ? "selected" : ""}>${valor}</option>
  `;
}

function renderFilaTrabajador(w: WorkerRecord): Html {
  return html`
    <tr>
      <td class="celda-codigo">
        <a href="/trabajadores/${w.employeeId}" class="enlace-nomina"> ${w.employeeId} </a>
      </td>
      <td class="celda-destacada">
        <a href="/trabajadores/${w.employeeId}" class="enlace-trabajador"> ${w.name} </a>
      </td>
      <td>${w.department || html`<span class="texto-atenuado">Sin departamento</span>`}</td>
      <td>${w.area || html`<span class="texto-atenuado">Sin área</span>`}</td>
      <td>${w.position || html`<span class="texto-atenuado">—</span>`}</td>
      <td>${etiquetaNomina(w.payrollType)}</td>
      <td class="celda-mono">${w.hireDate ?? html`<span class="texto-atenuado">—</span>`}</td>
      <td title="${w.plant ?? ""}">
        ${shortPlantName(w.plant) || html`<span class="texto-atenuado">—</span>`}
      </td>
      <td>
        ${
          w.active
            ? html`<span class="insignia insignia-activo">Activo</span>`
            : html`<span class="insignia insignia-inactivo">Inactivo</span>`
        }
      </td>
      <td>
        <a href="/trabajadores/${w.employeeId}" class="boton-ver-ficha">Ver ficha</a>
      </td>
    </tr>
  `;
}

function etiquetaNomina(value: string | null | undefined): string {
  if (value === "NS") return "Sindicalizado";
  if (value === "NQ") return "Confianza";
  return value || "—";
}
