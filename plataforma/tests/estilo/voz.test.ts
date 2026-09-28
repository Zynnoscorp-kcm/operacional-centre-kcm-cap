/**
 * La voz de la plataforma, contra todo lo que se lee en pantalla.
 *
 * La consola y el libro de Excel los usan varias personas del departamento, no
 * una. Un texto que habla de tú a tú —«pulse aquí», «vaya a esa computadora»,
 * «si no la tiene a mano, deje esto vacío»— se lee como una nota escrita para
 * quien estaba delante ese día, y envejece mal: la instrucción deja de ser
 * cierta, el que la lee no es el que la recibió, y nadie sabe si sigue valiendo.
 *
 * La regla es la del apagado, que es la pantalla que fijó el tono: **se dice lo
 * que pasa, no lo que hay que hacer**. «Excel dejará de poder mandar el
 * barrido» en vez de «recuerde que después no podrá mandar el barrido». Cuando
 * de verdad hace falta nombrar una acción, se nombra el control —«Revisar, en
 * el paso 1, enumera a los trabajadores»— y no a quien lo pulsa.
 *
 * Esta prueba vigila lo que se puede vigilar: el trato de cortesía en segunda
 * persona, que es la forma más visible de ese registro. Lo demás —que el texto
 * sea corto, que diga una sola cosa— no lo comprueba una expresión regular y
 * queda en `docs/referencia/VOZ_DE_LA_CONSOLA.md`.
 *
 * Dos exclusiones, las dos por escrito:
 *
 * - **El quiosco de sala.** Ahí la pantalla sí habla con una persona concreta
 *   que está de pie frente a ella registrando su asistencia, y «escriba los
 *   cinco dígitos» es exactamente lo que tiene que decir.
 * - **Los comentarios del código.** Se escriben para quien mantiene el
 *   programa, no para quien lo usa, y ahí el imperativo es normal.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/** Habla con el trabajador que está frente a la pantalla de la sala. */
const AJENAS = new Set(["quiosco.ts", "quiosco.js"]);
/**
 * El dominio del quiosco responde a la misma persona de pie frente a la sala:
 * «Seleccione un nombre válido de la lista» es lo que el departamento pidió que
 * dijera cuando el curso no está en el catálogo.
 */
const AJENAS_POR_RUTA: readonly string[] = ["dominio/quiosco/"];

/**
 * Imperativos de cortesía. Están en singular y con mayúscula o minúscula porque
 * así aparecen: al principio de una frase o después de dos puntos.
 *
 * No entran los que en español son también otra cosa —«Marque», «Note»— ni los
 * verbos que sólo suenan a instrucción en contexto, para que la prueba no
 * empiece a pedir excepciones. Con estos alcanza: son los que aparecían.
 */
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

/** El código sin sus comentarios: es lo único que llega a la pantalla. */
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
