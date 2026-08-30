/**
 * Paridad de identidad entre el cliente Excel y el extractor Node.
 *
 * `sourceKey` decide el `trainingId` de cada capacitacion. Si el cliente VBA deriva una identidad
 * distinta a la que produjo el extractor, la importacion no reconoce el curso: HC lo da de alta
 * como una capacitacion nueva y desactiva la anterior. `normalizedName` tiene un efecto inmediato:
 * el servidor lo recalcula y responde CONFLICT si no coincide.
 *
 * Aqui se reconstruye en JavaScript el algoritmo declarado en `KcmBridgeCore.bas` -- incluida su
 * tabla de plegado, leida del propio `.bas` -- y se contrasta contra el extractor.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { normalizedCourseName, normalizedLabel } from "../../xlsb/extract-hc-xlsb.js";

const core = await readFile(path.resolve("clients/excel/vba/KcmBridgeCore.bas"), "utf8");
const matrixSync = await readFile(path.resolve("clients/excel/vba/KcmMatrixSync.bas"), "utf8");

/** Tabla de plegado tal como la declara el cliente. */
const foldTable = new Map();
for (const match of core.matchAll(/KcmAddFold "([A-Z]+)", "([0-9A-F,]+)"/g)) {
  for (const code of match[2].split(",")) foldTable.set(Number.parseInt(code, 16), match[1]);
}

/** Intervalos de separador compartido declarados en `KcmIsSharedSeparator`. */
const separatorRanges = (() => {
  const body = core.slice(
    core.indexOf("Private Function KcmIsSharedSeparator"),
    core.indexOf("Public Function KcmUnfoldableCharacter")
  );
  const ranges = [];
  for (const match of body.matchAll(/code >= &H([0-9A-F]+) And code <= &H([0-9A-F]+)/g)) {
    ranges.push([Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)]);
  }
  for (const match of body.matchAll(/code = &H([0-9A-F]+)/g)) {
    const code = Number.parseInt(match[1], 16);
    ranges.push([code, code]);
  }
  return ranges;
})();

const isSharedSeparator = (code) => separatorRanges.some(([low, high]) => code >= low && code <= high);

/** `KcmNormalizeLabel`: recorre unidades de codigo UTF-16, igual que `Mid$`. */
function vbaNormalizeLabel(value) {
  let output = "";
  for (const character of String(value).split("")) {
    const code = character.charCodeAt(0);
    let folded = "";
    if (code >= 97 && code <= 122) folded = String.fromCharCode(code - 32);
    else if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) folded = character;
    else if (foldTable.has(code)) folded = foldTable.get(code);
    if (folded) output += folded;
    else if (output.length > 0 && !output.endsWith(" ")) output += " ";
  }
  return output.replace(/ +$/, "");
}

/** `KcmSourceSlug`. */
function vbaSourceSlug(value) {
  return vbaNormalizeLabel(String(value).split("&").join(" y "))
    .toLowerCase()
    .split(" ")
    .join("-");
}

/** `KcmUnfoldableCharacter`. */
function vbaUnfoldableCharacter(value) {
  for (const character of String(value).split("")) {
    const code = character.charCodeAt(0);
    if (code > 127 && !foldTable.has(code) && !isSharedSeparator(code)) return code;
  }
  return 0;
}

const LABELS = [
  "QMS",
  "Induccion a la empresa",
  "INDUCCIONÓN",
  "INDUCCIÓN A LA EMPRESA",
  "Protección Auditiva",
  "SEGURIDAD & SALUD",
  "Seguridad y Salud",
  "MANEJO DE MONTACARGAS / PATIN HIDRAULICO",
  "NOM-004 LOTO",
  "Bloqueo   y    etiquetado",
  "  Espacios Confinados  ",
  "Trabajo en alturas (nivel 2)",
  "Primeros auxilios - RCP",
  "AÑO 2026",
  "Niños y jóvenes",
  "Brigada contra incendios: teoria",
  "Manejo de residuos peligrosos.",
  "5S",
  "ISO 9001:2015",
  "Uso de EPP – basico",
  "Temperatura 40°C",
  "¿Que es calidad?",
  "Riesgo eléctrico «NOM-029»",
  "SISTEMAS DE PROTECCIÓN Y DISPOSITIVOS DE SEGURIDAD EN LA MAQUINARIA Y EQUIPO, " +
    "PARA PREVENIR Y PROTEGER A LOS TRABAJADORES CONTRA LOS RIESGOS DE TRABAJO LOTO",
  "Capacitación — Fase I",
  "Máquinas y equipo",
  "ÚLTIMA REVISIÓN",
  "Auditoría interna",
  "TÉCNICO ESPECIALISTA",
  "Manejo de grúa"
];

test("el slug del cliente coincide con el del extractor para etiquetas realistas", () => {
  const divergences = [];
  for (const label of LABELS) {
    assert.equal(vbaUnfoldableCharacter(label), 0, `la etiqueta ${label} deberia ser interpretable`);
    const expected = normalizedLabel(label);
    const actual = vbaSourceSlug(label);
    if (actual !== expected) divergences.push(`${label}: cliente=${actual} extractor=${expected}`);
  }
  assert.deepEqual(divergences, [], divergences.join("\n"));
});

test("el nombre normalizado del cliente coincide con el que recalcula el servidor", () => {
  const divergences = [];
  for (const label of LABELS) {
    const expected = normalizedCourseName(label);
    const actual = vbaNormalizeLabel(label);
    if (actual !== expected) divergences.push(`${label}: cliente=${actual} servidor=${expected}`);
  }
  assert.deepEqual(divergences, [], divergences.join("\n"));
});

test("cada caracter que el cliente trata como separador tambien lo es para el extractor", () => {
  const unsafe = [];
  for (const [low, high] of separatorRanges) {
    for (let code = low; code <= high; code += 1) {
      // El extractor conserva letras y digitos tras NFKD; si sobrevive alguno, el cliente y el
      // extractor producirian slugs distintos para la misma etiqueta.
      if (normalizedLabel(String.fromCharCode(code)) !== "") {
        unsafe.push(`U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
  }
  assert.deepEqual(unsafe, [], `intervalos con contenido alfanumerico: ${unsafe.join(", ")}`);
  assert.ok(separatorRanges.length >= 7, "se esperaban los intervalos declarados en el cliente");
});

test("una letra fuera de la tabla de plegado bloquea el snapshot en lugar de forkear la identidad", () => {
  for (const character of ["Ø", "Æ", "Þ", "Δ", "Ж", "²", "½"]) {
    assert.notEqual(vbaUnfoldableCharacter(character), 0,
      `${character} debe considerarse no interpretable`);
  }
  assert.match(matrixSync, /unfoldable = KcmUnfoldableCharacter\(text\)/);
  assert.match(matrixSync, /que el cliente y el extractor no normalizan igual/);
});

test("el slug resultante cabe en la clave opaca que valida el servidor", () => {
  const opaque = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
  for (const label of LABELS) {
    const sourceKey = `hc-course:${vbaSourceSlug(label)}`;
    assert.match(sourceKey, opaque, `sourceKey invalido para ${label}`);
    assert.ok(sourceKey.length <= 200, `sourceKey demasiado largo para ${label}`);
  }
  assert.match(matrixSync, /KCM_SOURCE_KEY_LIMIT As Long = 200/);
});
