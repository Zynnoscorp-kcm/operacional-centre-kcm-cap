/**
 * La telaraña de la ficha: la persona contra su área, curso por curso.
 *
 * Un eje por curso exigible. La línea azul es la persona —el borde es el curso
 * acreditado y vigente; el centro, el que nunca ha llevado— y la punteada es la
 * proporción de su área que tiene cada curso vigente. Así se lee de un vistazo
 * dónde va por delante y dónde se quedó atrás, que es la pregunta de la ficha.
 *
 * El rótulo de cada eje lleva el color del estado de la persona en ese curso
 * —rojo pendiente, ámbar por reforzar, azul programado, gris acreditado—, que
 * es lo que pide acción. El detalle completo está en la lista de cursos de la
 * misma ficha, que es la alternativa en texto de este dibujo.
 *
 * SVG en línea y compuesto en el servidor: la política declara
 * `default-src 'none'` y ninguna biblioteca de gráficas podría cargarse. Cada
 * vértice lleva un `<title>`, que el navegador muestra como globo.
 */

import type {
  AreaCourseCompletion,
  WorkerCourseEvaluation,
} from "../../../domain/sistema-trabajador/tipos.ts";
import { html, rawHtml, type Html } from "../../kit/html.ts";

/**
 * Cuánto cuenta cada estado, de 0 a 1. La escala distingue «lo tuvo y se le
 * venció» de «nunca lo llevó», que se atienden distinto.
 */
const AVANCE_POR_ESTADO: Readonly<Record<string, number>> = {
  COMPLETADO: 1,
  PROGRAMADO: 0.6,
  REFORZAR: 0.35,
  PENDIENTE: 0,
  DATOS_INSUFICIENTES: 0,
};

const ESTADO_LEGIBLE: Readonly<Record<string, string>> = {
  COMPLETADO: "acreditado",
  PROGRAMADO: "programado",
  REFORZAR: "por reforzar",
  PENDIENTE: "pendiente",
  DATOS_INSUFICIENTES: "sin datos para evaluar",
};

const ANCHO = 560;
const ALTO = 400;
const CENTRO_X = ANCHO / 2;
const CENTRO_Y = ALTO / 2;
const RADIO = 122;
/** Distancia del rótulo al borde de la telaraña, y lo que se aleja si choca. */
const SEPARACION = 14;
const EMPUJE = 13;
const INTENTOS = 4;
/** Medidas aproximadas del rótulo, en unidades del lienzo. */
const ANCHO_POR_LETRA = 7.1;
const ALTO_DE_ROTULO = 13;
const ANILLOS = [0.25, 0.5, 0.75, 1];
/** Con menos de tres ejes no hay figura: la lista de cursos ya lo dice. */
const EJES_MINIMOS = 3;
const LARGO_DE_ROTULO = 17;

/** Palabras largas que se abrevian en el rótulo; el nombre completo va en el globo. */
const ABREVIATURAS: Readonly<Record<string, string>> = {
  MANTENIMIENTO: "MTTO.",
  CONCEPTOS: "CONC.",
  FUNDAMENTOS: "FUND.",
  SISTEMAS: "SIST.",
  SISTEMA: "SIST.",
  INSTALACIONES: "INST.",
  INSTRUMENTACION: "INSTRUM.",
  ELECTRONICA: "ELECTRÓN.",
  CAPACITACION: "CAP.",
  CONFIGURACION: "CONFIG.",
};
const PALABRAS_VACIAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "A", "EN", "PARA"]);

interface Eje {
  readonly nombre: string;
  readonly rotulo: string;
  readonly estado: string;
  readonly avance: number;
  /** La proporción del área con el curso vigente, y la misma cifra dicha en texto. */
  readonly area: number | undefined;
  readonly areaEnPalabras: string;
  readonly angulo: number;
}

interface Caja {
  readonly x: number;
  readonly y: number;
  readonly ancho: number;
  readonly alto: number;
}

