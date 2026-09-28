/**
 * Agenda pública de salas.
 *
 * Es la pantalla que usa quien imparte
 * desde fuera del departamento para ver qué sala está libre y apartarla. Como
 * el quiosco, no vive dentro de la consola: no lleva rail ni encabezado de
 * plataforma, porque quien entra aquí no administra nada, sólo reserva.
 *
 * Lo único que cambia respecto del original es cómo se elige un bloque. Allá,
 * al oprimir un horario, un script llenaba el formulario de la derecha; aquí no
 * hay scripts —la política declara `default-src 'none'`—, así que cada bloque
 * libre es un enlace que vuelve a pedir la página con la sala y la hora ya
 * escogidas, y el servidor devuelve el formulario lleno. Se gasta un viaje al
 * servidor y se gana que funcione sin JavaScript.
 *
 * Por lo mismo no hay refresco automático cada quince segundos: recargar sola
 * la página borraría lo que alguien estuviera escribiendo en el formulario. La
 * disponibilidad se actualiza al consultar, y el pie lo dice.
 */

import { guionHaces, hojaDeEstilos, simboloKcm } from "../estaticos.ts";
import { html, renderDocument, type Html } from "../kit/html.ts";
import { ROOMS, type PublicRoomOccupancy } from "../../domain/salas/tipos.ts";
import { claseDeSala } from "../kit/marca-de-sala.ts";
import { BLOQUE_EN_MINUTOS, FIN_DE_JORNADA, INICIO_DE_JORNADA, comoHora } from "../kit/horarios.ts";

/** La jornada y el bloque canónicos del dominio de salas. */

export interface DatosAgenda {
  /** Fecha consultada, en ISO corto. */
  readonly fecha: string;
  /** Sólo sala y horario ocupado: la agenda pública no publica identidades. */
  readonly ocupacion: readonly PublicRoomOccupancy[];
  /** Momento actual en la planta, para atenuar los bloques que ya pasaron. */
  readonly ahora: { readonly fecha: string; readonly minutos: number };
  /** Preselección que dejó el enlace de un bloque libre. */
  readonly salaElegida?: string | undefined;
  readonly inicioElegido?: string | undefined;
  readonly finElegido?: string | undefined;
  /** Acuse de una reservación recién confirmada. */
  readonly aviso?: string | undefined;
  readonly error?: string | undefined;
  /**
   * La agenda pide contraseña sólo cuando hay una declarada, igual que `/salas`.
   * Sin ella la pantalla no dibuja el campo y el servidor no lo exige: pedir en
   * el servidor algo que la pantalla no ofrece es lo que dejó esta agenda
   * inservible.
   */
  readonly requiereClave?: boolean | undefined;
  /** Lo capturado antes de un rechazo, para no obligar a escribirlo otra vez. */
  readonly previo?: Record<string, string> | undefined;
}

