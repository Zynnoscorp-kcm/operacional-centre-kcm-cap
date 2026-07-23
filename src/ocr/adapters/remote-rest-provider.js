import { createHash } from "node:crypto";

import { extractDigitCrops } from "../recognition/crop-extractor.js";

export const REMOTE_OCR_REQUEST_SCHEMA = "kcm.ocr-digits.request";
export const REMOTE_OCR_RESPONSE_SCHEMA = "kcm.ocr-digits.response";
export const REMOTE_OCR_SCHEMA_VERSION = "1.0.0";
export const REMOTE_REST_PROVIDER_NAME = "REMOTE_REST_DIGITS_V1";

const EXPECTED_ROWS = 40;
const DIGITS_PER_ROW = 5;
const EXPECTED_CROPS = EXPECTED_ROWS * DIGITS_PER_ROW;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_LIMITS = Object.freeze({
  maxCropBytes: 512 * 1024,
  maxInputBytes: 8 * 1024 * 1024,
  maxRequestBytes: 12 * 1024 * 1024,
  maxResponseBytes: 1024 * 1024
});
const RESERVED_HEADERS = new Set(["accept", "content-length", "content-type", "idempotency-key"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expectedKeys, field) {
  if (!isPlainObject(value)) throw invalidResponse(`${field} debe ser un objeto`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidResponse(`${field} no coincide con el contrato`);
  }
}

function assertExactRequestKeys(value, expectedKeys, field) {
  if (!isPlainObject(value)) throw new TypeError(`${field} debe ser un objeto simple`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${field} no coincide con el contrato OCR remoto`);
  }
}

function positiveLimit(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} esta fuera del intervalo permitido`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new TypeError("endpoint debe ser una URL HTTPS valida");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
    throw new TypeError("endpoint debe ser una URL HTTPS sin credenciales ni fragmento");
  }
  return endpoint.toString();
}

function safeHeaders(headers) {
  if (!isPlainObject(headers)) throw new TypeError("headers debe ser un objeto simple");
  const safe = {};
  for (const [name, rawValue] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(name)) throw new TypeError("Un encabezado remoto es invalido");
    if (RESERVED_HEADERS.has(name.toLowerCase())) throw new TypeError("No se permite sobrescribir encabezados del contrato OCR");
    const value = String(rawValue);
    if (!value || value.length > 4_096 || /[\r\n]/.test(value)) throw new TypeError("Un valor de encabezado remoto es invalido");
    safe[name] = value;
  }
  return Object.freeze(safe);
}

function safeGeometryVersion(value) {
  const version = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(version)) {
    throw new TypeError("La version geometrica OCR es invalida");
  }
  return version;
}

function inputBuffer(value, field) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError(`${field} debe ser Buffer o Uint8Array`);
  }
  const bytes = Buffer.from(value);
  if (!bytes.length) throw new TypeError(`${field} no puede estar vacio`);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new TypeError(`${field} debe contener un PNG real`);
  }
  return bytes;
}

function validateTemplate(segmentation) {
  if (!Array.isArray(segmentation?.templateMap?.rows) || !Array.isArray(segmentation?.digitCrops)) {
    throw new TypeError("El proveedor remoto requiere una segmentacion de plantilla");
  }
  if (segmentation.templateMap.rows.length !== EXPECTED_ROWS || segmentation.digitCrops.length !== EXPECTED_CROPS) {
    throw new RangeError("La solicitud remota debe contener exactamente 40 renglones por cinco casillas");
  }
  const rows = new Set();
  const positions = new Set();
  for (const row of segmentation.templateMap.rows) {
    if (!Number.isInteger(row?.rowIndex) || row.rowIndex < 1 || row.rowIndex > EXPECTED_ROWS || rows.has(row.rowIndex)) {
      throw new TypeError("La segmentacion contiene indices de renglon invalidos o duplicados");
    }
    if (!Array.isArray(row.digitBoxes) || row.digitBoxes.length !== DIGITS_PER_ROW) {
      throw new TypeError("Cada renglon segmentado debe contener cinco casillas");
    }
    rows.add(row.rowIndex);
    for (const digit of row.digitBoxes) {
      const digitIndex = Number(digit?.digitIndex);
      const key = `${row.rowIndex}:${digitIndex}`;
      if (!Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex >= DIGITS_PER_ROW || positions.has(key)) {
        throw new TypeError("La segmentacion contiene indices de casilla invalidos o duplicados");
      }
      positions.add(key);
    }
  }
  if (rows.size !== EXPECTED_ROWS || positions.size !== EXPECTED_CROPS) {
    throw new TypeError("La segmentacion no cubre la plantilla OCR completa");
  }
}

