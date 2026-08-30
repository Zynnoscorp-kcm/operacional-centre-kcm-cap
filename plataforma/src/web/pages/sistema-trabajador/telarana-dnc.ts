/**
 * Gráfica de telaraña del avance DNC de un trabajador.
 *
 * Por qué SVG en línea y no una biblioteca. La política de contenido de la
 * consola declara `default-src 'none'` y no admite scripts ni orígenes externos;
 * cualquier librería de gráficas quedaría bloqueada por el navegador. El dibujo
 * se compone aquí, en el servidor, y llega como marcado.
 *
 * Qué se considera interactivo sin guion. Cada vértice lleva un `<title>`,
 * que el navegador muestra como globo nativo al pasar el puntero y los lectores
 * de pantalla anuncian; el eje entero se resalta al pasar por encima con una
 * regla CSS, y debajo va la misma información como lista, que es lo que ve quien
 * navegue con teclado o imprima la ficha. Un gráfico que sólo existe como
 * dibujo no es accesible ni auditable.
 *
 * La escala. Un curso no es aprobado o reprobado: pasa por estados. Se
 * gradúa para que la silueta distinga «lo tuvo y se le venció» de «nunca lo
 * llevó», que son problemas distintos y se atienden distinto.
 *
 * ── El lienzo ─────────────────────────────────────────────────────────────
 *
 * El `viewBox` es ancho a propósito y lleva las etiquetas dentro. Antes era
 * cuadrado, con `overflow: visible` y los rótulos colgando fuera: los de la
 * izquierda se pintaban encima del menú lateral y los de la derecha encima del
 * resumen. Un `viewBox` que contiene todo lo que se dibuja no puede invadir
 * nada, y de paso el recorte por omisión del `<svg>` vuelve a ser una red de
 * seguridad en vez de un estorbo.
 *
 * Con muchos cursos exigibles —diecisiete o dieciocho es lo normal en un
 * técnico— dos rótulos vecinos quedan a veinte grados uno de otro, que a esta
 * escala son cuarenta píxeles de arco para un texto de cien. Por eso a partir de
 * nueve ejes los rótulos se alternan en dos anillos: el par cerca, el impar
 * lejos. No es adorno; sin eso, arriba y abajo se leen encimados.
 */

import type { WorkerCourseEvaluation } from "../../../domain/sistema-trabajador/tipos.ts";
import { html, rawHtml, type Html } from "../../kit/html.ts";

/** Cuánto avance representa cada estado, de 0 a 1. */
const AVANCE_POR_ESTADO: Readonly<Record<string, number>> = {
  COMPLETADO: 1,
  PROGRAMADO: 0.6,
  REFORZAR: 0.35,
  PENDIENTE: 0,
  DATOS_INSUFICIENTES: 0,
};

const LEYENDA_POR_ESTADO: Readonly<Record<string, string>> = {
  COMPLETADO: "Acreditado y vigente",
  PROGRAMADO: "Programado en sala",
  REFORZAR: "Vencido: requiere reforzamiento",
  PENDIENTE: "Sin registro del curso",
  DATOS_INSUFICIENTES: "Datos insuficientes para evaluar",
};

const CENTRO_X = 270;
const CENTRO_Y = 165;
const RADIO = 112;
/** Radio del disco de vidrio que va detrás de la telaraña. */
const RADIO_LENTE = RADIO + 20;
/** Los dos anillos de rótulos, medidos desde el centro. */
const ROTULO_CERCA = RADIO + 24;
const ROTULO_LEJOS = RADIO + 42;
/** A partir de aquí los rótulos vecinos se pisan y hay que alternarlos. */
const EJES_PARA_ALTERNAR = 9;

/** Los anillos de referencia: 25 %, 50 %, 75 % y 100 %. */
const ANILLOS = [0.25, 0.5, 0.75, 1];

interface Eje {
  readonly nombre: string;
  readonly estado: string;
  readonly avance: number;
  readonly x: number;
  readonly y: number;
  readonly xEtiqueta: number;
  readonly yEtiqueta: number;
}

/**
 * El polígono necesita al menos tres ejes para ser un polígono. Con uno o dos
 * cursos exigibles se dibujaría una raya, así que en ese caso no se dibuja nada
 * y la ficha se queda con su tabla, que ya dice lo mismo sin fingir una forma.
 */
