/**
 * Las tres pantallas de la auditoría interna.
 *
 * Comparten encabezado y barra de secciones porque son la misma pregunta hecha
 * sobre tres entidades. Lo que no comparten es la ventana, y la pantalla lo
 * dice en cada una: sesiones y salas se miran a ocho días; liberaciones, sin
 * corte, porque son evidencia de lo que entró a la matriz.
 *
 * Ninguna de las tres tiene formularios: aquí no se corrige nada. La auditoría
 * que se puede editar desde la pantalla que la muestra no es auditoría.
 */

import { fechaCorta } from "../kit/fechas.ts";
import type { AppConfig } from "../../config/environment.ts";
import { InternalAuditService } from "../../domain/consola-interna/auditoria.ts";
import type {
  AuditWindow,
  ReleaseAuditRow,
  RoomAuditRow,
  SessionAuditRow,
} from "../../domain/consola-interna/tipos.ts";
import {
  etiquetaDeAuditoria,
  etiquetaDeEstadoDeReservacion,
  etiquetaDeEstadoDeSesion,
} from "../kit/etiquetas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

/** Sin base no hay nada que auditar, y decirlo evita leer el vacío como calma. */
const SIN_BASE = "Sin conexión con la base de datos: no hay registros que consultar.";

function renderVentana(ventana: AuditWindow): Html {
  return html`<p class="texto-nota">
    Últimos ${ventana.days} días: del ${fechaCorta(ventana.from)} al ${fechaCorta(ventana.to)}.
  </p>`;
}

function renderVacio(columnas: number, mensaje: string): Html {
  return html`<tr>
    <td colspan="${columnas}" class="texto-vacio">${mensaje}</td>
  </tr>`;
}

/** Instante ISO recortado a lo que se lee de un vistazo: día y hora local. */
function momento(iso: string | undefined): string {
  if (iso === undefined) return "—";
  return `${fechaCorta(iso.slice(0, 10))} · ${iso.slice(11, 16)}`;
}

// -----------------------------------------------------------------------------
// Sesiones
// -----------------------------------------------------------------------------

