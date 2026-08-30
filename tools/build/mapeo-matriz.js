#!/usr/bin/env node
/**
 * Propone las filas de `MATRIZ_MAPEO` a partir de un snapshot HC privado.
 *
 * El snapshot conserva `sourceColumn`, la letra real donde vive cada curso en la hoja HC del XLSB.
 * `HC_CURSOS` no la persiste, de modo que sin este puente el tablero no puede decirle a la VBA en
 * qué columna escribir. El `trainingId` se deriva con la misma regla que `KcmOperationalHcService`.
 *
 * No escribe en Google ni en el XLSB: imprime TSV para revisar y pegar.
 *
 *   npm run build:mapeo-matriz -- --snapshot referencias/privado/hc-snapshot-....json
 */
import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const PRIVATE_DIR = path.resolve("referencias/privado");
const HEADERS = [
  "trainingId", "destinationSheet", "destinationColumn", "destinationHeader",
  "headerRow", "mappingVersion", "overwritePolicy", "active"
];

function parseArguments(argv) {
  const options = {
    snapshot: "",
    sheet: "HC",
    headerRow: 3,
    version: `matriz-${new Date().toISOString().slice(0, 7)}`,
    policy: "NO_OVERWRITE"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split("=");
    const value = inline === undefined ? argv[index += 1] : inline;
    if (flag === "--snapshot") options.snapshot = String(value || "");
    else if (flag === "--sheet") options.sheet = String(value || "");
    else if (flag === "--header-row") options.headerRow = Number(value);
    else if (flag === "--mapping-version") options.version = String(value || "");
    else if (flag === "--overwrite-policy") options.policy = String(value || "");
    else throw new Error(`Bandera no reconocida: ${flag}`);
  }
  if (!Number.isInteger(options.headerRow) || options.headerRow < 1) {
    throw new Error("--header-row debe ser un entero positivo");
  }
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(options.version)) {
    throw new Error("--mapping-version admite letras, digitos, punto, guion y guion bajo");
  }
  if (!["NO_OVERWRITE", "OVERWRITE"].includes(options.policy)) {
    throw new Error("--overwrite-policy admite NO_OVERWRITE u OVERWRITE");
  }
  return options;
}

/** El snapshot es privado: sólo se acepta una ruta que permanezca bajo `referencias/privado/`. */
async function resolveSnapshot(requested) {
  if (requested) {
    const resolved = path.resolve(requested);
    if (resolved !== PRIVATE_DIR && !resolved.startsWith(`${PRIVATE_DIR}${path.sep}`)) {
      throw new Error("El snapshot debe permanecer bajo referencias/privado/");
    }
    return resolved;
  }
  const entries = (await readdir(PRIVATE_DIR)).filter((name) => name.endsWith(".json")).sort();
  if (!entries.length) throw new Error("No hay snapshot HC en referencias/privado/");
  return path.join(PRIVATE_DIR, entries.at(-1));
}

function trainingIdFor(sourceKey) {
  return `HC-${crypto.createHash("sha256").update(sourceKey, "utf8").digest("hex").slice(0, 20).toUpperCase()}`;
}

function columnIndex(letters) {
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0);
}

/** Un TSV no debe poder inyectar fórmulas ni romper la fila al pegarse en Sheets. */
function tsvCell(value) {
  const text = String(value).replace(/[\t\r\n]+/g, " ").trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const snapshotPath = await resolveSnapshot(options.snapshot);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const courses = Array.isArray(snapshot.courses) ? snapshot.courses : [];
  if (!courses.length) throw new Error("El snapshot no contiene cursos");

  const seenColumn = new Map();
  const seenTraining = new Set();
  const rows = courses
    .map((course) => {
      const sourceKey = String(course.sourceKey || "");
      const column = String(course.sourceColumn || "").toUpperCase();
      if (!/^hc-course:.+/.test(sourceKey)) throw new Error(`sourceKey invalido: ${sourceKey}`);
      if (!/^[A-Z]{1,3}$/.test(column)) throw new Error(`sourceColumn invalida en ${sourceKey}`);
      const trainingId = trainingIdFor(sourceKey);
      if (seenTraining.has(trainingId)) throw new Error(`trainingId duplicado para ${sourceKey}`);
      seenTraining.add(trainingId);
      const previous = seenColumn.get(column);
      if (previous) throw new Error(`La columna ${column} la reclaman ${previous} y ${sourceKey}`);
      seenColumn.set(column, sourceKey);
      return { trainingId, column, displayName: String(course.displayName || ""), sourceKey };
    })
    .sort((left, right) => columnIndex(left.column) - columnIndex(right.column));

  const lines = [HEADERS.join("\t")].concat(rows.map((row) => [
    row.trainingId, options.sheet, row.column, row.displayName,
    options.headerRow, options.version, options.policy, "TRUE"
  ].map(tsvCell).join("\t")));

  process.stdout.write(`${lines.join("\n")}\n`);
  process.stderr.write(
    `\n${rows.length} cursos desde ${path.basename(snapshotPath)}\n` +
    `Revise la columna destino antes de pegar en MATRIZ_MAPEO; ` +
    `el trainingId sólo coincide si la importación HC deriva el mismo sourceKey.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