const EJES_MINIMOS = 3;

export function renderRadarDnc(evaluaciones: readonly WorkerCourseEvaluation[]): Html | "" {
  const aplicables = evaluaciones.filter((curso) => curso.isApplicable);
  if (aplicables.length < EJES_MINIMOS) return "";

  const ejes = construirEjes(aplicables);
  const avanceMedio = ejes.reduce((total, eje) => total + eje.avance, 0) / ejes.length;

  return html`<section class="tarjeta" aria-labelledby="titulo-radar">
    <div class="seccion-cabecera">
      <h3 id="titulo-radar">Avance por curso exigible</h3>
      <p class="seccion-subtitulo">Un eje por curso aplicable.</p>
    </div>

    <div class="radar-envoltura">
      <svg
        class="radar"
        viewBox="0 0 540 330"
        role="img"
        aria-labelledby="radar-titulo radar-desc"
        focusable="false"
      >
        <title id="radar-titulo">Avance DNC por curso exigible</title>
        <desc id="radar-desc">
          Gráfica de telaraña con ${ejes.length} ejes. El detalle por curso está en la lista que
          sigue a la gráfica.
        </desc>

        ${DEFINICIONES}

        <!-- El disco de vidrio: es lo que da el volumen. Va debajo de todo. -->
        <circle class="radar-lente" cx="${CENTRO_X}" cy="${CENTRO_Y}" r="${RADIO_LENTE}" />
        <circle class="radar-lente-filo" cx="${CENTRO_X}" cy="${CENTRO_Y}" r="${RADIO_LENTE}" />
        <ellipse
          class="radar-lente-brillo"
          cx="${CENTRO_X - 30}"
          cy="${CENTRO_Y - 58}"
          rx="82"
          ry="40"
        />

        ${ANILLOS.map(
          (proporcion) =>
            html`<polygon
              class="radar-anillo"
              points="${puntosDePoligono(ejes, () => proporcion)}"
            />`,
        )}
        ${ejes.map(
          (eje) =>
            html`<line
              class="radar-eje"
              x1="${CENTRO_X}"
              y1="${CENTRO_Y}"
              x2="${redondear(eje.x)}"
              y2="${redondear(eje.y)}"
            />`,
        )}

        <!-- La silueta va dos veces: difuminada como halo y encima nítida. -->
        <polygon class="radar-halo" points="${puntosDePoligono(ejes, (eje) => eje.avance)}" />
        <polygon class="radar-area" points="${puntosDePoligono(ejes, (eje) => eje.avance)}" />

        ${ejes.map((eje) => renderVertice(eje))}
      </svg>

      <dl class="radar-resumen">
        <div>
          <dt>Avance medio</dt>
          <dd>${Math.round(avanceMedio * 100)}%</dd>
        </div>
        <div>
          <dt>Cursos exigibles</dt>
          <dd>${ejes.length}</dd>
        </div>
      </dl>
    </div>

    <!--
      La misma información sin depender del dibujo: para lector de pantalla, para
      teclado y para cuando la ficha se imprime.
    -->
    <ul class="radar-lista">
      ${ejes.map(
        (eje) =>
          html`<li>
            <span class="radar-lista-curso">${eje.nombre}</span>
            <span class="radar-lista-estado radar-estado-${eje.estado.toLowerCase()}"
              >${LEYENDA_POR_ESTADO[eje.estado] ?? eje.estado}</span
            >
          </li>`,
      )}
    </ul>
  </section>`;
}

/**
 * Degradados y desenfoque del vidrio.
 *
 * Van con `class` y sin un solo color escrito: los tonos los pone `base.css` con
 * `stop-color: var(--…)`, que es donde vive el color de esta plataforma. Es
 * marcado literal del árbol, de ahí el `rawHtml`.
 */
