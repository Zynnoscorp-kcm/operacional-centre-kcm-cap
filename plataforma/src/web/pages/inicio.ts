import type { AppConfig } from "../../config/environment.ts";
import type { OperativeSessionSummary } from "../../domain/quiosco/tipos.ts";
import type { SessionHeader } from "../../domain/preliberacion/tipos.ts";
import type { RoomReservation } from "../../domain/salas/tipos.ts";
import { ROOMS } from "../../domain/salas/tipos.ts";
import { etiquetaDeEstadoDeSesion } from "../kit/etiquetas.ts";
import { fechaLarga } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderEmergenteDeApagado, renderEmergenteDelAcuse } from "./apagado.ts";
import { renderLayout } from "../layout.ts";

const MAXIMO_DE_FILAS = 6;
const MAXIMO_DE_CERRADAS = 5;

export interface DatosPantallaBase {
  readonly config: AppConfig;
  readonly hoy: string;
  readonly sesiones: readonly OperativeSessionSummary[];
  readonly reservas: readonly RoomReservation[];
  readonly porLiberar: readonly SessionHeader[];
  readonly apagando?: boolean;
  readonly dc3PorEmitir?: number;
}

interface FilaDeCola {
  readonly cuantas: number;
  readonly texto: string;
  readonly pista: string;
  readonly destino: string;
  readonly accion: string;
  readonly tono: string;
}

function renderFilaDeCola(fila: FilaDeCola): Html {
  return html`<li class="cola-fila ${fila.tono}">
    <span class="cola-cifra">${fila.cuantas}</span>
    <span class="cola-texto">
      <strong>${fila.texto}</strong>
      <span class="cola-pista">${fila.pista}</span>
    </span>
    <a class="cola-accion" href="${fila.destino}">${fila.accion}</a>
  </li>`;
}

