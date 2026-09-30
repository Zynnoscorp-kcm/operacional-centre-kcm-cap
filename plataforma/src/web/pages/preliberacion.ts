/**
 * Pantallas de Preliberación (Función 4).
 *
 * Dos vistas: la bandeja de sesiones revisables y el banco de trabajo de una
 * sesión. Se rinden en servidor y sin una sola línea de script: la política
 * de contenido de la plataforma declara `default-src 'none'`, así que todo lo
 * que la pantalla hace, lo hace con formularios.
 *
 * Esa restricción manda en el diseño del banco: el revisor marca el padrón
 * completo y lo guarda de una vez, que es además como se comporta el servicio
 * —una sola operación serializada— y no fila por fila.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import { etiquetaDeEstadoDeSesion } from "../kit/etiquetas.ts";
import { fechaCorta } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";
import type { ExistingDate } from "../../domain/liberacion/tipos.ts";
import type {
  ReportEvidenceRecord,
  RosterRow,
  SessionHeader,
  WorkbenchState,
} from "../../domain/preliberacion/tipos.ts";
import {
  EXAM_OUTCOME_LABELS,
  PRERELEASE_FINDINGS,
  type FindingCode,
} from "../../domain/preliberacion/tipos.ts";
import {
  ROSTER_SITUATION_LABELS,
  rosterSituation,
  type RosterSituation,
} from "../../domain/preliberacion/servicio.ts";

export interface DatosBandejaPreliberacion {
  readonly entorno: EnvironmentName;
  readonly revisables: readonly SessionHeader[];
  readonly aviso?: string;
}

export interface DatosBancoPreliberacion {
  readonly entorno: EnvironmentName;
  readonly estado: WorkbenchState;
  readonly reportes: readonly ReportEvidenceRecord[];
  /** Quién de la sesión ya tiene fecha del curso en la copia de la matriz. */
  readonly fechasPrevias?: readonly ExistingDate[];
  /** Identificador de la solicitud que llevarán los formularios de mutación. */
  readonly requestId: string;
  readonly aviso?: string;
}

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

export function renderPreReleaseInboxPage(datos: DatosBandejaPreliberacion): string {
  const { entorno, revisables, aviso } = datos;

  const contenido = html`
    ${aviso ? html`<p class="aviso-publicacion">${aviso}</p>` : ""}

    <section class="tarjeta" aria-labelledby="titulo-revisables">
      <div class="seccion-cabecera">
        <h2 id="titulo-revisables">Sesiones en revisión</h2>
        <p class="seccion-subtitulo">Sesiones cerradas o en preliberación.</p>
      </div>
      ${renderTablaSesiones(revisables, "Sin sesiones por revisar.")}
    </section>
  `;

  return renderLayout({
    titulo: "Preliberación",
    rutaActiva: "/preliberacion",
    subtitulo: "Cotejo de padrón, exámenes y exclusiones",
    entorno,
    contenido,
  });
}

