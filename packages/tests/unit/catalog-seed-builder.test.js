import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = path.resolve("tools/build/semilla-catalogo.js");
const MAPPING_SCRIPT = path.resolve("tools/build/mapeo-matriz.js");
const PRIVATE_DIR = path.resolve("referencias/privado");

/**
 * Cada prueba trabaja en su propio subdirectorio privado. El generador escribe en rutas fijas,
 * asi que sin este aislamiento la suite sobrescribiria los catalogos reales del operador.
 */
async function withSnapshot(snapshot, body) {
  const dir = path.join(PRIVATE_DIR, `.pruebas-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "hc-snapshot-prueba.json");
  await writeFile(file, JSON.stringify(snapshot), { mode: 0o600 });
  try {
    return await body(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function rows(dir, name) {
  const content = await readFile(path.join(dir, name), "utf8");
  return content.trim().split("\n").map((line) => line.split("\t"));
}

function seed(file, dir, extra = []) {
  return run(process.execPath, [SCRIPT, "--snapshot", file, "--out-dir", dir, ...extra]);
}

const SNAPSHOT = Object.freeze({
  schemaVersion: "HC_SNAPSHOT_V1",
  courses: [
    { sourceKey: "hc-course:5s", sourceColumn: "AJ", displayName: "5S" },
    { sourceKey: "hc-course:reinduccion", sourceColumn: "J", displayName: "REINDUCCION" }
  ],
  employees: [
    { employeeId: "17981", displayName: "MARTINEZ,CARLOS", area: "WADDING", position: "JEFE" },
    { employeeId: "123", displayName: "RUIZ,JOSE", area: "CALIDAD", position: "TECNICO" }
  ]
});

test("emite ambos catalogos con sus encabezados exactos", async () => {
  await withSnapshot(SNAPSHOT, async (file, dir) => {
    const { stdout } = await seed(file, dir);
    assert.match(stdout, /2 cursos/);
    assert.match(stdout, /2 trabajadores/);

    const courses = await rows(dir, "capacitaciones-seed.tsv");
    assert.deepEqual(courses[0], ["trainingId", "trainingName", "active", "version"]);
    assert.deepEqual(courses.slice(1).map((row) => row[1]), ["5S", "REINDUCCION"]);
    courses.slice(1).forEach((row) => assert.deepEqual(row.slice(2), ["TRUE", "1.0.0"]));

    const employees = await rows(dir, "empleados-seed.tsv");
    assert.deepEqual(employees[0], [
      "employeeId", "displayName", "area", "position", "shift", "active", "version"
    ]);
    assert.deepEqual(employees.slice(1).map((row) => row[0]), ["00123", "17981"]);
  });
});

test("el trainingId coincide con el que genera el mapeo de matriz", async () => {
  await withSnapshot(SNAPSHOT, async (file, dir) => {
    await seed(file, dir);
    const { stdout } = await run(process.execPath, [MAPPING_SCRIPT, "--snapshot", file]);

    const catalog = new Set((await rows(dir, "capacitaciones-seed.tsv")).slice(1).map((row) => row[0]));
    const mapping = stdout.trim().split("\n").slice(1).map((line) => line.split("\t")[0]);
    assert.equal(mapping.length, 2);
    mapping.forEach((trainingId) => {
      assert.ok(catalog.has(trainingId), `${trainingId} debe existir en CAPACITACIONES`);
    });
  });
});

test("normaliza el numero de trabajador a cinco digitos y rechaza uno invalido", async () => {
  await withSnapshot({
    ...SNAPSHOT,
    employees: [{ employeeId: "123456", displayName: "X", area: "", position: "" }]
  }, async (file, dir) => {
    await assert.rejects(
      () => seed(file, dir),
      (error) => /employeeId invalido/.test(error.stderr)
    );
  });
});

test("un identificador repetido detiene la generacion completa", async () => {
  await withSnapshot({
    ...SNAPSHOT,
    employees: [
      { employeeId: "17981", displayName: "A", area: "", position: "" },
      { employeeId: "17981", displayName: "B", area: "", position: "" }
    ]
  }, async (file, dir) => {
    await assert.rejects(
      () => seed(file, dir),
      (error) => /employeeId duplicado/.test(error.stderr)
    );
  });
});

test("un nombre que empieza con signo se neutraliza antes de llegar a Sheets", async () => {
  await withSnapshot({
    ...SNAPSHOT,
    employees: [{ employeeId: "17981", displayName: "=1+1", area: "", position: "" }]
  }, async (file, dir) => {
    await seed(file, dir);
    const employees = await rows(dir, "empleados-seed.tsv");
    assert.equal(employees[1][1], "'=1+1");
  });
});

test("el snapshot debe permanecer bajo referencias/privado", async () => {
  await assert.rejects(
    () => run(process.execPath, [SCRIPT, "--snapshot", "/tmp/fuera.json"]),
    (error) => /referencias\/privado/.test(error.stderr)
  );
});

test("la salida no puede escribirse fuera de referencias/privado", async () => {
  await withSnapshot(SNAPSHOT, async (file) => {
    await assert.rejects(
      () => run(process.execPath, [SCRIPT, "--snapshot", file, "--out-dir", "/tmp/fuera"]),
      (error) => /La salida debe permanecer bajo referencias\/privado/.test(error.stderr)
    );
  });
});
