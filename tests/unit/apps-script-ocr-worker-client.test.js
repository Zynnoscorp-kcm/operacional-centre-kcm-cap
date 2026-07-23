import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { PNG } from "pngjs";

const ROOT = path.resolve("src/apps-script");
const authSource = await readFile(path.join(ROOT, "services/OcrWorkerAuth.gs"), "utf8");
const clientSource = await readFile(path.join(ROOT, "services/OcrRemoteWorkerClient.gs"), "utf8");

function bufferFromBytes(value) {
  return Buffer.from(Array.from(value, (byte) => Number(byte) < 0 ? Number(byte) + 256 : Number(byte)));
}

function signedBytes(value) {
  return [...Buffer.from(value)].map((byte) => byte > 127 ? byte - 256 : byte);
}

function sha256(value) {
  return crypto.createHash("sha256").update(bufferFromBytes(value)).digest("hex");
}

function pngBytes(seed) {
  const image = new PNG({ width: 8, height: 8 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = (seed * 31 + index) % 256;
    image.data[index + 1] = (seed * 17 + index) % 256;
    image.data[index + 2] = (seed * 7 + index) % 256;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

const VISUAL_BYTES = pngBytes(1);
const PROCESSED_BYTES = pngBytes(2);

function variant(bytes) {
  return {
    mimeType: "image/png",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    contentBase64: bytes.toString("base64")
  };
}

function workerPayload({ requestId, documentId, sourceSha256 }) {
  const rows = [];
  const cropPairs = [];
  for (let rowIndex = 1; rowIndex <= 40; rowIndex += 1) {
    const slots = [];
    for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
      const cropId = `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`;
      slots.push({
        cropId,
        digitIndex,
        digit: String((rowIndex === 1 ? digitIndex : rowIndex + digitIndex) % 10),
        confidence: 0.91
      });
      cropPairs.push({
        cropId,
        rowIndex,
        digitIndex,
        visual: variant(VISUAL_BYTES),
        processed: variant(PROCESSED_BYTES)
      });
    }
    rows.push({ rowIndex, slots, flags: ["PAGE_ALIGNMENT_REVIEW_REQUIRED"] });
  }
  return {
    contractVersion: "1.0.0",
    requestId,
    documentId,
    sourceSha256,
    status: "COMPLETED",
    workerVersion: "synthetic-1.0",
    runtime: {
      nodeVersion: "22.17.0",
      ocrEngineName: "tesseract",
      ocrEngineVersion: "5.3.0",
      pdfInfoVersion: "22.12.0",
      pdfToPpmVersion: "22.12.0",
      imagePipelineVersion: "raster-homography-1.0.0",
      containerBuildId: "git-0123456789abcdef",
      pdfToolsUsed: false
    },
    processingMs: 125,
    rows,
    cropPairs
  };
}

function response(status, body, contentType = "application/json; charset=utf-8") {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    getResponseCode: () => status,
    getContent: () => signedBytes(bytes),
    getAllHeaders: () => ({ "Content-Type": contentType })
  };
}

function baseProperties(overrides = {}) {
  return {
    KCM_OCR_WORKER_ENABLED: "true",
    KCM_OCR_WORKER_ENDPOINT: "https://ocr.example.invalid/v1/process",
    KCM_OCR_WORKER_ALLOWED_HOSTS: "ocr.example.invalid",
    KCM_OCR_WORKER_AUTH_MODE: "HMAC",
    KCM_OCR_WORKER_SECRET: "s".repeat(32),
    KCM_OCR_WORKER_MAX_REQUEST_BYTES: "4194304",
    KCM_OCR_WORKER_MAX_RESPONSE_BYTES: "4194304",
    KCM_OCR_WORKER_MAX_ATTEMPTS: "2",
    KCM_OCR_WORKER_BACKOFF_MS: "10",
    KCM_OCR_WORKER_DEADLINE_MS: "60000",
    ...overrides
  };
}

function createHarness({ properties = {}, responses = [] } = {}) {
  const values = baseProperties(properties);
  const fetches = [];
  const sleeps = [];
  const storedBatches = [];
  const queue = [...responses];

  const parseReviewCropDataUrl = (dataUrl, mimeType) => {
    const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1] !== mimeType) throw new Error("invalid crop");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("invalid mime");
    if (bytes.length > 262144) throw new Error("crop too large");
    return { byteSize: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  };

  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      property(name, fallback) {
        return Object.hasOwn(values, name) ? values[name] : fallback;
      },
      maxUploadBytes: () => 10485760,
      maxReviewCropBytes: () => 262144,
      maxReviewCropBatchBytes: () => 8388608
    },
    KcmDriveEvidenceRepository: { parseReviewCropDataUrl },
    KcmOcrCropEvidenceService: {
      storeBatch(input) {
        storedBatches.push(input);
        return { status: "COMPLETADO", totalPairs: input.items.length };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest(_algorithm, value) {
        return signedBytes(crypto.createHash("sha256").update(bufferFromBytes(value)).digest());
      },
      computeHmacSha256Signature(value, key) {
        return signedBytes(crypto.createHmac("sha256", String(key)).update(String(value)).digest());
      },
      base64Encode(value) { return bufferFromBytes(value).toString("base64"); },
      newBlob(value) {
        const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : bufferFromBytes(value);
        return {
          getBytes: () => signedBytes(bytes),
          getDataAsString: () => bytes.toString("utf8")
        };
      },
      sleep(milliseconds) { sleeps.push(milliseconds); }
    },
    UrlFetchApp: {
      fetch(endpoint, options) {
        fetches.push({ endpoint, options });
        if (!queue.length) throw new Error("synthetic network exhaustion");
        const next = queue.shift();
        return typeof next === "function" ? next(endpoint, options) : next;
      }
    }
  });
  new vm.Script(authSource, { filename: "OcrWorkerAuth.gs" }).runInContext(context);
  new vm.Script(clientSource, { filename: "OcrRemoteWorkerClient.gs" }).runInContext(context);
  return { client: context.KcmOcrRemoteWorkerClient, fetches, sleeps, storedBatches, values };
}

