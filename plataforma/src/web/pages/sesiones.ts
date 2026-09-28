/**
 * Pantalla Web de Sesiones Operativas (Funciones 2 y 3).
 * Muestra sesiones activas y recientemente cerradas (últimos 14 días) con auditoría y creación de sesiones.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import type { OperativeSessionSummary, TrainingCatalogItem } from "../../domain/quiosco/tipos.ts";
import { ROOMS } from "../../domain/salas/tipos.ts";
import { etiquetaDeEstadoDeSesion } from "../kit/etiquetas.ts";
import { fechaCorta } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";
import { horasDeLaJornada } from "../kit/horarios.ts";

export interface SessionsPageProps {
  readonly entorno: EnvironmentName;
  readonly sessions: readonly OperativeSessionSummary[];
  readonly trainings: readonly TrainingCatalogItem[];
  readonly cutoffDate: string;
  /**
   * Si la autorización pide PIN. Dibujar un campo `required` que el servidor ya
   * no comprueba impediría enviar el formulario sin razón; no dibujarlo cuando
   * sí se comprueba deja el botón inservible. Manda el servidor.
   */
  readonly pidePin?: boolean;
  /** Acuse de una creación reciente, ya redactado por la ruta. */
  readonly aviso?: string | undefined;
  readonly error?: string | undefined;
}

export function renderSessionsPage(props: SessionsPageProps): string {
  const contenido = html`
    ${props.aviso ? html`<p class="aviso">${props.aviso}</p>` : ""}
    ${props.error ? html`<p class="aviso-error" role="alert">${props.error}</p>` : ""}

    <section class="tarjeta" aria-labelledby="sesiones-titulo">
      <div class="seccion-cabecera cabecera-fila">
        <div>
          <h2 id="sesiones-titulo">Sesiones operativas</h2>
          <p class="texto-secundario">
            Activas y cerradas desde el ${fechaCorta(props.cutoffDate)}
          </p>
        </div>
        <div>
          <a href="#crear-sesion" class="boton boton-primario">Nueva sesión</a>
          <a href="/quiosco" class="boton boton-secundario">Abrir quiosco</a>
        </div>
      </div>

      <div class="tabla-contenedor">
        <table class="tabla-sesiones">
          <thead>
            <tr>
              <th>Código</th>
              <th>Curso</th>
              <th>Instructor</th>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Duración</th>
              <th>Asistencias</th>
              <th>Estado</th>
              <th class="columna-angosta">Autorizada</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${
              props.sessions.length > 0
                ? props.sessions.map((s) => renderFilaSesion(s, props.pidePin ?? true))
                : html`
                    <tr>
                      <td colspan="10" class="texto-centro">
                        Sin sesiones operativas en la ventana consultada.
                      </td>
                    </tr>
                  `
            }
          </tbody>
        </table>
      </div>
    </section>

    <section id="crear-sesion" class="tarjeta" aria-labelledby="crear-titulo">
      <h3 id="crear-titulo">Nueva sesión</h3>
      <p class="texto-secundario">
        La sesión se crea como borrador y se abre cuando empieza el registro de asistencia.
      </p>

      <form method="POST" action="/api/sessions" class="formulario-sesion">
        <div class="grupo-campo">
          <label for="trainingId">Curso *</label>
          <select id="trainingId" name="trainingId" required class="control-formulario">
            <option value="">Seleccionar curso del catálogo</option>
            ${props.trainings.map((t) => html`<option value="${t.trainingId}">${t.name}</option>`)}
          </select>
        </div>

        <div class="fila-campos">
          <div class="grupo-campo">
            <label for="date">Fecha *</label>
            <input
              type="date"
              id="date"
              name="date"
              required
              class="control-formulario"
              value="${new Date().toISOString().slice(0, 10)}"
            />
          </div>

          <div class="grupo-campo">
            <label for="durationMinutes">Duración en minutos *</label>
            <input
              type="number"
              id="durationMinutes"
              name="durationMinutes"
              min="1"
              max="1440"
              value="60"
              required
              class="control-formulario"
            />
          </div>
        </div>

        <div class="fila-campos">
          <div class="grupo-campo">
            <label for="instructor">Instructor *</label>
            <input
              type="text"
              id="instructor"
              name="instructor"
              placeholder="Nombre del instructor"
              required
              class="control-formulario"
            />
          </div>

          <div class="grupo-campo">
            <label for="roomId">Sala</label>
            <select id="roomId" name="roomId" class="control-formulario">
              <option value="">Sin sala asignada</option>
              ${ROOMS.map((sala) => html`<option value="${sala.roomId}">${sala.name}</option>`)}
            </select>
          </div>
        </div>

        <div class="fila-campos">
          <div class="grupo-campo">
            <!--
              Un desplegable y no un campo de hora libre: son exactamente los
              mismos bloques que ofrece la agenda pública, de media hora, así que
              la sesión y la reservación de sala caen siempre en el mismo
              horario. Escribiéndolo a mano se podía teclear 09:10, que la
              reservación tenía que redondear.
            -->
            <label for="startTime">Hora de inicio</label>
            <select id="startTime" name="startTime" class="control-formulario">
              <option value="">Sin hora definida</option>
              ${horasDeLaJornada().map((hora) => html`<option value="${hora}">${hora}</option>`)}
            </select>
          </div>

          <div class="grupo-campo">
            <label for="estimatedAttendees">Asistentes estimados</label>
            <input
              type="number"
              id="estimatedAttendees"
              name="estimatedAttendees"
              min="1"
              max="40"
              value="1"
              class="control-formulario"
            />
          </div>

          <div class="grupo-campo">
            <label for="eventType">Tipo de evento</label>
            <input
              type="text"
              id="eventType"
              name="eventType"
              value="Capacitacion"
              class="control-formulario"
            />
          </div>
        </div>

        <p class="help">
          La sala seleccionada se aparta en la agenda por la duración de la sesión, redondeada a
          bloques de 30 minutos. Sin sala, la sesión no ocupa agenda.
        </p>

        <div class="acciones-formulario">
          <button type="submit" class="boton boton-primario">Crear sesión</button>
        </div>
      </form>
    </section>
  `;

  return renderLayout({
    titulo: "Sesiones",
    rutaActiva: "/sesiones",
    subtitulo: "Alta, apertura y cierre de sesiones",
    entorno: props.entorno,
    contenido,
  });
}

