/**
 * Ficha individual del trabajador (Función 8 - Sistema general por trabajador).
 *
 * Entre la trayectoria y la bitácora DC-3 había un «Plan de Capacitación del
 * Trimestre». Se retiró junto con su derivación en el dominio: no era un plan,
 * era la tabla de «Cursos por realizar o actualizar» reordenada por una
 * prioridad que la plataforma inventaba en el momento, con un trimestre
 * sugerido que era siempre el trimestre en curso y sin nada detrás en la base.
 * La misma información, sin la promesa de un calendario que nadie firmó, sigue
 * en la sección de cursos exigibles.
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import { shortPlantName } from "../../../domain/sistema-trabajador/planta.ts";
import { renderRadarDnc } from "./telarana-dnc.ts";
import type {
  DerivedWorkerProfile,
  WorkerCourseEvaluation,
  CourseTrajectoryEntry,
  Dc3WorkerLogEntry,
  DncStatus,
} from "../../../domain/sistema-trabajador/tipos.ts";

export interface DatosPerfilTrabajador {
  readonly profile: DerivedWorkerProfile;
  readonly entorno: EnvironmentName;
}

export function renderWorkerProfilePage(datos: DatosPerfilTrabajador): string {
  const { profile, entorno } = datos;
  const { worker, seniority, category, photo, metrics } = profile;
  const planta = shortPlantName(worker.plant);
  const cursosAcreditados = profile.courseEvaluations.filter(
    (curso) => curso.status === "COMPLETADO",
  );
  const cursosPorAtender = profile.courseEvaluations.filter(
    (curso) =>
      curso.status === "PENDIENTE" || curso.status === "REFORZAR" || curso.status === "PROGRAMADO",
  );

  const contenido = html`
    <nav class="miga-de-pan" aria-label="Navegación secundaria">
      <a href="/">Inicio</a> &rsaquo;
      <a href="/trabajadores">Directorio de trabajadores</a> &rsaquo;
      <span>Ficha: ${worker.employeeId}</span>
    </nav>

    <!-- Encabezado de Ficha con Avatar y Datos Generales -->
    <section class="tarjeta tarjeta-perfil" aria-labelledby="titulo-perfil">
      <div class="perfil-cabecera">
        <div class="avatar-placeholder" aria-label="${photo.ariaLabel}" role="img">
          <span>${photo.initials}</span>
        </div>

        <div class="perfil-datos-principales">
          <div class="perfil-tag-line">
            <span class="insignia insignia-nomina">Nómina: ${worker.employeeId}</span>
            <span
              class="insignia insignia-categoria"
              title="Regla: ${category.ruleId} v${category.ruleVersion}"
            >
              ${category.category}
            </span>
            ${
              worker.active
                ? html`<span class="insignia insignia-activo">Activo</span>`
                : html`<span class="insignia insignia-inactivo">Inactivo</span>`
            }
          </div>
          <h2 id="titulo-perfil" class="perfil-nombre">${worker.name}</h2>
          <!--
            El encabezado dice las cuatro cosas por las que se busca a alguien en
            piso: nombre, puesto, área y planta. La planta va en corto —1 o 2—,
            con el nombre completo de la matriz en el título del dato.
          -->
          <p class="perfil-puesto">
            ${worker.position || "Puesto no especificado"} · ${worker.area || "Área no asignada"}
            ${
              planta
                ? html` ·
                    <span class="insignia insignia-planta" title="${worker.plant ?? ""}"
                      >Planta ${planta}</span
                    >`
                : ""
            }
          </p>
        </div>
      </div>

      <div class="perfil-grilla-detalles">
        <div class="detalle-item">
          <span class="detalle-etiqueta">Tipo de personal</span>
          <span class="detalle-valor">${etiquetaNomina(worker.payrollType)}</span>
        </div>
        <div class="detalle-item">
          <span class="detalle-etiqueta">Departamento</span>
          <span class="detalle-valor">${worker.department || "No asignado"}</span>
        </div>
        <div class="detalle-item">
          <span class="detalle-etiqueta">Área operativa</span>
          <span class="detalle-valor">${worker.area || "No asignada"}</span>
        </div>
        <div class="detalle-item">
          <span class="detalle-etiqueta">Planta</span>
          <span class="detalle-valor" title="${worker.plant ?? "No disponible"}">
            ${planta || "No asignada"}
          </span>
        </div>
        <div class="detalle-item">
          <span class="detalle-etiqueta">Antigüedad</span>
          <span
            class="detalle-valor"
            title="Fecha de ingreso: ${worker.hireDate ?? "No disponible"}"
          >
            ${seniority.formatted}
          </span>
        </div>
        <!--
          La escolaridad no se muestra. En casi toda la plantilla es un valor
          declarado por omisión —no se captura, se supone— y ocupaba sitio junto
          a los datos con los que sí se decide. Se sigue derivando y viaja en el
          perfil, porque el DC-3 la necesita; lo que se retira es la ficha.
        -->
      </div>
    </section>

    ${renderRadarDnc(profile.courseEvaluations)}

    <!-- Resumen de Cumplimiento DNC (Invariante: sin porcentajes prematuros) -->
    <section class="tarjeta" aria-labelledby="titulo-metricas">
      <div class="seccion-cabecera">
        <h3 id="titulo-metricas">Situación de capacitación</h3>
        <span class="nota-auditoria">${metrics.notaPublicacion}</span>
      </div>

      <div class="metricas-resumen-grilla">
        <div class="metrica-tarjeta metrica-completado">
          <span class="metrica-numero">${metrics.completados}</span>
          <span class="metrica-etiqueta">Completados vigentes</span>
        </div>
        <div class="metrica-tarjeta metrica-reforzar">
          <span class="metrica-numero">${metrics.reforzar}</span>
          <span class="metrica-etiqueta">Por reforzar (vencidos)</span>
        </div>
        <div class="metrica-tarjeta metrica-pendiente">
          <span class="metrica-numero">${metrics.pendientes}</span>
          <span class="metrica-etiqueta">Pendientes</span>
        </div>
        <div class="metrica-tarjeta metrica-programado">
          <span class="metrica-numero">${metrics.programados}</span>
          <span class="metrica-etiqueta">Programados en sala</span>
        </div>
      </div>
    </section>

    <!-- 1. Cursos exigibles, separados por situación para que el perfil no mezcle aplicables y no aplicables. -->
    <section class="tarjeta" aria-labelledby="titulo-cursos">
      <div class="seccion-cabecera">
        <h3 id="titulo-cursos">Cursos exigibles</h3>
        <p class="seccion-subtitulo">Reglas DNC por departamento y, cuando existan, por área.</p>
      </div>
      <h4>Cursos acreditados vigentes</h4>
      ${renderTablaCursos(cursosAcreditados, "Sin cursos exigibles acreditados.")}
      <h4>Cursos por realizar o actualizar</h4>
      ${renderTablaCursos(cursosPorAtender, "Sin cursos pendientes, por reforzar ni programados.")}
    </section>

    <!-- 2. Trayectoria Cronológica -->
    <section class="tarjeta" aria-labelledby="titulo-trayectoria">
      <div class="seccion-cabecera">
        <h3 id="titulo-trayectoria">Trayectoria de capacitación</h3>
        <p class="seccion-subtitulo">Acreditaciones con su procedencia.</p>
      </div>

      ${
        profile.trajectory.length === 0
          ? html`<p class="texto-vacio">Sin registros de acreditación.</p>`
          : html`
              <div class="tabla-contenedor">
                <table class="tabla-kcm">
                  <thead>
                    <tr>
                      <th scope="col">Fecha</th>
                      <th scope="col">Curso</th>
                      <th scope="col">Procedencia</th>
                      <th scope="col">Lote / Sesión</th>
                      <th scope="col">Registrado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${profile.trajectory.map(renderFilaTrayectoria)}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>

    <!-- 3. Bitácora DC-3 -->
    <section class="tarjeta" aria-labelledby="titulo-dc3">
      <div class="seccion-cabecera">
        <h3 id="titulo-dc3">Constancias DC-3</h3>
        <p class="seccion-subtitulo">Emisiones para Inducción a la empresa, QMS y LOTO.</p>
      </div>

      ${
        profile.dc3Log.length === 0
          ? html`<p class="texto-vacio">Sin constancias emitidas.</p>`
          : html`
              <div class="tabla-contenedor">
                <table class="tabla-kcm">
                  <thead>
                    <tr>
                      <th scope="col">Curso</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Folio</th>
                      <th scope="col">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${profile.dc3Log.map(renderFilaDc3)}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;

  return renderLayout({
    titulo: `Ficha: ${worker.name}`,
    tituloDocumento: `${worker.employeeId} · ${worker.name}`,
    subtitulo: worker.department || "Directorio de trabajadores",
    entorno,
    contenido,
    rutaActiva: "/trabajadores",
    estado: html`<span class="insignia insignia-nomina">Nómina ${worker.employeeId}</span>`,
  });
}

/**
 * Una fila por curso. Sin la clave del curso: `TR-QMS-01` no le dice nada a
 * quien consulta una ficha, ocupaba la primera columna —la que más se mira— y
 * empujaba el nombre, que es lo único por lo que se busca un curso aquí. La
 * clave sigue viajando en el perfil y la usan la carga y la liberación.
 */