export interface TelaranaDnc {
  readonly evaluaciones: readonly WorkerCourseEvaluation[];
  readonly area?: readonly AreaCourseCompletion[] | undefined;
  /** Cómo se llama a la persona en la leyenda: nombre y primer apellido. */
  readonly persona: string;
}

export function renderRadarDnc(entrada: TelaranaDnc): Html | "" {
  const aplicables = entrada.evaluaciones.filter((curso) => curso.isApplicable);
  if (aplicables.length < EJES_MINIMOS) return "";

  const delArea = new Map(
    (entrada.area ?? [])
      .filter((curso) => curso.applicable > 0)
      .map((curso) => [curso.trainingId, curso]),
  );
  const ejes: Eje[] = aplicables.map((curso, indice) => {
    const area = delArea.get(curso.trainingId);
    return {
      nombre: curso.canonicalCourseName,
      rotulo: rotuloCorto(curso.canonicalCourseName),
      estado: curso.status,
      avance: AVANCE_POR_ESTADO[curso.status] ?? 0,
      area: area ? area.completed / area.applicable : undefined,
      areaEnPalabras: area
        ? ` · en su área, ${String(area.completed)} de ${String(area.applicable)} lo tienen vigente`
        : "",
      // Se arranca arriba y se gira en el sentido de las manecillas.
      angulo: (indice / aplicables.length) * 2 * Math.PI - Math.PI / 2,
    };
  });
  const conArea = ejes.filter((eje) => eje.area !== undefined).length >= EJES_MINIMOS;

  return html`<figure class="dnc-radar">
    <svg
      class="dnc-radar-lienzo"
      viewBox="0 0 ${ANCHO} ${ALTO}"
      role="img"
      aria-labelledby="dnc-radar-titulo dnc-radar-desc"
      focusable="false"
    >
      <title id="dnc-radar-titulo">Cursos exigibles de ${entrada.persona}</title>
      <desc id="dnc-radar-desc">
        Telaraña con ${ejes.length} cursos${conArea ? ", comparada con la media de su área" : ""}.
        El detalle de cada curso está en la lista de cursos del puesto.
      </desc>
      ${ANILLOS.map(
        (proporcion) =>
          html`<polygon
            class="dnc-radar-anillo${proporcion === 1 ? " dnc-radar-borde" : ""}"
            points="${puntos(ejes, () => proporcion)}"
          />`,
      )}
      ${ejes.map((eje) => {
        const [x, y] = punto(eje.angulo, 1);
        return html`<line
          class="dnc-radar-eje"
          x1="${CENTRO_X}"
          y1="${CENTRO_Y}"
          x2="${redondear(x)}"
          y2="${redondear(y)}"
        />`;
      })}
      ${
        conArea
          ? html`<polygon
              class="dnc-radar-area"
              points="${puntos(ejes, (eje) => eje.area ?? 0)}"
            />`
          : ""
      }
      <polygon class="dnc-radar-persona" points="${puntos(ejes, (eje) => eje.avance)}" />
      ${ejes.map((eje) => renderVertice(eje))} ${renderRotulos(ejes)}
    </svg>
    <figcaption class="dnc-radar-leyenda">
      <span class="dnc-leyenda-serie dnc-leyenda-persona">${entrada.persona}</span>
      ${conArea ? html`<span class="dnc-leyenda-serie dnc-leyenda-area">Media del área</span>` : ""}
    </figcaption>
  </figure>`;
}

/** Nombre y primer apellido, para la leyenda. */
export function nombreCorto(nombre: string): string {
  return nombre.trim().split(/\s+/u).slice(0, 2).join(" ");
}

function rotuloCorto(nombre: string): string {
  const terminos = nombre
    .toLocaleUpperCase("es-MX")
    .split(/\s+/u)
    .filter((termino) => termino && !PALABRAS_VACIAS.has(termino))
    .map((termino) => ABREVIATURAS[termino] ?? termino);
  const corto = terminos.join(" ");
  return corto.length > LARGO_DE_ROTULO
    ? `${corto.slice(0, LARGO_DE_ROTULO - 1).trimEnd()}…`
    : corto;
}

