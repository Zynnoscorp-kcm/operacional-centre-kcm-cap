/**
 * Inicio.
 *
 * Dejó de ser un índice. Era una retícula con las diez funciones de la
 * plataforma en recuadros y su disponibilidad al lado: un menú dibujado por
 * segunda vez, porque el lateral ya lleva a los mismos sitios, y una lista de
 * estados que hablaba del avance del proyecto y no del trabajo del día.
 *
 * Ahora es lo que se mira al llegar: qué sesiones hay hoy, cuáles siguen
 * abiertas, qué salas están tomadas y qué está esperando a que alguien la
 * libere. Todo sale de los servicios que la consola ya tiene; con repositorios
 * en memoria las cifras salen en cero, que es la verdad de esa corrida.
 *
 * Sigue sin haber aquí un solo dato de persona ni porcentaje alguno: los de DNC
 * no se publican hasta que estén aprobados los alias, la cobertura de
 * poblaciones y la vigencia por curso.
 */

import type { AppConfig } from "../../config/environment.ts";
import type { OperativeSessionSummary } from "../../domain/quiosco/tipos.ts";
import type { SessionHeader } from "../../domain/preliberacion/tipos.ts";
import type { RoomReservation } from "../../domain/salas/tipos.ts";
import { ROOMS } from "../../domain/salas/tipos.ts";
import { etiquetaDeEstadoDeSesion } from "../kit/etiquetas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

/** Cuántas filas caben en una tarjeta del tablero sin volverla una tabla. */
const MAXIMO_DE_FILAS = 6;
/** Una vista previa, no un historial: para eso está la auditoría de sesiones. */
const MAXIMO_DE_CERRADAS = 5;

export interface DatosPantallaBase {
  readonly config: AppConfig;
  /** Fecha de la planta en `YYYY-MM-DD`, no la del proceso. */
  readonly hoy: string;
  /** Sesiones operativas de la ventana corta, tal como las lista `/sesiones`. */
  readonly sesiones: readonly OperativeSessionSummary[];
  /** Reservaciones de hoy, tal como las lista `/salas`. */
  readonly reservas: readonly RoomReservation[];
  /** Sesiones en la bandeja de liberación. */
  readonly porLiberar: readonly SessionHeader[];
}

