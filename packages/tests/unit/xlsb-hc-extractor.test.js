import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildSyntheticXlsb,
  serialForIso,
  syntheticCourseNames
} from "../fixtures/synthetic/xlsb-fixture.js";
import {
  assertSafeOutputPath,
  canonicalJson,
  extractHcSnapshot,
  extractHcSnapshotFromBuffer,
  snapshotIsApplicable,
  writeSnapshotFile
} from "../../xlsb/extract-hc-xlsb.js";

const FIXED_EXTRACTION_TIME = "2026-07-26T12:00:00.000Z";
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byDisplayName(snapshot, displayName) {
  return snapshot.courses.find((course) => course.displayName === displayName);
}

test("extrae HC por workbook/rels, usa caches de formulas y conserva IDs de cinco digitos", () => {
  const source = buildSyntheticXlsb();
  const snapshot = extractHcSnapshotFromBuffer(source, {
    extractedAt: FIXED_EXTRACTION_TIME,
    fileName: "maestro-sintetico.xlsb"
  });

  assert.deepEqual(Object.keys(snapshot), [
    "schemaVersion",
    "source",
    "extractedAt",
    "employees",
    "courses",
    "completions",
    "diagnostics"
  ]);
  assert.deepEqual(snapshot.source, {
    fileName: "maestro-sintetico.xlsb",
    sha256: sha256(source),
    byteSize: source.length,
    sheetName: "HC"
  });
  assert.equal(snapshot.schemaVersion, "HC_SNAPSHOT_V1");
  assert.equal(snapshot.extractedAt, FIXED_EXTRACTION_TIME);
  assert.deepEqual(snapshot.employees.map(({ employeeId }) => employeeId), ["00007", "00123"]);
  assert.deepEqual(snapshot.employees[0], {
    employeeId: "00007",
    displayName: "Persona Sintética Beta",
    hireDate: "2021-01-15",
    payrollType: "Quincenal",
    position: "Puesto Sintético B",
    department: "Departamento Sintético",
    area: "Área Sintética",
    plant: "Planta Sintética"
  });
  assert.equal(snapshot.employees[1].displayName, "Persona Sintética Alfa");
  assert.equal(snapshot.employees[1].hireDate, "2020-02-29");
  assert.equal(snapshot.courses.length, 27);
  assert.deepEqual(byDisplayName(snapshot, "Curso Sintético 01"), {
    sourceKey: "hc-course:grupo-tecnico/curso-sintetico-01",
    sourceColumn: "J",
    displayName: "Curso Sintético 01",
    normalizedName: "CURSO SINTETICO 01"
  });
  assert.deepEqual(snapshot.completions, [
    {
      employeeId: "00007",
      sourceKey: "hc-course:grupo-tecnico/curso-sintetico-03",
      completionDate: "2026-07-26"
    },
    {
      employeeId: "00123",
      sourceKey: "hc-course:grupo-tecnico/curso-sintetico-01",
      completionDate: "2026-07-24"
    },
    {
      employeeId: "00123",
      sourceKey: "hc-course:grupo-tecnico/curso-sintetico-02",
      completionDate: "2026-07-25"
    }
  ]);
  assert.deepEqual(snapshot.diagnostics.counts, {
    employeeCount: 2,
    courseCount: 27,
    completionCount: 3,
    skippedEmployeeCount: 0,
    skippedCourseCount: 0,
    skippedCompletionCount: 0,
    formulaCellCount: 4,
    formulaCachedValueCount: 4,
    formulaErrorCount: 0,
    externalLinkCount: 2,
    mergedCellCount: 2
  });
  assert.deepEqual(snapshot.diagnostics.issues, []);
  assert.equal(snapshotIsApplicable(snapshot), true);
});

test("sourceKey usa la ruta normalizada y permanece estable al mover cursos", () => {
  const originalNames = syntheticCourseNames();
  const movedNames = [...originalNames];
  [movedNames[0], movedNames[9]] = [movedNames[9], movedNames[0]];
  const original = extractHcSnapshotFromBuffer(buildSyntheticXlsb({ courseNames: originalNames }), {
    extractedAt: FIXED_EXTRACTION_TIME
  });
  const moved = extractHcSnapshotFromBuffer(buildSyntheticXlsb({ courseNames: movedNames }), {
    extractedAt: FIXED_EXTRACTION_TIME
  });
  const before = byDisplayName(original, "Curso Sintético 01");
  const after = byDisplayName(moved, "Curso Sintético 01");

  assert.equal(before.sourceKey, after.sourceKey);
  assert.equal(before.sourceColumn, "J");
  assert.equal(after.sourceColumn, "S");
  assert.notEqual(canonicalJson(original.source), canonicalJson(moved.source));
});

test("diagnostica rutas de curso duplicadas sin incluir PII", () => {
  const names = syntheticCourseNames();
  names[26] = names[0];
  const snapshot = extractHcSnapshotFromBuffer(buildSyntheticXlsb({ courseNames: names }), {
    extractedAt: FIXED_EXTRACTION_TIME
  });
  const issues = snapshot.diagnostics.issues;

  assert.equal(snapshot.courses.length, 25);
  assert.equal(snapshot.diagnostics.counts.skippedCourseCount, 2);
  assert.equal(snapshot.diagnostics.counts.skippedCompletionCount, 1);
  assert.equal(snapshotIsApplicable(snapshot), false);
  assert.deepEqual(issues.map(({ code }) => code), [
    "AMBIGUOUS_COURSE_SOURCE_KEY",
    "UNEXPECTED_COURSE_COUNT"
  ]);
  assert.match(issues[0].detail, /"sourceColumns":\["J","AJ"\]/);
  assert.doesNotMatch(
    JSON.stringify(snapshot.diagnostics),
    /00007|00123|Persona Sintética/
  );
});

