import { RasterProcessingError } from "../image/errors.js";
import { calculateHomography, invertHomography, rectifyRaster } from "../image/homography.js";
import { detectPageQuadrilateral, orderAndValidateQuadrilateral } from "../image/page-detector.js";
import { decodeRaster, encodeRasterPng } from "../image/raster-codec.js";
import {
  grayscaleStatistics,
  rotateRaster,
  stretchGrayscaleContrast,
  toGrayscaleRgba,
  transformExifOrientation
} from "../image/raster-ops.js";

const DEFAULT_TARGET = Object.freeze({ width: 1216, height: 2002 });
const MAX_TARGET_PIXELS = 10_000_000;

function errorResult(error, diagnostics) {
  const normalized = error instanceof RasterProcessingError
    ? error
    : new RasterProcessingError("PIXEL_NORMALIZATION_FAILED", "Fallo inesperado durante la normalizacion raster", {
      stage: diagnostics.stage ?? "UNKNOWN",
      cause: error
    });
  return Object.freeze({
    ok: false,
    pixelTransformApplied: false,
    recoverable: normalized.recoverable !== false,
    error: Object.freeze({
      code: normalized.code,
      stage: normalized.stage,
      message: normalized.message,
      diagnostics: normalized.diagnostics ?? null
    }),
    diagnostics: Object.freeze({
      ...diagnostics,
      operations: Object.freeze([...(diagnostics.operations ?? [])]),
      warnings: Object.freeze([...(diagnostics.warnings ?? [])]),
      failedAt: normalized.stage
    })
  });
}

