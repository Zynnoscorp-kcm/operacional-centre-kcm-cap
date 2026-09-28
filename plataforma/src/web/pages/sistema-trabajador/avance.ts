/**
 * La barra de avance de la capacitación: acreditados, por reforzar, programados
 * y pendientes, apilados sobre el total de obligaciones.
 *
 * Se dibuja en SVG con los anchos como atributos —la política de contenido no
 * deja escribir estilos en línea— y se estira al ancho de su celda. Va siempre
 * con la cuenta escrita al lado: el color acompaña, no es el único que lo dice.
 */

import { html, rawHtml, type Html } from "../../kit/html.ts";

export interface PartesDeAvance {
  readonly acreditados: number;
  readonly reforzar: number;
  readonly programados: number;
  readonly pendientes: number;
}

const TRAMOS = [
  { clave: "acreditados", clase: "avance-acreditado", texto: "Acreditado" },
  { clave: "reforzar", clase: "avance-reforzar", texto: "Por reforzar" },
  { clave: "programados", clase: "avance-programado", texto: "Programado" },
  { clave: "pendientes", clase: "avance-pendiente", texto: "Pendiente" },
] as const;

export function totalDeAvance(partes: PartesDeAvance): number {
  return partes.acreditados + partes.reforzar + partes.programados + partes.pendientes;
}

/** La proporción acreditada, para ordenar: de menor a mayor avance. */
export function proporcionAcreditada(partes: PartesDeAvance): number {
  const total = totalDeAvance(partes);
  return total === 0 ? 0 : partes.acreditados / total;
}

/** Las cuatro cuentas en una frase, para el globo y los lectores de pantalla. */
export function resumenDeAvance(partes: PartesDeAvance): string {
  return (
    `${String(partes.acreditados)} acreditados, ${String(partes.reforzar)} por reforzar, ` +
    `${String(partes.programados)} programados y ${String(partes.pendientes)} pendientes, ` +
    `de ${String(totalDeAvance(partes))}`
  );
}

export function renderLeyendaDeAvance(): Html {
  return html`<p class="avance-leyenda">
    ${TRAMOS.map(
      (tramo) =>
        html`<span class="avance-clave"
          ><span class="avance-muestra ${tramo.clase}" aria-hidden="true"></span
          >${tramo.texto}</span
        >`,
    )}
  </p>`;
}

/** La barra y la cuenta, como dos celdas de una fila de avance. */
export function renderBarraDeAvance(partes: PartesDeAvance): Html {
  const total = totalDeAvance(partes);
  if (total === 0) {
    return html`<span class="avance-sin-cursos">Sin cursos exigibles</span>
      <span class="avance-cuenta">—</span>`;
  }
  const resumen = resumenDeAvance(partes);
  return html`<span class="avance-barra" title="${resumen}">${barraApilada(partes, total)}</span>
    <span class="avance-cuenta"
      ><strong>${partes.acreditados}</strong>/${total}<span class="solo-lectores"
        >. ${resumen}.</span
      ></span
    >`;
}

/**
 * Los anchos van en unidades del `viewBox` —de 0 a 100— y el dibujo se estira
 * a su celda; la separación entre tramos es un trazo del color de la tarjeta
 * que no se estira con él.
 */
function barraApilada(partes: PartesDeAvance, total: number): Html {
  if (total === 0) return html``;
  let inicio = 0;
  const tramos = TRAMOS.map((tramo) => {
    const ancho = (partes[tramo.clave] / total) * 100;
    const rect =
      ancho > 0
        ? `<rect class="${tramo.clase}" x="${inicio.toFixed(2)}" y="0" ` +
          `width="${ancho.toFixed(2)}" height="10" />`
        : "";
    inicio += ancho;
    return rect;
  });
  return rawHtml(
    '<svg class="avance-lienzo" viewBox="0 0 100 10" preserveAspectRatio="none" ' +
      `aria-hidden="true" focusable="false">${tramos.join("")}</svg>`,
  );
}
