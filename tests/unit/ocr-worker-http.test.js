import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

import { createOcrWorker } from "../../deploy/ocr-worker/app.js";
import {
  OCR_DOCUMENT_PATH,
  OCR_WORKER_CONTRACT_VERSION,
  buildCompletedResponse
} from "../../deploy/ocr-worker/contract.js";
import { createOcrHttpServer } from "../../deploy/ocr-worker/http-server.js";
import {
  createPipelineDocumentRecognizer,
  rasterizePdfWithPdftoppm
} from "../../deploy/ocr-worker/pipeline-recognizer.js";
import { TEMPLATE_GEOMETRY_VERSION } from "../../src/ocr/config/template-geometry.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { createSyntheticAttendancePng } from "../fixtures/synthetic/image-fixtures.js";

const SECRET = "worker-test-secret-32-characters-minimum";
const NOW_MS = 1_800_000_000_000;
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runtimeMetadata(overrides = {}) {
  return {
    nodeVersion: "22.17.0",
    ocrEngineName: "tesseract",
    ocrEngineVersion: "5.3.0",
    pdfInfoVersion: "22.12.0",
    pdfToPpmVersion: "22.12.0",
    imagePipelineVersion: "raster-homography-1.0.0",
    containerBuildId: "git-0123456789abcdef",
    pdfToolsUsed: false,
    ...overrides
  };
}

function requestPayload(overrides = {}) {
  const sourceBytes = overrides.sourceBytes ?? createSyntheticAttendancePng();
  const payload = {
    contractVersion: OCR_WORKER_CONTRACT_VERSION,
    requestId: "request-001",
    document: {
      documentId: "document-001",
      sha256: hash(sourceBytes),
      mimeType: "image/png",
      contentBase64: sourceBytes.toString("base64")
    },
    template: {
      version: TEMPLATE_GEOMETRY_VERSION,
      expectedRows: 40,
      digitsPerRow: 5
    },
    recognition: { mode: "DIGIT_BOXES_ONLY", alphabet: "0123456789" }
  };
  if (overrides.root) Object.assign(payload, overrides.root);
  if (overrides.document) Object.assign(payload.document, overrides.document);
  return payload;
}

function recognizedResult() {
  const rows = Array.from({ length: 40 }, (_, rowOffset) => ({
    rowIndex: rowOffset + 1,
    digits: Array.from({ length: 5 }, (_, digitIndex) => ({
      cropId: `r${String(rowOffset + 1).padStart(2, "0")}-d${digitIndex + 1}`,
      digitIndex,
      digit: rowOffset === 0 ? String(digitIndex) : "",
      confidence: rowOffset === 0 ? 0.99 : 0
    }))
  }));
  const cropPairs = rows.flatMap((row) => row.digits.map((digit) => ({
    cropId: digit.cropId,
    rowIndex: row.rowIndex,
    digitIndex: digit.digitIndex,
    visual: { mimeType: "image/png", bytes: TINY_PNG },
    processed: { mimeType: "image/png", bytes: TINY_PNG }
  })));
  return { rows, cropPairs, runtime: runtimeMetadata() };
}

function signedHeaders(body, { requestId = "request-001", timestamp = String(Math.floor(NOW_MS / 1_000)), secret = SECRET } = {}) {
  const canonical = `${body}\n${timestamp}\n${requestId}`;
  const signature = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return {
    "Content-Type": "application/json",
    "X-KCM-Contract-Version": OCR_WORKER_CONTRACT_VERSION,
    "X-KCM-Request-Id": requestId,
    "X-KCM-Timestamp": timestamp,
    "X-KCM-Signature": `sha256=${signature}`
  };
}

async function runningServer(t, { recognizeDocument = async () => recognizedResult(), limits } = {}) {
  const worker = createOcrWorker({ recognizeDocument, secret: SECRET, now: () => NOW_MS, limits });
  const server = createOcrHttpServer(worker);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("worker health no expone configuracion, documentos ni secretos", async (t) => {
  const baseUrl = await runningServer(t);
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["status", "workerVersion"]);
  assert.equal(body.status, "ok");
  assert.doesNotMatch(JSON.stringify(body), /secret|requestId|sourceSha256|contentBase64/i);
});

