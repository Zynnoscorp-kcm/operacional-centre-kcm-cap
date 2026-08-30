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
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface ReleasePageProps {
  readonly entorno: EnvironmentName;
  readonly preview?: ReleasePreview;
  /** Clave idempotente entregada por el servidor para confirmar o reanudar. */
  readonly requestId?: string;
  /** Sesiones que superaron preliberación y esperan la confirmación de liberar. */
  readonly sessions?: readonly SessionHeader[];
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
  ATOMIC_BATCH_ABORTED: "No intentada (lote abortado)",
  EMPLOYEE_NOT_FOUND: "Trabajador ausente de la matriz",
  COURSE_NOT_FOUND: "Curso ausente del catálogo",
  EXISTING_VALUE_CONFLICT: "La celda ya tiene un valor",
  OVERWRITE_NOT_ALLOWED: "El destino no admite sobrescritura",
  OVERWRITE_REASON_REQUIRED: "Motivo no declarado",
  IDEMPOTENCY_CONFLICT: "Conflicto de clave idempotente",
};

function etiqueta(estado: string): string {
  return ETIQUETAS_DE_ESTADO[estado] ?? estado;
}

export function renderReleasePage(props: ReleasePageProps): string {
  const contenido = props.preview
    ? renderPreview(props.preview, props.requestId)
    : renderBandeja(props.sessions ?? [], props.mensaje, props.aviso);

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
          <h2 id="preflight-titulo">Validación previa · sesión ${preview.sessionId}</h2>
          <p class="texto-secundario">
            Fecha a escribir: ${preview.completionDate} · Destino
            ${preview.mapping.destinationName}, hoja ${preview.mapping.destinationSheet}, columna
            ${preview.mapping.destinationColumn} · Versión de mapeo
            ${preview.mapping.mappingVersion}
          </p>
        </div>
        <span class="insignia">${preview.mapping.overwritePolicy}</span>
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
              El lote sobrescribiría ${sobrescrituras} fecha(s) ya registradas. El motivo es
              obligatorio y queda en el historial con el valor anterior.
            </p>`
          : ""
      }
      ${
        !preview.atomicBatchReady && !preview.overwriteRequiresReason
          ? html`<p class="aviso aviso-error">
              El lote no puede aplicarse: hay conflictos pendientes. La liberación es atómica y no
              escribe ninguna fila.
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
        />
        <button
          type="submit"
          class="boton boton-primario"
          ${preview.counts.included === 0 ? "disabled" : ""}
        >
          Liberar ${preview.counts.included} registro(s)
        </button>
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
          Registros que entran al lote
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
          Registros fuera del lote
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
