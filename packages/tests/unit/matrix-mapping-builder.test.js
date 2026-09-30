import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = path.resolve("tools/build/mapeo-matriz.js");
const PRIVATE_DIR = path.resolve("referencias/privado");

function snapshot(courses) {
  return JSON.stringify({ schemaVersion: "HC_SNAPSHOT_V1", courses });
}

async function withPrivateSnapshot(courses, body) {
  const dir = path.join(PRIVATE_DIR, `.pruebas-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "hc-snapshot-prueba.json");
  await writeFile(file, snapshot(courses), { mode: 0o600 });
  try {
    return await body(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function build(file, extra = []) {
  return run(process.execPath, [SCRIPT, "--snapshot", file, ...extra]);
}

test("deriva el trainingId con la misma regla que la importacion HC", async () => {
  const sourceKey = "hc-course:reinduccion-a-la-empresa";
  const expected = `HC-${crypto.createHash("sha256").update(sourceKey, "utf8").digest("hex").slice(0, 20).toUpperCase()}`;

  await withPrivateSnapshot([
    { sourceKey, sourceColumn: "J", displayName: "REINDUCCION A LA EMPRESA" }
  ], async (file) => {
    const { stdout } = await build(file, ["--mapping-version", "matriz-prueba-01"]);
    const lines = stdout.trim().split("\n");
    assert.deepEqual(lines[0].split("\t"), [
      "trainingId", "destinationSheet", "destinationColumn", "destinationHeader",
      "headerRow", "mappingVersion", "overwritePolicy", "active"
    ]);
    assert.deepEqual(lines[1].split("\t"), [
      expected, "HC", "J", "REINDUCCION A LA EMPRESA", "3", "matriz-prueba-01", "NO_OVERWRITE", "TRUE"
    ]);
  });
});

test("la version por omision es el mes vigente en UTC, no una fecha fija", async () => {
  await withPrivateSnapshot([
    { sourceKey: "hc-course:x", sourceColumn: "J", displayName: "X" }
  ], async (file) => {
    const { stdout } = await build(file);
    const version = stdout.trim().split("\n")[1].split("\t")[5];
    assert.match(version, /^matriz-\d{4}-\d{2}$/);
    assert.equal(version, `matriz-${new Date().toISOString().slice(0, 7)}`);
  });
});

test("ordena por columna real de la matriz, no alfabeticamente", async () => {
  await withPrivateSnapshot([
    { sourceKey: "hc-course:5s", sourceColumn: "AJ", displayName: "5S" },
    { sourceKey: "hc-course:bpr", sourceColumn: "AA", displayName: "BPR" },
    { sourceKey: "hc-course:reinduccion", sourceColumn: "J", displayName: "REINDUCCION" }
  ], async (file) => {
    const { stdout } = await build(file);
    const columns = stdout.trim().split("\n").slice(1).map((line) => line.split("\t")[2]);
    assert.deepEqual(columns, ["J", "AA", "AJ"]);
  });
});

test("dos cursos no pueden reclamar la misma columna destino", async () => {
  await withPrivateSnapshot([
    { sourceKey: "hc-course:uno", sourceColumn: "J", displayName: "UNO" },
    { sourceKey: "hc-course:dos", sourceColumn: "J", displayName: "DOS" }
  ], async (file) => {
    await assert.rejects(() => build(file), (error) => /La columna J la reclaman/.test(error.stderr));
  });
});

test("un nombre que empieza con signo se neutraliza antes de llegar a Sheets", async () => {
  await withPrivateSnapshot([
    { sourceKey: "hc-course:formula", sourceColumn: "J", displayName: "=HYPERLINK(\"http://x\")" }
  ], async (file) => {
    const { stdout } = await build(file);
    assert.equal(stdout.trim().split("\n")[1].split("\t")[3], "'=HYPERLINK(\"http://x\")");
  });
});

test("el snapshot debe permanecer bajo referencias/privado", async () => {
  const outside = await mkdtemp(path.join(tmpdir(), "kcm-mapeo-"));
  const file = path.join(outside, "snapshot.json");
  await writeFile(file, snapshot([{ sourceKey: "hc-course:x", sourceColumn: "J", displayName: "X" }]));
  try {
    await assert.rejects(
      () => build(file),
      (error) => /referencias\/privado/.test(error.stderr)
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("rechaza banderas y valores fuera de contrato sin producir mapeo", async () => {
  await withPrivateSnapshot([
    { sourceKey: "hc-course:x", sourceColumn: "J", displayName: "X" }
  ], async (file) => {
    await assert.rejects(() => build(file, ["--header-row", "0"]), (error) => /header-row/.test(error.stderr));
    await assert.rejects(() => build(file, ["--overwrite-policy", "FORZAR"]), (error) => /overwrite-policy/.test(error.stderr));
    await assert.rejects(() => build(file, ["--desconocida", "1"]), (error) => /no reconocida/.test(error.stderr));
  });
});

test("una columna fuente invalida detiene la propuesta completa", async () => {
  await withPrivateSnapshot([
    { sourceKey: "hc-course:x", sourceColumn: "J", displayName: "X" },
    { sourceKey: "hc-course:y", sourceColumn: "1A", displayName: "Y" }
  ], async (file) => {
    await assert.rejects(() => build(file), (error) => /sourceColumn invalida/.test(error.stderr));
  });
});