test("worker HTTP valida HMAC y devuelve 40x5 con 200 pares de evidencia", async (t) => {
  let received = null;
  const baseUrl = await runningServer(t, {
    recognizeDocument: async (input) => {
      received = input;
      return recognizedResult();
    }
  });
  const body = JSON.stringify(requestPayload());
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body),
    body
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const output = await response.json();
  assert.deepEqual(Object.keys(output).sort(), [
    "contractVersion", "cropPairs", "documentId", "processingMs", "requestId",
    "rows", "runtime", "sourceSha256", "status", "workerVersion"
  ]);
  assert.equal(output.rows.length, 40);
  assert.equal(output.rows[0].slots.length, 5);
  assert.equal(output.rows[0].slots.map((slot) => slot.digit).join(""), "01234");
  assert.equal(output.cropPairs.length, 200);
  assert.equal(output.cropPairs[0].visual.sha256, hash(TINY_PNG));
  assert.equal(output.cropPairs[0].processed.contentBase64, TINY_PNG.toString("base64"));
  assert.deepEqual(output.runtime, runtimeMetadata());
  assert.doesNotMatch(JSON.stringify(output.runtime), /\/usr\/|secret|token|argument/i);
  assert.deepEqual(Object.keys(received).sort(), [
    "bytes", "documentId", "mimeType", "requestId", "sourceSha256", "templateVersion"
  ]);
  assert.equal("employeeRoster" in received, false);
  assert.equal("name" in received, false);
});

test("worker rechaza firma incorrecta antes de invocar OCR y sanitiza el error", async (t) => {
  let calls = 0;
  const baseUrl = await runningServer(t, { recognizeDocument: async () => { calls += 1; return recognizedResult(); } });
  const payload = requestPayload();
  const body = JSON.stringify(payload);
  const headers = signedHeaders(body);
  headers["X-KCM-Signature"] = `sha256=${"0".repeat(64)}`;
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, { method: "POST", headers, body });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  const errorBody = await response.text();
  assert.doesNotMatch(errorBody, new RegExp(SECRET));
  assert.doesNotMatch(errorBody, new RegExp(payload.document.sha256));
  assert.doesNotMatch(errorBody, /contentBase64/);
});

test("worker rechaza timestamp vencido", async (t) => {
  const baseUrl = await runningServer(t);
  const body = JSON.stringify(requestPayload());
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body, { timestamp: String(Math.floor(NOW_MS / 1_000) - 301) }),
    body
  });
  assert.equal(response.status, 401);
});

test("worker rechaza campos ajenos como padron o nombres", async (t) => {
  let calls = 0;
  const baseUrl = await runningServer(t, { recognizeDocument: async () => { calls += 1; return recognizedResult(); } });
  const payload = requestPayload({ root: { employeeRoster: ["00001"], employeeName: "Persona" } });
  const body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body),
    body
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.doesNotMatch(await response.text(), /00001|Persona|employee/i);
});

test("worker detecta hash y MIME inconsistentes sin procesar el documento", async (t) => {
  let calls = 0;
  const baseUrl = await runningServer(t, { recognizeDocument: async () => { calls += 1; return recognizedResult(); } });
  for (const payload of [
    requestPayload({ document: { sha256: "a".repeat(64) } }),
    requestPayload({ document: { mimeType: "image/jpeg" } })
  ]) {
    const body = JSON.stringify(payload);
    const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
      method: "POST",
      headers: signedHeaders(body),
      body
    });
    assert.equal(response.status, 422);
  }
  assert.equal(calls, 0);
});

test("worker rechaza salida incompleta del proveedor sin filtrar detalles", async (t) => {
  const baseUrl = await runningServer(t, {
    recognizeDocument: async () => ({ rows: [{ rowIndex: 1, digits: [] }], cropPairs: [] })
  });
  const body = JSON.stringify(requestPayload());
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body),
    body
  });
  assert.equal(response.status, 502);
  const output = await response.json();
  assert.equal(output.error.code, "INVALID_PROVIDER_RESULT");
  assert.equal("detail" in output.error, false);
});