function sourceInput(extra = {}) {
  const sourceBytes = signedBytes(Buffer.from("synthetic-source-image"));
  return {
    requestId: "request-worker-1",
    documentId: "document-worker-1",
    sourceSha256: sha256(sourceBytes),
    mimeType: "image/png",
    templateVersion: "kcm-v1",
    sourceBytes,
    ...extra
  };
}

test("firma HMAC y no agrega campos estructurados de padron o nombre al documento", () => {
  const input = sourceInput({
    sessionId: "must-not-leave-server",
    displayName: "must-not-leave-server",
    employees: ["must-not-leave-server"]
  });
  const payload = workerPayload(input);
  const harness = createHarness({ responses: [response(200, payload)] });
  const result = harness.client.process(input);

  assert.equal(harness.fetches.length, 1);
  const { endpoint, options } = harness.fetches[0];
  assert.equal(endpoint, "https://ocr.example.invalid/v1/process");
  assert.equal(options.method, "post");
  assert.equal(options.followRedirects, false);
  assert.equal(options.muteHttpExceptions, true);
  assert.equal(options.validateHttpsCertificates, true);
  assert.equal(options.payload.includes("must-not-leave-server"), false);
  assert.equal(options.payload.includes(harness.values.KCM_OCR_WORKER_SECRET), false);
  assert.equal(options.payload.includes("employees"), false);
  assert.equal(options.payload.includes("displayName"), false);
  const timestamp = options.headers["X-KCM-Timestamp"];
  const expectedSignature = crypto.createHmac("sha256", harness.values.KCM_OCR_WORKER_SECRET)
    .update(`${options.payload}\n${timestamp}\n${input.requestId}`).digest("hex");
  assert.equal(options.headers["X-KCM-Signature"], `sha256=${expectedSignature}`);

  assert.equal(result.rows.length, 40);
  assert.equal(result.rows[0].rawDigits, "01234");
  const candidates = harness.client.candidateInputs(result);
  assert.deepEqual([...candidates[0].technicalFlags], ["PAGE_ALIGNMENT_REVIEW_REQUIRED"]);
  assert.equal(result.cropPairs.length, 200);
  assert.equal(result.cropPairs[0].visual.dataUrl.startsWith("data:image/png;base64,"), true);
  assert.equal(result.cropBytes > 0, true);
  assert.equal(result.runtime.ocrEngineName, "tesseract");
  assert.equal(result.runtime.ocrEngineVersion, "5.3.0");
  assert.equal(result.runtime.containerBuildId, "git-0123456789abcdef");
  assert.equal(JSON.stringify(result.runtime).includes("/usr/bin"), false);
  assert.equal(Object.hasOwn(result, "sourceBytes"), false);
});