function renderTablaSesiones(sesiones: readonly SessionHeader[], vacio: string): Html {
  if (sesiones.length === 0) {
    return html`<p class="texto-vacio">${vacio}</p>`;
  }

  return html`
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Curso</th>
            <th scope="col">Fecha</th>
            <th scope="col">Instructor</th>
            <th scope="col">Estado</th>
            <th scope="col">Padrón</th>
            <th scope="col">Excluidos</th>
            <th scope="col">Sin calificar</th>
            <th scope="col">Revisar</th>
          </tr>
        </thead>
        <tbody>
          ${sesiones.map(
            (s) => html`
              <tr>
                <td class="celda-codigo">${s.sessionCode}</td>
                <td>${s.trainingName}</td>
                <td class="celda-mono">${s.date}</td>
                <td>${s.instructor}</td>
                <td><span class="insignia">${etiquetaDeEstadoDeSesion(s.status)}</span></td>
                <td class="celda-numero">${s.attendanceCount}</td>
                <td class="celda-numero">${s.excludedCount}</td>
                <td class="celda-numero">${s.pendingExamCount}</td>
                <td>
                  <a class="boton-enlace" href="/preliberacion/${s.sessionId}">Abrir</a>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Banco de trabajo
// ---------------------------------------------------------------------------

/**
 * Aviso de quién ya tiene fecha del curso. Antes sólo se sabía al liberar, y
 * entonces la pantalla pedía un motivo que nadie había previsto.
 */
function renderFechasPrevias(fechas: readonly ExistingDate[]): Html {
  if (fechas.length === 0) return html``;
  return html`<section class="tarjeta" aria-labelledby="fechas-previas-titulo">
    <h3 id="fechas-previas-titulo">Ya tienen fecha de este curso</h3>
    <p class="texto-secundario">
      Según la copia de la matriz que guarda la plataforma. No detiene nada: al liberar aparece un
      aviso con estos trabajadores y se decide ahí si se libera.
    </p>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Nómina</th>
            <th scope="col">Fecha registrada</th>
            <th scope="col">Comparada con la sesión</th>
          </tr>
        </thead>
        <tbody>
          ${fechas.map(
            (fecha) =>
              html`<tr>
                <td class="celda-mono">${fecha.employeeId}</td>
                <td class="celda-mono">${fechaCorta(fecha.previousDate)}</td>
                <td>
                  ${
                    fecha.newer
                      ? html`<span class="insignia insignia-aviso"
                          >Más reciente: no se reemplaza</span
                        >`
                      : html`<span class="insignia insignia-pendiente">Pedirá motivo</span>`
                  }
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`;
}

export function renderPreReleaseWorkbenchPage(datos: DatosBancoPreliberacion): string {
  const { entorno, estado, reportes, requestId, aviso } = datos;
  const sesion = estado.session;
  const editable = estado.editable !== false;

  const contenido = html`
    <nav class="miga-de-pan" aria-label="Navegación secundaria">
      <a href="/preliberacion">&larr; Volver a preliberación</a>
    </nav>

    ${aviso ? html`<p class="aviso-publicacion">${aviso}</p>` : ""}
    ${renderEncabezadoSesion(sesion)} ${renderContadores(estado)}
    ${renderFechasPrevias(datos.fechasPrevias ?? [])} ${renderHallazgos(estado, editable)}
    ${editable ? renderAltaManual(sesion, requestId) : ""}
    ${renderRevision(estado, editable, requestId)} ${renderTransiciones(estado, requestId)}
    ${renderReportes(sesion, reportes)}
  `;

  return renderLayout({
    titulo: `Preliberación ${sesion.sessionCode}`,
    rutaActiva: "/preliberacion",
    subtitulo: sesion.trainingName,
    entorno,
    contenido,
    estado: html`<span class="insignia">${etiquetaDeEstadoDeSesion(sesion.status)}</span>`,
  });
}

function renderEncabezadoSesion(sesion: SessionHeader): Html {
  return html`
    <section class="tarjeta" aria-labelledby="titulo-sesion">
      <div class="seccion-cabecera">
        <h2 id="titulo-sesion">Datos de la sesión</h2>
      </div>
      <dl class="definiciones">
        <dt>Código</dt>
        <dd class="celda-mono">${sesion.sessionCode}</dd>
        <dt>Curso</dt>
        <dd>${sesion.trainingName}</dd>
        <dt>Fecha</dt>
        <dd class="celda-mono">${sesion.date}</dd>
        <dt>Instructor</dt>
        <dd>${sesion.instructor}</dd>
        <dt>Estado</dt>
        <dd><span class="insignia">${etiquetaDeEstadoDeSesion(sesion.status)}</span></dd>
        <dt>Autorizada</dt>
        <dd>
          ${
            sesion.authorized
              ? html`<span class="insignia insignia-completado">Sí</span>`
              : html`<span class="insignia insignia-pendiente">No</span>`
          }
        </dd>
      </dl>
    </section>
  `;
}

function renderContadores(estado: WorkbenchState): Html {
  const c = estado.counters;
  const tarjetas: readonly [number, string][] = [
    [c.expectedExams, "Registrados"],
    [c.approvedExams, "Aprobados"],
    [c.failedExams, "Reprobados"],
    [c.missingExams, "Sin entregar"],
    [c.excludedCount, "Excluidos"],
    [c.eligibleCount, "A liberar"],
  ];

  return html`
    <section class="tarjeta" aria-labelledby="titulo-contadores">
      <div class="seccion-cabecera">
        <h2 id="titulo-contadores">Resumen de la revisión</h2>
      </div>
      <div class="metricas-resumen-grilla">
        ${tarjetas.map(
          ([valor, etiqueta]) => html`
            <div class="metrica-tarjeta">
              <span class="metrica-numero">${valor}</span>
              <span class="metrica-etiqueta">${etiqueta}</span>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

function renderHallazgos(estado: WorkbenchState, editable: boolean): Html {
  const derivados = estado.derivedFindings;
  const declarables = estado.findingCatalog.filter((f) => !f.derived);
  const declarados = new Set(estado.review.declaredFindings);

  return html`
    <section class="tarjeta" aria-labelledby="titulo-hallazgos">
      <div class="seccion-cabecera">
        <h2 id="titulo-hallazgos">Hallazgos</h2>
        <p class="seccion-subtitulo">Derivados del padrón y declarados por inspección física.</p>
      </div>

      <h3>Derivados</h3>
      ${
        derivados.length === 0
          ? html`<p class="texto-vacio">Sin hallazgos derivados.</p>`
          : html`
              <ul>
                ${derivados.map(
                  (codigo) => html`
                    <li>
                      <span class="insignia insignia-aviso">${etiquetaHallazgo(codigo)}</span>
                    </li>
                  `,
                )}
              </ul>
            `
      }

      <h3>De inspección física</h3>
      ${
        editable
          ? html` <p class="texto-atenuado">Se registran con el padrón al guardar la revisión.</p> `
          : html`
              <ul>
                ${declarables
                  .filter((f) => declarados.has(f.code))
                  .map((f) => html`<li>${f.label}</li>`)}
              </ul>
            `
      }
    </section>
  `;
}

function etiquetaHallazgo(codigo: string): string {
  const definicion = PRERELEASE_FINDINGS[codigo as FindingCode];
  return definicion ? definicion.label : codigo;
}

function renderAltaManual(sesion: SessionHeader, requestId: string): Html {
  return html`
    <section class="tarjeta" aria-labelledby="titulo-alta">
      <div class="seccion-cabecera">
        <h2 id="titulo-alta">Alta manual</h2>
        <p class="seccion-subtitulo">Alta por número de nómina contra el padrón activo.</p>
      </div>
      <form method="POST" action="/api/pre-release/add-worker" class="formulario-busqueda">
        <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
        <input type="hidden" name="requestId" value="${requestId}" />
        <div class="campo-busqueda">
          <label class="etiqueta-formulario" for="campo-alta-nomina">Número de nómina</label>
          <input
            class="input-kcm"
            id="campo-alta-nomina"
            name="employeeId"
            inputmode="numeric"
            pattern="[0-9]{5}"
            maxlength="5"
            required
            placeholder="01234"
          />
        </div>
        <div class="acciones-busqueda">
          <button class="boton-kcm" type="submit">Agregar al padrón</button>
        </div>
      </form>
    </section>
  `;
}

function renderRevision(estado: WorkbenchState, editable: boolean, requestId: string): Html {
  const sesion = estado.session;
  const declarados = new Set(estado.review.declaredFindings);
  const declarables = estado.findingCatalog.filter((f) => !f.derived);

  const tabla = html`
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Nómina</th>
            <th scope="col">Trabajador</th>
            <th scope="col">Examen</th>
            <th scope="col">Excluir</th>
            <th scope="col">Motivo de exclusión</th>
            <th scope="col">Situación</th>
          </tr>
        </thead>
        <tbody>
          ${estado.roster.map((fila) => renderFilaPadron(fila, estado, editable))}
        </tbody>
      </table>
    </div>
  `;

  if (estado.roster.length === 0) {
    return html`
      <section class="tarjeta" aria-labelledby="titulo-padron">
        <div class="seccion-cabecera"><h2 id="titulo-padron">Padrón de la sesión</h2></div>
        <p class="texto-vacio">Sin participantes registrados.</p>
      </section>
    `;
  }

  if (!editable) {
    return html`
      <section class="tarjeta" aria-labelledby="titulo-padron">
        <div class="seccion-cabecera">
          <h2 id="titulo-padron">Padrón de la sesión</h2>
          <p class="seccion-subtitulo">Sólo lectura: la sesión salió de preliberación.</p>
        </div>
        ${tabla}
      </section>
    `;
  }

  return html`
    <section class="tarjeta" aria-labelledby="titulo-padron">
      <div class="seccion-cabecera">
        <h2 id="titulo-padron">Padrón de la sesión</h2>
        <p class="seccion-subtitulo">
          Guardar registra el cotejo sin cambiar el estado de la sesión.
        </p>
      </div>

      <form method="POST" action="/api/pre-release/save">
        <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
        <input type="hidden" name="requestId" value="${requestId}" />

        ${tabla}

        <fieldset>
          <legend>Hallazgos de inspección física</legend>
          ${declarables.map(
            (f) => html`
              <label class="etiqueta-formulario">
                <input
                  type="checkbox"
                  name="hallazgo"
                  value="${f.code}"
                  ${declarados.has(f.code) ? "checked" : ""}
                />
                ${f.label}
              </label>
            `,
          )}
        </fieldset>

        <div class="campo-busqueda">
          <label class="etiqueta-formulario" for="campo-comentarios"
            >Comentarios de la revisión</label
          >
          <textarea
            class="input-kcm"
            id="campo-comentarios"
            name="comments"
            rows="4"
            maxlength="1500"
          >
${estado.review.comments}</textarea>
        </div>

        <div class="acciones-busqueda">
          <button class="boton-kcm" type="submit">Guardar revisión</button>
        </div>
      </form>
    </section>
  `;
}

/** La insignia que le toca a cada situación; el texto lo pone el dominio. */
const INSIGNIA_POR_SITUACION: Readonly<Record<RosterSituation, string>> = Object.freeze({
  EXCLUIDO: "insignia-aviso",
  PENDIENTE: "insignia-pendiente",
  A_LIBERAR: "insignia-completado",
});

function renderFilaPadron(fila: RosterRow, estado: WorkbenchState, editable: boolean): Html {
  const situacion = rosterSituation(fila);
  // Los motivos acompañan a la exclusión, que es donde explican algo. Junto a
  // «Pendiente» sólo repetirían, en jerga, que la revisión no se ha guardado.
  const motivos = situacion === "EXCLUIDO" ? fila.blockingReasons.join(", ") : "";

  return html`
    <tr>
      <td class="celda-mono">${fila.employeeId}</td>
      <td>
        ${
          fila.knownEmployee
            ? html`${fila.displayName}`
            : html`<span class="insignia insignia-aviso">No identificado</span>`
        }
      </td>
      <td>
        ${
          editable
            ? html`
                <fieldset>
                  <legend class="etiqueta-formulario">Examen de ${fila.employeeId}</legend>
                  ${estado.examOutcomes.map(
                    (opcion) => html`
                      <label class="etiqueta-formulario">
                        <input
                          type="radio"
                          name="examen__${fila.employeeId}"
                          value="${opcion.code}"
                          ${fila.examStatus === opcion.code ? "checked" : ""}
                        />
                        ${opcion.label}
                      </label>
                    `,
                  )}
                </fieldset>
              `
            : html`<span class="insignia"
                >${EXAM_OUTCOME_LABELS[fila.examStatus] ?? fila.examStatus}</span
              >`
        }
      </td>
      <td>
        ${
          editable
            ? html`
                <label class="etiqueta-formulario">
                  <input
                    type="checkbox"
                    name="excluir__${fila.employeeId}"
                    value="1"
                    ${fila.excludedFromRelease ? "checked" : ""}
                  />
                  Excluir
                </label>
              `
            : fila.excludedFromRelease
              ? html`<span class="insignia insignia-aviso">Excluido</span>`
              : html`<span class="texto-atenuado">—</span>`
        }
      </td>
      <td>
        ${
          editable
            ? html`
                <input
                  class="input-kcm"
                  type="text"
                  name="motivo__${fila.employeeId}"
                  maxlength="200"
                  value="${fila.exclusionReason}"
                  placeholder="Obligatorio si se excluye"
                />
              `
            : html`${fila.exclusionReason || "—"}`
        }
      </td>
      <td>
        <span class="insignia ${INSIGNIA_POR_SITUACION[situacion]}"
          >${ROSTER_SITUATION_LABELS[situacion]}</span
        >
        ${motivos ? html`<span class="celda-motivo">${motivos}</span>` : ""}
      </td>
    </tr>
  `;
}

function renderTransiciones(estado: WorkbenchState, requestId: string): Html {
  const sesion = estado.session;
  const enPreliberacion = sesion.status === "PRELIBERACION";
  const enBandeja = sesion.status === "LISTA_PARA_LIBERAR";
  const revisionGuardada = Boolean(estado.review.reviewedAt);
  // Limpia es sin un solo hallazgo, ni de los que el revisor declara ni de los
  // que la revisión deriva sola. Es la condición del atajo, y se calcula aquí
  // igual que en la ruta para que la pantalla y el servidor no discrepen.
  const sinHallazgos = estado.findings.length === 0 && estado.derivedFindings.length === 0;

  return html`
    <section class="tarjeta" aria-labelledby="titulo-transiciones">
      <div class="seccion-cabecera">
        <h2 id="titulo-transiciones">Confirmaciones</h2>
        <p class="seccion-subtitulo">
          Cada paso se confirma por separado; antes de avanzar se vuelven a comprobar la
          autorización y los exámenes.
        </p>
      </div>

      ${
        revisionGuardada
          ? html`
              <p class="texto-atenuado">
                Última revisión guardada por ${estado.review.reviewedBy} el
                <span class="celda-mono">${estado.review.reviewedAt}</span>.
              </p>
            `
          : html`<p class="texto-vacio">Sin revisión guardada.</p>`
      }

      <div class="acciones-busqueda">
        ${
          // El orden lo impone el servidor: sin revisión guardada, entrar a
          // preliberación se rechaza. Ofrecer el botón igual dejaba al revisor
          // ante un error y sin saber qué le faltaba, así que el paso aparece
          // cuando de verdad se puede dar y, si no, se dice qué falta.
          !enPreliberacion && !enBandeja
            ? revisionGuardada
              ? html`
                  <form method="POST" action="/api/pre-release/enter">
                    <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
                    <input type="hidden" name="requestId" value="${requestId}" />
                    <button class="boton-kcm" type="submit">Entrar a preliberación</button>
                  </form>
                `
              : html`<p class="texto-atenuado">Requiere la revisión guardada.</p>`
            : ""
        }
        ${
          // Dos caminos y uno solo visible a la vez, según lo que la sesión traiga.
          //
          // Limpia: un botón que revisa y libera en el mismo acto. La segunda
          // revisión de una sesión sin hallazgos no es un control —nada exige que
          // la firme otra persona— sino una ceremonia que cuesta dos pantallas.
          //
          // Con hallazgos: el camino de siempre, en dos pasos, porque ahí la
          // segunda mirada sí tiene algo que mirar. El atajo no se ofrece, y el
          // servidor lo vuelve a comprobar por si la sesión se ensució entre que
          // se pintó esta pantalla y alguien pulsó.
          enPreliberacion
            ? sinHallazgos
              ? html`
                  <form method="POST" action="/api/pre-release/liberar">
                    <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
                    <input type="hidden" name="requestId" value="${requestId}" />
                    <button class="boton-kcm" type="submit">Liberar</button>
                  </form>
                  <p class="texto-atenuado">Sin hallazgos: se libera desde aquí.</p>
                `
              : html`
                  <form method="POST" action="/api/pre-release/submit">
                    <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
                    <input type="hidden" name="requestId" value="${requestId}" />
                    <button class="boton-kcm" type="submit">Pasar a liberación</button>
                  </form>
                `
            : ""
        }
        ${
          enBandeja
            ? html`
                <form method="POST" action="/api/pre-release/return">
                  <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
                  <input type="hidden" name="requestId" value="${requestId}" />
                  <button class="boton-secundario" type="submit">Regresar a preliberación</button>
                </form>
              `
            : ""
        }
      </div>
    </section>
  `;
}

function renderReportes(sesion: SessionHeader, reportes: readonly ReportEvidenceRecord[]): Html {
  return html`
    <section class="tarjeta" aria-labelledby="titulo-reportes">
      <div class="seccion-cabecera">
        <h2 id="titulo-reportes">Reporte de preliberación</h2>
        <p class="seccion-subtitulo">
          La vista previa no deja registro. Archivar guarda el PDF como evidencia en auditoría.
        </p>
      </div>

      <div class="acciones-busqueda">
        <a class="boton-secundario" href="/preliberacion/${sesion.sessionId}/reporte">
          Ver vista previa
        </a>
        <form method="POST" action="/api/pre-release/report">
          <input type="hidden" name="sessionId" value="${sesion.sessionId}" />
          <button class="boton-kcm" type="submit">Archivar reporte</button>
        </form>
      </div>

      <h3>Reportes archivados</h3>
      ${
        reportes.length === 0
          ? html`<p class="texto-vacio">Sin reportes archivados.</p>`
          : html`
              <div class="tabla-contenedor">
                <table class="tabla-kcm">
                  <thead>
                    <tr>
                      <th scope="col">Archivo</th>
                      <th scope="col">Archivado</th>
                      <th scope="col">Por</th>
                      <th scope="col"><span class="solo-lectores">Descargar</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${reportes.map(
                      (r) => html`
                        <tr>
                          <td>${r.fileName}</td>
                          <td class="celda-fecha" title="Huella ${r.sha256}">
                            ${fechaCorta(r.createdAt)}
                          </td>
                          <td>${r.createdBy}</td>
                          <td>
                            <a class="boton-enlace" href="/preliberacion/reporte/${r.evidenceId}">
                              Descargar
                            </a>
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;
}