function suppliedExtraction({ segmentation, imageBytes, normalizedImage, crops }) {
  if (crops?.crops) return crops;
  if (Array.isArray(crops)) return Object.freeze({ crops: Object.freeze(crops) });
  const normalizedImageBytes = normalizedImage?.bytes ?? normalizedImage?.pngBytes ?? normalizedImage;
  const suppliedImage = normalizedImageBytes ?? imageBytes;
  if (!suppliedImage) throw new TypeError("El proveedor remoto requiere recortes o la imagen PNG normalizada");
  return extractDigitCrops({ imageBytes: Buffer.from(suppliedImage), segmentation });
}

function requestCrops(extraction, segmentation, limits) {
  if (!Array.isArray(extraction?.crops) || extraction.crops.length !== EXPECTED_CROPS) {
    throw new RangeError("El proveedor remoto requiere exactamente 200 recortes");
  }
  const expectedByPosition = new Map(segmentation.digitCrops.map((crop) => [
    `${crop.rowIndex}:${crop.digitIndex}`,
    String(crop.cropId)
  ]));
  const positions = new Set();
  let totalBytes = 0;
  const prepared = extraction.crops.map((crop) => {
    const rowIndex = Number(crop?.rowIndex);
    const digitIndex = Number(crop?.digitIndex);
    const position = `${rowIndex}:${digitIndex}`;
    const expectedCropId = expectedByPosition.get(position);
    const cropId = String(crop?.cropId ?? "");
    if (!expectedCropId || cropId !== expectedCropId || positions.has(position)) {
      throw new TypeError("Los recortes no corresponden de forma univoca con la segmentacion");
    }
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(cropId)) throw new TypeError("cropId es invalido");
    positions.add(position);
    const bytes = inputBuffer(crop.pngBytes, `crop:${cropId}`);
    if (bytes.length > limits.maxCropBytes) throw new RangeError("Un recorte excede el limite de bytes permitido");
    totalBytes += bytes.length;
    if (totalBytes > limits.maxInputBytes) throw new RangeError("Los recortes exceden el limite total de bytes permitido");
    const digest = sha256(bytes);
    if (crop.sha256 != null && String(crop.sha256) !== digest) {
      throw new TypeError("El hash declarado de un recorte no coincide con sus bytes");
    }
    return {
      cropId,
      rowIndex,
      digitIndex,
      mimeType: "image/png",
      sha256: digest,
      contentBase64: bytes.toString("base64")
    };
  }).sort((left, right) => left.rowIndex - right.rowIndex || left.digitIndex - right.digitIndex);
  if (positions.size !== EXPECTED_CROPS) throw new TypeError("Los recortes no cubren las 200 casillas esperadas");
  return Object.freeze({ crops: Object.freeze(prepared.map(Object.freeze)), totalBytes });
}

export function computeRemoteOcrRequestSha256({ geometryVersion, crops }) {
  const safeVersion = safeGeometryVersion(geometryVersion);
  if (!Array.isArray(crops) || crops.length !== EXPECTED_CROPS) {
    throw new TypeError("Se requieren 200 metadatos de recorte para calcular el hash remoto");
  }
  const hash = createHash("sha256");
  hash.update(`${REMOTE_OCR_REQUEST_SCHEMA}\0${REMOTE_OCR_SCHEMA_VERSION}\0${safeVersion}\0`);
  for (const crop of [...crops].sort((left, right) => left.rowIndex - right.rowIndex || left.digitIndex - right.digitIndex)) {
    hash.update(`${crop.cropId}\0${crop.rowIndex}\0${crop.digitIndex}\0${crop.sha256}\n`);
  }
  return hash.digest("hex");
}