test("mapea los 200 pares por renglon hacia candidatos y alimenta el productor interno", () => {
  const input = sourceInput();
  const harness = createHarness({ responses: [response(200, workerPayload(input))] });
  const result = harness.client.process(input);
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    rowIndex: index + 1,
    candidateId: `candidate-${String(index + 1).padStart(2, "0")}`
  }));
  const stored = harness.client.storeCropEvidence(result, {
    requestId: "request-crops-1",
    sessionId: "session-worker-1",
    documentId: input.documentId,
    candidates
  });

  assert.equal(stored.status, "COMPLETADO");
  assert.equal(stored.totalPairs, 200);
  assert.equal(harness.storedBatches.length, 1);
  assert.equal(harness.storedBatches[0].items[0].candidateId, "candidate-01");
  assert.equal(harness.storedBatches[0].items[199].candidateId, "candidate-40");
  assert.equal(Object.hasOwn(harness.storedBatches[0].items[0].visual, "sha256"), false);
});

test("reintenta estados transitorios con el mismo cuerpo y firma, sin propagar el cuerpo remoto", () => {
  const input = sourceInput();
  const harness = createHarness({
    responses: [
      response(503, "remote secret and personal data"),
      response(200, workerPayload(input))
    ]
  });
  const result = harness.client.process(input);
  assert.equal(result.status, "COMPLETED");
  assert.equal(harness.fetches.length, 2);
  assert.deepEqual(harness.sleeps, [10]);
  assert.equal(harness.fetches[0].options.payload, harness.fetches[1].options.payload);
  assert.equal(harness.fetches[0].options.headers["X-KCM-Signature"], harness.fetches[1].options.headers["X-KCM-Signature"]);
});