export function renderAgendaPage(datos: DatosAgenda): string {
  const documento = html`<html lang="es-MX" class="tema-quiosco">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="referrer" content="no-referrer" />
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <meta name="theme-color" content="#07090d" />
      <title>Agenda de salas · Plataforma KCM</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Montserrat:wght@600;700;800&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="${hojaDeEstilos.ruta}" />
      <link rel="icon" href="${simboloKcm.ruta}" type="${simboloKcm.tipo}" />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    </head>
    <body class="agenda-cuerpo">
      <a class="salto-contenido" href="#disponibilidad">Saltar a disponibilidad</a>

      <!-- El fondo del quiosco de sala: negro de base, lienzo de haces y viñeta. -->
      <div class="agenda-fondo" aria-hidden="true">
        <div class="agenda-fondo-negro"></div>
        <canvas id="beams-canvas" class="agenda-lienzo"></canvas>
        <div class="agenda-vineta"></div>
      </div>

      <div class="agenda-shell">
        <header class="agenda-encabezado">
          <div class="agenda-marca">
            <span class="agenda-marca-halo" aria-hidden="true"></span>
            <img
              class="agenda-marca-simbolo"
              src="${simboloKcm.ruta}"
              alt="Símbolo Kimberly-Clark"
              width="175"
              height="162"
            />
            <span class="agenda-marca-texto">
              <strong>Kimberly-Clark</strong>
              <span>de México</span>
            </span>
          </div>
          <p class="agenda-sync">
            <span class="agenda-sync-punto" aria-hidden="true"></span>
            Consultado ${datos.fecha}
          </p>
        </header>

        <section class="agenda-hero">
          <p class="agenda-eyebrow">Agenda compartida · ${ROOMS.length} salas</p>
          <h1>Agenda de salas</h1>
        </section>

        <main class="agenda-workspace">
          <section class="agenda-panel" id="disponibilidad" aria-labelledby="titulo-disponibilidad">
            <div class="agenda-panel-cabeza">
              <div>
                <h2 id="titulo-disponibilidad">Disponibilidad por sala</h2>
                <p>${fechaLarga(datos.fecha)}</p>
              </div>
              ${renderControlesDeFecha(datos.fecha)}
            </div>

            <div class="agenda-salas">${ROOMS.map((sala) => renderSala(sala, datos))}</div>

            <p class="agenda-leyenda">
              <span><i class="agenda-llave-libre"></i>Disponible</span>
              <span><i class="agenda-llave-ocupada"></i>Reservada</span>
              <span><i class="agenda-llave-pasada"></i>Horario concluido</span>
              <span><i class="agenda-llave-elegida"></i>Selección</span>
            </p>
          </section>

          ${renderFormulario(datos)}
        </main>

        <footer class="agenda-pie">Horario de 07:00 a 20:00 · hora del centro de México</footer>
      </div>

      <!-- El mismo guion que dibuja los haces del quiosco, sin una constante distinta. -->
      <script src="${guionHaces.ruta}"></script>
    </body>
  </html>`;

  return renderDocument(documento);
}

function renderControlesDeFecha(fecha: string): Html {
  return html`<form class="agenda-fecha-tools" method="get" action="/agenda">
    <a class="agenda-icono" href="/agenda?fecha=${sumarDias(fecha, -1)}" aria-label="Día anterior"
      >←</a
    >
    <input
      id="agenda-fecha"
      name="fecha"
      type="date"
      value="${fecha}"
      aria-label="Fecha de agenda"
    />
    <a class="agenda-icono" href="/agenda?fecha=${sumarDias(fecha, 1)}" aria-label="Día siguiente"
      >→</a
    >
    <button class="agenda-ghost" type="submit">Consultar</button>
  </form>`;
}

function renderSala(sala: (typeof ROOMS)[number], datos: DatosAgenda): Html {
  const ocupados = datos.ocupacion.filter((fila) => fila.roomId === sala.roomId);
  const bloques: Html[] = [];

  for (let inicio = INICIO_DE_JORNADA; inicio < FIN_DE_JORNADA; inicio += BLOQUE_EN_MINUTOS) {
    bloques.push(renderBloque(sala, inicio, ocupados, datos));
  }

  // La clase de marca tiñe la tarjeta con la paleta de la sala. El color entra
  // por la hoja de estilos y no por un `style` en línea: la política de
  // contenido declara `style-src 'self'` y descartaría el atributo.
  return html`<article class="agenda-sala ${claseDeSala(sala.roomId)}">
    <div class="agenda-sala-cabeza">
      <h3>${sala.name}</h3>
      <span class="agenda-sala-estado${ocupados.length > 0 ? " ocupada" : ""}">
        ${
          ocupados.length > 0
            ? `${ocupados.length} bloque${ocupados.length === 1 ? "" : "s"} reservado${ocupados.length === 1 ? "" : "s"}`
            : "Disponible todo el día"
        }
      </span>
    </div>
    <div class="agenda-bloques">${bloques}</div>
  </article>`;
}

