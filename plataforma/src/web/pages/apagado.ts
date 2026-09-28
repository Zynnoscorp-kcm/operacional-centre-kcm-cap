/**
 * Apagar la plataforma de esta computadora.
 *
 * Tres piezas y una sola idea: apagar es un gesto corto, así que se pregunta en
 * un recuadro sobre la pantalla en la que se está y no mandando a nadie a otra
 * página a leer tres párrafos.
 *
 * - `renderEmergenteDeApagado` es la pregunta. Vive en la pantalla de inicio,
 *   cerrada hasta que alguien pulsa el botón.
 * - `renderApagadoConfirmarPage` es esa misma pregunta para quien llega escribiendo
 *   `/apagar` en la barra de direcciones. No sobra: `GET` tiene que poder
 *   contestar algo, y tiene que ser la pregunta y no el apagado.
 * - `renderApagadoHechoPage` es el acuse, y es lo que responde el `POST` justo
 *   antes de cerrar el proceso.
 *
 * Por qué se pregunta. Apagar no rompe nada —el proceso cierra limpio y suelta
 * la base—, pero deja a Excel sin destino para el barrido, el padrón y el lote
 * DC-3 hasta que alguien vuelva a esta computadora a encenderla. Eso no puede
 * pasar por un clic distraído.
 *
 * Y por qué no hay botón de encender en ninguna parte: si la plataforma está
 * apagada no hay nada escuchando, así que no existe página que pueda dibujarlo.
 * El encendido vive fuera del navegador, en `deploy/local/`.
 */

import type { AppConfig } from "../../config/environment.ts";
import { renderEmergente } from "../kit/emergente.ts";
import { html, type Html, rawHtml } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface ApagadoConfirmarInput {
  readonly config: AppConfig;
}

/**
 * La pregunta. Una línea de consecuencia y dos botones: lo que hay que saber
 * antes de pulsar cabe en un renglón, y lo que hay que hacer para encenderla de
 * nuevo se dice después, cuando ya está apagada y sirve de algo.
 *
 * Los dos destinos cambian según dónde viva el recuadro. En el tablero el envío
 * va a `/` —la misma dirección en la que ya está— para que la respuesta sea esa
 * misma pantalla con el acuse encima y no un viaje a otra página; y el «No»
 * basta con que suelte el fragmento, que no pide nada al servidor. En `/apagar`,
 * donde la pantalla *es* la pregunta, el envío va a su propia dirección y el
 * «No» tiene que volver a una pantalla de verdad.
 */
interface DestinosDeLaPregunta {
  readonly accion: string;
  readonly cierre: string;
}

function cuerpoDeLaPregunta(destinos: DestinosDeLaPregunta): Html {
  return html`
    <p class="emergente-texto">Excel dejará de poder mandar el barrido de la matriz y el padrón.</p>
    <form method="post" action="${destinos.accion}" class="emergente-acciones">
      <input type="hidden" name="accion" value="apagar" />
      <button type="submit" class="boton-peligro">Sí, apagar</button>
      <a class="boton-secundario" href="${destinos.cierre}">No</a>
    </form>
  `;
}

/** El recuadro que abre el botón del tablero. Envía al propio tablero. */
export function renderEmergenteDeApagado(): Html {
  return renderEmergente({
    ancla: "apagar",
    titulo: "¿Apagar el servidor local?",
    cuerpo: cuerpoDeLaPregunta({ accion: "/", cierre: "#" }),
  });
}

export function renderApagadoConfirmarPage(input: ApagadoConfirmarInput): string {
  const contenido: Html = renderEmergente({
    fijo: true,
    titulo: "¿Apagar el servidor local?",
    cuerpo: cuerpoDeLaPregunta({ accion: "/apagar", cierre: "/" }),
    claseDeCaja: "energia-confirmacion",
  });

  return renderLayout({
    titulo: "Apagar la plataforma",
    rutaActiva: "/",
    subtitulo: "Sólo afecta a esta computadora",
    entorno: input.config.environment,
    papel: input.config.role,
    contenido,
  });
}

/**
 * La palomita. Se dibuja sola con `stroke-dashoffset`, que es la única forma de
 * animar un trazo sin guiones, y va en tinta plena y no en verde: el verde es
 * el color de «esto salió bien» y aquí no salió bien nada, simplemente terminó.
 */
const PALOMITA = rawHtml(
  '<svg class="escena-palomita" viewBox="0 0 24 24" width="46" height="46" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false"><path d="M4 12.6 L9.4 18 L20 6.4"/></svg>',
);

/**
 * La rueda de espera, la de los doce rayos del teléfono. Son doce elementos
 * vacíos porque cada rayo necesita su propio giro y su propio retardo, y la
 * hoja no puede generarlos: sin guiones, los que hay en el marcado son los que
 * hay. Van sin texto —el rótulo llega con la palomita— y ocultos al lector de
 * pantalla, que ya tiene el título del recuadro.
 */
const RUEDA = rawHtml(
  '<span class="escena-rueda" aria-hidden="true">' + "<i></i>".repeat(12) + "</span>",
);

/**
 * El acuse. Se manda antes de cerrar, porque después de cerrar no hay quien
 * responda: si el proceso muriera primero, el navegador enseñaría un error de
 * conexión y quien apagó no sabría si funcionó.
 *
 * La secuencia —rueda, palomita, rótulo, botón— corre con retardos de la hoja de
 * estilos y no con un reloj de JavaScript, que aquí no existe. Los tiempos están
 * elegidos para que la palomita aparezca cuando el proceso ya murió de verdad y
 * no antes: el margen de acuse de la ruta es de 250 ms y la rueda dura 1.4 s.
 *
 * El botón de OK cierra el recuadro con un fragmento, sin pedirle nada al
 * servidor. Es deliberado: para cuando alguien lo pulsa, no hay servidor.
 */
export function renderEmergenteDelAcuse(): Html {
  return renderEmergente({
    fijo: true,
    anclaDeCierre: "cerrar-acuse",
    titulo: "Servidor local apagado",
    claseDeCaja: "emergente-acuse",
    cuerpo: html`
      <div class="escena">${RUEDA}${PALOMITA}</div>
      <p class="emergente-acciones escena-accion">
        <a class="boton-kcm" href="#cerrar-acuse">OK</a>
      </p>
    `,
  });
}

export function renderApagadoHechoPage(input: ApagadoConfirmarInput): string {
  const emergente = renderEmergenteDelAcuse();

  const contenido: Html = html`
    ${emergente}
    <section class="tarjeta energia-reposo">
      <h2>Encenderlo de nuevo</h2>
      <p>Se enciende con <strong>Encender KCM</strong>, en el Escritorio.</p>
    </section>
  `;

  return renderLayout({
    titulo: "Servidor local apagado",
    subtitulo: "Esta computadora",
    entorno: input.config.environment,
    papel: input.config.role,
    contenido,
    sinRail: true,
  });
}