function renderFilaSesion(s: OperativeSessionSummary, pidePin: boolean): Html {
  const insigniaClase =
    s.status === "ABIERTA"
      ? "insignia-activo"
      : s.status === "CERRADA"
        ? "insignia-inactivo"
        : "insignia-pendiente";
  const puedeAutorizarse = [
    "BORRADOR",
    "ABIERTA",
    "CERRADA",
    "PRELIBERACION",
    "LISTA_PARA_LIBERAR",
    "LIBERADA_PARCIAL",
  ].includes(s.status);

  return html`
    <tr>
      <td><strong>${s.sessionCode}</strong></td>
      <td>${s.trainingName}</td>
      <td>${s.instructor}</td>
      <td class="celda-fecha">${fechaCorta(s.date)}</td>
      <td class="celda-mono">${s.startTime || "—"}</td>
      <td>${s.durationMinutes} min</td>
      <td><strong>${s.totalAttendances}</strong> / 40</td>
      <td><span class="insignia ${insigniaClase}">${etiquetaDeEstadoDeSesion(s.status)}</span></td>
      <td class="columna-angosta">
        ${
          s.authorized
            ? html`<span class="punto-estado punto-si" title="Autorizada"></span
                ><span class="solo-lectores">Autorizada</span>`
            : html`<span class="punto-estado punto-no" title="Sin autorizar"></span
                ><span class="solo-lectores">Sin autorizar</span>`
        }
      </td>
      <td>
        <div class="acciones-fila">
          ${
            !s.authorized && puedeAutorizarse
              ? html`
                  <form
                    method="POST"
                    action="/api/sessions/${s.sessionId}/authorize"
                    class="formulario-en-linea"
                  >
                    <input type="hidden" name="reason" value="Autorización con PIN" />
                    ${
                      pidePin
                        ? html`<label class="solo-lectores" for="pin-${s.sessionId}"
                              >PIN de autorización</label
                            ><input
                              id="pin-${s.sessionId}"
                              name="pin"
                              type="password"
                              class="campo-pin"
                              minlength="3"
                              maxlength="32"
                              autocomplete="one-time-code"
                              placeholder="PIN de autorización"
                              required
                            />`
                        : ""
                    }
                    <button type="submit" class="boton-pequeno boton-exito">Autorizar</button>
                  </form>
                `
              : ""
          }
          ${
            s.status === "ABIERTA"
              ? html`
                  <form
                    method="POST"
                    action="/api/sessions/${s.sessionId}/close"
                    class="formulario-en-linea"
                  >
                    <button type="submit" class="boton-pequeno boton-advertencia">Cerrar</button>
                  </form>
                `
              : ""
          }
          ${
            s.status === "BORRADOR"
              ? html`
                  <form
                    method="POST"
                    action="/api/sessions/${s.sessionId}/open"
                    class="formulario-en-linea"
                  >
                    <button type="submit" class="boton-pequeno boton-exito">Abrir</button>
                  </form>
                `
              : ""
          }
        </div>
      </td>
    </tr>
  `;
}
