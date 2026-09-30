/**
 * Pantalla de Liberación a la matriz (Función 5).
 *
 * Es una vista de preflight y confirmación, no un formulario que escriba
 * directo: muestra qué se va a escribir, qué se va a sobrescribir y qué queda
 * fuera, antes de que alguien apriete nada. La sobrescritura pide su motivo
 * en la misma pantalla porque el motivo es parte del acto, no un trámite
 * posterior.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import type {
  ExcludedEntry,
  MatrixWriteResult,
  ReleasePreview,
} from "../../domain/liberacion/tipos.ts";
import type { SessionHeader } from "../../domain/preliberacion/tipos.ts";
import type { MatrixDelivery } from "../../ports/entregas-matriz.port.ts";
import { fechaCorta } from "../kit/fechas.ts";
import { html, type Html, rawHtml } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface ReleasePageProps {
  readonly entorno: EnvironmentName;
  readonly preview?: ReleasePreview;
  /** Clave idempotente entregada por el servidor para confirmar o reanudar. */
  readonly requestId?: string;
  /** Sesiones que superaron preliberación y esperan la confirmación de liberar. */
  readonly sessions?: readonly SessionHeader[];
  /**
   * Lo ya liberado y su acuse de Excel. Ausente significa que no hay base
   * conectada: entonces el tablero lo dice en vez de enseñar una bandeja vacía,
   * que se leería como «no hay nada esperando».
   */
  readonly deliveries?: readonly MatrixDelivery[];
  /** El tablero viene desplegado. Lo pide la dirección para sobrevivir al refresco. */
  readonly entregasAbiertas?: boolean;
  readonly aviso?: string;
  readonly mensaje?: string;
}

const ETIQUETAS_DE_ESTADO: Readonly<Record<string, string>> = {
  READY: "Se escribirá",
  READY_OVERWRITE: "Sobrescribirá",
  WRITTEN: "Escrita",
  OVERWRITTEN: "Sobrescrita",
  ALREADY_APPLIED: "Ya aplicada",
  RECOVERED: "Recuperada",
  ATOMIC_BATCH_ABORTED: "No intentada: la liberación se detuvo",
  EMPLOYEE_NOT_FOUND: "Trabajador ausente de la matriz",
  COURSE_NOT_FOUND: "Curso ausente del catálogo",
  EXISTING_VALUE_CONFLICT: "La celda ya tiene un valor",
  OVERWRITE_NOT_ALLOWED: "El destino no admite sobrescritura",
  NEWER_DATE_PRESENT: "La matriz ya tiene una fecha más reciente",
  OVERWRITE_REASON_REQUIRED: "Motivo no declarado",
  IDEMPOTENCY_CONFLICT: "Ya se había liberado con otros datos",
};

function etiqueta(estado: string): string {
  return ETIQUETAS_DE_ESTADO[estado] ?? estado;
}

export function renderReleasePage(props: ReleasePageProps): string {
  const contenido = props.preview
    ? renderPreview(props.preview, props.requestId)
    : html`${renderBandeja(props.sessions ?? [], props.mensaje, props.aviso)}
      ${renderTableroDeEntregas(props)}`;

  return renderLayout({
    titulo: "Liberación a la matriz",
    rutaActiva: "/liberacion",
    subtitulo: "Validación previa y escritura en la matriz",
    entorno: props.entorno,
    contenido,
  });
}

function renderBandeja(sessions: readonly SessionHeader[], mensaje?: string, aviso?: string): Html {
  return html`
    <section class="tarjeta" aria-labelledby="liberacion-titulo">
      <div class="seccion-cabecera">
        <div>
          <h2 id="liberacion-titulo">Sesiones listas para liberar</h2>
          <p class="texto-secundario">Sesiones con preliberación concluida.</p>
        </div>
      </div>

      ${aviso ? html`<p class="aviso-publicacion">${aviso}</p>` : ""}
      ${mensaje ? html`<p class="aviso aviso-error">${mensaje}</p>` : ""}
      ${renderSessionTable(sessions)}
    </section>
  `;
}

