import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildSyntheticXlsb, syntheticCourseNames } from "../fixtures/synthetic/xlsb-fixture.js";
import { sha256 } from "../../dc3/ooxml.js";
import {
  buildSyntheticRosterSheetXml,
  buildSyntheticDc3Template,
  buildSyntheticWorkbook
} from "../../dc3/testing/synthetic-dataset.js";
import { createDc3PreviewApplication, startDc3PreviewServer } from "../../dc3/testing/preview-server.js";

const APPROVED = Object.freeze({
  durationHours: 8,
  thematicArea: "ÁREA DE ENSAYO",
  trainingAgent: "AGENTE DE ENSAYO"
});

function projectRootWithSources() {
  const root = mkdtempSync(join(tmpdir(), "kcm-dc3-banco-prueba-"));
  mkdirSync(join(root, "referencias", "privado"), { recursive: true });
  const courseNames = syntheticCourseNames();
  courseNames[0] = "QMS";
  courseNames[1] = "LOTO SINTÉTICO";
  writeFileSync(join(root, "matriz.xlsb"), buildSyntheticXlsb({ courseNames }));
  writeFileSync(join(root, "padron.xlsx"), buildSyntheticWorkbook([
    {
      name: "SND ACTIVOS",
      xml: buildSyntheticRosterSheetXml(
        ["00123", "PERSONA SINTÉTICA UNO", "PUESTO SINTÉTICO", "AAAA000101HDFBBBB0", "2020-02-29"]
      )
    },
    {
      name: "EMP ACTIVOS",
      xml: buildSyntheticRosterSheetXml(
        ["00007", "PERSONA SINTÉTICA DOS", "OTRO PUESTO", "BABC000101MDFCCCC1", "2026-03-02"]
      )
    }
  ]));
  writeFileSync(join(root, "plantilla.xlsx"), buildSyntheticDc3Template());
  writeFileSync(join(root, "dc3-config.json"), JSON.stringify({
    schemaVersion: "DC3_CONFIG_V1",
    configVersion: "banco-sintetico-v1",
    cutoffDate: "2026-01-01",
    paths: {
      matrix: "matriz.xlsb",
      roster: "padron.xlsx",
      template: "plantilla.xlsx",
      outputDirectory: "referencias/privado/dc3-generados",
      ledger: "referencias/privado/dc3-ledger.json"
    },
    courses: [
      {
        courseId: "INDUCCION_EMPRESA",
        source: { kind: "ACTIVE_HIRE_DATE" },
        dc3Name: "INDUCCIÓN SINTÉTICA",
        durationHours: null,
        thematicArea: "",
        trainingAgent: ""
      },
      {
        courseId: "QMS",
        source: { kind: "HC_COURSE", normalizedNames: ["QMS"] },
        dc3Name: "QMS SINTÉTICO",
        durationHours: null,
        thematicArea: "",
        trainingAgent: ""
      }
    ]
  }));
  return root;
}

function application(root) {
  return createDc3PreviewApplication({ projectRoot: root, configPath: "dc3-config.json" });
}

function metadataFor(courseIds, values = APPROVED) {
  return Object.fromEntries(courseIds.map((courseId) => [courseId, { ...values }]));
}

