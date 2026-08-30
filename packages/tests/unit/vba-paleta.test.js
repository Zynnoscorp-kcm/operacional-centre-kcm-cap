import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * El libro de Excel y la consola son la misma plataforma y tienen que verse igual.
 *
 * La hoja de estilos manda. Esta prueba recalcula cada constante de KcmPanel desde
 * `tokens.css` y falla si se separan. Existe porque ya se habian separado: cuatro de las nueve
 * llevaban un numero que no correspondia a su propio comentario, y nadie podia notarlo mirando
 * el codigo --VBA guarda el color como azul-verde-rojo, asi que el numero no se parece al
 * hexadecimal--. Se veia en la pantalla, en un azul apenas distinto, y ahi nadie lo mide.
 */
const TOKENS = {
  COLOR_MARCA: "--kcm-brand",
  COLOR_MARCA_OSCURA: "--kcm-brand-dark",
  COLOR_TINTA: "--kcm-ink",
  COLOR_APAGADO: "--kcm-muted",
  COLOR_LIENZO: "--kcm-canvas",
  COLOR_BLANCO: "--kcm-surface",
  COLOR_OK: "--kcm-ok",
  COLOR_AVISO: "--kcm-warn",
  COLOR_ALERTA: "--kcm-danger"
};

// Los modulos que pintan. Ninguno debe llevar un color suelto: si hace falta uno nuevo, se
// agrega a la paleta y a `tokens.css`, no al sitio donde se usa.
const MODULOS_QUE_PINTAN = ["KcmPanel.bas", "KcmConfigButtons.bas", "KcmMatrixPanel.bas"];

const hojaDeEstilos = await readFile("plataforma/src/web/assets/tokens.css", "utf8");
const panel = await readFile("clients/excel/vba/KcmPanel.bas", "utf8");

function tokenHex(nombre) {
  // Sólo el bloque claro: el tema oscuro redefine algunos y el libro no tiene tema.
  const claro = hojaDeEstilos.split("@media")[0];
  const encontrado = new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(claro);
  assert.ok(encontrado, `tokens.css no declara ${nombre}`);
  return encontrado[1].toUpperCase();
}

// Excel guarda el color como entero en orden azul-verde-rojo.
function aLargoDeVba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r + g * 256 + b * 65536;
}

test("la paleta del libro es la de tokens.css, color por color", () => {
  for (const [constante, token] of Object.entries(TOKENS)) {
    const declarado = new RegExp(`Public Const ${constante} As Long = (\\d+)`).exec(panel);
    assert.ok(declarado, `KcmPanel.bas no declara ${constante}`);
    const hex = tokenHex(token);
    assert.equal(
      Number(declarado[1]),
      aLargoDeVba(hex),
      `${constante} deberia valer ${aLargoDeVba(hex)} para ser ${hex} (${token})`
    );
  }
});

test("el comentario de cada constante dice su hexadecimal verdadero", () => {
  for (const constante of Object.keys(TOKENS)) {
    const linea = new RegExp(`Public Const ${constante} As Long = (\\d+)\\s*' (#[0-9A-F]{6})`).exec(panel);
    assert.ok(linea, `${constante} deberia declarar su hexadecimal en el comentario`);
    assert.equal(Number(linea[1]), aLargoDeVba(linea[2]), `el comentario de ${constante} miente`);
  }
});

test("ningun modulo que pinta lleva colores sueltos", async () => {
  for (const modulo of MODULOS_QUE_PINTAN) {
    const fuente = await readFile(`clients/excel/vba/${modulo}`, "utf8");
    const codigo = fuente.split(/\r?\n/).filter((linea) => !/^\s*'/.test(linea)).join("\n");
    const sueltos = codigo.match(/RGB\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g) || [];
    assert.deepEqual(sueltos, [], `${modulo} usa colores fuera de la paleta: ${sueltos.join(", ")}`);
  }
});