function renderFilaCurso(ev: WorkerCourseEvaluation): Html {
  return html`
    <tr>
      <td class="celda-destacada">${ev.canonicalCourseName}</td>
      <td>
        ${
          ev.ruleLevel
            ? html`<span
                class="insignia insignia-regla"
                title="Regla ${ev.ruleId ?? ""} v${ev.ruleVersion ?? "1.0.0"}"
                >${ev.ruleLevel}</span
              >`
            : html`<span class="texto-atenuado">—</span>`
        }
      </td>
      <td>${renderInsigniaEstado(ev.status)}</td>
      <td>${ev.lastCompletionDate ?? "—"}</td>
      <td>${ev.expirationDate ?? "—"}</td>
    </tr>
  `;
}

function renderTablaCursos(cursos: readonly WorkerCourseEvaluation[], mensajeVacio: string): Html {
  if (cursos.length === 0) {
    return html`<p class="texto-vacio">${mensajeVacio}</p>`;
  }
  return html`
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Nombre del curso</th>
            <th scope="col">Nivel / regla</th>
            <th scope="col">Estado DNC</th>
            <th scope="col">Última acreditación</th>
            <th scope="col">Vigencia / expiración</th>
          </tr>
        </thead>
        <tbody>
          ${cursos.map(renderFilaCurso)}
        </tbody>
      </table>
    </div>
  `;
}