test("la autenticacion es inyectable sin cambiar transporte ni exponer credenciales", () => {
  const input = sourceInput();
  const payload = workerPayload(input);
  const harness = createHarness({ properties: { KCM_OCR_WORKER_SECRET: "" } });
  const calls = [];
  const injected = harness.client.create({
    headers() { return { Authorization: "Bearer synthetic-id-token" }; }
  }, {
    fetch(endpoint, options) {
      calls.push({ endpoint, options });
      return response(200, payload);
    }
  });
  const result = injected.process(input);
  assert.equal(result.status, "COMPLETED");
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-id-token");
  assert.equal(Object.hasOwn(calls[0].options.headers, "X-KCM-Signature"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-id-token"), false);
});

test("rechaza respuestas que no cubren exactamente 40x5 o 200 pares", () => {
  const input = sourceInput();
  const cases = [
    (payload) => { payload.rows.pop(); },
    (payload) => { payload.rows[1].rowIndex = 1; },
    (payload) => { payload.rows[0].slots.pop(); },
    (payload) => { payload.cropPairs.pop(); },
    (payload) => { payload.cropPairs[1] = { ...payload.cropPairs[0] }; }
  ];
  for (const mutate of cases) {
    const payload = workerPayload(input);
    mutate(payload);
    const harness = createHarness({ responses: [response(200, payload)] });
    assert.throws(
      () => harness.client.process(input),
      (error) => error.code === "CONFLICT" && /worker OCR/.test(error.message)
    );
  }
});

test("verifica hash, MIME y claves permitidas de cada variante sin filtrar detalles remotos", () => {
  const input = sourceInput();
  const corruptions = [
    (payload) => { payload.cropPairs[0].visual.sha256 = "0".repeat(64); },
    (payload) => { payload.cropPairs[0].visual.mimeType = "text/plain"; },
    (payload) => { payload.cropPairs[0].visual.contentBase64 = "not base64"; },
    (payload) => { payload.displayName = "private remote value"; }
  ];
  for (const corrupt of corruptions) {
    const payload = workerPayload(input);
    corrupt(payload);
    const harness = createHarness({ responses: [response(200, payload)] });
    assert.throws(() => harness.client.process(input), (error) => {
      assert.equal(error.code, "CONFLICT");
      assert.equal(error.message.includes("private remote value"), false);
      assert.equal(error.message.includes("not base64"), false);
      return true;
    });
  }
});

test("rechaza banderas remotas fuera de la whitelist tecnica", () => {
  const input = sourceInput();
  const payload = workerPayload(input);
  payload.rows[0].flags = ["AUTO_ACEPTADO"];
  const harness = createHarness({ responses: [response(200, payload)] });
  assert.throws(() => harness.client.process(input), (error) => error.code === "CONFLICT");
});

test("preserva runtime efectivo y rechaza rutas, campos extra o tipos ambiguos", () => {
  const input = sourceInput();
  const corruptions = [
    (payload) => { payload.runtime.ocrEngineVersion = "/usr/bin/tesseract"; },
    (payload) => { payload.runtime.command = "tesseract --version"; },
    (payload) => { payload.runtime.pdfToolsUsed = "false"; },
    (payload) => { payload.runtime.ocrEngineName = "unknown"; },
    (payload) => { delete payload.runtime.pdfInfoVersion; }
  ];
  for (const corrupt of corruptions) {
    const payload = workerPayload(input);
    corrupt(payload);
    const harness = createHarness({ responses: [response(200, payload)] });
    assert.throws(() => harness.client.process(input), (error) => {
      assert.equal(error.code, "CONFLICT");
      assert.equal(error.message.includes("/usr/bin"), false);
      assert.equal(error.message.includes("tesseract --version"), false);
      return true;
    });
  }
});

test("rechaza coerciones JSON en indices, digitos, confianzas y tiempos", () => {
  const input = sourceInput();
  const corruptions = [
    (payload) => { payload.rows[0].rowIndex = "1"; },
    (payload) => { payload.rows[0].slots[0].digitIndex = "0"; },
    (payload) => { payload.rows[0].slots[0].digit = 0; },
    (payload) => { payload.rows[0].slots[0].confidence = null; },
    (payload) => { payload.rows[0].slots[0].digit = ""; payload.rows[0].slots[0].confidence = 0.5; },
    (payload) => { payload.rows[0].flags = [1]; },
    (payload) => { payload.cropPairs[0].rowIndex = "1"; },
    (payload) => { payload.cropPairs[0].digitIndex = "0"; },
    (payload) => { payload.processingMs = "125"; },
    (payload) => { payload.runtime.nodeVersion = 22.17; }
  ];
  for (const corrupt of corruptions) {
    const payload = workerPayload(input);
    corrupt(payload);
    const harness = createHarness({ responses: [response(200, payload)] });
    assert.throws(() => harness.client.process(input), (error) => error.code === "CONFLICT");
  }
});

test("rechaza tipos de contenido que sólo prefijan application/json", () => {
  const input = sourceInput();
  const payload = workerPayload(input);
  const harness = createHarness({ responses: [response(200, payload, "application/json-evil")] });
  assert.throws(() => harness.client.process(input), (error) => error.code === "CONFLICT");
});

test("aplica limites antes de enviar y antes de interpretar una respuesta", () => {
  const oversizedSource = signedBytes(Buffer.alloc(5000, 7));
  const requestHarness = createHarness({ properties: { KCM_OCR_WORKER_MAX_REQUEST_BYTES: "4096" } });
  assert.throws(() => requestHarness.client.process(sourceInput({
    sourceBytes: oversizedSource,
    sourceSha256: sha256(oversizedSource)
  })), (error) => error.code === "INVALID_PAYLOAD");
  assert.equal(requestHarness.fetches.length, 0);

  const input = sourceInput();
  const responseHarness = createHarness({
    properties: { KCM_OCR_WORKER_MAX_RESPONSE_BYTES: "65536" },
    responses: [response(200, Buffer.alloc(65537, 65))]
  });
  assert.throws(() => responseHarness.client.process(input), (error) => error.code === "CONFLICT");
  assert.equal(responseHarness.fetches.length, 1);
});

test("rechaza endpoint no permitido, hash fuente distinto y HTTP definitivo con errores sanitizados", () => {
  const input = sourceInput();
  const hostHarness = createHarness({ properties: { KCM_OCR_WORKER_ALLOWED_HOSTS: "other.example.invalid" } });
  assert.throws(() => hostHarness.client.process(input), (error) => error.code === "INTERNAL_ERROR");
  assert.equal(hostHarness.fetches.length, 0);

  const hashHarness = createHarness();
  assert.throws(() => hashHarness.client.process({ ...input, sourceSha256: "0".repeat(64) }), (error) => error.code === "CONFLICT");
  assert.equal(hashHarness.fetches.length, 0);

  const httpHarness = createHarness({ responses: [response(400, "private remote diagnostic")] });
  assert.throws(() => httpHarness.client.process(input), (error) => {
    assert.equal(error.code, "CONFLICT");
    assert.equal(error.retryable, false);
    assert.equal(error.message.includes("private remote diagnostic"), false);
    return true;
  });
  assert.equal(httpHarness.fetches.length, 1);
});

test("el manifiesto conserva inferencia automatica de scopes", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "appsscript.json"), "utf8"));
  assert.equal(Object.hasOwn(manifest, "oauthScopes"), false);
});