function strictBase64Png(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TypeError(`${field} no contiene base64 canonico`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new TypeError(`${field} no contiene base64 canonico`);
  return inputBuffer(bytes, field);
}

/**
 * Validador compartible por un worker HTTP. Rechaza cualquier campo ajeno al
 * contrato, decodifica solo PNGs y verifica hashes individuales y de lote.
 */
export function validateRemoteOcrRequestPayload(value, { limits = {} } = {}) {
  const configuredLimits = { ...DEFAULT_LIMITS, ...limits };
  const safeLimits = Object.freeze({
    maxCropBytes: positiveLimit(configuredLimits.maxCropBytes, "maxCropBytes", 2 * 1024 * 1024),
    maxInputBytes: positiveLimit(configuredLimits.maxInputBytes, "maxInputBytes", 32 * 1024 * 1024),
    maxRequestBytes: positiveLimit(configuredLimits.maxRequestBytes, "maxRequestBytes", 48 * 1024 * 1024)
  });
  assertExactRequestKeys(value, ["schema", "version", "requestSha256", "geometry", "crops"], "request");
  if (value.schema !== REMOTE_OCR_REQUEST_SCHEMA || value.version !== REMOTE_OCR_SCHEMA_VERSION) {
    throw new TypeError("La version del contrato OCR remoto no es compatible");
  }
  if (!/^[a-f0-9]{64}$/.test(value.requestSha256)) throw new TypeError("requestSha256 es invalido");
  assertExactRequestKeys(value.geometry, ["version", "rowCount", "digitsPerRow"], "request.geometry");
  const geometryVersion = safeGeometryVersion(value.geometry.version);
  if (value.geometry.rowCount !== EXPECTED_ROWS || value.geometry.digitsPerRow !== DIGITS_PER_ROW) {
    throw new RangeError("La geometria remota debe declarar 40 renglones por cinco casillas");
  }
  if (!Array.isArray(value.crops) || value.crops.length !== EXPECTED_CROPS) {
    throw new RangeError("La solicitud remota debe contener exactamente 200 recortes");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > safeLimits.maxRequestBytes) {
    throw new RangeError("La solicitud JSON OCR excede el limite de bytes permitido");
  }
  const positions = new Set();
  const cropIds = new Set();
  let totalBytes = 0;
  const crops = value.crops.map((crop) => {
    assertExactRequestKeys(
      crop,
      ["cropId", "rowIndex", "digitIndex", "mimeType", "sha256", "contentBase64"],
      "request.crops[]"
    );
    const rowIndex = crop.rowIndex;
    const digitIndex = crop.digitIndex;
    const position = `${rowIndex}:${digitIndex}`;
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS ||
      !Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex >= DIGITS_PER_ROW || positions.has(position)) {
      throw new TypeError("La solicitud contiene una posicion de recorte invalida o duplicada");
    }
    if (typeof crop.cropId !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(crop.cropId) || cropIds.has(crop.cropId)) {
      throw new TypeError("La solicitud contiene cropId invalido o duplicado");
    }
    if (crop.mimeType !== "image/png") throw new TypeError("Cada recorte remoto debe declarar image/png");
    if (typeof crop.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(crop.sha256)) {
      throw new TypeError("La solicitud contiene un hash de recorte invalido");
    }
    const bytes = strictBase64Png(crop.contentBase64, `crop:${crop.cropId}`);
    if (bytes.length > safeLimits.maxCropBytes) throw new RangeError("Un recorte excede el limite de bytes permitido");
    totalBytes += bytes.length;
    if (totalBytes > safeLimits.maxInputBytes) throw new RangeError("Los recortes exceden el limite total de bytes permitido");
    if (sha256(bytes) !== crop.sha256) throw new TypeError("El hash de un recorte no coincide con sus bytes");
    positions.add(position);
    cropIds.add(crop.cropId);
    return Object.freeze({
      cropId: crop.cropId,
      rowIndex,
      digitIndex,
      mimeType: crop.mimeType,
      sha256: crop.sha256,
      contentBase64: crop.contentBase64,
      bytes: Buffer.from(bytes)
    });
  }).sort((left, right) => left.rowIndex - right.rowIndex || left.digitIndex - right.digitIndex);
  if (positions.size !== EXPECTED_CROPS) throw new TypeError("La solicitud no cubre las 200 posiciones OCR");
  const computedHash = computeRemoteOcrRequestSha256({ geometryVersion, crops });
  if (computedHash !== value.requestSha256) throw new TypeError("requestSha256 no coincide con el contenido de la solicitud");
  return Object.freeze({
    schema: value.schema,
    version: value.version,
    requestSha256: value.requestSha256,
    geometry: Object.freeze({ version: geometryVersion, rowCount: EXPECTED_ROWS, digitsPerRow: DIGITS_PER_ROW }),
    crops: Object.freeze(crops),
    totalBytes
  });
}