export function renderHomePage(datos: DatosPantallaBase): string {
  const deHoy = datos.sesiones.filter((sesion) => sesion.date === datos.hoy);
  const abiertas = datos.sesiones.filter((sesion) => sesion.status === "ABIERTA");
  const enPreliberacion = datos.sesiones.filter(
    (sesion) => sesion.status === "CERRADA" || sesion.status === "PRELIBERACION",
  );
  const reservasVivas = datos.reservas.filter((reserva) => reserva.status !== "CANCELADA");

  /*
   * Cerradas recientemente. Responde «¿ya cerró la sala?» sin ir a preguntar:
   * el instructor cierra desde el quiosco y aquí se ve. Van las más recientes
   * primero —la ventana operativa ya viene acotada a catorce días— y son
   * exactamente las que esperan preliberación.
   */
  const cerradas = datos.sesiones
    .filter((sesion) => sesion.status === "CERRADA")
    .sort(
      (izquierda, derecha) =>
        derecha.date.localeCompare(izquierda.date) ||
        derecha.sessionCode.localeCompare(izquierda.sessionCode),
    )
    .slice(0, MAXIMO_DE_CERRADAS);

  const contenido = html`
    <dl class="kpi-tira">
      ${renderIndicador("Sesiones de hoy", deHoy.length, "sesiones", "kpi-texto", "Fecha de planta")}
      ${renderIndicador("Sesiones abiertas", abiertas.length, "sesiones", "kpi-ok", "Registro de asistencia en curso")}
      ${renderIndicador("Salas ocupadas", reservasVivas.length, "reservaciones", "kpi-texto", "Reservaciones vigentes")}
      ${renderIndicador("Pendientes de liberación", datos.porLiberar.length, "sesiones", datos.porLiberar.length > 0 ? "kpi-aviso" : "kpi-texto", "Revisión concluida")}
    </dl>

    <div class="tablero-columnas">
      <div class="tablero-pila">
        <section class="tarjeta" aria-labelledby="titulo-sesiones-hoy">
          <div class="seccion-cabecera cabecera-fila">
            <div>
              <h2 id="titulo-sesiones-hoy">Sesiones de hoy</h2>
              <p>Programadas para ${datos.hoy}</p>
            </div>
            <a class="enlace-seccion" href="/sesiones">Ver sesiones</a>
          </div>
          ${
            deHoy.length > 0
              ? html`<ul class="lista-tablero">
                  ${deHoy.slice(0, MAXIMO_DE_FILAS).map(renderSesion)}
                </ul>`
              : html`<p class="texto-vacio">Sin sesiones agendadas para hoy.</p>`
          }
        </section>

        <section class="tarjeta" aria-labelledby="titulo-cerradas">
          <div class="seccion-cabecera cabecera-fila">
            <div>
              <h2 id="titulo-cerradas">Sesiones cerradas</h2>
              <p>Pendientes de preliberación</p>
            </div>
            <a class="enlace-seccion" href="/preliberacion">Ver preliberación</a>
          </div>
          ${
            cerradas.length > 0
              ? html`<ul class="lista-tablero">
                  ${cerradas.map(renderCerrada)}
                </ul>`
              : html`<p class="texto-vacio">Sin sesiones cerradas.</p>`
          }
        </section>
      </div>

      <div class="tablero-pila">
        ${renderSiguientePaso(datos.porLiberar.length, enPreliberacion.length, abiertas.length)}

        <section class="tarjeta" aria-labelledby="titulo-salas-hoy">
          <div class="seccion-cabecera cabecera-fila">
            <div><h2 id="titulo-salas-hoy">Salas de hoy</h2></div>
            <a class="enlace-seccion" href="/salas">Ver salas</a>
          </div>
          ${
            reservasVivas.length > 0
              ? html`<ul class="lista-tablero">
                  ${reservasVivas.slice(0, MAXIMO_DE_FILAS).map(renderReserva)}
                </ul>`
              : html`<p class="texto-vacio">Sin reservaciones para hoy.</p>`
          }
        </section>

        <section class="tarjeta" aria-labelledby="titulo-por-liberar">
          <div class="seccion-cabecera cabecera-fila">
            <div><h2 id="titulo-por-liberar">Pendientes de liberación</h2></div>
            <a class="enlace-seccion" href="/liberacion">Ver liberación</a>
          </div>
          ${
            datos.porLiberar.length > 0
              ? html`<ul class="lista-tablero">
                  ${datos.porLiberar.slice(0, MAXIMO_DE_FILAS).map(renderPorLiberar)}
                </ul>`
              : html`<p class="texto-vacio">Sin pendientes de liberación.</p>`
          }
        </section>
      </div>
    </div>
  `;

  return renderLayout({
    titulo: "Inicio",
    subtitulo: `Resumen operativo · ${datos.hoy}`,
    entorno: datos.config.environment,
    contenido,
    rutaActiva: "/",
    // Medio minuto. Es lo que hace que cerrar en la sala se vea aquí sin que
    // nadie recargue: Inicio no tiene un solo campo que se pueda perder.
    recargaCada: 30,
  });
}

function renderIndicador(
  etiqueta: string,
  cifra: number,
  unidad: string,
  clase: string,
  pista: string,
): Html {
  return html`<div class="kpi ${clase}">
    <dt class="kpi-etiqueta">${etiqueta}</dt>
    <dd class="kpi-dato">
      <span class="kpi-cifra">${cifra}</span>
      <span class="kpi-unidad">${unidad}</span>
    </dd>
    <p class="kpi-pista">${pista}</p>
  </div>`;
}

/**
 * La única superficie azul del tablero. Lleva lo que toca hacer a continuación
 * —lo que hay más avanzado en el flujo y sigue esperando a alguien— y no un
 * dato más: si todo fuera azul, nada lo sería.
 */