export function renderSessionAuditPage(input: {
  readonly config: AppConfig;
  readonly window: AuditWindow;
  readonly rows: readonly SessionAuditRow[];
  readonly sinBase: boolean;
}): string {
  const abiertas = input.rows.filter((fila) => fila.openedAt !== undefined).length;
  const cerradas = input.rows.filter((fila) => fila.closedAt !== undefined).length;

  const contenido = html`<section class="tarjeta">
    <div class="seccion-cabecera">
      <h2>Sesiones creadas, abiertas y cerradas</h2>
      <p>Alta, apertura, cierre y asistencias registradas.</p>
    </div>
    ${renderVentana(input.window)}

    <div class="kpi-tira">
      ${renderKpi("Sesiones con actividad", input.rows.length)} ${renderKpi("Abiertas", abiertas)}
      ${renderKpi("Cerradas", cerradas)}
    </div>

    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th>Código</th>
            <th>Curso</th>
            <th>Instructor</th>
            <th>Fecha</th>
            <th>Estado</th>
            <th>Creada</th>
            <th>Abierta</th>
            <th>Cerrada</th>
            <th>Asistencias</th>
          </tr>
        </thead>
        <tbody>
          ${
            input.rows.length === 0
              ? renderVacio(
                  9,
                  input.sinBase ? SIN_BASE : "Sin sesiones con movimiento en la ventana.",
                )
              : input.rows.map(
                  (fila) =>
                    html`<tr>
                      <td class="celda-mono">${fila.code}</td>
                      <td>${fila.course}</td>
                      <td>${fila.trainer || "—"}</td>
                      <td class="celda-mono">${fila.date}</td>
                      <td>
                        <span class="insignia">${etiquetaDeEstadoDeSesion(fila.state)}</span>
                        ${fila.authorized ? html`<span class="insignia insignia-completado">Autorizada</span>` : ""}
                      </td>
                      <td class="celda-mono">${momento(fila.createdAt)}</td>
                      <td class="celda-mono">${momento(fila.openedAt)}</td>
                      <td class="celda-mono">${momento(fila.closedAt)}</td>
                      <td class="celda-numero">
                        ${fila.attendances}
                        <span class="texto-atenuado">(${fila.released} liberadas)</span>
                      </td>
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>
  </section>`;

  return renderLayout({
    titulo: "Auditoría de sesiones",
    subtitulo: `Creadas, abiertas y cerradas · últimos ${String(input.window.days)} días`,
    rutaActiva: "/auditoria/sesiones",
    entorno: input.config.environment,
    contenido,
  });
}

// -----------------------------------------------------------------------------
// Reservaciones de sala
// -----------------------------------------------------------------------------

export function renderRoomAuditPage(input: {
  readonly config: AppConfig;
  readonly window: AuditWindow;
  readonly rows: readonly RoomAuditRow[];
  readonly sinBase: boolean;
}): string {
  const canceladas = input.rows.filter((fila) => fila.cancelledAt !== undefined).length;

  const contenido = html`<section class="tarjeta">
    <div class="seccion-cabecera">
      <h2>Reservaciones de sala agendadas</h2>
      <p>Solicitante, horario y cancelación.</p>
    </div>
    ${renderVentana(input.window)}

    <div class="kpi-tira">
      ${renderKpi("Reservaciones con movimiento", input.rows.length)}
      ${renderKpi("Vigentes", input.rows.length - canceladas)}
      ${renderKpi("Canceladas", canceladas)}
    </div>

    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th>Sala</th>
            <th>Fecha</th>
            <th>Horario</th>
            <th>Solicitante</th>
            <th>Área</th>
            <th>Estado</th>
            <th>Agendada</th>
            <th>Cancelación</th>
          </tr>
        </thead>
        <tbody>
          ${
            input.rows.length === 0
              ? renderVacio(
                  8,
                  input.sinBase ? SIN_BASE : "Sin reservaciones con movimiento en la ventana.",
                )
              : input.rows.map(
                  (fila) =>
                    html`<tr>
                      <td>${fila.room}</td>
                      <td class="celda-mono">${fila.date}</td>
                      <td class="celda-mono">${fila.startTime}–${fila.endTime}</td>
                      <td>${fila.requesterName || "—"}</td>
                      <td>${fila.requesterArea || "—"}</td>
                      <td>
                        <span
                          class="insignia ${
                            fila.status === "CANCELADA"
                              ? "insignia-inactivo"
                              : "insignia-completado"
                          }"
                          >${etiquetaDeEstadoDeReservacion(fila.status)}</span
                        >
                      </td>
                      <td class="celda-mono">${momento(fila.createdAt)}</td>
                      <td>
                        ${
                          fila.cancelledAt === undefined
                            ? html`<span class="texto-atenuado">—</span>`
                            : html`<span class="celda-mono">${momento(fila.cancelledAt)}</span
                                ><br /><span class="texto-secundario"
                                  >${fila.cancelledBy ?? "sin actor registrado"} ·
                                  ${fila.cancellationReason ?? "sin motivo registrado"}</span
                                >`
                        }
                      </td>
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>
  </section>`;

  return renderLayout({
    titulo: "Auditoría de salas",
    subtitulo: `Agendadas y canceladas · últimos ${String(input.window.days)} días`,
    rutaActiva: "/auditoria/salas",
    entorno: input.config.environment,
    contenido,
  });
}

// -----------------------------------------------------------------------------
// Liberaciones
// -----------------------------------------------------------------------------

export function renderReleaseAuditPage(input: {
  readonly config: AppConfig;
  readonly rows: readonly ReleaseAuditRow[];
  readonly sinBase: boolean;
}): string {
  const sobrescrituras = InternalAuditService.countOverwrites(input.rows);

  const contenido = html`<section class="tarjeta">
    <div class="seccion-cabecera">
      <h2>Liberaciones ejecutadas</h2>
      <p>Trabajador, curso, fecha inscrita y fecha sustituida.</p>
    </div>

    <p class="miga-de-pan">Sin ventana de días: historial completo de liberaciones.</p>

    <div class="kpi-tira">
      ${renderKpi("Efectos listados", input.rows.length)}
      ${renderKpi("Con fecha sustituida", sobrescrituras)}
    </div>

    ${
      sobrescrituras > 0
        ? html`<p class="aviso">
            ${sobrescrituras} efectos sustituyeron una fecha registrada. Cada uno conserva su motivo
            y su actor.
          </p>`
        : ""
    }

    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th>Trabajador</th>
            <th>Curso</th>
            <th>Sesión</th>
            <th>Fecha inscrita</th>
            <th>Fecha sustituida</th>
            <th>Motivo y actor</th>
            <th>Aplicada</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          ${
            input.rows.length === 0
              ? renderVacio(8, input.sinBase ? SIN_BASE : "Sin liberaciones ejecutadas.")
              : input.rows.map(renderLiberacion)
          }
        </tbody>
      </table>
    </div>
  </section>`;

  return renderLayout({
    titulo: "Auditoría de liberaciones",
    subtitulo: "Trabajadores, fechas inscritas y fechas sustituidas",
    rutaActiva: "/auditoria/liberaciones",
    entorno: input.config.environment,
    contenido,
  });
}

/**
 * Un renglón por efecto. Cuando hubo sobrescritura, la fecha anterior se marca
 * como alerta: no es un dato más de la fila, es la excepción que hay que poder
 * ver de reojo al recorrer la lista.
 */
function renderLiberacion(fila: ReleaseAuditRow): Html {
  const sobrescribio = fila.previousDate !== undefined;

  return html`<tr>
    <td>
      <span class="celda-mono">${fila.workerNumber}</span><br />
      <span class="texto-secundario">${fila.workerName}</span>
    </td>
    <td>${fila.course}</td>
    <td class="celda-mono">${fila.sessionCode}</td>
    <td class="celda-mono celda-destacada">${fila.effectiveDate}</td>
    <td class="${sobrescribio ? "celda-mono celda-alerta" : "celda-mono"}">
      ${fila.previousDate ?? "—"}
    </td>
    <td class="celda-motivo">
      ${
        sobrescribio
          ? html`${fila.overwriteReason ?? "sin motivo registrado"}<br /><span
                class="texto-secundario"
                >${fila.overwriteActor ?? "actor no registrado"} ·
                ${momento(fila.overwriteAt)}</span
              >`
          : html`<span class="texto-atenuado">sin sustitución</span>`
      }
    </td>
    <td class="celda-mono">${momento(fila.appliedAt)}</td>
    <td>
      <span class="insignia">${etiquetaDeAuditoria(fila.result)}</span><br />
      <span class="texto-secundario"
        >Liberación ${etiquetaDeAuditoria(fila.batchState).toLocaleLowerCase("es-MX")} ·
        ${fila.releasedBy || "—"}</span
      >
    </td>
  </tr>`;
}

function renderKpi(etiqueta: string, cifra: number): Html {
  return html`<div class="kpi">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${cifra}</span></span>
  </div>`;
}