function buildRequest(segmentation, extraction, limits) {
  const geometryVersion = safeGeometryVersion(segmentation.geometryVersion ?? segmentation.templateMap.version);
  const prepared = requestCrops(extraction, segmentation, limits);
  const requestSha256 = computeRemoteOcrRequestSha256({ geometryVersion, crops: prepared.crops });
  const payload = Object.freeze({
    schema: REMOTE_OCR_REQUEST_SCHEMA,
    version: REMOTE_OCR_SCHEMA_VERSION,
    requestSha256,
    geometry: Object.freeze({
      version: geometryVersion,
      rowCount: EXPECTED_ROWS,
      digitsPerRow: DIGITS_PER_ROW
    }),
    crops: prepared.crops
  });
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > limits.maxRequestBytes) {
    throw new RangeError("La solicitud JSON OCR excede el limite de bytes permitido");
  }
  return Object.freeze({ payload, body, requestSha256 });
}

function invalidResponse(detail) {
  return new RemoteOcrProviderError("REMOTE_OCR_INVALID_RESPONSE", "El servicio OCR devolvio una respuesta invalida", {
    retryable: false,
    detail
  });
}

function safeEngineField(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+:-]{0,63}$/.test(value)) {
    throw invalidResponse(`${field} es invalido`);
  }
  return value;
}

/** Valida y normaliza el JSON de salida que comparte cliente y worker. */
export function validateRemoteOcrResponsePayload(value, { requestSha256 } = {}) {
  assertExactKeys(value, ["schema", "version", "requestSha256", "engine", "rows"], "response");
  if (value.schema !== REMOTE_OCR_RESPONSE_SCHEMA || value.version !== REMOTE_OCR_SCHEMA_VERSION) {
    throw invalidResponse("La version del contrato remoto no es compatible");
  }
  if (typeof value.requestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.requestSha256)) {
    throw invalidResponse("requestSha256 es invalido");
  }
  if (requestSha256 != null && value.requestSha256 !== requestSha256) {
    throw new RemoteOcrProviderError("REMOTE_OCR_RESPONSE_MISMATCH", "La respuesta OCR no corresponde a la solicitud", {
      retryable: false
    });
  }
  assertExactKeys(value.engine, ["name", "version"], "response.engine");
  const engine = Object.freeze({
    name: safeEngineField(value.engine.name, "engine.name"),
    version: safeEngineField(value.engine.version, "engine.version")
  });
  if (!Array.isArray(value.rows) || value.rows.length !== EXPECTED_ROWS) {
    throw invalidResponse("La respuesta debe contener exactamente 40 renglones");
  }
  const rowsSeen = new Set();
  const rows = value.rows.map((row) => {
    assertExactKeys(row, ["rowIndex", "digits"], "response.rows[]");
    const rowIndex = row.rowIndex;
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS || rowsSeen.has(rowIndex)) {
      throw invalidResponse("rowIndex es invalido o esta duplicado");
    }
    rowsSeen.add(rowIndex);
    if (!Array.isArray(row.digits) || row.digits.length !== DIGITS_PER_ROW) {
      throw invalidResponse("Cada renglon debe contener exactamente cinco digitos");
    }
    const digitsSeen = new Set();
    const digits = row.digits.map((digit) => {
      assertExactKeys(digit, ["digitIndex", "value", "confidence"], "response.rows[].digits[]");
      const digitIndex = digit.digitIndex;
      if (!Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex >= DIGITS_PER_ROW || digitsSeen.has(digitIndex)) {
        throw invalidResponse("digitIndex es invalido o esta duplicado");
      }
      digitsSeen.add(digitIndex);
      if (typeof digit.value !== "string" || !/^\d?$/.test(digit.value)) {
        throw invalidResponse("El valor OCR debe ser un digito o cadena vacia");
      }
      if (!Number.isFinite(digit.confidence) || digit.confidence < 0 || digit.confidence > 1) {
        throw invalidResponse("La confianza OCR debe ser finita y estar entre cero y uno");
      }
      if (digit.value === "" && digit.confidence !== 0) {
        throw invalidResponse("Una casilla vacia debe reportar confianza cero");
      }
      return Object.freeze({
        digitIndex,
        value: digit.value,
        confidence: digit.confidence
      });
    }).sort((left, right) => left.digitIndex - right.digitIndex);
    return Object.freeze({
      rowIndex,
      digits: Object.freeze(digits)
    });
  }).sort((left, right) => left.rowIndex - right.rowIndex);
  if (rowsSeen.size !== EXPECTED_ROWS) throw invalidResponse("La respuesta no cubre los 40 renglones");
  return Object.freeze({
    schema: value.schema,
    version: value.version,
    requestSha256: value.requestSha256,
    engine,
    rows: Object.freeze(rows)
  });
}