function punto(angulo: number, proporcion: number, radio = RADIO): readonly [number, number] {
  return [
    CENTRO_X + Math.cos(angulo) * radio * proporcion,
    CENTRO_Y + Math.sin(angulo) * radio * proporcion,
  ];
}

/**
 * Los puntos de un polígono. Van como atributo `points`, que es una lista de
 * números y no marcado, así que se marca en crudo tras componerlo con valores
 * que sólo pueden ser números.
 */
function puntos(ejes: readonly Eje[], proporcion: (eje: Eje) => number): Html {
  return rawHtml(
    ejes
      .map((eje) => {
        const [x, y] = punto(eje.angulo, Math.max(0, Math.min(1, proporcion(eje))));
        return `${redondear(x)},${redondear(y)}`;
      })
      .join(" "),
  );
}

function renderVertice(eje: Eje): Html {
  const [x, y] = punto(eje.angulo, eje.avance);
  return html`<circle class="dnc-radar-vertice" cx="${redondear(x)}" cy="${redondear(y)}" r="3.2">
    <title>${eje.nombre}: ${ESTADO_LEGIBLE[eje.estado] ?? eje.estado}${eje.areaEnPalabras}</title>
  </circle>`;
}

/**
 * Los rótulos, sin encimarse. Con dieciocho cursos, dos vecinos quedan a veinte
 * grados; arriba y abajo, donde los rótulos se acomodan uno al lado del otro,
 * eso no alcanza para un texto de cien unidades. Cada rótulo se coloca junto a
 * su eje y, si choca con uno ya colocado, se aleja del centro hasta que cabe.
 */
function renderRotulos(ejes: readonly Eje[]): Html {
  const colocadas: Caja[] = [];
  return html`${ejes.map((eje) => {
    const ancho = eje.rotulo.length * ANCHO_POR_LETRA;
    const coseno = Math.cos(eje.angulo);
    const seno = Math.sin(eje.angulo);
    const ancla = coseno > 0.2 ? "start" : coseno < -0.2 ? "end" : "middle";

    let radio = RADIO + SEPARACION;
    let caja = cajaDe(eje.angulo, radio, ancho, ancla, seno);
    for (
      let intento = 0;
      intento < INTENTOS && colocadas.some((otra) => chocan(caja, otra));
      intento += 1
    ) {
      radio += EMPUJE;
      caja = cajaDe(eje.angulo, radio, ancho, ancla, seno);
    }
    colocadas.push(caja);

    const [x] = punto(eje.angulo, 1, radio);
    return html`<text
      class="dnc-radar-rotulo dnc-tono-${eje.estado.toLowerCase()}"
      x="${redondear(x)}"
      y="${redondear(caja.y + ALTO_DE_ROTULO - 2)}"
      text-anchor="${ancla}"
    >
      <title>${eje.nombre}</title>
      ${eje.rotulo}
    </text>`;
  })}`;
}

function cajaDe(angulo: number, radio: number, ancho: number, ancla: string, seno: number): Caja {
  const [x, y] = punto(angulo, 1, radio);
  const izquierda = ancla === "start" ? x : ancla === "end" ? x - ancho : x - ancho / 2;
  // Arriba, el rótulo se apoya sobre su punto; abajo, cuelga de él; a los lados,
  // se centra en la altura del eje.
  const arriba = seno < -0.2 ? y - ALTO_DE_ROTULO : seno > 0.2 ? y : y - ALTO_DE_ROTULO / 2;
  return { x: izquierda, y: arriba, ancho, alto: ALTO_DE_ROTULO };
}

function chocan(a: Caja, b: Caja): boolean {
  const aire = 2;
  return (
    a.x < b.x + b.ancho + aire &&
    b.x < a.x + a.ancho + aire &&
    a.y < b.y + b.alto + aire &&
    b.y < a.y + a.alto + aire
  );
}

function redondear(valor: number): string {
  return valor.toFixed(1);
}