function renderBloque(
  sala: (typeof ROOMS)[number],
  inicio: number,
  ocupados: readonly PublicRoomOccupancy[],
  datos: DatosAgenda,
): Html {
  const fin = inicio + BLOQUE_EN_MINUTOS;
  const etiqueta = comoHora(inicio);
  const ocupado = ocupados.some(
    (fila) => inicio < enMinutos(fila.endTime) && fin > enMinutos(fila.startTime),
  );
  const pasado =
    datos.fecha < datos.ahora.fecha ||
    (datos.fecha === datos.ahora.fecha && inicio <= datos.ahora.minutos);

  if (ocupado) {
    return html`<span
      class="agenda-bloque ocupado"
      aria-label="${sala.name}, ${etiqueta}, reservada"
      >${etiqueta}</span
    >`;
  }
  if (pasado) {
    return html`<span
      class="agenda-bloque pasado"
      aria-label="${sala.name}, ${etiqueta}, horario concluido"
      >${etiqueta}</span
    >`;
  }

  /*
   * Selección por dos toques: el primero fija el inicio, el segundo el término.
   *
   * Antes un toque proponía una hora fija y reservar hora y media obligaba a
   * corregir el campo a mano. Ahora el primer bloque ancla y el segundo cierra
   * el rango, con los dos bloques incluidos: tocar 07:00 y luego 09:00 reserva
   * de 07:00 a 09:30. Se eligen bloques, no bordes, que es como se lee una
   * rejilla.
   *
   * Sigue sin haber JavaScript —la política de esta pantalla declara
   * `default-src 'none'`—, así que el estado del primer toque viaja en la
   * propia URL y lo resuelve el servidor al volver a pintar.
   */
  const anclaEnEstaSala =
    datos.salaElegida === sala.roomId && datos.inicioElegido !== undefined
      ? enMinutos(datos.inicioElegido)
      : Number.NaN;
  const hayAncla = Number.isFinite(anclaEnEstaSala);

  // Un rango no puede saltarse una reservación ajena. Si entre el ancla y este
  // bloque hay algo ocupado, el toque no cierra el rango: vuelve a anclar aquí.
  const cruzaOcupado =
    hayAncla &&
    inicio > anclaEnEstaSala &&
    ocupados.some(
      (fila) => anclaEnEstaSala < enMinutos(fila.endTime) && fin > enMinutos(fila.startTime),
    );
  const cierraRango = hayAncla && inicio > anclaEnEstaSala && !cruzaOcupado;

  // Anclar propone el bloque mismo, treinta minutos. Es el mínimo del dominio y
  // deja que el segundo toque diga hasta dónde, en vez de adivinar una hora.
  const inicioDelEnlace = cierraRango ? comoHora(anclaEnEstaSala) : etiqueta;
  const finDelEnlace = comoHora(fin);

  const finElegido = datos.finElegido !== undefined ? enMinutos(datos.finElegido) : Number.NaN;
  const dentroDelRango =
    hayAncla && Number.isFinite(finElegido) && inicio >= anclaEnEstaSala && fin <= finElegido;
  const esAncla = hayAncla && inicio === anclaEnEstaSala;

  const clases = "agenda-bloque" + (dentroDelRango ? " elegido" : "") + (esAncla ? " ancla" : "");
  const descripcion = esAncla
    ? `${sala.name}, ${etiqueta}, inicio elegido`
    : cierraRango
      ? `${sala.name}, terminar a las ${finDelEnlace}`
      : `${sala.name}, ${etiqueta}, disponible`;

  return html`<a
    class="${clases}"
    href="/agenda?fecha=${datos.fecha}&amp;sala=${sala.roomId}&amp;inicio=${inicioDelEnlace}&amp;fin=${finDelEnlace}#reservar"
    aria-label="${descripcion}"
    >${etiqueta}</a
  >`;
}

