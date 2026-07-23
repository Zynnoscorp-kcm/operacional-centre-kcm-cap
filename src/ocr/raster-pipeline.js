import { createHash } from "node:crypto";

import { CONTRACT_VERSION } from "../shared/contracts.js";
import { SimulatedOcrProvider } from "./adapters/simulated-provider.js";
import { TEMPLATE_GEOMETRY } from "./config/template-geometry.js";
import { validateInputFile } from "./preprocessing/file-validation.js";
import { normalizeRasterPixelsOrThrow } from "./preprocessing/pixel-normalizer.js";
import { rasterizeSinglePagePdf } from "./preprocessing/pdf-rasterizer.js";
import { segmentTemplate } from "./segmentation/template-segmenter.js";
import { createOcrCandidates } from "./validation/candidate-validator.js";

function requiredTextFields(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} es obligatorio`);
  }
}

function summarizeNormalization(result) {
  return Object.freeze({
    mode: "PIXEL_HOMOGRAPHY_V1",
    pixelTransformApplied: true,
    width: result.width,
    height: result.height,
    quadrilateral: result.quadrilateral,
    homography: result.homography,
    diagnostics: result.diagnostics
  });
}

function normalizationReviewFlags(normalized) {
  const diagnostics = normalized.diagnostics;
  const warnings = diagnostics.warnings ?? [];
  const uncertain = diagnostics.quadrilateralSource === "FULL_FRAME_FALLBACK"
    || diagnostics.pageDetectionConfidence < 0.8
    || warnings.length > 0;
  return uncertain ? Object.freeze(["PAGE_ALIGNMENT_REVIEW_REQUIRED"]) : Object.freeze([]);
}

function normalizedImageDto(normalized, pngBytes, sha256, includeBytes) {
  const dto = {
    mimeType: normalized.mimeType,
    width: normalized.width,
    height: normalized.height,
    sha256,
    bytesIncluded: includeBytes === true
  };
  if (includeBytes === true) {
    const stableBytes = Buffer.from(pngBytes);
    Object.defineProperty(dto, "bytes", {
      enumerable: true,
      get: () => Buffer.from(stableBytes)
    });
  }
  return Object.freeze(dto);
}

/**
 * Vertical OCR local real: valida el binario, rasteriza PDF cuando aplica,
 * rectifica pixeles a la plantilla y entrega recortes al proveedor elegido.
 * El proveedor simulado sigue disponible para separar pruebas geometricas de
 * pruebas de reconocimiento; TesseractDigitsProvider consume los mismos datos.
 */
function prepareRasterOcrPipeline({
  bytes,
  declaredMimeType,
  sessionId,
  documentId,
  evidenceId,
  actor,
  provider,
  allowSimulatedProvider = false,
  includeNormalizedImageBytes = false,
  recognitionHints = [],
  employeeRoster,
  createdAt = new Date().toISOString(),
  fileLimits,
  thresholds,
  normalizationOptions,
  pdfRasterizationOptions
}) {
  requiredTextFields({ sessionId, documentId, evidenceId, actor });
  if (!provider || typeof provider.recognize !== "function") {
    throw new TypeError("runRasterOcrPipeline requiere un proveedor OCR explicito");
  }
  if (provider instanceof SimulatedOcrProvider && allowSimulatedProvider !== true) {
    throw new TypeError("El proveedor simulado requiere allowSimulatedProvider=true");
  }

  const file = validateInputFile(bytes, { declaredMimeType, limits: fileLimits });
  const rasterization = file.detectedMimeType === "application/pdf"
    ? rasterizeSinglePagePdf(bytes, pdfRasterizationOptions)
    : Object.freeze({
      bytes: Buffer.from(bytes),
      width: file.dimensions.width,
      height: file.dimensions.height,
      mimeType: file.detectedMimeType,
      page: 1,
      adapter: "DIRECT_RASTER_V1",
      transparencyComposited: false,
      transparentPixelCount: 0
    });

  const normalized = normalizeRasterPixelsOrThrow(rasterization.bytes, {
    declaredMimeType: rasterization.mimeType,
    ...normalizationOptions,
    targetWidth: TEMPLATE_GEOMETRY.source.width,
    targetHeight: TEMPLATE_GEOMETRY.source.height
  });
  const normalizedPngBytes = normalized.pngBytes;
  const segmentation = segmentTemplate({ width: normalized.width, height: normalized.height });
  return {
    sessionId,
    documentId,
    evidenceId,
    actor,
    provider,
    includeNormalizedImageBytes,
    recognitionHints,
    employeeRoster,
    createdAt,
    thresholds,
    file,
    rasterization,
    normalized,
    normalizedPngBytes,
    segmentation
  };
}

function recognizeInput(prepared) {
  return Object.freeze({
    segmentation: prepared.segmentation,
    imageBytes: prepared.normalizedPngBytes,
    hints: prepared.recognitionHints
  });
}

function finalizeRasterOcrPipeline(prepared, recognition) {
  if (!recognition || !Array.isArray(recognition.rows)) {
    throw new TypeError("El proveedor OCR no devolvio un arreglo de renglones");
  }
  const {
    sessionId,
    documentId,
    evidenceId,
    actor,
    provider,
    includeNormalizedImageBytes,
    employeeRoster,
    createdAt,
    thresholds,
    file,
    rasterization,
    normalized,
    normalizedPngBytes,
    segmentation
  } = prepared;
  const candidates = createOcrCandidates(recognition.rows, {
    documentId,
    employeeRoster,
    thresholds,
    maxRows: TEMPLATE_GEOMETRY.participantRows.count,
    contextValidationFlags: normalizationReviewFlags(normalized)
  });
  const requiresReview = candidates.some((candidate) => candidate.decision === "REVISION_REQUERIDA");
  const normalizedSha256 = createHash("sha256").update(normalizedPngBytes).digest("hex");

  const document = Object.freeze({
    documentId,
    sessionId,
    evidenceId,
    sha256: file.sha256,
    mimeType: file.detectedMimeType,
    byteSize: file.byteSize,
    pageCount: file.pageCount,
    status: requiresReview ? "REVISION_OCR" : "PROCESADO",
    createdBy: actor,
    createdAt: new Date(createdAt).toISOString(),
    version: CONTRACT_VERSION
  });

  return Object.freeze({
    document,
    file,
    rasterization: Object.freeze({
      width: rasterization.width,
      height: rasterization.height,
      mimeType: rasterization.mimeType,
      page: rasterization.page,
      adapter: rasterization.adapter,
      transparencyComposited: rasterization.transparencyComposited,
      transparentPixelCount: rasterization.transparentPixelCount
    }),
    normalization: summarizeNormalization(normalized),
    normalizedImage: normalizedImageDto(normalized, normalizedPngBytes, normalizedSha256, includeNormalizedImageBytes),
    processing: Object.freeze({
      geometryVersion: segmentation.geometryVersion,
      provider: String(recognition.provider ?? provider.providerName ?? "UNKNOWN"),
      engine: recognition.engine ? Object.freeze({
        name: String(recognition.engine.name),
        version: String(recognition.engine.version)
      }) : null
    }),
    segmentation,
    recognition,
    candidates
  });
}

export function runRasterOcrPipeline(options) {
  if (options?.provider?.isAsync === true) {
    throw new TypeError("El proveedor OCR asincrono requiere runRasterOcrPipelineAsync");
  }
  const prepared = prepareRasterOcrPipeline(options);
  const recognition = prepared.provider.recognize(recognizeInput(prepared));
  if (recognition && typeof recognition.then === "function") {
    throw new TypeError("El proveedor OCR devolvio una promesa; use runRasterOcrPipelineAsync");
  }
  return finalizeRasterOcrPipeline(prepared, recognition);
}

/**
 * Variante enchufable para proveedores REST. Conserva exactamente la misma
 * normalizacion, validacion, candidatos y DTO de la funcion sincrona.
 */
export async function runRasterOcrPipelineAsync(options) {
  const prepared = prepareRasterOcrPipeline(options);
  const recognition = await prepared.provider.recognize(recognizeInput(prepared));
  return finalizeRasterOcrPipeline(prepared, recognition);
}