// Las peticiones usan `node:http` y no `fetch`: el agente de `fetch` conserva la conexion abierta y
// mantiene vivo el proceso de pruebas hasta que expira el keep-alive.
function peticion(preview, { method = "GET", path = "/", headers = {}, body = null } = {}) {
  const { port } = preview.server.address();
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        resolvePromise({ status: response.statusCode, body: parsed, text });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("el estado local describe la configuración sin exponer identidades", () => {
  const root = projectRootWithSources();
  try {
    const state = application(root).state();
    assert.equal(state.realSourcesAvailable, true);
    assert.equal(state.cutoffDate, "2026-01-01");
    assert.deepEqual(state.courses.map(({ courseId }) => courseId), ["INDUCCION_EMPRESA", "QMS"]);
    assert.deepEqual(state.courses[0].missingMetadata, [
      "duración en horas", "área temática", "agente capacitador"
    ]);
    assert.doesNotMatch(JSON.stringify(state), /PERSONA SINTÉTICA|00123|00007|HDFBBBB0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// El banco corre sobre las fuentes reales sin escribir nada: si publicara documentos en vez de
// conteos, un tablero abierto en el navegador se convertiria en una fuga de datos personales.
test("el plan es de sólo lectura y publica únicamente agregados", () => {
  const root = projectRootWithSources();
  try {
    const before = readdirSync(join(root, "referencias", "privado"));
    const summary = application(root).plan({
      overrides: metadataFor(["INDUCCION_EMPRESA", "QMS"]),
      signatures: {}
    });
    assert.equal(summary.mode, "PLAN_REAL");
    assert.equal(summary.execution.mode, "PLAN_ONLY");
    // Una induccion por el alta posterior al corte y un QMS desde la matriz sintetica.
    assert.equal(summary.detected, 2);
    assert.equal(summary.ready, 2);
    assert.equal(summary.readiness.metadataApproved, true);
    assert.equal(Object.hasOwn(summary, "documents"), false);
    assert.doesNotMatch(JSON.stringify(summary), /PERSONA SINTÉTICA|00123|00007|HDFBBBB0/);
    assert.deepEqual(readdirSync(join(root, "referencias", "privado")), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("los metadatos capturados en el navegador no tocan la configuración privada", () => {
  const root = projectRootWithSources();
  try {
    const local = application(root);
    const pending = local.plan({ overrides: {}, signatures: {} });
    assert.equal(pending.ready, 0);
    assert.equal(pending.readiness.emitOnApproval, 2);
    local.plan({ overrides: metadataFor(["INDUCCION_EMPRESA", "QMS"]), signatures: {} });
    // La segunda corrida sin metadatos vuelve a bloquear: la captura vivio solo en esa peticion.
    assert.equal(local.plan({ overrides: {}, signatures: {} }).ready, 0);
    assert.equal(local.state().courses[0].durationHours, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("la vista previa entrega el PDF que se le daría al trabajador", () => {
  const root = projectRootWithSources();
  try {
    const sample = application(root).sampleDocument({
      courseId: "QMS",
      overrides: metadataFor(["QMS"], { ...APPROVED, durationHours: 3 }),
      signatures: { instructor: "INSTRUCTOR DE ENSAYO" }
    });
    assert.equal(sample.fields.durationHours, 3);
    // Las leyendas ya no dependen de que la hoja oficial este en el disco: la vista previa muestra
    // el mismo formato que se emite, venga de donde venga el proyecto.
    assert.equal(sample.legends.origin, "HORNEADA");
    assert.equal(sample.document.mimeType, "application/pdf");
    assert.match(sample.document.name, /\.pdf$/);
    const pdf = Buffer.from(sample.document.base64, "base64");
    assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
    const printed = pdf.toString("latin1");
    assert.match(printed, /INSTRUCTOR DE ENSAYO/);
    assert.match(printed, /QMS/);
    assert.equal(sha256(pdf), sample.document.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("la vista previa se niega mientras falte un metadato legal", () => {
  const root = projectRootWithSources();
  try {
    assert.throws(
      () => application(root).sampleDocument({ courseId: "QMS", overrides: {}, signatures: {} }),
      (error) => error.code === "METADATA_PENDING"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// El ensayo es la unica ruta con escritura del banco y debe ocurrir fuera del proyecto: si escribiera
// en referencias/privado/ contaminaria el ledger real y la emision del dia de la aprobacion.
test("el ensayo emite en una carpeta temporal, es idempotente y no toca el proyecto", () => {
  const root = projectRootWithSources();
  try {
    const before = readdirSync(join(root, "referencias", "privado"));
    const rehearsal = application(root).rehearsal({
      overrides: metadataFor(["INDUCCION_EMPRESA", "QMS"]),
      signatures: {},
      workerCount: 6
    });
    assert.equal(rehearsal.mode, "ENSAYO_SINTETICO");
    assert.equal(rehearsal.execution.generated > 0, true);
    assert.equal(rehearsal.execution.conflicts, 0);
    assert.equal(rehearsal.replay.generated, 0);
    assert.equal(rehearsal.replay.conflicts, 0);
    assert.equal(rehearsal.replay.repeated, rehearsal.execution.generated);
    assert.equal(rehearsal.files.length, rehearsal.execution.generated);
    assert.equal(rehearsal.ledgerRecords, rehearsal.execution.generated);
    // La identidad sin CURP valida y el registro ausente del padron quedan bloqueados por origen.
    assert.equal(rehearsal.readiness.blockedBySource > 0, true);
    assert.deepEqual(readdirSync(join(root, "referencias", "privado")), before);
    assert.equal(rehearsal.files.every(({ name }) => name.endsWith(".pdf")), true);
    const sample = Buffer.from(rehearsal.sample.base64, "base64");
    assert.equal(sample.subarray(0, 8).toString("latin1"), "%PDF-1.4");
    assert.doesNotMatch(sample.toString("latin1"), /absPath|Private|PERSONA REAL/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("la API local rechaza peticiones sin JSON, con Host ajeno o demasiado grandes", async () => {
  const root = projectRootWithSources();
  const preview = await startDc3PreviewServer({ port: 0, projectRoot: root, configPath: "dc3-config.json" });
  const json = { "Content-Type": "application/json" };
  try {
    const estado = await peticion(preview, { path: "/api/estado" });
    assert.equal(estado.status, 200);
    assert.equal(estado.body.ok, true);

    const sinJson = await peticion(preview, { method: "POST", path: "/api/plan", body: "{}" });
    assert.equal(sinJson.status, 415);

    const hostAjeno = await peticion(preview, {
      method: "POST", path: "/api/plan", headers: { ...json, Host: "kcm.example.invalid" }, body: "{}"
    });
    assert.equal(hostAjeno.status, 403);
    assert.equal(
      (await peticion(preview, { method: "POST", path: "/api/plan", headers: { ...json, Host: "localhost" }, body: "{}" })).status,
      200
    );

    const enorme = await peticion(preview, {
      method: "POST",
      path: "/api/plan",
      headers: json,
      body: JSON.stringify({ relleno: "x".repeat(70 * 1024) })
    });
    assert.equal(enorme.status, 413);

    const invalido = await peticion(preview, {
      method: "POST",
      path: "/api/plan",
      headers: json,
      body: JSON.stringify({ overrides: { QMS: { durationHours: 5000 } } })
    });
    assert.equal(invalido.status, 400);
    assert.equal(invalido.body.error.code, "INVALID_INPUT");

    const desconocido = await peticion(preview, { path: "/api/otro" });
    assert.equal(desconocido.status, 404);
  } finally {
    await preview.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("el servidor sólo escucha en loopback", async () => {
  await assert.rejects(
    () => startDc3PreviewServer({ host: "0.0.0.0", port: 0 }),
    /loopback/
  );
});