function renderFormulario(datos: DatosAgenda): Html {
  const inicio = datos.inicioElegido ?? "";
  const fin = datos.finElegido ?? "";
  const previo = datos.previo ?? {};
  const antes = (campo: string): string => previo[campo] ?? "";

  return html`<aside
    class="agenda-panel agenda-reserva"
    id="reservar"
    aria-labelledby="titulo-reserva"
  >
    <h2 id="titulo-reserva">Reservar una sala</h2>
    <p>El bloque inicial y el final quedan incluidos. Un solo bloque reserva 30 minutos.</p>

    ${datos.aviso ? html`<p class="agenda-mensaje exito" role="status">${datos.aviso}</p>` : ""}
    ${datos.error ? html`<p class="agenda-mensaje error" role="alert">${datos.error}</p>` : ""}

    <form method="post" action="/agenda" autocomplete="off">
      <div class="agenda-campo">
        <label for="reserva-sala">Sala</label>
        <select id="reserva-sala" name="roomId" required>
          <option value="">Seleccionar sala</option>
          ${ROOMS.map(
            (sala) =>
              html`<option
                value="${sala.roomId}"
                ${datos.salaElegida === sala.roomId ? "selected" : ""}
              >
                ${sala.name}
              </option>`,
          )}
        </select>
      </div>

      <div class="agenda-campo">
        <label for="reserva-fecha">Fecha</label>
        <input id="reserva-fecha" name="date" type="date" value="${datos.fecha}" required />
      </div>

      <div class="agenda-dos">
        <div class="agenda-campo">
          <label for="reserva-inicio">Inicio</label>
          <select id="reserva-inicio" name="startTime" required>
            ${renderHoras(INICIO_DE_JORNADA, FIN_DE_JORNADA - BLOQUE_EN_MINUTOS, inicio)}
          </select>
        </div>
        <div class="agenda-campo">
          <label for="reserva-fin">Término</label>
          <select id="reserva-fin" name="endTime" required>
            ${renderHoras(INICIO_DE_JORNADA + BLOQUE_EN_MINUTOS, FIN_DE_JORNADA, fin)}
          </select>
        </div>
      </div>

      <div class="agenda-campo">
        <label for="reserva-nombre">Nombre completo</label>
        <input
          id="reserva-nombre"
          name="requesterName"
          maxlength="120"
          placeholder="Nombre del solicitante"
          value="${antes("requesterName")}"
          required
        />
      </div>

      <div class="agenda-campo">
        <label for="reserva-nomina">Número de nómina</label>
        <input
          id="reserva-nomina"
          name="requesterWorkerNumber"
          inputmode="numeric"
          pattern="[0-9]{5}"
          maxlength="5"
          placeholder="Cinco dígitos"
          title="Cinco dígitos"
          value="${antes("requesterWorkerNumber")}"
          required
        />
      </div>

      <div class="agenda-dos">
        <div class="agenda-campo">
          <label for="reserva-puesto">Puesto</label>
          <input
            id="reserva-puesto"
            name="requesterPosition"
            maxlength="120"
            value="${antes("requesterPosition")}"
            required
          />
        </div>
        <div class="agenda-campo">
          <label for="reserva-area">Área</label>
          <input
            id="reserva-area"
            name="requesterArea"
            maxlength="120"
            value="${antes("requesterArea")}"
            required
          />
        </div>
      </div>

      <div class="agenda-campo">
        <label for="reserva-motivo">Motivo de la reservación</label>
        <!-- prettier-ignore -->
        <textarea id="reserva-motivo" name="reason" maxlength="300" required>${antes("reason")}</textarea>
      </div>

      <div class="agenda-campo">
        <label for="reserva-asistentes">Asistentes estimados</label>
        <input
          id="reserva-asistentes"
          name="estimatedAttendees"
          type="number"
          min="1"
          max="100"
          value="${antes("estimatedAttendees") || "1"}"
          required
        />
      </div>

      ${
        datos.requiereClave
          ? html`<div class="agenda-campo">
              <label for="reserva-clave">Contraseña de agenda</label>
              <input
                id="reserva-clave"
                name="clave"
                type="password"
                maxlength="120"
                autocomplete="off"
                required
              />
            </div>`
          : ""
      }

      <p class="agenda-privacidad">
        Nombre, nómina, puesto y área sólo se muestran al personal autorizado de Capacitación. La
        agenda pública muestra sala y horario.
      </p>

      <button class="agenda-primario" type="submit">Confirmar reservación</button>
    </form>
  </aside>`;
}

function renderHoras(desde: number, hasta: number, elegida: string): Html[] {
  const opciones: Html[] = [];
  for (let valor = desde; valor <= hasta; valor += BLOQUE_EN_MINUTOS) {
    const etiqueta = comoHora(valor);
    opciones.push(
      html`<option value="${etiqueta}" ${elegida === etiqueta ? "selected" : ""}>
        ${etiqueta}
      </option>`,
    );
  }
  return opciones;
}

function enMinutos(valor: string): number {
  const coincidencia = /^(\d{2}):(\d{2})/u.exec(valor);
  if (!coincidencia) return Number.NaN;
  return Number(coincidencia[1]) * 60 + Number(coincidencia[2]);
}

/**
 * Suma días sobre la fecha ISO sin pasar por `Date`, que al interpretar
 * `2026-08-03` como medianoche UTC corre un día en el huso de la planta.
 */
function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const punto = new Date(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1));
  punto.setUTCDate(punto.getUTCDate() + dias);
  return punto.toISOString().slice(0, 10);
}

function fechaLarga(fecha: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${fecha}T12:00:00Z`));
  } catch {
    return fecha;
  }
}
