import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

test("Apps Script usa V8, zona horaria requerida y acceso de dominio", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "appsscript.json"), "utf8"));
  assert.equal(manifest.runtimeVersion, "V8");
  assert.equal(manifest.timeZone, "America/Mexico_City");
  assert.equal(manifest.webapp.access, "DOMAIN");
  assert.equal(manifest.webapp.executeAs, "USER_DEPLOYING");
  const config = await readFile(path.join(ROOT, "server/00_Config.gs"), "utf8");
  const processingTransitions = config.match(/OCR_EN_PROCESO:\s*\[([^\]]*)\]/);
  assert.ok(processingTransitions);
  assert.match(processingTransitions[1], /REVISION_OCR/);
  assert.doesNotMatch(processingTransitions[1], /PRELIBERACION/);
});

test("todos los archivos .gs tienen sintaxis JavaScript valida", async () => {
  const files = (await filesBelow(ROOT)).filter((file) => file.endsWith(".gs"));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  }
});

test("el router expone la vertical digital, OCR, examen y liberacion", async () => {
  const router = await readFile(path.join(ROOT, "server/Router.gs"), "utf8");
  for (const action of [
    "createSession", "issueKioskToken", "kioskRegister", "uploadOcrDocument", "processRemoteOcrDocument",
    "ingestOcrCandidates", "reviewOcrCandidate", "listOcrCandidates", "reviewEvidence", "reconcilePhysicalAttendance",
    "reconcileExams", "releasePreview", "executeRelease", "sessionAudit"
  ]) assert.match(router, new RegExp(`${action}:`));
  assert.match(router, /KcmValidation\.safeError/);
});

test("el servidor bloquea ingreso OCR simulado fuera de MOCK y conserva el endpoint remoto", async () => {
  const router = await readFile(path.join(ROOT, "server/Router.gs"), "utf8");
  let mockMode = false;
  const calls = { begin: 0, ingest: 0, remote: 0, errors: 0 };
  const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const context = vm.createContext({
    Object, String, Boolean, Error,
    Utilities: { getUuid: () => "request-synthetic" },
    KcmRequestContext: { requestId: "" },
    KcmConfig: { isMockMode: () => mockMode },
    KcmValidation: {
      fail,
      identifier: (value) => {
        const normalized = String(value || "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalized)) fail("INVALID_IDENTIFIER", "Identificador invalido");
        return normalized;
      },
      safeError: (error) => ({ code: error.code || "INTERNAL_ERROR", message: error.message, retryable: false })
    },
    KcmServiceSupport: { recordError: () => { calls.errors += 1; } },
    KcmOcrWorkflowService: {
      beginProcessing: () => { calls.begin += 1; return { status: "OCR_EN_PROCESO" }; },
      ingestCandidates: () => { calls.ingest += 1; return []; }
    },
    KcmRemoteOcrProcessingService: {
      process: () => { calls.remote += 1; return { status: "OCR_EN_PROCESO", retryRequired: true }; }
    }
  });
  new vm.Script(router, { filename: "Router.gs" }).runInContext(context);

  assert.equal(context.api("beginOcrProcessing", { documentId: "document-1" }).error.code, "FORBIDDEN");
  assert.equal(context.api("ingestOcrCandidates", { documentId: "document-1", candidates: [] }).error.code, "FORBIDDEN");
  assert.equal(calls.begin, 0);
  assert.equal(calls.ingest, 0);
  assert.equal(context.api("processRemoteOcrDocument", { documentId: "document-1" }).ok, true);
  assert.equal(calls.remote, 1);

  mockMode = true;
  assert.equal(context.api("beginOcrProcessing", { documentId: "document-1" }).ok, true);
  assert.equal(context.api("ingestOcrCandidates", { documentId: "document-1", candidates: [] }).ok, true);
  assert.equal(calls.begin, 1);
  assert.equal(calls.ingest, 1);
  assert.equal(calls.errors, 2);
  assert.equal(context.api("beginOcrProcessing", { documentId: "document-1", requestId: "=formula" }).error.code, "INVALID_IDENTIFIER");
  assert.equal(calls.begin, 1, "un requestId invalido se rechaza antes de ejecutar la operacion");
  assert.doesNotMatch(router, /ingestCandidatesForRemote:/, "la ingestion interna no debe exponerse al navegador");
});

test("la liberacion aplica elegibilidad, bloqueo, idempotencia y no sobreescritura", async () => {
  const pre = await readFile(path.join(ROOT, "services/PreReleaseService.gs"), "utf8");
  const release = await readFile(path.join(ROOT, "services/ReleaseService.gs"), "utf8");
  const matrix = await readFile(path.join(ROOT, "services/MatrixGateway.gs"), "utf8");
  for (const guard of ["identityValidated", "attendanceProven", "EXAMEN_CONFIRMADO", "session.authorized", "attendance.released"]) assert.match(pre, new RegExp(guard.replace(".", "\\.")));
  assert.match(release, /LockService\.getScriptLock/);
  assert.match(release, /idempotencyKey/);
  assert.match(matrix, /EXISTING_VALUE_CONFLICT/);
  assert.match(matrix, /destinationHeader/);
  assert.match(matrix, /El encabezado de la matriz cambio/);
  assert.doesNotMatch(matrix, /clearContent|deleteRow|deleteSheet/);
});

test("Apps Script marca todas las ocurrencias OCR duplicadas para revision", async () => {
  const ocr = await readFile(path.join(ROOT, "services/OcrWorkflowService.gs"), "utf8");
  assert.match(ocr, /duplicateCounts\[raw\]/);
  assert.match(ocr, /duplicateCounts\[normalized\] > 1/);
  assert.doesNotMatch(ocr, /if \(normalized && seen\[normalized\]\)/);
});

test("la UI agrupa las pantallas minimas y funciona sin google.script.run", async () => {
  const html = await readFile(path.join(ROOT, "web/Index.html"), "utf8");
  for (const view of ["home", "sessions", "kiosk", "search", "upload", "tracking", "review", "prerelease", "exams", "release", "result", "audit"]) assert.match(html, new RegExp(`id="view-${view}"`));
  assert.match(html, /LOCAL_PREVIEW/);
  assert.match(html, /Boolean\(window\.google&&google\.script&&google\.script\.run\)/);
  assert.match(html, /\?view=kiosk#kioskToken=token-local-solo-qa/);
  assert.doesNotMatch(html, /issueKioskToken:\{token:/);
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: "Index.inline.js" }));
});

test("no hay identificadores productivos ni datos binarios guardados en Sheets", async () => {
  const files = await filesBelow(ROOT);
  const text = (await Promise.all(files.filter((file) => /\.(gs|html|json)$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(text, /[a-zA-Z0-9_-]{40,}/, "no deben existir IDs o secretos largos incrustados");
  const headers = await readFile(path.join(ROOT, "server/00_Config.gs"), "utf8");
  assert.doesNotMatch(headers, /base64|dataUrl/i);
  assert.match(text, /example\.invalid/);
});