function renderSessionTable(sessions: readonly SessionHeader[]): Html {
  if (sessions.length === 0) {
    return html`<p class="texto-vacio">Sin sesiones listas para liberar.</p>`;
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
            <th scope="col">Padrón</th>
            <th scope="col">Excluidos</th>
            <th scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>
          ${sessions.map(
            (session) => html`
              <tr>
                <td class="celda-codigo">${session.sessionCode}</td>
                <td>${session.trainingName}</td>
                <td class="celda-mono">${session.date}</td>
                <td>${session.instructor}</td>
                <td class="celda-numero">${session.attendanceCount}</td>
                <td class="celda-numero">${session.excludedCount}</td>
                <td>
                  <a class="boton-enlace" href="/liberacion?sessionId=${session.sessionId}">
                    Ver validación
                  </a>
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function renderPreview(preview: ReleasePreview, requestId?: string): Html {
  const sobrescrituras = preview.counts.overwrites;

  return html`
    <p><a class="boton-secundario" href="/liberacion">Volver a la lista</a></p>
    <section class="tarjeta" aria-labelledby="preflight-titulo">
      <div class="seccion-cabecera">
        <div>
          <h2 id="preflight-titulo">Validación previa</h2>
          <p class="texto-secundario">
            Fecha a escribir: ${fechaCorta(preview.completionDate)} · Destino
            ${preview.mapping.destinationName}, hoja ${preview.mapping.destinationSheet}, columna
            ${preview.mapping.destinationColumn}
          </p>
        </div>
        <span class="insignia"
          >${
            preview.mapping.overwritePolicy === "NO_OVERWRITE"
              ? "No sobrescribe fechas"
              : "Sobrescribe con historial"
          }</span
        >
      </div>

      <dl class="contadores">
        <div>
          <dt>Total en lista</dt>
          <dd>${preview.counts.total}</dd>
        </div>
        <div>
          <dt>Se liberarán</dt>
          <dd>${preview.counts.included}</dd>
        </div>
        <div>
          <dt>Excluidos</dt>
          <dd>${preview.counts.excluded}</dd>
        </div>
        <div>
          <dt>Sobrescrituras</dt>
          <dd>${sobrescrituras}</dd>
        </div>
      </dl>

      ${
        preview.overwriteRequiresReason
          ? html`<p class="aviso aviso-error">
              ${sobrescrituras === 1 ? "Un trabajador ya tiene" : html`${sobrescrituras} trabajadores ya tienen`}
              fecha de este curso en la copia de la matriz que guarda la plataforma (columna «Valor
              anterior»). Para liberar hace falta el motivo de sobrescritura, abajo; queda en el
              historial con el valor anterior. Si la fecha anterior ya no está en la matriz, Excel
              escribe la nueva sin más. Para corregir la sesión primero, se puede regresar a
              preliberación.
            </p>`
          : ""
      }
      ${
        !preview.atomicBatchReady && !preview.overwriteRequiresReason
          ? html`<p class="aviso aviso-error">
              La liberación no puede aplicarse: hay conflictos pendientes. Se aplica completa o no
              se aplica, así que no se escribió ninguna fecha.
            </p>`
          : ""
      }
      ${renderTablaIncluidos(preview.included)} ${renderTablaExcluidos(preview.excluded)}

      <form method="post" action="/api/release/execute" class="formulario">
        <input type="hidden" name="sessionId" value="${preview.sessionId}" />
        <input type="hidden" name="requestId" value="${requestId ?? ""}" />
        <label for="overwriteReason">
          Motivo de sobrescritura
          ${preview.overwriteRequiresReason ? "(obligatorio)" : "(si aplica)"}
        </label>
        <input
          id="overwriteReason"
          name="overwriteReason"
          type="text"
          maxlength="200"
          autocomplete="off"
          ${preview.overwriteRequiresReason ? "required" : ""}
          placeholder="${preview.overwriteRequiresReason ? "Por qué se reemplaza la fecha anterior" : ""}"
        />
        <button
          type="submit"
          class="boton boton-primario"
          ${preview.counts.included === 0 ? "disabled" : ""}
        >
          Liberar ${preview.counts.included} registro(s)
        </button>
      </form>

      <form method="post" action="/api/pre-release/return" class="formulario-en-linea">
        <input type="hidden" name="sessionId" value="${preview.sessionId}" />
        <button type="submit" class="boton boton-secundario">Regresar a preliberación</button>
        <span class="texto-nota"
          >Devuelve la sesión a revisión para corregir asistentes o exámenes antes de liberar.</span
        >
      </form>
    </section>
  `;
}

function renderTablaIncluidos(filas: readonly MatrixWriteResult[]): Html {
  if (filas.length === 0) {
    return html`<p class="texto-secundario">Sin registros elegibles en esta sesión.</p>`;
  }

  return html`
    <div class="tabla-contenedor">
      <table>
        <caption>
          Registros que se liberan
        </caption>
        <thead>
          <tr>
            <th>Trabajador</th>
            <th>Efecto</th>
            <th>Valor anterior</th>
            <th>Procedencia anterior</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map(
            (fila) =>
              html`<tr>
                <td>${fila.employeeId}</td>
                <td>${etiqueta(fila.status)}</td>
                <td>${fila.previousDate ?? "—"}</td>
                <td>${fila.previousProvenance ?? "—"}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function renderTablaExcluidos(filas: readonly ExcludedEntry[]): Html {
  if (filas.length === 0) return html``;

  return html`
    <div class="tabla-contenedor">
      <table>
        <caption>
          Registros que no se liberan
        </caption>
        <thead>
          <tr>
            <th>Trabajador</th>
            <th>Motivos</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map(
            (fila) =>
              html`<tr>
                <td>${fila.employeeId ?? "—"}</td>
                <td>${fila.reasons.map((motivo) => etiqueta(motivo)).join(", ")}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Tablero de entregas a la matriz
// -----------------------------------------------------------------------------

/**
 * Lo que pasa después de pulsar «Liberar».
 *
 * Liberar aquí no escribe en el XLSB: deja la fecha lista para que el cliente de
 * Excel la escriba en la PC donde vive el libro. Ese intervalo no se veía en
 * ninguna parte —la sesión salía de la lista de pendientes y no volvía a
 * aparecer—, así que la única forma de saber si la fecha ya estaba era abrir la
 * matriz a mirar.
 *
 * El tablero llena ese hueco y nada más: un renglón por lote liberado, con un
 * foco rojo mientras Excel no ha acusado y verde cuando ya lo hizo. Va plegado
 * porque no es lo primero que se hace en esta pantalla; se despliega y entonces
 * la dirección lo recuerda, para que el botón de actualizar no lo vuelva a
 * cerrar en cada consulta.
 *
 * Se actualiza pulsando y no solo: un reloj preguntando cada minuto son mil
 * cuatrocientas lecturas al día contra una base con presupuesto, y la respuesta
 * casi siempre sería la misma.
 */
function renderTableroDeEntregas(props: ReleasePageProps): Html {
  const entregas = props.deliveries;
  const esperando = (entregas ?? []).filter((fila) => fila.state !== "ENTREGADA").length;

  return html`
    <details class="tarjeta tablero-entregas" id="entregas" ${props.entregasAbiertas ? "open" : ""}>
      <summary class="tablero-resumen">
        <span class="tablero-titulo">Entregas a la matriz</span>
        ${
          entregas === undefined
            ? ""
            : esperando > 0
              ? html`<span class="insignia insignia-pendiente"
                  >${esperando} esperando a Excel</span
                >`
              : html`<span class="insignia insignia-completado">Todo entregado</span>`
        }
      </summary>

      <p class="texto-secundario">
        Las fechas liberadas se escriben en la matriz con la siguiente actualización de Excel.
      </p>

      ${
        entregas === undefined
          ? html`<p class="texto-vacio">
              Sin conexión con la base de datos: no hay entregas que seguir.
            </p>`
          : html`
              <p class="acciones-fila">
                <a class="boton-secundario" href="/liberacion?entregas=1#entregas">Actualizar</a>
              </p>
              ${renderTablaDeEntregas(entregas)}
            `
      }
    </details>
  `;
}

function renderTablaDeEntregas(entregas: readonly MatrixDelivery[]): Html {
  if (entregas.length === 0) {
    return html`<p class="texto-vacio">
      Nada liberado sin entregar. Lo entregado y quitado del tablero sigue en
      <a href="/auditoria/liberaciones">auditoría</a>.
    </p>`;
  }

  return html`
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col" class="columna-angosta">Acuse</th>
            <th scope="col">Código</th>
            <th scope="col">Curso</th>
            <th scope="col">Fecha</th>
            <th scope="col">Escritas</th>
            <th scope="col">Liberada</th>
            <th scope="col">Liberó</th>
            <th scope="col">Quitar</th>
          </tr>
        </thead>
        <tbody>
          ${entregas.map(renderEntrega)}
        </tbody>
      </table>
    </div>
    <p class="texto-nota">
      Quitar una entrega confirmada no borra nada: la liberación y su acuse permanecen en
      <a href="/auditoria/liberaciones">auditoría</a>.
    </p>
  `;
}

/**
 * Los tres focos.
 *
 * El color no va solo: el título y el texto para lectores de pantalla dicen lo
 * mismo, porque un punto de color no lo lee quien no distingue los dos tonos ni
 * quien navega con lector.
 */
const FOCOS: Readonly<Record<MatrixDelivery["state"], { clase: string; texto: string }>> = {
  PENDIENTE: { clase: "foco-rojo", texto: "Pendiente de escritura en Excel" },
  CON_CONFLICTO: { clase: "foco-ambar", texto: "Excel no pudo escribirla" },
  ENTREGADA: { clase: "foco-verde", texto: "Escrita en la matriz" },
};

function renderEntrega(entrega: MatrixDelivery): Html {
  const foco = FOCOS[entrega.state];
  const entregada = entrega.state === "ENTREGADA";

  return html`<tr>
    <td class="columna-angosta">
      <span class="foco ${foco.clase}" title="${foco.texto}"></span>
      <span class="solo-lectores">${foco.texto}</span>
    </td>
    <td class="celda-codigo">${entrega.sessionCode}</td>
    <td>${entrega.courseName || "—"}</td>
    <td class="celda-mono">${entrega.sessionDate || "—"}</td>
    <td class="celda-numero">
      ${entrega.delivered} de ${entrega.total}
      ${
        entrega.rejected > 0
          ? html`<br /><span class="texto-secundario">${entrega.rejected} con conflicto</span>${
                entrega.conflictDetail
                  ? html`<br /><span class="texto-secundario">${entrega.conflictDetail}</span>`
                  : ""
              }`
          : ""
      }
    </td>
    <td class="celda-mono">${entrega.releasedAt.slice(0, 16).replace("T", " ")}</td>
    <td>${entrega.releasedBy || "—"}</td>
    <td>
      ${
        entregada
          ? html`<form
              method="post"
              action="/liberacion/entregas/${entrega.batchId}/ocultar"
              class="formulario-en-linea"
            >
              <button
                type="submit"
                class="boton-pequeno boton-icono"
                title="Quitar del tablero. Sigue en auditoría."
                aria-label="Quitar del tablero la entrega ${entrega.sessionCode}"
              >
                ${ICONO_EQUIS}
              </button>
            </form>`
          : html`<span class="texto-atenuado" title="Todavía no la confirma Excel.">—</span>`
      }
    </td>
  </tr>`;
}

/** La equis, en línea: la política de contenido no admite iconos por CDN. */
const ICONO_EQUIS = rawHtml(
  '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5"/></svg>',
);