function validatedRemoteResponse(value, { requestSha256, expectedCrops, attempts }) {
  const payload = validateRemoteOcrResponsePayload(value, { requestSha256 });
  const cropsByPosition = new Map(expectedCrops.map((crop) => [`${crop.rowIndex}:${crop.digitIndex}`, crop]));
  const rows = payload.rows.map((row) => {
    const digits = row.digits.map((digit) => {
      const expectedCrop = cropsByPosition.get(`${row.rowIndex}:${digit.digitIndex}`);
      if (!expectedCrop) throw invalidResponse("La respuesta contiene una posicion no solicitada");
      return Object.freeze({
        cropId: expectedCrop.cropId,
        digitIndex: digit.digitIndex,
        digit: digit.value,
        confidence: digit.confidence,
        isBlank: digit.value === "",
        cropSha256: expectedCrop.sha256
      });
    });
    const detected = digits.some((digit) => digit.digit !== "");
    const digitConfidences = digits.map((digit) => digit.confidence);
    return Object.freeze({
      rowIndex: row.rowIndex,
      detected,
      rawDigits: digits.map((digit) => digit.digit).join(""),
      digitConfidences: Object.freeze(digitConfidences),
      overallConfidence: detected ? Math.min(...digitConfidences) : 0,
      digits: Object.freeze(digits),
      provider: REMOTE_REST_PROVIDER_NAME
    });
  });
  return Object.freeze({
    provider: REMOTE_REST_PROVIDER_NAME,
    engine: payload.engine,
    transport: Object.freeze({
      protocol: "REST_JSON",
      schema: REMOTE_OCR_RESPONSE_SCHEMA,
      version: REMOTE_OCR_SCHEMA_VERSION,
      requestSha256,
      attempts
    }),
    rows: Object.freeze(rows),
    cropArtifacts: Object.freeze(expectedCrops.map((crop) => Object.freeze({
      cropId: crop.cropId,
      rowIndex: crop.rowIndex,
      digitIndex: crop.digitIndex,
      sha256: crop.sha256
    }))),
    binaryArtifactsIncluded: false
  });
}