export function renderHomePage(datos: DatosPantallaBase): string {
  const deHoy = datos.sesiones.filter((sesion) => sesion.date === datos.hoy);
  const abiertas = datos.sesiones.filter((sesion) => sesion.status === "ABIERTA");
  const enPreliberacion = datos.sesiones.filter(
    (sesion) => sesion.status === "CERRADA" || sesion.status === "PRELIBERACION",
  );
  const reservasVivas = datos.reservas.filter((reserva) => reserva.status !== "CANCELADA");

  const cerradas = datos.sesiones
    .filter((sesion) => sesion.status === "CERRADA")
    .sort(
      (izquierda, derecha) =>
        derecha.date.localeCompare(izquierda.date) ||
        derecha.sessionCode.localeCompare(izquierda.sessionCode),
    )
    .slice(0, MAXIMO_DE_CERRADAS);

  const enRevision = datos.sesiones.filter((sesion) => sesion.status === "PRELIBERACION");
  const conError = datos.sesiones.filter((sesion) => sesion.status === "ERROR");

  const cola: readonly FilaDeCola[] = [
    {
      cuantas: abiertas.length,
      texto: "abiertas en la sala",
      pista: "Se cierran desde el quiosco",
      destino: "/sesiones",
      accion: "Ver sesiones",
      tono: "",
    },
    {
      cuantas: cerradas.length,
      texto: "esperan su lista física",
      pista: "Revisar exámenes y cotejar",
      destino: "/preliberacion",
      accion: "Revisar",
      tono: "cola-toca",
    },
    {
      cuantas: enRevision.length,
      texto: "en revisión",
      pista: "Preliberación empezada y sin terminar",
      destino: "/preliberacion",
      accion: "Continuar",
      tono: "cola-toca",
    },
    {
      cuantas: datos.porLiberar.length,
      texto: "listas para liberar",
      pista: "Revisión concluida",
      destino: "/liberacion",
      accion: "Liberar",
      tono: "cola-toca",
    },
    {
      cuantas: conError.length,
      texto: "con error",
      pista: "No avanzan solas",
      destino: "/sesiones",
      accion: "Atender",
      tono: "cola-alto",
    },
    {
      cuantas: datos.dc3PorEmitir ?? 0,
      texto: "constancias DC-3 por emitir",
      pista: "Cursos desde el 1 de enero de 2026",
      destino: "/dc3",
      accion: "Emitir",
      tono: "cola-toca",
    },
  ].filter((fila) => fila.cuantas > 0);

  const contenido = html`
    ${datos.apagando === true && datos.config.role === "local" ? renderEmergenteDelAcuse() : ""}
    ${
      datos.config.role !== "local"
        ? ""
        : datos.apagando === true
          ? html`<section class="tarjeta" aria-labelledby="titulo-energia">
              <div class="seccion-cabecera">
                <h2 id="titulo-energia">Esta computadora</h2>
              </div>
              <p class="energia-estado">
                <span class="energia-punto energia-punto-apagado" aria-hidden="true"></span>
                Servidor local apagado
              </p>
              <p class="texto-nota">
                Se enciende con <strong>Encender KCM</strong>, en el Escritorio.
              </p>
            </section>`
          : html`<section class="tarjeta" aria-labelledby="titulo-energia">
                <div class="seccion-cabecera">
                  <h2 id="titulo-energia">Esta computadora</h2>
                </div>
                <p class="energia-estado">
                  <span class="energia-punto" aria-hidden="true"></span>
                  Plataforma encendida
                </p>
                <p class="texto-nota">
                  Recibe el barrido de la matriz y el padrón enviados desde Excel.
                </p>
                <p class="acciones-fila">
                  <a class="boton-peligro energia-boton" href="#apagar">Apagar la plataforma</a>
                </p>
              </section>
              ${renderEmergenteDeApagado()}`
    }

    <section class="tarjeta" aria-labelledby="titulo-cola">
      <div class="seccion-cabecera">
        <h2 id="titulo-cola">Lo que toca ahora</h2>
      </div>
      ${
        cola.length > 0
          ? html`<ul class="cola">
              ${cola.map(renderFilaDeCola)}
            </ul>`
          : html`<p class="texto-vacio">Nada pendiente.</p>`
      }
    </section>

    <dl class="kpi-tira">
      ${renderIndicador("Sesiones de hoy", deHoy.length, "sesiones", "kpi-texto", "Agendadas para hoy")}
      ${renderIndicador("Sesiones abiertas", abiertas.length, "sesiones", "kpi-ok", "Registro de asistencia en curso")}
      ${renderIndicador("Salas ocupadas", reservasVivas.length, "reservaciones", "kpi-texto", "Reservaciones de hoy")}
      ${renderIndicador("Pendientes de liberación", datos.porLiberar.length, "sesiones", datos.porLiberar.length > 0 ? "kpi-aviso" : "kpi-texto", "Con la revisión concluida")}
    </dl>

    <div class="tablero-columnas">
      <div class="tablero-pila">
        <section class="tarjeta" aria-labelledby="titulo-sesiones-hoy">
          <div class="seccion-cabecera cabecera-fila">
            <div>
              <h2 id="titulo-sesiones-hoy">Sesiones de hoy</h2>
              <p>Programadas para hoy</p>
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
    subtitulo: `Resumen del día · ${fechaLarga(datos.hoy)}`,
    entorno: datos.config.environment,
    papel: datos.config.role,
    contenido,
    rutaActiva: "/",
    ...(datos.apagando === true ? {} : { recargaCada: 30 }),
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

function renderSiguientePaso(porLiberar: number, enPreliberacion: number, abiertas: number): Html {
  const paso =
    porLiberar > 0
      ? {
          rotulo: "Pendiente",
          titulo: `${String(porLiberar)} ${porLiberar === 1 ? "sesión lista" : "sesiones listas"} para liberar`,
          texto: "Con la revisión concluida, listas para escribirse en la matriz.",
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
              texto: "Ninguna sesión abierta ni liberación pendiente.",
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
