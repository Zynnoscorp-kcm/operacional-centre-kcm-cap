import { createHash } from "node:crypto";

export const DEFAULT_FILE_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  minWidth: 1000,
  minHeight: 1400,
  maxWidth: 12_000,
  maxHeight: 18_000,
  maxPixels: 50_000_000,
  maxPages: 1,
  allowedMimeTypes: Object.freeze(["image/jpeg", "image/png", "application/pdf"])
});

const MIME_SIGNATURES = Object.freeze({
  PNG: "image/png",
  JPEG: "image/jpeg",
  PDF: "application/pdf"
});

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError("El archivo debe proporcionarse como Buffer o Uint8Array");
}

export function detectMimeType(bytes) {
  const buffer = asBuffer(bytes);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return MIME_SIGNATURES.PNG;
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return MIME_SIGNATURES.JPEG;
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return MIME_SIGNATURES.PDF;
  }
  return null;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function countPdfPages(buffer) {
  const source = buffer.toString("latin1");
  return [...source.matchAll(/\/Type\s*\/Page(?!s)\b/g)].length;
}

function inspectDimensions(buffer, mimeType) {
  if (mimeType === MIME_SIGNATURES.PNG) return readPngDimensions(buffer);
  if (mimeType === MIME_SIGNATURES.JPEG) return readJpegDimensions(buffer);
  return null;
}

function mergeLimits(overrides) {
  const limits = {
    ...DEFAULT_FILE_LIMITS,
    ...(overrides ?? {}),
    allowedMimeTypes: overrides?.allowedMimeTypes ?? DEFAULT_FILE_LIMITS.allowedMimeTypes
  };
  for (const name of ["maxBytes", "minWidth", "minHeight", "maxWidth", "maxHeight", "maxPixels", "maxPages"]) {
    if (!Number.isInteger(limits[name]) || limits[name] < 1) throw new TypeError(`Limite OCR invalido: ${name}`);
  }
  if (limits.minWidth > limits.maxWidth || limits.minHeight > limits.maxHeight) {
    throw new TypeError("Los limites minimos de imagen exceden los maximos");
  }
  if (!Array.isArray(limits.allowedMimeTypes) || limits.allowedMimeTypes.length === 0) {
    throw new TypeError("allowedMimeTypes debe ser un arreglo no vacio");
  }
  return limits;
}

export function inspectInputFile(bytes, { declaredMimeType = null, limits: limitOverrides = null } = {}) {
  const buffer = asBuffer(bytes);
  const limits = mergeLimits(limitOverrides);
  const detectedMimeType = detectMimeType(buffer);
  const dimensions = detectedMimeType ? inspectDimensions(buffer, detectedMimeType) : null;
  const pageCount = detectedMimeType === MIME_SIGNATURES.PDF ? countPdfPages(buffer) : 1;
  const errors = [];
  const warnings = [];

  if (buffer.length === 0) errors.push("EMPTY_FILE");
  if (buffer.length > limits.maxBytes) errors.push("FILE_TOO_LARGE");
  if (!detectedMimeType) errors.push("UNSUPPORTED_FILE_SIGNATURE");
  if (detectedMimeType && !limits.allowedMimeTypes.includes(detectedMimeType)) errors.push("MIME_NOT_ALLOWED");
  if (declaredMimeType && detectedMimeType && declaredMimeType !== detectedMimeType) errors.push("MIME_MISMATCH");

  if (detectedMimeType === MIME_SIGNATURES.PDF) {
    if (pageCount === 0) errors.push("PDF_PAGE_COUNT_UNKNOWN");
    if (pageCount > limits.maxPages) errors.push("PDF_MULTIPAGE_NOT_ALLOWED");
    warnings.push("PDF_REQUIRES_RASTERIZATION_BEFORE_RECOGNITION");
  } else if (detectedMimeType) {
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
      errors.push("IMAGE_DIMENSIONS_UNREADABLE");
    } else {
      const longEdge = Math.max(dimensions.width, dimensions.height);
      const shortEdge = Math.min(dimensions.width, dimensions.height);
      if (shortEdge < limits.minWidth || longEdge < limits.minHeight) errors.push("IMAGE_RESOLUTION_TOO_LOW");
      if (shortEdge > limits.maxWidth || longEdge > limits.maxHeight || (dimensions.width * dimensions.height) > limits.maxPixels) {
        errors.push("IMAGE_RESOLUTION_TOO_HIGH");
      }
      if (dimensions.width > dimensions.height) warnings.push("LANDSCAPE_REQUIRES_ROTATION");
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    byteSize: buffer.length,
    detectedMimeType,
    declaredMimeType,
    dimensions: dimensions ? Object.freeze({ ...dimensions }) : null,
    orientation: dimensions ? (dimensions.width > dimensions.height ? "LANDSCAPE" : "PORTRAIT") : null,
    pageCount,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings)
  });
}

export function validateInputFile(bytes, options = {}) {
  const inspection = inspectInputFile(bytes, options);
  if (!inspection.valid) {
    const error = new TypeError(`Archivo OCR invalido: ${inspection.errors.join(",")}`);
    error.code = "OCR_FILE_INVALID";
    error.validationErrors = inspection.errors;
    throw error;
  }
  return inspection;
}