function renderInsigniaEstado(status: DncStatus): Html {
  switch (status) {
    case "COMPLETADO":
      return html`<span class="insignia insignia-completado">COMPLETADO</span>`;
    case "REFORZAR":
      return html`<span class="insignia insignia-reforzar">REFORZAR</span>`;
    case "PENDIENTE":
      return html`<span class="insignia insignia-pendiente">PENDIENTE</span>`;
    case "PROGRAMADO":
      return html`<span class="insignia insignia-programado">PROGRAMADO</span>`;
    case "NO_APLICA":
      return html`<span class="insignia insignia-no-aplica">NO APLICA</span>`;
    case "DATOS_INSUFICIENTES":
      return html`<span class="insignia insignia-datos-insuficientes">DATOS INSUFICIENTES</span>`;
  }
}

function renderFilaTrayectoria(item: CourseTrajectoryEntry): Html {
  const esPlataforma = item.provenance === "SESSION_RELEASE";
  return html`
    <tr>
      <td class="celda-codigo">${item.completionDate}</td>
      <td class="celda-destacada">${item.courseName}</td>
      <td>
        <span
          class="insignia ${esPlataforma ? "insignia-procedencia-plataforma" : "insignia-procedencia-matriz"}"
        >
          ${item.provenance}
        </span>
      </td>
      <td class="celda-mono">${item.sourceBatchId ?? "HISTORIAL_MATRIZ"}</td>
      <td>${item.actor}</td>
    </tr>
  `;
}

function renderFilaDc3(item: Dc3WorkerLogEntry): Html {
  return html`
    <tr>
      <td class="celda-destacada">${item.courseName}</td>
      <td>
        ${
          item.isIssued
            ? html`<span class="insignia insignia-completado">EMITIDA</span>`
            : html`<span class="insignia insignia-reforzar">PENDIENTE DE EMISIÓN</span>`
        }
      </td>
      <td class="celda-mono">${item.documentFolio ?? "—"}</td>
      <td>${item.issuedAt ?? "—"}</td>
    </tr>
  `;
}

function etiquetaNomina(value: string | null | undefined): string {
  if (value === "NS") return "Sindicalizado";
  if (value === "NQ") return "Empleado de confianza";
  return value || "No disponible";
}
