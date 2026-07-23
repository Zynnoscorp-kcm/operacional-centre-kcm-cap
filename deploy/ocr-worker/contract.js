import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";

import { TEMPLATE_GEOMETRY_VERSION } from "../../src/ocr/config/template-geometry.js";
import {
  detectMimeType,
  inspectInputFile,
  validateInputFile
} from "../../src/ocr/preprocessing/file-validation.js";

export const OCR_WORKER_CONTRACT_VERSION = "1.0.0";
export const OCR_WORKER_VERSION = "document-worker-1.0.0";
export const OCR_DOCUMENT_PATH = "/v1/ocr/documents:recognize";
export const OCR_HEALTH_PATH = "/healthz";

export const OCR_WORKER_LIMITS = Object.freeze({
  maxRequestBytes: 15 * 1024 * 1024,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxEvidenceBlobBytes: 256 * 1024,
  maxEvidenceBinaryBytes: 8 * 1024 * 1024,
  maxResponseBytes: 4 * 1024 * 1024,
  maxClockSkewSeconds: 300
});

const EXPECTED_ROWS = 40;
const DIGITS_PER_ROW = 5;
const EXPECTED_CROPS = EXPECTED_ROWS * DIGITS_PER_ROW;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/;
const TEMPLATE_VERSION = /^[A-Za-z0-9_.-]{1,40}$/;
const FLAG = /^[A-Z0-9_]{1,40}$/;
const RUNTIME_VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._a-z0-9]*)?$/i;
const PIPELINE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, field) {
  if (!isPlainObject(value)) throw invalidRequest(`${field} debe ser un objeto`);
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw invalidRequest(`${field} no coincide con el contrato`);
  }
}

function boundedPositiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} esta fuera del intervalo permitido`);
  }
  return value;
}

function safeLimits(overrides = {}) {
  if (!isPlainObject(overrides)) throw new TypeError("limits debe ser un objeto simple");
  const limits = { ...OCR_WORKER_LIMITS, ...overrides };
  return Object.freeze({
    maxRequestBytes: boundedPositiveInteger(limits.maxRequestBytes, "maxRequestBytes", 20 * 1024 * 1024),
    maxDocumentBytes: boundedPositiveInteger(limits.maxDocumentBytes, "maxDocumentBytes", 12 * 1024 * 1024),
    maxEvidenceBlobBytes: boundedPositiveInteger(limits.maxEvidenceBlobBytes, "maxEvidenceBlobBytes", 2 * 1024 * 1024),
    maxEvidenceBinaryBytes: boundedPositiveInteger(limits.maxEvidenceBinaryBytes, "maxEvidenceBinaryBytes", 12 * 1024 * 1024),
    maxResponseBytes: boundedPositiveInteger(limits.maxResponseBytes, "maxResponseBytes", 12 * 1024 * 1024),
    maxClockSkewSeconds: boundedPositiveInteger(limits.maxClockSkewSeconds, "maxClockSkewSeconds", 900)
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeEqualText(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expected) continue;
    if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : "";
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
  return "";
}

function canonicalBase64(value, field, maximumDecodedBytes) {
  if (typeof value !== "string" || value.length < 4 || value.length > Math.ceil(maximumDecodedBytes / 3) * 4) {
    throw invalidDocument(`${field} no contiene base64 valido`);
  }
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw invalidDocument(`${field} no contiene base64 canonico`);
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maximumDecodedBytes || bytes.toString("base64") !== value) {
    throw invalidDocument(`${field} no contiene base64 canonico`);
  }
  return bytes;
}

function identifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw invalidRequest(`${field} es invalido`);
  }
  return value;
}

function hashValue(value, field) {
  if (typeof value !== "string" || !HEX_SHA256.test(value)) {
    throw invalidRequest(`${field} es invalido`);
  }
  return value;
}

function mimeType(value) {
  if (typeof value !== "string" || !["image/jpeg", "image/png", "application/pdf"].includes(value)) {
    throw invalidDocument("document.mimeType no esta permitido");
  }
  return value;
}

function invalidRequest(detail) {
  return new OcrWorkerHttpError(400, "INVALID_REQUEST", "La solicitud OCR no coincide con el contrato", {
    retryable: false,
    detail
  });
}

function invalidDocument(detail) {
  return new OcrWorkerHttpError(422, "INVALID_DOCUMENT", "El documento OCR no es valido", {
    retryable: false,
    detail
  });
}

function invalidProvider(detail) {
  return new OcrWorkerHttpError(502, "INVALID_PROVIDER_RESULT", "El motor OCR devolvio un resultado invalido", {
    retryable: false,
    detail
  });
}

export class OcrWorkerHttpError extends Error {
  constructor(status, code, message, { retryable = false, detail = null } = {}) {
    super(message);
    this.name = "OcrWorkerHttpError";
    this.status = status;
    this.code = code;
    this.retryable = Boolean(retryable);
    Object.defineProperty(this, "detail", { value: detail, enumerable: false });
  }
}

export function validateWorkerSecret(value) {
  const secret = String(value ?? "");
  if (secret.length < 32 || secret.length > 256 || /[\u0000-\u001f\u007f]/.test(secret)) {
    throw new TypeError("KCM_OCR_WORKER_SECRET debe contener entre 32 y 256 caracteres seguros");
  }
  return secret;
}

export function authenticateOcrRequest({ headers, rawBody, secret, nowMs = Date.now(), limits = {} }) {
  const effectiveLimits = safeLimits(limits);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? "");
  if (!body.length || body.length > effectiveLimits.maxRequestBytes) {
    throw new OcrWorkerHttpError(413, "REQUEST_TOO_LARGE", "La solicitud OCR excede el limite permitido");
  }
  const contentType = headerValue(headers, "content-type");
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    throw new OcrWorkerHttpError(415, "UNSUPPORTED_MEDIA_TYPE", "La solicitud OCR debe usar JSON");
  }
  const contractVersion = headerValue(headers, "x-kcm-contract-version");
  const requestId = headerValue(headers, "x-kcm-request-id");
  const timestamp = headerValue(headers, "x-kcm-timestamp");
  const suppliedSignature = headerValue(headers, "x-kcm-signature").toLowerCase();
  if (contractVersion !== OCR_WORKER_CONTRACT_VERSION || !IDENTIFIER.test(requestId) ||
      !/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(suppliedSignature)) {
    throw new OcrWorkerHttpError(401, "UNAUTHORIZED", "La autenticacion del worker OCR no es valida");
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Number(nowMs) / 1_000);
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - timestampSeconds) > effectiveLimits.maxClockSkewSeconds) {
    throw new OcrWorkerHttpError(401, "UNAUTHORIZED", "La autenticacion del worker OCR no es valida");
  }
  let bodyText;
  try {
    bodyText = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new OcrWorkerHttpError(400, "INVALID_REQUEST", "La solicitud OCR no coincide con el contrato");
  }
  const canonical = `${bodyText}\n${timestamp}\n${requestId}`;
  const expectedSignature = `sha256=${createHmac("sha256", validateWorkerSecret(secret)).update(canonical, "utf8").digest("hex")}`;
  if (!safeEqualText(suppliedSignature, expectedSignature)) {
    throw new OcrWorkerHttpError(401, "UNAUTHORIZED", "La autenticacion del worker OCR no es valida");
  }
  return Object.freeze({ bodyText, requestId, contractVersion, timestamp: timestampSeconds });
}

export function validateDocumentRequest(bodyText, { limits = {}, allowedTemplateVersions = [TEMPLATE_GEOMETRY_VERSION] } = {}) {
  const effectiveLimits = safeLimits(limits);
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw invalidRequest("El cuerpo no contiene JSON valido");
  }
  exactKeys(payload, ["contractVersion", "requestId", "document", "template", "recognition"], "request");
  if (payload.contractVersion !== OCR_WORKER_CONTRACT_VERSION) throw invalidRequest("contractVersion no es compatible");
  const requestId = identifier(payload.requestId, "requestId");

  exactKeys(payload.document, ["documentId", "sha256", "mimeType", "contentBase64"], "request.document");
  const documentId = identifier(payload.document.documentId, "document.documentId");
  const sourceSha256 = hashValue(payload.document.sha256, "document.sha256");
  const declaredMimeType = mimeType(payload.document.mimeType);
  const sourceBytes = canonicalBase64(payload.document.contentBase64, "document.contentBase64", effectiveLimits.maxDocumentBytes);
  if (!safeEqualText(sha256(sourceBytes), sourceSha256)) throw invalidDocument("El hash del documento no coincide");

  exactKeys(payload.template, ["version", "expectedRows", "digitsPerRow"], "request.template");
  const templateVersion = payload.template.version;
  if (typeof templateVersion !== "string" || !TEMPLATE_VERSION.test(templateVersion) || !allowedTemplateVersions.includes(templateVersion)) {
    throw invalidRequest("La version de plantilla no esta habilitada");
  }
  if (payload.template.expectedRows !== EXPECTED_ROWS || payload.template.digitsPerRow !== DIGITS_PER_ROW) {
    throw invalidRequest("La geometria solicitada debe ser 40 por 5");
  }

  exactKeys(payload.recognition, ["mode", "alphabet"], "request.recognition");
  if (payload.recognition.mode !== "DIGIT_BOXES_ONLY" || payload.recognition.alphabet !== "0123456789") {
    throw invalidRequest("El modo de reconocimiento no esta permitido");
  }

  let file;
  if (declaredMimeType === "application/pdf") {
    const inspection = inspectInputFile(sourceBytes, {
      declaredMimeType,
      limits: { maxBytes: effectiveLimits.maxDocumentBytes }
    });
    const structuralErrors = new Set(["PDF_PAGE_COUNT_UNKNOWN", "PDF_MULTIPAGE_NOT_ALLOWED"]);
    const blockingErrors = inspection.errors.filter((error) => !structuralErrors.has(error));
    if (blockingErrors.length) throw invalidDocument("La firma, MIME o tamano del PDF no es valido");
    file = Object.freeze({
      ...inspection,
      valid: true,
      pageCount: null,
      errors: Object.freeze([]),
      warnings: Object.freeze([...new Set([
        ...inspection.warnings,
        "PDF_STRUCTURE_DELEGATED_TO_PDFINFO"
      ])]),
      structuralValidation: "PDFINFO_REQUIRED"
    });
  } else {
    try {
      file = validateInputFile(sourceBytes, {
        declaredMimeType,
        limits: { maxBytes: effectiveLimits.maxDocumentBytes }
      });
    } catch (error) {
      throw invalidDocument(error?.code === "OCR_FILE_INVALID" ? "La firma o resolucion de la imagen no es valida" : "No fue posible validar el documento");
    }
  }
  if (file.detectedMimeType !== declaredMimeType) throw invalidDocument("El MIME declarado no coincide con el contenido");
  return Object.freeze({
    requestId,
    documentId,
    sourceSha256,
    mimeType: declaredMimeType,
    templateVersion,
    sourceBytes: Buffer.from(sourceBytes),
    file
  });
}

function validateFlags(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 20) throw invalidProvider("flags es invalido");
  const seen = new Set();
  return Object.freeze(value.map((entry) => {
    if (typeof entry !== "string") throw invalidProvider("flags es invalido");
    const flag = entry;
    if (!FLAG.test(flag) || seen.has(flag)) throw invalidProvider("flags es invalido");
    seen.add(flag);
    return flag;
  }));
}

function responseRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_ROWS) {
    throw invalidProvider("Se requieren exactamente 40 renglones");
  }
  const rowsSeen = new Set();
  return Object.freeze(rows.map((row) => {
    if (!isPlainObject(row)) throw invalidProvider("Cada renglon debe ser un objeto");
    const rowIndex = row.rowIndex;
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS || rowsSeen.has(rowIndex)) {
      throw invalidProvider("rowIndex es invalido o duplicado");
    }
    rowsSeen.add(rowIndex);
    const sourceSlots = row.slots ?? row.digits;
    if (!Array.isArray(sourceSlots) || sourceSlots.length !== DIGITS_PER_ROW) {
      throw invalidProvider("Cada renglon debe contener cinco casillas");
    }
    const slotsSeen = new Set();
    const slots = sourceSlots.map((slot) => {
      if (!isPlainObject(slot)) throw invalidProvider("Cada casilla debe ser un objeto");
      const digitIndex = slot.digitIndex;
      if (!Number.isSafeInteger(digitIndex) || digitIndex < 0 || digitIndex >= DIGITS_PER_ROW || slotsSeen.has(digitIndex)) {
        throw invalidProvider("digitIndex es invalido o duplicado");
      }
      slotsSeen.add(digitIndex);
      const cropId = `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`;
      if (slot.cropId != null && (typeof slot.cropId !== "string" || slot.cropId !== cropId)) {
        throw invalidProvider("cropId no corresponde a la posicion");
      }
      const digit = slot.digit ?? slot.value ?? "";
      const confidence = slot.confidence;
      if (typeof digit !== "string" || !/^\d?$/.test(digit) || typeof confidence !== "number" ||
          !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || (digit === "" && confidence !== 0)) {
        throw invalidProvider("El valor o la confianza de una casilla es invalido");
      }
      return Object.freeze({ cropId, digitIndex, digit, confidence });
    }).sort((left, right) => left.digitIndex - right.digitIndex);
    const flags = validateFlags(row.flags);
    const output = { rowIndex, slots: Object.freeze(slots) };
    if (flags.length) output.flags = flags;
    return Object.freeze(output);
  }).sort((left, right) => left.rowIndex - right.rowIndex));
}

function evidenceVariant(value, field, limits) {
  if (!isPlainObject(value)) throw invalidProvider(`${field} no es un objeto`);
  const bytes = Buffer.isBuffer(value.bytes) || value.bytes instanceof Uint8Array
    ? Buffer.from(value.bytes)
    : null;
  if (!bytes || !bytes.length || bytes.length > limits.maxEvidenceBlobBytes) {
    throw invalidProvider(`${field} excede el limite o no contiene bytes`);
  }
  const detectedMimeType = detectMimeType(bytes);
  const declaredMimeType = String(value.mimeType ?? detectedMimeType ?? "").toLowerCase();
  if (!detectedMimeType || !["image/png", "image/jpeg"].includes(detectedMimeType) || declaredMimeType !== detectedMimeType) {
    throw invalidProvider(`${field} no contiene una imagen permitida`);
  }
  if (detectedMimeType === "image/png" && !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw invalidProvider(`${field} no contiene un PNG real`);
  }
  return Object.freeze({
    mimeType: detectedMimeType,
    sha256: sha256(bytes),
    contentBase64: bytes.toString("base64"),
    byteSize: bytes.length
  });
}

function responseCropPairs(cropPairs, limits) {
  if (!Array.isArray(cropPairs) || cropPairs.length !== EXPECTED_CROPS) {
    throw invalidProvider("Se requieren exactamente 200 pares de recortes");
  }
  const positions = new Set();
  let totalBinaryBytes = 0;
  const pairs = cropPairs.map((pair) => {
    if (!isPlainObject(pair)) throw invalidProvider("Cada recorte debe ser un objeto");
    const rowIndex = pair.rowIndex;
    const digitIndex = pair.digitIndex;
    const position = `${rowIndex}:${digitIndex}`;
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS ||
        !Number.isSafeInteger(digitIndex) || digitIndex < 0 || digitIndex >= DIGITS_PER_ROW || positions.has(position)) {
      throw invalidProvider("La posicion de un recorte es invalida o duplicada");
    }
    positions.add(position);
    const cropId = `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`;
    if (typeof pair.cropId !== "string" || pair.cropId !== cropId) throw invalidProvider("cropId no corresponde a la posicion");
    const visual = evidenceVariant(pair.visual, `cropPairs.${cropId}.visual`, limits);
    const processed = evidenceVariant(pair.processed, `cropPairs.${cropId}.processed`, limits);
    totalBinaryBytes += visual.byteSize + processed.byteSize;
    if (totalBinaryBytes > limits.maxEvidenceBinaryBytes) {
      throw invalidProvider("La evidencia OCR excede el limite binario total");
    }
    return Object.freeze({
      cropId,
      rowIndex,
      digitIndex,
      visual: Object.freeze({ mimeType: visual.mimeType, sha256: visual.sha256, contentBase64: visual.contentBase64 }),
      processed: Object.freeze({ mimeType: processed.mimeType, sha256: processed.sha256, contentBase64: processed.contentBase64 })
    });
  }).sort((left, right) => left.rowIndex - right.rowIndex || left.digitIndex - right.digitIndex);
  if (positions.size !== EXPECTED_CROPS) throw invalidProvider("La evidencia no cubre las 200 casillas");
  return Object.freeze({ pairs: Object.freeze(pairs), totalBinaryBytes });
}

function responseRuntime(value) {
  const expected = [
    "nodeVersion", "ocrEngineName", "ocrEngineVersion", "pdfInfoVersion",
    "pdfToPpmVersion", "imagePipelineVersion", "containerBuildId", "pdfToolsUsed"
  ].sort();
  if (!isPlainObject(value)) throw invalidProvider("runtime no es un objeto");
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidProvider("runtime no coincide con el contrato");
  }
  for (const name of ["nodeVersion", "ocrEngineVersion", "pdfInfoVersion", "pdfToPpmVersion"]) {
    if (typeof value[name] !== "string" || !RUNTIME_VERSION.test(value[name])) throw invalidProvider(`${name} no es verificable`);
  }
  if (value.ocrEngineName !== "tesseract" || typeof value.imagePipelineVersion !== "string" ||
      !PIPELINE_VERSION.test(value.imagePipelineVersion) || typeof value.containerBuildId !== "string" ||
      !BUILD_ID.test(value.containerBuildId) || typeof value.pdfToolsUsed !== "boolean") {
    throw invalidProvider("runtime contiene metadatos no permitidos");
  }
  return Object.freeze({
    nodeVersion: value.nodeVersion,
    ocrEngineName: "tesseract",
    ocrEngineVersion: value.ocrEngineVersion,
    pdfInfoVersion: value.pdfInfoVersion,
    pdfToPpmVersion: value.pdfToPpmVersion,
    imagePipelineVersion: value.imagePipelineVersion,
    containerBuildId: value.containerBuildId,
    pdfToolsUsed: value.pdfToolsUsed
  });
}

export function buildCompletedResponse({ request, recognition, processingMs, workerVersion = OCR_WORKER_VERSION, limits = {} }) {
  const effectiveLimits = safeLimits(limits);
  const normalizedProcessingMs = processingMs;
  if (!Number.isSafeInteger(normalizedProcessingMs) || normalizedProcessingMs < 0 || normalizedProcessingMs > 120_000) {
    throw invalidProvider("processingMs es invalido");
  }
  if (typeof workerVersion !== "string" || !/^[A-Za-z0-9_.-]{1,40}$/.test(workerVersion)) {
    throw new TypeError("workerVersion es invalido");
  }
  const rows = responseRows(recognition?.rows);
  const cropPairs = responseCropPairs(recognition?.cropPairs, effectiveLimits);
  const runtime = responseRuntime(recognition?.runtime);
  const payload = Object.freeze({
    contractVersion: OCR_WORKER_CONTRACT_VERSION,
    requestId: request.requestId,
    documentId: request.documentId,
    sourceSha256: request.sourceSha256,
    status: "COMPLETED",
    workerVersion,
    runtime,
    processingMs: normalizedProcessingMs,
    rows,
    cropPairs: cropPairs.pairs
  });
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > effectiveLimits.maxResponseBytes) {
    throw new OcrWorkerHttpError(502, "RESPONSE_TOO_LARGE", "La respuesta OCR excede el limite permitido", { retryable: false });
  }
  return Object.freeze({ payload, body, evidenceBinaryBytes: cropPairs.totalBinaryBytes });
}

export function publicError(error) {
  const known = error instanceof OcrWorkerHttpError;
  const sourceCode = String(error?.code ?? "");
  const invalidPdf = sourceCode === "PDF_STRUCTURE_INVALID";
  const status = known ? error.status : invalidPdf ? 422 : sourceCode.startsWith("TESSERACT_") ? 503 : 500;
  const code = known ? error.code : invalidPdf ? "INVALID_DOCUMENT" : status === 503 ? "OCR_ENGINE_UNAVAILABLE" : "INTERNAL_ERROR";
  const message = known
    ? error.message
    : invalidPdf
      ? "El documento OCR no es valido"
    : status === 503
      ? "El motor OCR no esta disponible temporalmente"
      : "No fue posible completar el procesamiento OCR";
  return Object.freeze({
    status,
    payload: Object.freeze({
      error: Object.freeze({ code, message, retryable: known ? error.retryable : status === 503 })
    })
  });
}

export function effectiveWorkerLimits(overrides = {}) {
  return safeLimits(overrides);
}
