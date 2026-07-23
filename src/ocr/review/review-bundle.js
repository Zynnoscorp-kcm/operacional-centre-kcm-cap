import { createHash } from "node:crypto";

import { OCR_DECISIONS } from "../../shared/contracts.js";

export const REVIEW_BUNDLE_VERSION = "ocr-review-bundle-v1";
export const REVIEW_SLOT_COUNT = 5;
export const REVIEW_MAX_ROWS = 40;
export const REVIEW_EXPECTED_CROPS = REVIEW_MAX_ROWS * REVIEW_SLOT_COUNT;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FLAG_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const CROP_ID_PATTERN = /^r(0[1-9]|[12][0-9]|3[0-9]|40)-d([1-5])$/;
const ALLOWED_DECISIONS = new Set(Object.values(OCR_DECISIONS));

export class ReviewBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReviewBundleError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewBundleError(code, message);
}

function safeOpaqueId(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) {
    fail("REVIEW_ID_INVALID", `${field} debe ser un identificador opaco valido`);
  }
  if (value !== value.trim() || value.includes("..") || /[\\/\0]/.test(value) || !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value)) {
    fail("REVIEW_ID_UNSAFE", `${field} contiene caracteres no permitidos`);
  }
  return value;
}

function parseCropId(value) {
  if (typeof value !== "string" || value.length > 20 || value.includes("..") || /[\\/\0]/.test(value)) {
    fail("REVIEW_CROP_ID_UNSAFE", "cropId no es seguro");
  }
  const match = value.match(CROP_ID_PATTERN);
  if (!match) fail("REVIEW_CROP_ID_INVALID", "cropId no pertenece a la cuadricula 40x5");
  return Object.freeze({ cropId: value, rowIndex: Number(match[1]), digitIndex: Number(match[2]) - 1 });
}

function finiteRatio(value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail("REVIEW_METADATA_INVALID", `${field} debe estar entre cero y uno`);
  return Number(value);
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) fail("REVIEW_METADATA_INVALID", `${field} debe ser un entero positivo`);
  return value;
}

function safeSha256(value, field) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail("REVIEW_HASH_INVALID", `${field} no es un SHA-256 valido`);
  return value;
}

function safeRect(rect, field) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) {
    fail("REVIEW_METADATA_INVALID", `${field} debe ser un rectangulo entero`);
  }
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) {
    fail("REVIEW_METADATA_INVALID", `${field} queda fuera del dominio permitido`);
  }
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function asOptionalBytes(value, field, required) {
  if (value == null && !required) return null;
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail("REVIEW_EVIDENCE_MISSING", `${field} no contiene bytes raster`);
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    fail("REVIEW_EVIDENCE_MIME_INVALID", `${field} no contiene un PNG valido`);
  }
  return bytes;
}

function verifiedBytes(value, expectedSha256, field, required) {
  const bytes = asOptionalBytes(value, field, required);
  if (!bytes) return null;
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) fail("REVIEW_EVIDENCE_HASH_MISMATCH", `${field} no coincide con su SHA-256`);
  return bytes;
}

function opaqueReference(documentId, cropId, variant, sha256) {
  return `ev_${createHash("sha256").update(`${REVIEW_BUNDLE_VERSION}\0${documentId}\0${cropId}\0${variant}\0${sha256}`).digest("base64url").slice(0, 32)}`;
}

function candidateReference(documentId, candidateId) {
  return `candidate_${createHash("sha256").update(`${REVIEW_BUNDLE_VERSION}\0${documentId}\0${candidateId}`).digest("base64url").slice(0, 28)}`;
}

function validateFlags(flags) {
  if (!Array.isArray(flags)) fail("REVIEW_CANDIDATE_INVALID", "validationFlags debe ser un arreglo");
  const unique = [];
  const seen = new Set();
  for (const flag of flags) {
    if (typeof flag !== "string" || !FLAG_PATTERN.test(flag)) fail("REVIEW_CANDIDATE_INVALID", "validationFlags contiene una bandera invalida");
    if (!seen.has(flag)) unique.push(flag);
    seen.add(flag);
  }
  return Object.freeze(unique);
}