const DEFINICIONES = rawHtml(`<defs>
      <radialGradient id="radar-vidrio" cx="34%" cy="24%" r="82%">
        <stop class="radar-vidrio-alto" offset="0%" />
        <stop class="radar-vidrio-medio" offset="46%" />
        <stop class="radar-vidrio-bajo" offset="82%" />
        <stop class="radar-vidrio-canto" offset="100%" />
      </radialGradient>
      <linearGradient id="radar-canto" x1="0" y1="0" x2="0.9" y2="1">
        <stop class="radar-canto-luz" offset="0%" />
        <stop class="radar-canto-sombra" offset="100%" />
      </linearGradient>
      <linearGradient id="radar-relleno" x1="0.15" y1="0" x2="0.6" y2="1">
        <stop class="radar-relleno-alto" offset="0%" />
        <stop class="radar-relleno-medio" offset="52%" />
        <stop class="radar-relleno-bajo" offset="100%" />
      </linearGradient>
      <linearGradient id="radar-filo" x1="0" y1="0" x2="1" y2="1">
        <stop class="radar-filo-claro" offset="0%" />
        <stop class="radar-filo-marca" offset="55%" />
        <stop class="radar-filo-hondo" offset="100%" />
      </linearGradient>
      <filter id="radar-difuminado" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </defs>`);

function construirEjes(cursos: readonly WorkerCourseEvaluation[]): readonly Eje[] {
  const total = cursos.length;
  const alterna = total >= EJES_PARA_ALTERNAR;

  return cursos.map((curso, indice) => {
    // Se arranca arriba —de ahí el cuarto de vuelta restado— y se gira en el
    // sentido de las manecillas, que es como se lee una gráfica de este tipo.
    const angulo = (indice / total) * 2 * Math.PI - Math.PI / 2;
    const avance = AVANCE_POR_ESTADO[curso.status] ?? 0;
    const radioRotulo = alterna && indice % 2 === 1 ? ROTULO_LEJOS : ROTULO_CERCA;

    return {
      nombre: curso.canonicalCourseName,
      estado: curso.status,
      avance,
      x: CENTRO_X + Math.cos(angulo) * RADIO,
      y: CENTRO_Y + Math.sin(angulo) * RADIO,
      xEtiqueta: CENTRO_X + Math.cos(angulo) * radioRotulo,
      yEtiqueta: CENTRO_Y + Math.sin(angulo) * radioRotulo,
    };
  });
}

function renderVertice(eje: Eje): Html {
  const x = CENTRO_X + (eje.x - CENTRO_X) * eje.avance;
  const y = CENTRO_Y + (eje.y - CENTRO_Y) * eje.avance;
  const leyenda = LEYENDA_POR_ESTADO[eje.estado] ?? eje.estado;

  return html`<g class="radar-vertice radar-estado-${eje.estado.toLowerCase()}">
    <title>${eje.nombre}: ${leyenda}</title>
    <circle class="radar-aureola" cx="${redondear(x)}" cy="${redondear(y)}" r="8" />
    <circle class="radar-punto" cx="${redondear(x)}" cy="${redondear(y)}" r="4.5" />
    <text
      class="radar-etiqueta"
      x="${redondear(eje.xEtiqueta)}"
      y="${redondear(eje.yEtiqueta)}"
      text-anchor="${anclaje(eje.xEtiqueta)}"
    >
      ${acortar(eje.nombre)}
    </text>
  </g>`;
}

/**
 * Los puntos de un polígono. Van como atributo `points`, que es una lista de
 * números y no marcado, así que se marca en crudo tras componerlo con valores
 * que sólo pueden ser números.
 */
function puntosDePoligono(ejes: readonly Eje[], proporcion: (eje: Eje) => number): Html {
  return rawHtml(
    ejes
      .map((eje) => {
        const factor = proporcion(eje);
        return `${redondear(CENTRO_X + (eje.x - CENTRO_X) * factor)},${redondear(
          CENTRO_Y + (eje.y - CENTRO_Y) * factor,
        )}`;
      })
      .join(" "),
  );
}

function anclaje(x: number): string {
  if (x > CENTRO_X + 6) return "start";
  if (x < CENTRO_X - 6) return "end";
  return "middle";
}

/** Un nombre de curso largo desbordaría el lienzo; el completo va en el globo. */
function acortar(nombre: string): string {
  return nombre.length > 18 ? `${nombre.slice(0, 17)}…` : nombre;
}

function redondear(valor: number): string {
  return valor.toFixed(1);
}
