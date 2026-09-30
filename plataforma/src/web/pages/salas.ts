import type { AppConfig } from "../../config/environment.ts";
import type { AuditEventRecord } from "../../domain/quiosco/tipos.ts";
import type { RoomReservation } from "../../domain/salas/tipos.ts";
import { ROOMS } from "../../domain/salas/tipos.ts";
import { etiquetaDeAuditoria, etiquetaDeEstadoDeReservacion } from "../kit/etiquetas.ts";
import { fechaCorta } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export function renderRoomsPage(input: {
  readonly config: AppConfig;
  readonly date: string;
  readonly reservations: readonly RoomReservation[];
  readonly notice?: string;
  readonly error?: string;
  readonly requiereClave?: boolean;
}): string {
  const content = html` <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Reservaciones del día</h2>
        <p>Bloques de 30 minutos, sin traslapes.</p>
      </div>
      ${input.notice ? html`<p class="aviso">${input.notice}</p>` : false}
      ${input.error ? html`<p class="aviso-error" role="alert">${input.error}</p>` : false}
      <form method="get" action="/salas" class="formulario">
        <label>Fecha <input type="date" name="date" value="${input.date}" required /></label
        ><button type="submit">Consultar</button>
      </form>
      <div class="tabla-contenedor">
        <table>
          <thead>
            <tr>
              <th>Sala</th>
              <th>Horario</th>
              <th>Estado</th>
              <th>Solicitante</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${
              input.reservations.length
                ? input.reservations.map((row) =>
                    renderReservacion(row, input.date, input.requiereClave ?? false),
                  )
                : html`<tr>
                    <td colspan="5">Sin reservaciones para esta fecha.</td>
                  </tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
    <section class="tarjeta">
      <h2>Nueva reservación</h2>
      <form method="post" action="/api/rooms/reservations" class="formulario">
        <input type="hidden" name="requestId" value="room-web-${Date.now()}" />
        <label
          >Sala
          <select name="roomId" required>
            ${ROOMS.map((room) => html`<option value="${room.roomId}">${room.name}</option>`)}
          </select></label
        >
        <label>Fecha <input type="date" name="date" value="${input.date}" required /></label>
        <label>Inicio <input type="time" name="startTime" step="1800" required /></label>
        <label>Fin <input type="time" name="endTime" step="1800" required /></label>
        <label>Nombre <input name="requesterName" maxlength="160" required /></label>
        <label>Puesto <input name="requesterPosition" maxlength="160" /></label>
        <label>Área <input name="requesterArea" maxlength="160" /></label>
        <label>Motivo <textarea name="reason" maxlength="300" required></textarea></label>
        ${
          input.requiereClave
            ? html`<label
                >Contraseña de agenda <input name="clave" type="password" maxlength="120" required
              /></label>`
            : false
        }
        <label
          >Asistentes estimados
          <input type="number" name="estimatedAttendees" min="1" value="1" required
        /></label>
        <button type="submit">Reservar</button>
      </form>
    </section>`;
  return renderLayout({
    titulo: "Agenda de salas",
    rutaActiva: "/salas",
    subtitulo: "Disponibilidad y reservaciones",
    entorno: input.config.environment,
    contenido: content,
  });
}

/**
 * Una reservación por renglón, con su formulario de cancelación al lado.
 *
 * Cancelar borra el horario de alguien más desde una pantalla que está abierta
 * a quien pase enfrente, así que pide la misma contraseña de agenda que agendar
 * y no una confirmación a secas. El motivo viaja con un valor por omisión
 * porque el dominio lo exige y sin él cancelar fallaría por un campo vacío.
 */
function renderReservacion(row: RoomReservation, date: string, requiereClave: boolean): Html {
  const sala = ROOMS.find((room) => room.roomId === row.roomId)?.name ?? row.roomId;
  const cancelada = row.status === "CANCELADA";

  return html`<tr>
    <td>${sala}</td>
    <td class="celda-mono">${row.startTime}–${row.endTime}</td>
    <td>
      <span class="insignia ${cancelada ? "insignia-inactivo" : "insignia-completado"}"
        >${etiquetaDeEstadoDeReservacion(row.status)}</span
      >
    </td>
    <td>${row.requesterName || "—"}</td>
    <td>
      ${
        cancelada
          ? html`<span class="texto-atenuado">—</span>`
          : html`<form
              method="post"
              action="/api/rooms/reservations/${row.reservationId}/cancel"
              class="formulario-cancelar"
            >
              <input type="hidden" name="date" value="${date}" />
              <input type="hidden" name="reason" value="Cancelada desde la agenda" />
              ${
                requiereClave
                  ? html`<input
                      name="clave"
                      type="password"
                      maxlength="120"
                      required
                      aria-label="Contraseña de agenda"
                      placeholder="Contraseña de agenda"
                    />`
                  : false
              }
              <button class="boton-pequeno" type="submit">Cancelar reservación</button>
            </form>`
      }
    </td>
  </tr>`;
}

export function renderAuditPage(input: {
  readonly config: AppConfig;
  readonly events: readonly AuditEventRecord[];
}): string {
  const content = html`<section class="tarjeta">
    <div class="seccion-cabecera">
      <h2>Auditoría operativa</h2>
      <p>Quién hizo qué, sobre qué registro y cuándo. No se edita ni se borra.</p>
    </div>
    <div class="tabla-contenedor">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Quién</th>
            <th>Registro</th>
            <th>Acción</th>
            <th>Cambio</th>
            <th>Motivo</th>
            <th>Solicitud</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody>
          ${
            input.events.length
              ? input.events.map(
                  (event) =>
                    html`<tr>
                      <td class="celda-fecha">
                        ${fechaCorta(event.occurredAt)} · ${event.occurredAt.slice(11, 16)}
                      </td>
                      <td>
                        ${event.actor}
                        <span class="persona-meta">${etiquetaDeAuditoria(event.role)}</span>
                      </td>
                      <td>
                        ${etiquetaDeAuditoria(event.entityType)}
                        <span class="persona-meta celda-mono">${event.entityId}</span>
                      </td>
                      <td>${etiquetaDeAuditoria(event.action)}</td>
                      <td>
                        ${etiquetaDeAuditoria(event.previousState)} →
                        ${etiquetaDeAuditoria(event.newState)}
                      </td>
                      <td>${event.reason ?? "—"}</td>
                      <td class="celda-mono">${event.requestId ?? "—"}</td>
                      <td>${etiquetaDeAuditoria(event.provenance)}</td>
                    </tr>`,
                )
              : html`<tr>
                  <td colspan="8">Sin eventos registrados.</td>
                </tr>`
          }
        </tbody>
      </table>
    </div>
  </section>`;
  return renderLayout({
    titulo: "Auditoría",
    rutaActiva: "/auditoria",
    subtitulo: "Registro permanente de la operación",
    entorno: input.config.environment,
    contenido: content,
  });
}