test("contrato de salida rechaza duplicados, caracteres, cropId y MIME adulterados", () => {
  const request = {
    requestId: "request-001",
    documentId: "document-001",
    sourceSha256: "0".repeat(64)
  };
  const invalidResults = [];

  const duplicateRow = recognizedResult();
  duplicateRow.rows[39].rowIndex = 39;
  invalidResults.push(duplicateRow);

  const invalidDigit = recognizedResult();
  invalidDigit.rows[0].digits[0].digit = "X";
  invalidResults.push(invalidDigit);

  const duplicateCrop = recognizedResult();
  duplicateCrop.cropPairs[1] = { ...duplicateCrop.cropPairs[0] };
  invalidResults.push(duplicateCrop);

  const invalidCropId = recognizedResult();
  invalidCropId.cropPairs[0].cropId = "r40-d5";
  invalidResults.push(invalidCropId);

  const invalidMime = recognizedResult();
  invalidMime.cropPairs[0].visual = { mimeType: "image/png", bytes: Buffer.from("not-an-image") };
  invalidResults.push(invalidMime);

  for (const recognition of invalidResults) {
    assert.throws(
      () => buildCompletedResponse({ request, recognition, processingMs: 1 }),
      (error) => error?.status === 502 && error?.code === "INVALID_PROVIDER_RESULT"
    );
  }
});

test("contrato de salida exige runtime efectivo estricto y sin rutas", () => {
  const request = {
    requestId: "request-001",
    documentId: "document-001",
    sourceSha256: "0".repeat(64)
  };
  const invalidRuntimeValues = [
    null,
    runtimeMetadata({ ocrEngineVersion: "/usr/bin/tesseract" }),
    runtimeMetadata({ ocrEngineName: "unknown" }),
    runtimeMetadata({ nodeVersion: 22.17 }),
    runtimeMetadata({ pdfToolsUsed: "false" }),
    { ...runtimeMetadata(), commandPath: "/usr/bin/tesseract" }
  ];
  for (const runtime of invalidRuntimeValues) {
    const recognition = recognizedResult();
    recognition.runtime = runtime;
    assert.throws(
      () => buildCompletedResponse({ request, recognition, processingMs: 1 }),
      (error) => error?.status === 502 && error?.code === "INVALID_PROVIDER_RESULT"
    );
  }
});

test("servidor HTTP corta solicitudes mayores al limite", async (t) => {
  const baseUrl = await runningServer(t, { limits: { maxRequestBytes: 4_096 } });
  const body = JSON.stringify(requestPayload());
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body),
    body
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "REQUEST_TOO_LARGE");
});

test("pipeline inyectado conserva 40x5 y genera 200 pares sin Tesseract real", async () => {
  const provider = {
    recognize({ segmentation, imageBytes }) {
      const extraction = extractDigitCrops({ imageBytes, segmentation });
      return {
        engine: { name: "tesseract", version: "5.3.0" },
        rows: segmentation.templateMap.rows.map((row) => ({
          rowIndex: row.rowIndex,
          digits: row.digitBoxes.map((digit) => ({
            cropId: `r${String(row.rowIndex).padStart(2, "0")}-d${digit.digitIndex + 1}`,
            digitIndex: digit.digitIndex,
            digit: "",
            confidence: 0
          }))
        })),
        extraction
      };
    }
  };
  const recognizer = createPipelineDocumentRecognizer({
    provider,
    runtimeMetadata: runtimeMetadata()
  });
  const result = await recognizer({
    bytes: createSyntheticAttendancePng(),
    mimeType: "image/png",
    templateVersion: TEMPLATE_GEOMETRY_VERSION
  });
  assert.equal(result.rows.length, 40);
  assert.equal(result.cropPairs.length, 200);
  assert.deepEqual(result.runtime, runtimeMetadata());
  assert.ok(result.cropPairs.every((pair) => pair.visual.bytes.length > 0 && pair.processed.bytes.length > 0));
});

