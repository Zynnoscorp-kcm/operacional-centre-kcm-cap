import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const HOJAS = ["tokens.css", "base.css"] as const;

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

const LITERAL = /class="([^"$\n{}]*)"/gu;
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
