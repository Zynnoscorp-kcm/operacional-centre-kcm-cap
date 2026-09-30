#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PRIVATE_DIR = path.resolve("referencias/privado");
const COURSE_HEADERS = ["trainingId", "trainingName", "active", "version"];
const EMPLOYEE_HEADERS = [
  "employeeId", "displayName", "area", "position", "shift", "active", "version"
];
const CONTRACT_VERSION = "1.0.0";

function parseArguments(argv) {
  const options = { snapshot: "", version: CONTRACT_VERSION, outDir: PRIVATE_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split("=");
    const value = inline === undefined ? argv[index += 1] : inline;
    if (flag === "--snapshot") options.snapshot = String(value || "");
    else if (flag === "--version") options.version = String(value || "");
    else if (flag === "--out-dir") options.outDir = insidePrivate(String(value || ""), "La salida");
    else throw new Error(`Bandera no reconocida: ${flag}`);
  }
  return options;
}

function insidePrivate(candidate, subject) {
  const resolved = path.resolve(candidate);
  if (resolved !== PRIVATE_DIR && !resolved.startsWith(`${PRIVATE_DIR}${path.sep}`)) {
    throw new Error(`${subject} debe permanecer bajo referencias/privado/`);
  }
  return resolved;
}

async function resolveSnapshot(requested) {
  if (requested) return insidePrivate(requested, "El snapshot");
  const entries = (await readdir(PRIVATE_DIR))
    .filter((name) => name.startsWith("hc-snapshot-") && name.endsWith(".json")).sort();
  if (!entries.length) throw new Error("No hay snapshot HC en referencias/privado/");
  return path.join(PRIVATE_DIR, entries.at(-1));
}

function trainingIdFor(sourceKey) {
  return `HC-${crypto.createHash("sha256").update(sourceKey, "utf8").digest("hex").slice(0, 20).toUpperCase()}`;
}

function tsvCell(value) {
  const text = String(value === undefined || value === null ? "" : value)
    .replace(/[\t\r\n]+/g, " ").trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function table(headers, rows) {
  return [headers.join("\t")].concat(rows.map((row) => row.map(tsvCell).join("\t"))).join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const snapshotPath = await resolveSnapshot(options.snapshot);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));

  const courses = Array.isArray(snapshot.courses) ? snapshot.courses : [];
  const employees = Array.isArray(snapshot.employees) ? snapshot.employees : [];
  if (!courses.length || !employees.length) {
    throw new Error("El snapshot no contiene cursos y trabajadores");
  }

  const seenTraining = new Set();
  const courseRows = courses.map((course) => {
    const sourceKey = String(course.sourceKey || "");
    if (!/^hc-course:.+/.test(sourceKey)) throw new Error(`sourceKey invalido: ${sourceKey}`);
    const trainingId = trainingIdFor(sourceKey);
    if (seenTraining.has(trainingId)) throw new Error(`trainingId duplicado para ${sourceKey}`);
    seenTraining.add(trainingId);
    return [trainingId, String(course.displayName || trainingId), "TRUE", options.version];
  }).sort((left, right) => String(left[1]).localeCompare(String(right[1])));

  const seenEmployee = new Set();
  const employeeRows = employees.map((employee) => {
    const employeeId = String(employee.employeeId || "").padStart(5, "0");
    if (!/^\d{5}$/.test(employeeId)) throw new Error(`employeeId invalido: ${employee.employeeId}`);
    if (seenEmployee.has(employeeId)) throw new Error(`employeeId duplicado: ${employeeId}`);
    seenEmployee.add(employeeId);
    return [
      employeeId, String(employee.displayName || ""), String(employee.area || ""),
      String(employee.position || ""), "", "TRUE", options.version
    ];
  }).sort((left, right) => String(left[0]).localeCompare(String(right[0])));

  const coursePath = path.join(options.outDir, "capacitaciones-seed.tsv");
  const employeePath = path.join(options.outDir, "empleados-seed.tsv");
  await writeFile(coursePath, `${table(COURSE_HEADERS, courseRows)}\n`, { mode: 0o600 });
  await writeFile(employeePath, `${table(EMPLOYEE_HEADERS, employeeRows)}\n`, { mode: 0o600 });

  const leadingZeros = employeeRows.filter((row) => row[0].startsWith("0")).length;
  process.stdout.write(
    `${courseRows.length} cursos  -> ${path.relative(process.cwd(), coursePath)}\n` +
    `${employeeRows.length} trabajadores -> ${path.relative(process.cwd(), employeePath)}\n` +
    `${leadingZeros} numeros de trabajador empiezan con cero: formatee la columna A como texto antes de pegar\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
