/**
 * La hoja de entrega de una tanda de constancias DC-3.
 *
 * Una tanda sale impresa y se reparte: a un supervisor de área, a la ventanilla,
 * al archivo. Hasta ahora el reparto se llevaba en una hoja aparte que alguien
 * escribía a mano con los mismos nombres que acababa de imprimir. Esta hoja es
 * esa lista, compuesta con los mismos datos y en el mismo orden que las
 * constancias que la siguen.
 *
 * Va delante de las constancias en el mismo PDF, así que una tanda es un solo
 * trabajo de impresión y la hoja no se separa de lo que enumera.
 */

import { PdfPage, measureText } from "./escritor.ts";

export interface RenglonDeRelacion {
  readonly workerNumber: string;
  readonly workerName: string;
  readonly area: string;
  /** Etiqueta corta del curso: el nombre DC-3 de LOTO no cabe en una columna. */
  readonly courseLabel: string;
  readonly completionDate: string | null;
  /** La constancia sale con algún recuadro en blanco. */
  readonly partial: boolean;
}

export interface OpcionesDeRelacion {
  /** Día de la emisión, `YYYY-MM-DD`, en la fecha de la planta. */
  readonly fecha: string;
  /** Quién emitió la tanda: la cuenta de consola, o el actor de servicio. */
  readonly actor: string;
  /** Lo que acota la tanda —«Área FLEXOGRAFICA · LOTO»—, si algo la acota. */
  readonly contexto?: string;
}

const PAGINA = { ancho: 612, alto: 792, margen: 44 } as const;
const ANCHO_UTIL = PAGINA.ancho - PAGINA.margen * 2;
const ALTO_DE_RENGLON = 24;
const ALTO_DE_ENCABEZADO = 17;
/** Donde termina la tabla: debajo sólo va el pie de la hoja. */
const FIN_DE_TABLA = PAGINA.alto - PAGINA.margen - 22;

/**
 * Las columnas, con su ancho en puntos. Suman el ancho útil de la hoja.
 */
const COLUMNAS = [
  { titulo: "#", ancho: 20, alinear: "right" },
  { titulo: "Nómina", ancho: 44, alinear: "left" },
  { titulo: "Nombre", ancho: 214, alinear: "left" },
  { titulo: "Área", ancho: 116, alinear: "left" },
  { titulo: "Curso", ancho: 58, alinear: "left" },
  { titulo: "Fecha del curso", ancho: 72, alinear: "left" },
] as const;

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** `2026-08-26` → «26 ago 2026»: se lee sin pensar y no confunde día con mes. */
function fechaCorta(iso: string): string {
  const [anio = "", mes = "", dia = ""] = iso.split("-");
  const nombre = MESES[Number(mes) - 1];
  if (!nombre || !dia) return iso;
  return `${String(Number(dia))} ${nombre.slice(0, 3)} ${anio}`;
}

/** `2026-09-24` → «24 de septiembre de 2026». */
export function fechaLarga(iso: string): string {
  const [anio = "", mes = "", dia = ""] = iso.split("-");
  const nombre = MESES[Number(mes) - 1];
  if (!nombre || !dia) return iso;
  return `${String(Number(dia))} de ${nombre} de ${anio}`;
}

/**
 * El texto que cabe en `ancho`, con puntos suspensivos si no cabe entero.
 *
 * Tres puntos y no el carácter «…»: el escritor mide los caracteres de WinAnsi
 * por su letra base, y el de los puntos suspensivos se mide como un punto
 * aunque se dibuja tres veces más ancho, así que el recorte se metía en la
 * columna de al lado.
 */
function recortar(texto: string, ancho: number, size: number): string {
  if (measureText(texto, { size }) <= ancho) return texto;
  let corte = texto;
  while (corte.length > 1 && measureText(`${corte}...`, { size }) > ancho)
    corte = corte.slice(0, -1);
  return `${corte.trimEnd()}...`;
}

/**
 * Dónde empieza la tabla en cada hoja. La primera lleva el encabezado completo
 * —título, cuántas, quién, de qué va la tanda y la nota—; las que siguen, sólo
 * el título corto. Se calcula antes de dibujar porque el pie dice «Hoja 1 de 3»
 * y el total de hojas depende de cuántos renglones caben en cada una.
 */
function inicioDeTabla(primera: boolean, conContexto: boolean): number {
  if (!primera) return PAGINA.margen + 17 + 10;
  return PAGINA.margen + 21 + 14 + (conContexto ? 14 : 0) + 14 + 12;
}

function renglonesPorHoja(inicio: number): number {
  return Math.max(1, Math.floor((FIN_DE_TABLA - inicio - ALTO_DE_ENCABEZADO) / ALTO_DE_RENGLON));
}

/**
 * Las hojas de la relación. La primera lleva el encabezado completo; las que
 * siguen, sólo el título corto y la tabla, para que una tanda de sesenta no
 * gaste media hoja en repetir lo mismo.
 */