test("PDF sin conteo regex atraviesa el worker y delega pagina y cifrado a pdfinfo", async (t) => {
  const sourceBytes = Buffer.from("%PDF-1.7\nsynthetic-object-stream-without-page-token\n", "ascii");
  const toolCalls = [];
  let providerCalls = 0;
  const provider = {
    recognize({ segmentation, imageBytes }) {
      providerCalls += 1;
      const extraction = extractDigitCrops({ imageBytes, segmentation });
      return {
        engine: { name: "tesseract", version: "5.3.0" },
        rows: segmentation.templateMap.rows.map((row) => ({
          rowIndex: row.rowIndex,
          digits: row.digitBoxes.map((digit) => ({
            cropId: `r${String(row.rowIndex).padStart(2, "0")}-d${digit.digitIndex + 1}`,
            digitIndex: digit.digitIndex,
            digit: "",
            confidence: 0
          }))
        })),
        extraction
      };
    }
  };
  const pdfRasterizer = (bytes) => rasterizePdfWithPdftoppm(bytes, {
    execFile(command, args) {
      toolCalls.push(command);
      if (command === "/usr/bin/pdfinfo") return "Pages: 1\nEncrypted: no\n";
      writeFileSync(`${args.at(-1)}.png`, createSyntheticAttendancePng(), { mode: 0o600 });
      return "";
    }
  });
  const baseUrl = await runningServer(t, {
    recognizeDocument: createPipelineDocumentRecognizer({
      provider,
      pdfRasterizer,
      runtimeMetadata: runtimeMetadata()
    })
  });
  const body = JSON.stringify(requestPayload({
    sourceBytes,
    document: { mimeType: "application/pdf" }
  }));
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body),
    body
  });
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.equal(output.runtime.pdfToolsUsed, true);
  assert.equal(providerCalls, 1);
  assert.deepEqual(toolCalls, ["/usr/bin/pdfinfo", "/usr/bin/pdftoppm"]);
});

test("pdfinfo multipagina rechaza el PDF antes de pdftoppm y del proveedor", async (t) => {
  const sourceBytes = Buffer.from("%PDF-1.7\nsynthetic-object-stream-without-page-token\n", "ascii");
  const toolCalls = [];
  let providerCalls = 0;
  const baseUrl = await runningServer(t, {
    recognizeDocument: createPipelineDocumentRecognizer({
      provider: {
        recognize() {
          providerCalls += 1;
          throw new Error("El proveedor no debe ejecutarse");
        }
      },
      pdfRasterizer: (bytes) => rasterizePdfWithPdftoppm(bytes, {
        execFile(command) {
          toolCalls.push(command);
          return "Pages: 2\nEncrypted: no\n";
        }
      }),
      runtimeMetadata: runtimeMetadata()
    })
  });
  const body = JSON.stringify(requestPayload({
    sourceBytes,
    document: { mimeType: "application/pdf" }
  }));
  const response = await fetch(`${baseUrl}${OCR_DOCUMENT_PATH}`, {
    method: "POST",
    headers: signedHeaders(body),
    body
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "INVALID_DOCUMENT");
  assert.equal(providerCalls, 0);
  assert.deepEqual(toolCalls, ["/usr/bin/pdfinfo"]);
});

test("contrato de salida no coerciona indices, digitos, confianzas ni tiempos", () => {
  const request = {
    requestId: "request-001",
    documentId: "document-001",
    sourceSha256: "0".repeat(64)
  };
  const cases = [
    { mutate: (value) => { value.rows[0].rowIndex = "1"; } },
    { mutate: (value) => { value.rows[0].digits[0].digitIndex = "0"; } },
    { mutate: (value) => { value.rows[0].digits[0].digit = 0; } },
    { mutate: (value) => { value.rows[0].digits[0].confidence = null; } },
    { mutate: (value) => { value.rows[1].digits[0].confidence = 0.2; } },
    { mutate: (value) => { value.rows[0].flags = [1]; } },
    { mutate: (value) => { value.cropPairs[0].rowIndex = "1"; } },
    { mutate: (value) => { value.cropPairs[0].digitIndex = "0"; } }
  ];

  for (const { mutate } of cases) {
    const recognition = recognizedResult();
    mutate(recognition);
    assert.throws(
      () => buildCompletedResponse({ request, recognition, processingMs: 1 }),
      (error) => error?.status === 502 && error?.code === "INVALID_PROVIDER_RESULT"
    );
  }

  assert.throws(
    () => buildCompletedResponse({ request, recognition: recognizedResult(), processingMs: "1" }),
    (error) => error?.status === 502 && error?.code === "INVALID_PROVIDER_RESULT"
  );
});