export function normalizeRasterPixels(bytes, {
  declaredMimeType = null,
  targetWidth = DEFAULT_TARGET.width,
  targetHeight = DEFAULT_TARGET.height,
  quadrilateral = null,
  rotationDegrees = null,
  autoRotateLandscape = true,
  allowFullFrameFallback = true,
  contrast = null
} = {}) {
  const diagnostics = {
    stage: "DECODE",
    operations: [],
    warnings: []
  };

  try {
    if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth < 2 || targetHeight < 2) {
      throw new RasterProcessingError("TARGET_DIMENSIONS_INVALID", "Las dimensiones objetivo son invalidas", {
        stage: "DECODE",
        recoverable: false
      });
    }
    if ((targetWidth * targetHeight) > MAX_TARGET_PIXELS) {
      throw new RasterProcessingError("TARGET_IMAGE_TOO_LARGE", "La imagen normalizada excede el limite de pixeles", {
        stage: "DECODE",
        recoverable: false,
        diagnostics: { maxTargetPixels: MAX_TARGET_PIXELS }
      });
    }
    const decoded = decodeRaster(bytes, { declaredMimeType });
    diagnostics.inputMimeType = decoded.mimeType;
    diagnostics.sourceDimensions = Object.freeze({ width: decoded.width, height: decoded.height });
    diagnostics.exifOrientation = decoded.exifOrientation;
    diagnostics.operations.push("DECODE_RASTER");

    diagnostics.stage = "ORIENTATION";
    let oriented = transformExifOrientation(decoded, decoded.exifOrientation);
    diagnostics.operations.push("NORMALIZE_EXIF_ORIENTATION");
    const appliedRotation = rotationDegrees == null
      ? (autoRotateLandscape && oriented.width > oriented.height ? 90 : 0)
      : Number(rotationDegrees);
    if (appliedRotation !== 0) oriented = rotateRaster(oriented, appliedRotation);
    diagnostics.rotationDegrees = appliedRotation;
    diagnostics.orientedDimensions = Object.freeze({ width: oriented.width, height: oriented.height });
    diagnostics.operations.push("NORMALIZE_PAGE_ORIENTATION");

    diagnostics.stage = "GRAYSCALE";
    const grayscale = toGrayscaleRgba(oriented);
    const inputStatistics = grayscaleStatistics(grayscale);
    if (inputStatistics.dynamicRange < 8 || inputStatistics.standardDeviation < 2) {
      throw new RasterProcessingError("LOW_CONTRAST_IMAGE", "La imagen no contiene informacion visual suficiente", {
        stage: "GRAYSCALE",
        diagnostics: {
          dynamicRange: inputStatistics.dynamicRange,
          standardDeviation: inputStatistics.standardDeviation
        }
      });
    }
    diagnostics.inputGrayscale = Object.freeze({
      dynamicRange: inputStatistics.dynamicRange,
      mean: inputStatistics.mean,
      standardDeviation: inputStatistics.standardDeviation
    });
    diagnostics.operations.push("CONVERT_TO_GRAYSCALE_RGBA");

    diagnostics.stage = "PAGE_DETECTION";
    let page;
    if (quadrilateral) {
      const validated = orderAndValidateQuadrilateral(quadrilateral, {
        width: grayscale.width,
        height: grayscale.height
      });
      page = {
        quadrilateral: validated.points,
        method: "PROVIDED_QUADRILATERAL",
        confidence: 1,
        diagnostics: { areaRatio: validated.areaRatio },
        warnings: []
      };
    } else {
      page = detectPageQuadrilateral(grayscale, { allowFullFrameFallback });
    }
    diagnostics.quadrilateralSource = page.method;
    diagnostics.pageDetectionConfidence = page.confidence;
    diagnostics.pageDetection = Object.freeze({ ...page.diagnostics });
    diagnostics.warnings.push(...page.warnings);
    diagnostics.operations.push("LOCATE_PAGE_QUADRILATERAL");

    diagnostics.stage = "HOMOGRAPHY";
    const destination = [
      { x: 0, y: 0 },
      { x: targetWidth - 1, y: 0 },
      { x: targetWidth - 1, y: targetHeight - 1 },
      { x: 0, y: targetHeight - 1 }
    ];
    const forwardHomography = calculateHomography(page.quadrilateral, destination);
    const inverseHomography = invertHomography(forwardHomography);
    diagnostics.operations.push("CALCULATE_INVERSE_HOMOGRAPHY");

    diagnostics.stage = "RECTIFICATION";
    const rectified = rectifyRaster(grayscale, inverseHomography, {
      width: targetWidth,
      height: targetHeight
    });
    diagnostics.operations.push("RECTIFY_TO_TEMPLATE");

    diagnostics.stage = "CONTRAST";
    const contrasted = stretchGrayscaleContrast(rectified, contrast ?? {});
    diagnostics.contrast = contrasted.diagnostics;
    diagnostics.operations.push("NORMALIZE_CONTRAST");

    diagnostics.stage = "ENCODE";
    const pngBytes = encodeRasterPng(contrasted.raster);
    diagnostics.operations.push("ENCODE_GRAYSCALE_PNG");
    diagnostics.stage = "COMPLETE";

    const stableData = Buffer.from(contrasted.raster.data);
    const stablePngBytes = Buffer.from(pngBytes);
    const result = {
      ok: true,
      pixelTransformApplied: true,
      recoverable: false,
      mimeType: "image/png",
      width: targetWidth,
      height: targetHeight,
      quadrilateral: Object.freeze(page.quadrilateral),
      homography: Object.freeze({
        forward: forwardHomography,
        inverse: inverseHomography
      }),
      diagnostics: Object.freeze({
        ...diagnostics,
        operations: Object.freeze([...diagnostics.operations]),
        warnings: Object.freeze([...diagnostics.warnings]),
        targetDimensions: Object.freeze({ width: targetWidth, height: targetHeight })
      })
    };
    Object.defineProperties(result, {
      data: { enumerable: true, get: () => Buffer.from(stableData) },
      pngBytes: { enumerable: true, get: () => Buffer.from(stablePngBytes) }
    });
    return Object.freeze(result);
  } catch (error) {
    return errorResult(error, diagnostics);
  }
}

export function normalizeRasterPixelsOrThrow(bytes, options = {}) {
  const result = normalizeRasterPixels(bytes, options);
  if (!result.ok) {
    throw new RasterProcessingError(result.error.code, result.error.message, {
      stage: result.error.stage,
      recoverable: result.recoverable,
      diagnostics: result.error.diagnostics
    });
  }
  return result;
}