async function responseJson(response, maxResponseBytes) {
  const contentType = String(response.headers?.get?.("content-type") ?? "");
  if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw invalidResponse("Content-Type no es JSON");
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw invalidResponse("La respuesta excede el limite declarado");
  }
  let text = "";
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        byteLength += chunk.length;
        if (byteLength > maxResponseBytes) {
          await reader.cancel().catch(() => {});
          throw invalidResponse("La respuesta excede el limite permitido");
        }
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks, byteLength).toString("utf8");
    } catch (error) {
      if (error instanceof RemoteOcrProviderError) throw error;
      throw invalidResponse("No fue posible leer la respuesta");
    } finally {
      reader.releaseLock();
    }
  } else {
    try {
      text = await response.text();
    } catch {
      throw invalidResponse("No fue posible leer la respuesta");
    }
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      throw invalidResponse("La respuesta excede el limite permitido");
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalidResponse("El cuerpo no contiene JSON valido");
  }
}

function retryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function discardResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // El cuerpo remoto nunca se incluye en errores ni bitacoras.
  }
}

function retryDelayMs(response, attempt, { backoffBaseMs, maxBackoffMs }) {
  const retryAfter = String(response?.headers?.get?.("retry-after") ?? "").trim();
  const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.min(maxBackoffMs, Math.max(0, Math.round(seconds * 1_000)));
  return Math.min(maxBackoffMs, backoffBaseMs * (2 ** (attempt - 1)));
}

export class RemoteOcrProviderError extends Error {
  constructor(code, message, { retryable = false, status = null, attempts = 0, detail = null } = {}) {
    super(message);
    this.name = "RemoteOcrProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.attempts = Number.isInteger(attempts) && attempts >= 0 ? attempts : 0;
    Object.defineProperty(this, "detail", { value: detail, enumerable: false });
  }
}

export class RemoteRestDigitsProvider {
  #endpoint;
  #fetch;
  #headers;
  #limits;
  #timeoutMs;
  #maxAttempts;
  #backoffBaseMs;
  #maxBackoffMs;
  #sleep;

