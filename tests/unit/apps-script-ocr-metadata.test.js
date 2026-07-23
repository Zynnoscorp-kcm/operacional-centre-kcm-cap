import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");
const supportSource = await readFile(path.join(ROOT, "services/00_ServiceSupport.gs"), "utf8");
const configSource = await readFile(path.join(ROOT, "server/00_Config.gs"), "utf8");
const repositorySource = await readFile(path.join(ROOT, "repositories/SheetsRepository.gs"), "utf8");

const RUNTIME = Object.freeze({
  nodeVersion: "22.17.0",
  ocrEngineName: "tesseract",
  ocrEngineVersion: "5.3.4",
  pdfInfoVersion: "25.6.0",
  pdfToPpmVersion: "25.6.0",
  imagePipelineVersion: "raster-homography-1.0.0",
  containerBuildId: "synthetic-build:2026.07.21",
  pdfToolsUsed: false
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function supportHarness() {
  const inserted = [];
  let uuid = 0;
  const repository = {
    insertMany(name, rows) {
      inserted.push({ name, rows: rows.map((row) => ({ ...row })) });
      return rows;
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error,
    Utilities: { getUuid: () => `uuid-${++uuid}` },
    KcmRepository: { current: () => repository },
    KcmConfig: { CONTRACT_VERSION: "1.0.0", SHEETS: { AUDIT: "AUDITORIA", ERRORS: "ERRORES", SESSIONS: "SESIONES" } },
    KcmRequestContext: { requestId: "request-context" },
    KcmValidation: {
      fail,
      identifier: (value) => String(value),
      text: (value) => String(value ?? ""),
      safeError: (error) => ({ code: error.code || "INTERNAL_ERROR", message: "Error sanitizado", retryable: false })
    },
    console
  });
  new vm.Script(supportSource, { filename: "00_ServiceSupport.gs" }).runInContext(context);
  return { support: context.KcmServiceSupport, inserted };
}

test("normaliza y persiste solamente la procedencia tecnica OCR permitida", () => {
  const harness = supportHarness();
  const metadata = harness.support.ocrMetadata({
    workerVersion: "worker-1.2.3", processingMs: 1234,
    runtime: Object.fromEntries(Object.entries(RUNTIME).reverse())
  }, true);

  assert.equal(metadata.workerVersion, "worker-1.2.3");
  assert.equal(metadata.pipelineVersion, "raster-homography-1.0.0");
  assert.equal(metadata.processingMs, 1234);
  assert.deepEqual(JSON.parse(metadata.runtime), RUNTIME);

  const event = harness.support.audit(
    { actor: "synthetic@example.invalid", role: "CAPACITACION" },
    {
      sessionId: "session-1", entityType: "OcrDocument", entityId: "document-1",
      action: "REMOTE_OCR_COMPLETED", ocrMetadata: {
        workerVersion: metadata.workerVersion, runtime: metadata.runtime, processingMs: metadata.processingMs
      }
    }
  );
  assert.equal(event.workerVersion, "worker-1.2.3");
  assert.equal(event.runtime, metadata.runtime);
  assert.equal(event.pipelineVersion, "raster-homography-1.0.0");
  assert.equal(event.processingMs, 1234);
  assert.equal(harness.inserted[0].name, "AUDITORIA");
  assert.equal(Object.hasOwn(event, "host"), false);
  assert.equal(Object.hasOwn(event, "environment"), false);
});

test("rechaza metadata ausente, campos extra, rutas y versiones no sanitizadas", () => {
  const { support } = supportHarness();
  assert.throws(() => support.ocrMetadata({}, true), (error) => error.code === "INVALID_INPUT");
  assert.equal(
    JSON.stringify(support.ocrMetadata({}, false)),
    JSON.stringify({ workerVersion: "", runtime: "", pipelineVersion: "", processingMs: "" })
  );

  for (const runtime of [
    { ...RUNTIME, host: "internal-host" },
    { ...RUNTIME, containerBuildId: "/srv/worker/build" },
    { ...RUNTIME, nodeVersion: "v22.17.0" },
    { ...RUNTIME, ocrEngineName: "other-engine" },
    { ...RUNTIME, imagePipelineVersion: "unknown-pipeline" },
    { ...RUNTIME, pdfToolsUsed: "false" }
  ]) {
    assert.throws(
      () => support.ocrMetadata({ workerVersion: "worker-1", runtime, processingMs: 100 }, true),
      (error) => error.code === "INVALID_INPUT"
    );
  }
  assert.throws(
    () => support.ocrMetadata({ workerVersion: "worker-1", runtime: RUNTIME, processingMs: 120001 }, true),
    (error) => error.code === "INVALID_INPUT"
  );
});

class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows.map((row) => [...row]);
  }

  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0); }
  getDataRange() { return { getValues: () => this.rows.map((row) => [...row]) }; }
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => Array.from({ length: rowCount }, (_, rowOffset) =>
        Array.from({ length: columnCount }, (_, columnOffset) => this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? "")
      ),
      setValues: (values) => {
        values.forEach((valuesRow, rowOffset) => {
          const targetRow = row - 1 + rowOffset;
          while (this.rows.length <= targetRow) this.rows.push([]);
          valuesRow.forEach((value, columnOffset) => {
            this.rows[targetRow][column - 1 + columnOffset] = value;
          });
        });
      },
      setNumberFormat: () => undefined
    };
  }
}

test("ensureSchema agrega columnas nuevas sin reemplazar encabezados ni filas existentes", () => {
  const sheets = new Map();
  const originalDocumentHeaders = [
    "documentId", "sessionId", "evidenceId", "sha256", "mimeType", "byteSize",
    "pageCount", "status", "createdBy", "createdAt", "version"
  ];
  const originalData = ["document-synthetic", "session-synthetic", "evidence-synthetic", "hash", "image/png", 10, 1, "RECIBIDO", "actor", "date", "1.0.0"];
  sheets.set("OCR_DOCUMENTOS", new FakeSheet("OCR_DOCUMENTOS", [originalDocumentHeaders, originalData]));
  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name) ?? null,
    insertSheet(name) {
      const sheet = new FakeSheet(name);
      sheets.set(name, sheet);
      return sheet;
    }
  };
  const properties = { getProperty: (name) => name === "KCM_DATA_SPREADSHEET_ID" ? "synthetic-sheet" : null };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error,
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { openById: () => spreadsheet },
    KcmValidation: { fail, forSheet: (value) => value },
    console
  });
  new vm.Script(configSource, { filename: "00_Config.gs" }).runInContext(context);
  new vm.Script(repositorySource, { filename: "SheetsRepository.gs" }).runInContext(context);

  context.KcmSheetsRepository.ensureSchema();

  const documentSheet = sheets.get("OCR_DOCUMENTOS");
  assert.deepEqual(documentSheet.rows[0], [...originalDocumentHeaders,
    "ocrRequestId", "ocrWorkerVersion", "ocrRuntime", "ocrPipelineVersion", "ocrProcessingMs", "ocrProcessedAt",
    "ocrLeaseId", "ocrLeaseUntil"
  ]);
  assert.deepEqual(documentSheet.rows[1].slice(0, originalData.length), originalData);
  assert.equal(documentSheet.rows[1].length, originalData.length, "la migracion no reescribe filas existentes");
  assert.deepEqual(sheets.get("AUDITORIA").rows[0], [...context.KcmConfig.HEADERS.AUDITORIA]);
});