test("bloquea nombre cacheado vacio y error de formula sin enlazar completions huerfanas", () => {
  const snapshot = extractHcSnapshotFromBuffer(
    buildSyntheticXlsb({ blankSecondDisplayName: true, formulaErrorCompletion: true }),
    { extractedAt: FIXED_EXTRACTION_TIME }
  );

  assert.deepEqual(snapshot.employees.map(({ employeeId }) => employeeId), ["00123"]);
  assert.equal(snapshot.completions.some(({ employeeId }) => employeeId === "00007"), false);
  assert.equal(snapshot.diagnostics.counts.skippedEmployeeCount, 1);
  assert.equal(snapshot.diagnostics.counts.formulaErrorCount, 1);
  assert.equal(snapshotIsApplicable(snapshot), false);
  assert.deepEqual(snapshot.diagnostics.issues.map(({ code }) => code), [
    "EMPTY_DISPLAY_NAME",
    "FORMULA_CACHE_ERROR"
  ]);
});

test("convierte correctamente serial cero del sistema de fechas 1904", () => {
  const snapshot = extractHcSnapshotFromBuffer(buildSyntheticXlsb({ date1904: true }), {
    extractedAt: FIXED_EXTRACTION_TIME
  });
  assert.equal(snapshot.employees[1].hireDate, "2020-02-29");
  assert.equal(snapshot.completions[1].completionDate, "2026-07-24");
});

test("el limite AJ bloquea truncamiento y solo se amplia con opcion validada", () => {
  const source = buildSyntheticXlsb({ courseCount: 28 });
  const defaultSnapshot = extractHcSnapshotFromBuffer(source, {
    extractedAt: FIXED_EXTRACTION_TIME
  });
  const extendedSnapshot = extractHcSnapshotFromBuffer(source, {
    extractedAt: FIXED_EXTRACTION_TIME,
    lastCourseColumn: "AK"
  });

  assert.equal(defaultSnapshot.courses.length, 27);
  assert.equal(byDisplayName(defaultSnapshot, "Curso Sintético 28"), undefined);
  assert.equal(snapshotIsApplicable(defaultSnapshot), false);
  assert.deepEqual(defaultSnapshot.diagnostics.issues.map(({ code }) => code), [
    "COURSE_RANGE_TRUNCATED"
  ]);
  assert.match(defaultSnapshot.diagnostics.issues[0].detail, /"sourceColumns":\["AK"\]/);
  assert.equal(extendedSnapshot.courses.length, 28);
  assert.equal(byDisplayName(extendedSnapshot, "Curso Sintético 28").sourceColumn, "AK");
  assert.equal(snapshotIsApplicable(extendedSnapshot), true);
  assert.throws(
    () => extractHcSnapshotFromBuffer(source, { lastCourseColumn: "XFE" }),
    /fuera de J:XFD/
  );
});

test("la API de archivo hace doble lectura sin modificar el XLSB y publica solo en privado", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "kcm-hc-xlsb-"));
  try {
    const projectRoot = join(temporaryRoot, "proyecto");
    const inputPath = join(projectRoot, "referencias", "maestro-sintetico.xlsb");
    const privateOutput = join(
      projectRoot,
      "referencias",
      "privado",
      "snapshot-sintetico.json"
    );
    const outsideOutput = join(projectRoot, "snapshot-fuera.json");
    mkdirSync(dirname(inputPath), { recursive: true });
    writeFileSync(inputPath, buildSyntheticXlsb(), { mode: 0o400 });
    const beforeHash = sha256(readFileSync(inputPath));
    const snapshot = extractHcSnapshot(inputPath, { extractedAt: FIXED_EXTRACTION_TIME });
    const afterHash = sha256(readFileSync(inputPath));

    assert.equal(beforeHash, afterHash);
    assert.equal(snapshot.source.sha256, beforeHash);
    assert.throws(
      () => assertSafeOutputPath(outsideOutput, { projectRoot }),
      /exclusivamente referencias\/privado/
    );
    const written = writeSnapshotFile(snapshot, privateOutput, {
      inputPath,
      projectRoot
    });
    assert.equal(written, realpathSync(privateOutput));
    assert.equal(statSync(privateOutput).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(privateOutput, "utf8")), snapshot);
    chmodSync(privateOutput, 0o644);
    assert.equal(
      writeSnapshotFile(snapshot, privateOutput, { inputPath, projectRoot }),
      realpathSync(privateOutput)
    );
    assert.equal(statSync(privateOutput).mode & 0o777, 0o600);
    assert.throws(
      () => writeSnapshotFile({ ...snapshot, extractedAt: "2026-07-27T00:00:00.000Z" }, privateOutput, {
        inputPath,
        projectRoot
      }),
      /contenido distinto/
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("el CLI no ofrece bypass para escribir fuera de referencias/privado", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "kcm-hc-cli-"));
  try {
    const inputPath = join(temporaryRoot, "maestro-sintetico.xlsb");
    const outputPath = join(temporaryRoot, "snapshot.json");
    writeFileSync(inputPath, buildSyntheticXlsb());
    const beforeHash = sha256(readFileSync(inputPath));
    const result = spawnSync(
      process.execPath,
      [
        resolve("packages/xlsb/extract-hc-xlsb.js"),
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--allow-output-outside-private"
      ],
      { cwd: resolve("."), encoding: "utf8" }
    );

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Argumento desconocido/);
    assert.equal(sha256(readFileSync(inputPath)), beforeHash);
    assert.throws(() => readFileSync(outputPath), /ENOENT/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