export function componerRelacionDc3(
  renglones: readonly RenglonDeRelacion[],
  opciones: OpcionesDeRelacion,
): PdfPage[] {
  const tramos: RenglonDeRelacion[][] = [];
  let resto = [...renglones];
  let primera = true;
  const conContexto = Boolean(opciones.contexto);
  while (resto.length > 0 || tramos.length === 0) {
    const cupo = renglonesPorHoja(inicioDeTabla(primera, conContexto));
    tramos.push(resto.slice(0, cupo));
    resto = resto.slice(cupo);
    primera = false;
  }

  const hayParciales = renglones.some((renglon) => renglon.partial);
  let numero = 0;

  return tramos.map((tramo, indice) => {
    const hoja = new PdfPage({ width: PAGINA.ancho, height: PAGINA.alto });
    const izquierda = PAGINA.margen;
    let y: number = PAGINA.margen;

    if (indice === 0) {
      hoja.text("RELACIÓN DE CONSTANCIAS DC-3", { x: izquierda, y, size: 14, bold: true });
      y += 21;
      const cuantas =
        renglones.length === 1 ? "1 constancia" : `${String(renglones.length)} constancias`;
      hoja.text(`${cuantas} · emitidas el ${fechaLarga(opciones.fecha)} por ${opciones.actor}`, {
        x: izquierda,
        y,
        size: 9.5,
        gray: 0.25,
      });
      y += 14;
      if (opciones.contexto) {
        hoja.text(opciones.contexto, { x: izquierda, y, size: 9.5, gray: 0.25 });
        y += 14;
      }
      hoja.text(
        "Cada renglón corresponde, en el mismo orden, a una de las constancias que siguen a esta hoja.",
        { x: izquierda, y, size: 8, gray: 0.4 },
      );
      y += 14;
      hoja.line(izquierda, y, izquierda + ANCHO_UTIL, y, { gray: 0.2, lineWidth: 1 });
      y = inicioDeTabla(true, conContexto);
    } else {
      hoja.text("RELACIÓN DE CONSTANCIAS DC-3 (continúa)", {
        x: izquierda,
        y,
        size: 11,
        bold: true,
      });
      y += 17;
      hoja.line(izquierda, y, izquierda + ANCHO_UTIL, y, { gray: 0.2, lineWidth: 1 });
      y = inicioDeTabla(false, conContexto);
    }

    // Encabezado de la tabla, en gris claro para que no compita con los nombres.
    hoja.rect(izquierda, y, ANCHO_UTIL, ALTO_DE_ENCABEZADO, { fill: 0.92, stroke: null });
    let x = izquierda;
    for (const columna of COLUMNAS) {
      hoja.text(columna.titulo, {
        x: x + 3,
        y: y + 5,
        size: 7.2,
        bold: true,
        gray: 0.2,
        width: columna.ancho - 6,
        align: columna.alinear,
      });
      x += columna.ancho;
    }
    y += ALTO_DE_ENCABEZADO;

    for (const renglon of tramo) {
      numero += 1;
      const celdas = [
        String(numero),
        renglon.workerNumber,
        renglon.workerName,
        renglon.area || "—",
        `${renglon.courseLabel}${renglon.partial ? " *" : ""}`,
        renglon.completionDate ? fechaCorta(renglon.completionDate) : "sin fecha",
      ];
      x = izquierda;
      celdas.forEach((texto, posicion) => {
        const columna = COLUMNAS[posicion];
        if (!columna) return;
        const size = posicion === 2 ? 8.6 : 8;
        hoja.text(recortar(texto, columna.ancho - 6, size), {
          x: x + 3,
          y: y + (ALTO_DE_RENGLON - size) / 2,
          size,
          bold: posicion === 2,
          width: columna.ancho - 6,
          align: columna.alinear,
        });
        x += columna.ancho;
      });
      y += ALTO_DE_RENGLON;
      hoja.line(izquierda, y, izquierda + ANCHO_UTIL, y, { gray: 0.75, lineWidth: 0.5 });
    }

    const pie = PAGINA.alto - PAGINA.margen - 8;
    if (hayParciales && indice === tramos.length - 1) {
      hoja.text("* Sale con algún recuadro en blanco, para llenarse a mano.", {
        x: izquierda,
        y: pie - 14,
        size: 7.6,
        gray: 0.35,
      });
    }
    hoja.text("Plataforma KCM · Constancias DC-3", { x: izquierda, y: pie, size: 7.2, gray: 0.45 });
    hoja.text(`Hoja ${String(indice + 1)} de ${String(tramos.length)}`, {
      x: izquierda,
      y: pie,
      size: 7.2,
      gray: 0.45,
      width: ANCHO_UTIL,
      align: "right",
    });
    return hoja;
  });
}
