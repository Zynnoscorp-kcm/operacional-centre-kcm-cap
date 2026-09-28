/**
 * El recorrido entre pantallas.
 *
 * La consola no carga guiones —la política declara `default-src 'none'`—, así
 * que la animación entre secciones la hace el navegador solo, a partir de los
 * `view-transition-name` que la hoja de estilos pone en el armazón.
 *
 * El mecanismo tiene una regla dura y una forma silenciosa de fallar: si un
 * documento repite un nombre, el navegador **cancela la transición entera** y no
 * avisa. No hay error en consola, no hay estilo roto que se vea; simplemente
 * vuelve el parpadeo de recarga y nadie sabe por qué. De ahí que esto se
 * comprueba aquí y no a ojo.
 *
 * Lo que se vigila:
 *
 * 1. **Una sola píldora encendida en el lateral** por documento, que es la que
 *    el navegador desliza de una sección a la siguiente.
 * 2. **Una sola sub-pestaña encendida** en la tira del armazón. La ficha DC-3
 *    dibuja una segunda tira de `.subpestanas` —la del plan del candidato— con
 *    su propio `aria-current`, y por eso el selector de la hoja está acotado a
 *    `.lienzo >`. Si alguien lo desacota, esta prueba es la que lo detiene.
 * 3. **Los nombres siguen escritos** en la hoja servida. Son cinco líneas de
 *    CSS sin las cuales todo lo demás sigue compilando igual.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hojaDeEstilos } from "../../src/web/estaticos.ts";
import { html } from "../../src/web/kit/html.ts";
import { renderLayout } from "../../src/web/layout.ts";

/** Toda ruta que el menú lateral sabe dibujar, secciones y sub-pestañas. */
const RUTAS_DEL_MENU: readonly string[] = [
  "/",
  "/sesiones",
  "/salas",
  "/preliberacion",
  "/liberacion",
  "/auditoria",
  "/auditoria/sesiones",
  "/auditoria/salas",
  "/auditoria/liberaciones",
  "/trabajadores",
  "/trabajadores/cursos",
  "/trabajadores/cobertura",
  "/trabajadores/departamentos",
  "/matriz",
  "/padron",
  "/sincronia",
  "/cargas",
  "/ocupaciones",
  "/dc3",
  "/excel",
  "/base",
  "/campos",
];

function pantalla(rutaActiva: string): string {
  return renderLayout({
    titulo: "Pantalla",
    subtitulo: "Prueba",
    entorno: "development",
    contenido: html`<p>Contenido</p>`,
    rutaActiva,
  });
}

/** Cuántos elementos de una clase llevan `aria-current="page"` en el documento. */
function encendidos(documento: string, clase: "lateral-enlace" | "subpestana"): number {
  const patron = new RegExp(`class="${clase}"[\\s\\S]{0,140}?aria-current="page"`, "g");
  return [...documento.matchAll(patron)].length;
}

describe("Recorrido entre pantallas", () => {
  it("ningún documento enciende dos veces la píldora del lateral", () => {
    for (const ruta of RUTAS_DEL_MENU) {
      const cuantas = encendidos(pantalla(ruta), "lateral-enlace");
      assert.equal(cuantas, 1, `${ruta} encendió ${cuantas} entradas del lateral, y debe ser 1`);
    }
  });

  it("ningún documento enciende dos sub-pestañas del armazón", () => {
    for (const ruta of RUTAS_DEL_MENU) {
      const cuantas = encendidos(pantalla(ruta), "subpestana");
      assert.ok(cuantas <= 1, `${ruta} encendió ${cuantas} sub-pestañas del armazón`);
    }
  });

  it("la hoja declara el recorrido y nombra las cuatro piezas del armazón", () => {
    const hoja = hojaDeEstilos.contenido;

    assert.match(hoja, /@view-transition\s*\{\s*navigation:\s*auto;/u);
    for (const nombre of ["kcm-rail", "kcm-barra", "kcm-pestanas", "kcm-lienzo"]) {
      assert.match(hoja, new RegExp(`view-transition-name:\\s*${nombre};`, "u"));
    }
  });

  it("la sub-pestaña activa se nombra sólo dentro del armazón, no en la del plan DC-3", () => {
    // Sin el `.lienzo >`, la tira del plan del candidato repetiría el nombre y
    // el navegador cancelaría la transición en toda la ficha DC-3.
    assert.match(
      hojaDeEstilos.contenido,
      /\.lienzo > \.subpestanas > \.subpestana\[aria-current="page"\]/u,
    );
  });

  it("quien pide menos movimiento no ve el recorrido", () => {
    // `*` no alcanza a los pseudo-elementos de la transición: los crea el
    // navegador y no descienden de nada, así que hay que nombrarlos.
    const hoja = hojaDeEstilos.contenido;
    const bloque = hoja.slice(hoja.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(bloque, /::view-transition-group\(\*\)/u);
    assert.match(bloque, /animation:\s*none\s*!important;/u);
  });
});
