import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const AJENAS = new Set(["quiosco.ts", "quiosco.js"]);
const AJENAS_POR_RUTA: readonly string[] = ["dominio/quiosco/"];

const TRATOS: readonly string[] = [
  "usted",
  "Pulse ",
  "pulse ",
  "Vaya ",
  "vaya ",
  "Siéntese",
  "Abra ",
  "abra ",
  "Escriba ",
  "escriba ",
  "Seleccione ",
  "seleccione ",
  "Revise ",
  "revise ",
  "Copie ",
  "copie ",
  "Guarde ",
  "guarde ",
  "Confirme ",
  "Indique ",
  "indique ",
  "Solicite ",
  "solicite ",
  "Corrija ",
  "corrija ",
  "Ejecute ",
  "ejecute ",
  "Emita ",
  "emita ",
  "Espere ",
  "Elija ",
  "elija ",
  "Desea continuar",
];

interface Fuente {
  readonly nombre: string;
  readonly texto: string;
}

function sinComentarios(fuente: string, marcaDeLinea: string): string {
  const sinBloques = fuente.replace(/\/\*[\s\S]*?\*\//gu, "");
  return sinBloques
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith(marcaDeLinea))
    .join("\n");
}

function recorrer(directorio: URL, prefijo: string, extension: string): Fuente[] {
  const encontradas: Fuente[] = [];
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      encontradas.push(
        ...recorrer(
          new URL(`${entrada.name}/`, directorio),
          `${prefijo}${entrada.name}/`,
          extension,
        ),
      );
      continue;
    }
    if (!entrada.name.endsWith(extension) || AJENAS.has(entrada.name)) continue;
    if (AJENAS_POR_RUTA.some((ruta) => `${prefijo}${entrada.name}`.startsWith(ruta))) continue;
    encontradas.push({
      nombre: `${prefijo}${entrada.name}`,
      texto: readFileSync(new URL(entrada.name, directorio), "utf8"),
    });
  }
  return encontradas;
}

function consola(): readonly Fuente[] {
  const vistas = recorrer(new URL("../../src/web/pages/", import.meta.url), "", ".ts").map(
    (vista) => ({ ...vista, texto: sinComentarios(vista.texto, "//") }),
  );
  const rutas = recorrer(new URL("../../src/routes/", import.meta.url), "rutas/", ".ts").map(
    (ruta) => ({ ...ruta, texto: sinComentarios(ruta.texto, "//") }),
  );
  const dominio = recorrer(new URL("../../src/domain/", import.meta.url), "dominio/", ".ts").map(
    (parte) => ({ ...parte, texto: sinComentarios(parte.texto, "//") }),
  );
  return [...vistas, ...rutas, ...dominio];
}

function libroDeExcel(): readonly Fuente[] {
  return recorrer(new URL("../../../clients/excel/vba/", import.meta.url), "vba/", ".bas").map(
    (modulo) => ({ ...modulo, texto: sinComentarios(modulo.texto, "'") }),
  );
}

function tratosEn(fuente: Fuente): readonly string[] {
  return TRATOS.filter((trato) => fuente.texto.includes(trato));
}

describe("Voz · la plataforma no tutea ni manda", () => {
  it("hay material que revisar", () => {
    assert.ok(consola().length >= 30, "el recorrido de la consola no encontró casi nada");
    assert.ok(libroDeExcel().length >= 15, "el recorrido del libro no encontró casi nada");
  });

  it("ninguna pantalla de la consola se dirige a quien la mira", () => {
    for (const fuente of consola()) {
      const encontrados = tratosEn(fuente);
      assert.deepEqual(
        encontrados,
        [],
        `${fuente.nombre} habla en segunda persona: ${encontrados.join(", ")}`,
      );
    }
  });

  it("ningún módulo del libro de Excel se dirige a quien lo usa", () => {
    for (const fuente of libroDeExcel()) {
      const encontrados = tratosEn(fuente);
      assert.deepEqual(
        encontrados,
        [],
        `${fuente.nombre} habla en segunda persona: ${encontrados.join(", ")}`,
      );
    }
  });
});