  constructor({
    endpoint,
    fetchFn = globalThis.fetch,
    headers = {},
    timeoutMs = 15_000,
    maxAttempts = 3,
    backoffBaseMs = 250,
    maxBackoffMs = 5_000,
    sleepFn = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    limits = {}
  } = {}) {
    this.#endpoint = safeEndpoint(endpoint);
    if (typeof fetchFn !== "function") throw new TypeError("fetchFn debe ser una funcion");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new TypeError("timeoutMs esta fuera del intervalo permitido");
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) {
      throw new TypeError("maxAttempts debe estar entre uno y cuatro");
    }
    if (!Number.isInteger(backoffBaseMs) || backoffBaseMs < 0 || backoffBaseMs > 5_000) {
      throw new TypeError("backoffBaseMs esta fuera del intervalo permitido");
    }
    if (!Number.isInteger(maxBackoffMs) || maxBackoffMs < backoffBaseMs || maxBackoffMs > 30_000) {
      throw new TypeError("maxBackoffMs esta fuera del intervalo permitido");
    }
    if (typeof sleepFn !== "function") throw new TypeError("sleepFn debe ser una funcion");
    const configuredLimits = { ...DEFAULT_LIMITS, ...limits };
    this.#limits = Object.freeze({
      maxCropBytes: positiveLimit(configuredLimits.maxCropBytes, "maxCropBytes", 2 * 1024 * 1024),
      maxInputBytes: positiveLimit(configuredLimits.maxInputBytes, "maxInputBytes", 32 * 1024 * 1024),
      maxRequestBytes: positiveLimit(configuredLimits.maxRequestBytes, "maxRequestBytes", 48 * 1024 * 1024),
      maxResponseBytes: positiveLimit(configuredLimits.maxResponseBytes, "maxResponseBytes", 4 * 1024 * 1024)
    });
    this.providerName = REMOTE_REST_PROVIDER_NAME;
    this.isAsync = true;
    this.#fetch = fetchFn;
    this.#headers = safeHeaders(headers);
    this.#timeoutMs = timeoutMs;
    this.#maxAttempts = maxAttempts;
    this.#backoffBaseMs = backoffBaseMs;
    this.#maxBackoffMs = maxBackoffMs;
    this.#sleep = sleepFn;
  }

  async #fetchOnce(body, requestSha256, attempt) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          ...this.#headers,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": requestSha256
        },
        body,
        signal: controller.signal,
        redirect: "error"
      });
      if (!response || !Number.isInteger(response.status) || typeof response.text !== "function") {
        throw invalidResponse("fetch no devolvio una respuesta HTTP valida");
      }
      return Object.freeze({
        response,
        timedOut: () => timedOut,
        close: () => clearTimeout(timer)
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof RemoteOcrProviderError) throw error;
      if (timedOut || controller.signal.aborted) {
        throw new RemoteOcrProviderError("REMOTE_OCR_TIMEOUT", "El servicio OCR excedio el tiempo permitido", {
          retryable: true,
          attempts: attempt
        });
      }
      throw new RemoteOcrProviderError("REMOTE_OCR_NETWORK", "No fue posible contactar al servicio OCR", {
        retryable: true,
        attempts: attempt
      });
    }
  }

  async #waitBeforeRetry(response, attempt) {
    const delayMs = retryDelayMs(response, attempt, {
      backoffBaseMs: this.#backoffBaseMs,
      maxBackoffMs: this.#maxBackoffMs
    });
    try {
      await this.#sleep(delayMs);
    } catch {
      throw new RemoteOcrProviderError("REMOTE_OCR_RETRY_FAILED", "No fue posible programar el reintento OCR", {
        retryable: true,
        attempts: attempt
      });
    }
  }

  /**
   * Envia exclusivamente los 200 recortes procesados. `hints`, padron, nombres,
   * sesion, documento y la pagina completa se ignoran deliberadamente.
   */
  async recognize({ segmentation, imageBytes, normalizedImage, crops } = {}) {
    validateTemplate(segmentation);
    const extraction = suppliedExtraction({ segmentation, imageBytes, normalizedImage, crops });
    const request = buildRequest(segmentation, extraction, this.#limits);
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      let attemptContext = null;
      try {
        attemptContext = await this.#fetchOnce(request.body, request.requestSha256, attempt);
        const { response } = attemptContext;
        if (retryableStatus(response.status)) {
          await discardResponseBody(response);
          if (attempt < this.#maxAttempts) {
            attemptContext.close();
            await this.#waitBeforeRetry(response, attempt);
            continue;
          }
          const rateLimited = response.status === 429;
          throw new RemoteOcrProviderError(
            rateLimited ? "REMOTE_OCR_RATE_LIMITED" : "REMOTE_OCR_UNAVAILABLE",
            rateLimited ? "El servicio OCR limito temporalmente la solicitud" : "El servicio OCR no esta disponible temporalmente",
            { retryable: true, status: response.status, attempts: attempt }
          );
        }
        if (response.status < 200 || response.status > 299) {
          await discardResponseBody(response);
          throw new RemoteOcrProviderError("REMOTE_OCR_HTTP_REJECTED", "El servicio OCR rechazo la solicitud", {
            retryable: false,
            status: response.status,
            attempts: attempt
          });
        }
        const json = await responseJson(response, this.#limits.maxResponseBytes);
        return validatedRemoteResponse(json, {
          requestSha256: request.requestSha256,
          expectedCrops: request.payload.crops,
          attempts: attempt
        });
      } catch (error) {
        const normalizedError = attemptContext?.timedOut()
          ? new RemoteOcrProviderError("REMOTE_OCR_TIMEOUT", "El servicio OCR excedio el tiempo permitido", {
            retryable: true,
            attempts: attempt
          })
          : error;
        const retryableTransportFailure = normalizedError instanceof RemoteOcrProviderError &&
          normalizedError.retryable &&
          (normalizedError.code === "REMOTE_OCR_NETWORK" || normalizedError.code === "REMOTE_OCR_TIMEOUT");
        if (retryableTransportFailure && attempt < this.#maxAttempts) {
          attemptContext?.close();
          await this.#waitBeforeRetry(null, attempt);
          continue;
        }
        throw normalizedError;
      } finally {
        attemptContext?.close();
      }
    }
    throw new RemoteOcrProviderError("REMOTE_OCR_UNAVAILABLE", "El servicio OCR no esta disponible temporalmente", {
      retryable: true,
      attempts: this.#maxAttempts
    });
  }
}

export const REMOTE_OCR_LIMITS = DEFAULT_LIMITS;