function validateCandidate(candidate, documentId) {
  if (!candidate || typeof candidate !== "object") fail("REVIEW_CANDIDATE_INVALID", "El candidato OCR es invalido");
  const candidateId = safeOpaqueId(candidate.candidateId, "candidateId");
  if (safeOpaqueId(candidate.documentId, "candidate.documentId") !== documentId) {
    fail("REVIEW_DOCUMENT_MISMATCH", "El candidato no pertenece al documento solicitado");
  }
  if (!Number.isInteger(candidate.rowIndex) || candidate.rowIndex < 1 || candidate.rowIndex > REVIEW_MAX_ROWS) {
    fail("REVIEW_ROW_INDEX_INVALID", "rowIndex debe estar entre 1 y 40");
  }
  const rawDigits = String(candidate.rawDigits ?? "");
  if (!/^\d{0,5}$/.test(rawDigits)) fail("REVIEW_CANDIDATE_INVALID", "rawDigits sólo puede contener hasta cinco digitos");
  const overallConfidence = finiteRatio(Number(candidate.overallConfidence), "overallConfidence");
  if (!ALLOWED_DECISIONS.has(candidate.decision)) fail("REVIEW_CANDIDATE_INVALID", "decision OCR no soportada");
  const digitConfidences = candidate.digitConfidences == null || (
    Array.isArray(candidate.digitConfidences) && candidate.digitConfidences.length === 0
  )
    ? Object.freeze(Array(REVIEW_SLOT_COUNT).fill(null))
    : (() => {
      if (!Array.isArray(candidate.digitConfidences) || candidate.digitConfidences.length !== REVIEW_SLOT_COUNT) {
        fail("REVIEW_CANDIDATE_INVALID", "digitConfidences debe contener cinco posiciones");
      }
      return Object.freeze(candidate.digitConfidences.map((value) => finiteRatio(Number(value), "digitConfidence")));
    })();
  return Object.freeze({
    candidateId,
    rowIndex: candidate.rowIndex,
    rawDigits,
    overallConfidence,
    decision: candidate.decision,
    validationFlags: validateFlags(candidate.validationFlags),
    digitConfidences
  });
}

function validateCrop(crop, documentId, { requireBytes = false } = {}) {
  if (!crop || typeof crop !== "object") fail("REVIEW_CROP_INVALID", "El recorte OCR es invalido");
  const parsed = parseCropId(crop.cropId);
  if (crop.rowIndex !== parsed.rowIndex || crop.digitIndex !== parsed.digitIndex) {
    fail("REVIEW_CROP_POSITION_MISMATCH", "cropId no coincide con rowIndex/digitIndex");
  }
  const sha256 = safeSha256(crop.sha256, "sha256");
  const visualSha256 = safeSha256(crop.visualSha256, "visualSha256");
  const processedBytes = verifiedBytes(crop.pngBytes, sha256, "processed", requireBytes);
  const visualBytes = verifiedBytes(crop.visualPngBytes, visualSha256, "visual", requireBytes);
  const flags = [];
  if (crop.isBlank === true) flags.push("BLANK_CROP");
  const edgeInkRatio = finiteRatio(Number(crop.edgeInkRatio), "edgeInkRatio");
  const inkRatio = finiteRatio(Number(crop.inkRatio), "inkRatio");

  return Object.freeze({
    cropId: parsed.cropId,
    rowIndex: parsed.rowIndex,
    digitIndex: parsed.digitIndex,
    rect: safeRect(crop.rect, "rect"),
    visualRect: safeRect(crop.visualRect, "visualRect"),
    isBlank: crop.isBlank === true,
    threshold: Number.isInteger(crop.threshold) && crop.threshold >= 0 && crop.threshold <= 255
      ? crop.threshold
      : fail("REVIEW_METADATA_INVALID", "threshold debe estar entre 0 y 255"),
    inkRatio,
    edgeInkRatio,
    flags: Object.freeze(flags),
    processed: Object.freeze({
      ref: opaqueReference(documentId, parsed.cropId, "processed", sha256),
      mimeType: "image/png",
      width: positiveInteger(crop.width, "width"),
      height: positiveInteger(crop.height, "height"),
      sha256
    }),
    visual: Object.freeze({
      ref: opaqueReference(documentId, parsed.cropId, "visual", visualSha256),
      mimeType: "image/png",
      width: positiveInteger(crop.visualWidth, "visualWidth"),
      height: positiveInteger(crop.visualHeight, "visualHeight"),
      sha256: visualSha256
    }),
    processedBytes,
    visualBytes
  });
}

function validateExtraction(extraction, documentId, options = {}) {
  if (!extraction?.crops || !Array.isArray(extraction.crops)) fail("REVIEW_EXTRACTION_INVALID", "La extraccion OCR es obligatoria");
  if (extraction.crops.length !== REVIEW_EXPECTED_CROPS) {
    fail("REVIEW_CROP_CARDINALITY_INVALID", "La extraccion debe contener exactamente 200 recortes");
  }
  const cropMap = new Map();
  for (const crop of extraction.crops) {
    const validated = validateCrop(crop, documentId, options);
    if (cropMap.has(validated.cropId)) fail("REVIEW_CROP_DUPLICATE", "La extraccion contiene cropId duplicado");
    cropMap.set(validated.cropId, validated);
  }
  for (let rowIndex = 1; rowIndex <= REVIEW_MAX_ROWS; rowIndex += 1) {
    for (let digit = 1; digit <= REVIEW_SLOT_COUNT; digit += 1) {
      const cropId = `r${String(rowIndex).padStart(2, "0")}-d${digit}`;
      if (!cropMap.has(cropId)) fail("REVIEW_CROP_GRID_INCOMPLETE", "La extraccion no cubre la cuadricula 40x5");
    }
  }
  return cropMap;
}

