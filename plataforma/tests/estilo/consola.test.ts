/**
 * El sistema de diseño de la consola, contra todas sus pantallas.
 *
 * Dos reglas que no se pueden comprobar mirando una pantalla, porque romperlas
 * no produce un error: produce un elemento que se ve mal y nadie relaciona con
 * el cambio que lo causó.
 *
 * 1. Cada clase que una vista usa existe en la hoja. Una clase inventada
 *    —`insignia-cerrado` donde la hoja dice `insignia-inactivo`— sale como HTML
 *    perfectamente válido y simplemente aparece sin estilo.
 * 2. Ninguna vista lleva estilo en un atributo `style`. La política de
 *    contenido declara `style-src 'self'` sin `'unsafe-inline'`, así que el
 *    navegador descarta ese atributo: el estilo no es que sea mala práctica, es
 *    que no se aplica. Tres `style="display:inline"` vivieron así en la vista de
 *    sesiones sin hacer nada.
 *
 * Se lee el código fuente de las vistas, no su salida: así no hace falta un
 * accesorio por pantalla y entran también las ramas que un accesorio no visita.
 * El precio es que sólo se ven las clases escritas literalmente; las que se
 * arman por interpolación quedan fuera, y por eso `estilo-barridos.test.ts`
 * sigue comprobando la salida ya renderizada de dos pantallas completas.
 *
 * El quiosco de sala queda fuera de las dos reglas y por escrito: es una
 * pantalla suelta que no usa esta hoja y declara su propia política con
 * `'unsafe-inline'`.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const HOJAS = ["tokens.css", "base.css"] as const;

/** Vive fuera de la hoja de la consola y con su propia política de contenido. */
const AJENAS = new Set(["quiosco.ts"]);

const declaradas = new Set(
  [
    ...HOJAS.map((hoja) =>
      readFileSync(new URL(`../../src/web/assets/${hoja}`, import.meta.url), "utf8"),
    )
      .join("\n")
      .matchAll(/\.([a-zA-Z][\w-]*)/gu),
  ].map((coincidencia) => coincidencia[1]),
);

/** `class="a b"` entero, sin una sola interpolación dentro. */
const LITERAL = /class="([^"$\n{}]*)"/gu;
/** El tramo literal que antecede a la primera interpolación de `class="a ${b}"`. */
const PREFIJO = /class="([^"$\n{}]*)\$\{/gu;

interface Vista {
  readonly nombre: string;
  readonly fuente: string;
}

function vistas(): readonly Vista[] {
  const raiz = new URL("../../src/web/pages/", import.meta.url);
  const encontradas: Vista[] = [];

  const recorrer = (directorio: URL, prefijo: string): void => {
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      if (entrada.isDirectory()) {
        recorrer(new URL(`${entrada.name}/`, directorio), `${prefijo}${entrada.name}/`);
        continue;
      }
      if (!entrada.name.endsWith(".ts") || AJENAS.has(entrada.name)) continue;
      encontradas.push({
        nombre: `${prefijo}${entrada.name}`,
        fuente: readFileSync(new URL(entrada.name, directorio), "utf8"),
      });
    }
  };

  recorrer(raiz, "");
  // La envoltura no es una vista pero dibuja el lateral y la barra de todas.
  encontradas.push({
    nombre: "layout.ts",
    fuente: readFileSync(new URL("../../src/web/layout.ts", import.meta.url), "utf8"),
  });
  return encontradas;
}

function clasesLiterales(fuente: string): readonly string[] {
  const usadas = new Set<string>();

  for (const coincidencia of fuente.matchAll(LITERAL)) {
    for (const clase of (coincidencia[1] ?? "").split(/\s+/u).filter(Boolean)) usadas.add(clase);
  }

  for (const coincidencia of fuente.matchAll(PREFIJO)) {
    const prefijo = coincidencia[1] ?? "";
    const clases = prefijo.split(/\s+/u).filter(Boolean);
    // Sin espacio antes de la interpolación, la última no está completa:
    // `class="radar-estado-${estado}"` no usa la clase `radar-estado-`.
    if (!/\s$/u.test(prefijo)) clases.pop();
    for (const clase of clases) usadas.add(clase);
  }

  return [...usadas];
}

describe("Consola · sistema de diseño", () => {
  it("hay pantallas que revisar", () => {
    assert.ok(vistas().length >= 15, "el recorrido de vistas no encontró casi nada");
  });

  it("ninguna vista usa una clase que la hoja no declare", () => {
    for (const vista of vistas()) {
      const huerfanas = clasesLiterales(vista.fuente)
        .filter((clase) => !declaradas.has(clase))
        .sort();
      assert.deepEqual(
        huerfanas,
        [],
        `${vista.nombre} usa clases sin estilo: ${huerfanas.join(", ")}`,
      );
    }
  });

  it("ninguna vista lleva estilo en línea, que la política descartaría", () => {
    for (const vista of vistas()) {
      assert.doesNotMatch(vista.fuente, /\sstyle="/u, `${vista.nombre} lleva estilo en línea`);
    }
  });
});