function renderSiguientePaso(porLiberar: number, enPreliberacion: number, abiertas: number): Html {
  const paso =
    porLiberar > 0
      ? {
          rotulo: "Pendiente",
          titulo: `${String(porLiberar)} ${porLiberar === 1 ? "sesión lista" : "sesiones listas"} para liberar`,
          texto: "Revisión previa del lote antes de escribir en la matriz.",
          accion: { nombre: "Ir a liberación", href: "/liberacion" },
        }
      : enPreliberacion > 0
        ? {
            rotulo: "Pendiente",
            titulo: `${String(enPreliberacion)} ${enPreliberacion === 1 ? "sesión" : "sesiones"} en revisión`,
            texto: "Cotejo de padrón, exámenes y exclusiones.",
            accion: { nombre: "Ir a preliberación", href: "/preliberacion" },
          }
        : abiertas > 0
          ? {
              rotulo: "En curso",
              titulo: `${String(abiertas)} ${abiertas === 1 ? "sesión abierta" : "sesiones abiertas"}`,
              texto: "Registro de asistencia en sala.",
              accion: { nombre: "Ir a sesiones", href: "/sesiones" },
            }
          : {
              rotulo: "Estado",
              titulo: "Sin pendientes",
              texto: "Ninguna sesión abierta ni lote en espera.",
              accion: { nombre: "Crear sesión", href: "/sesiones" },
            };

  return html`<div class="destacado">
    <span class="destacado-halo" aria-hidden="true"></span>
    <span class="destacado-rotulo">${paso.rotulo}</span>
    <h2 class="destacado-titulo">${paso.titulo}</h2>
    <p class="destacado-texto">${paso.texto}</p>
    <div class="destacado-acciones">
      <a class="destacado-boton" href="${paso.accion.href}">${paso.accion.nombre}</a>
      <a class="destacado-boton" href="/salas">Reservar sala</a>
    </div>
  </div>`;
}

function renderSesion(sesion: OperativeSessionSummary): Html {
  return html`<li class="lista-fila">
    <span class="lista-sello" aria-hidden="true">${sesion.startTime || "—"}</span>
    <span class="lista-cuerpo">
      <span class="lista-titulo">${sesion.trainingName}</span>
      <span class="lista-pista">${sesion.sessionCode} · ${sesion.durationMinutes} min</span>
    </span>
    <span class="insignia ${insigniaDeSesion(sesion.status)}"
      >${etiquetaDeEstadoDeSesion(sesion.status)}</span
    >
  </li>`;
}

function insigniaDeSesion(estado: string): string {
  if (estado === "ABIERTA") return "insignia-activo";
  if (estado === "LIBERADA_TOTAL") return "insignia-completado";
  if (estado === "CANCELADA" || estado === "ERROR") return "insignia-inactivo";
  return "insignia-pendiente";
}

/**
 * Una reservación por renglón, con la sala y el horario y nada más. Quién la
 * pidió está en `/salas`; el tablero no necesita nombres para decir que la sala
 * está tomada.
 */
/**
 * Una sesión cerrada. Lleva las asistencias porque es el dato con el que se
 * decide si vale la pena entrar a preliberarla ahora o esperar.
 */
function renderCerrada(sesion: OperativeSessionSummary): Html {
  return html`<li class="lista-fila">
    <span class="lista-cuerpo">
      <span class="lista-titulo">${sesion.trainingName}</span>
      <span class="lista-pista">${sesion.sessionCode} · ${sesion.date}</span>
    </span>
    <span class="insignia insignia-pendiente"
      >${sesion.totalAttendances}
      ${sesion.totalAttendances === 1 ? "asistencia" : "asistencias"}</span
    >
  </li>`;
}

function renderReserva(reserva: RoomReservation): Html {
  const sala = ROOMS.find((room) => room.roomId === reserva.roomId)?.name ?? reserva.roomId;
  return html`<li class="lista-fila">
    <span class="lista-cuerpo">
      <span class="lista-titulo">${sala}</span>
      <span class="lista-pista">${reserva.startTime}–${reserva.endTime}</span>
    </span>
  </li>`;
}

function renderPorLiberar(sesion: SessionHeader): Html {
  return html`<li class="lista-fila">
    <span class="lista-cuerpo">
      <span class="lista-titulo">${sesion.trainingName}</span>
      <span class="lista-pista">${sesion.sessionCode} · ${sesion.date}</span>
    </span>
  </li>`;
}