function validatedCandidates(candidates, documentId) {
  if (!Array.isArray(candidates) || candidates.length > REVIEW_MAX_ROWS) {
    fail("REVIEW_CANDIDATE_CARDINALITY_INVALID", "candidates debe contener hasta 40 filas");
  }
  const ids = new Set();
  const rows = new Set();
  return candidates.map((candidate) => {
    const validated = validateCandidate(candidate, documentId);
    if (ids.has(validated.candidateId)) fail("REVIEW_CANDIDATE_DUPLICATE", "candidateId duplicado");
    if (rows.has(validated.rowIndex)) fail("REVIEW_ROW_DUPLICATE", "rowIndex duplicado");
    ids.add(validated.candidateId);
    rows.add(validated.rowIndex);
    return validated;
  }).sort((left, right) => left.rowIndex - right.rowIndex);
}

export function createReviewBundle({ documentId: inputDocumentId, candidates, extraction } = {}) {
  const documentId = safeOpaqueId(inputDocumentId, "documentId");
  const cropMap = validateExtraction(extraction, documentId);
  const safeCandidates = validatedCandidates(candidates, documentId);
  const decisionCounts = {
    autoAccepted: 0,
    reviewRequired: 0,
    rejected: 0
  };
  let blankSlots = 0;
  let flaggedRows = 0;

  const rows = safeCandidates.map((candidate) => {
    const slots = Array.from({ length: REVIEW_SLOT_COUNT }, (_, digitIndex) => {
      const cropId = `r${String(candidate.rowIndex).padStart(2, "0")}-d${digitIndex + 1}`;
      const crop = cropMap.get(cropId);
      if (crop.isBlank) blankSlots += 1;
      return Object.freeze({
        cropId,
        digitIndex,
        confidence: candidate.digitConfidences[digitIndex],
        flags: crop.flags,
        isBlank: crop.isBlank,
        threshold: crop.threshold,
        inkRatio: crop.inkRatio,
        edgeInkRatio: crop.edgeInkRatio,
        rect: crop.rect,
        visualRect: crop.visualRect,
        processed: crop.processed,
        visual: crop.visual
      });
    });
    if (candidate.validationFlags.length) flaggedRows += 1;
    if (candidate.decision === OCR_DECISIONS.AUTO_ACCEPTED) decisionCounts.autoAccepted += 1;
    if (candidate.decision === OCR_DECISIONS.REVIEW_REQUIRED) decisionCounts.reviewRequired += 1;
    if (candidate.decision === OCR_DECISIONS.REJECTED) decisionCounts.rejected += 1;
    return Object.freeze({
      candidateId: candidate.candidateId,
      candidateRef: candidateReference(documentId, candidate.candidateId),
      rowIndex: candidate.rowIndex,
      rawDigits: candidate.rawDigits,
      overallConfidence: candidate.overallConfidence,
      decision: candidate.decision,
      validationFlags: candidate.validationFlags,
      slots: Object.freeze(slots)
    });
  });

  return Object.freeze({
    documentId,
    rows: Object.freeze(rows),
    counts: Object.freeze({
      rows: rows.length,
      slots: rows.length * REVIEW_SLOT_COUNT,
      blankSlots,
      flaggedRows,
      decisions: Object.freeze(decisionCounts)
    }),
    version: REVIEW_BUNDLE_VERSION
  });
}

function canonicalCandidateRow(documentId, candidateId) {
  const prefix = `${documentId}:row:`;
  if (!candidateId.startsWith(prefix)) return null;
  const rowText = candidateId.slice(prefix.length);
  if (!/^([0][1-9]|[12][0-9]|3[0-9]|40)$/.test(rowText)) return null;
  return Number(rowText);
}

export function createReviewEvidenceResolver({
  documentId: inputDocumentId,
  extraction,
  candidates = null
} = {}) {
  const documentId = safeOpaqueId(inputDocumentId, "documentId");
  const cropMap = validateExtraction(extraction, documentId, { requireBytes: true });
  const candidateRows = candidates == null
    ? null
    : new Map(validatedCandidates(candidates, documentId).map((candidate) => [candidate.candidateId, candidate.rowIndex]));

  return Object.freeze({
    resolve({ candidateId: inputCandidateId, cropId: inputCropId } = {}) {
      const candidateId = safeOpaqueId(inputCandidateId, "candidateId");
      const parsedCrop = parseCropId(inputCropId);
      const candidateRow = candidateRows?.get(candidateId) ?? canonicalCandidateRow(documentId, candidateId);
      if (!candidateRow) fail("REVIEW_CANDIDATE_BINDING_UNKNOWN", "candidateId no tiene un enlace de fila verificable");
      if (candidateRow !== parsedCrop.rowIndex) fail("REVIEW_CANDIDATE_CROP_MISMATCH", "candidateId y cropId pertenecen a filas distintas");
      const crop = cropMap.get(parsedCrop.cropId);
      if (!crop) fail("REVIEW_EVIDENCE_NOT_FOUND", "No existe evidencia para cropId");
      return Object.freeze({
        cropId: crop.cropId,
        mimeType: "image/png",
        visual: Object.freeze({ sha256: crop.visual.sha256, bytes: Buffer.from(crop.visualBytes) }),
        processed: Object.freeze({ sha256: crop.processed.sha256, bytes: Buffer.from(crop.processedBytes) })
      });
    }
  });
}
