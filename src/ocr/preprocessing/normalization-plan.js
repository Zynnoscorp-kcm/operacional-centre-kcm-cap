import { TEMPLATE_GEOMETRY } from "../config/template-geometry.js";

export function createNormalizationPlan(fileInspection, {
  targetWidth = TEMPLATE_GEOMETRY.source.width,
  targetHeight = TEMPLATE_GEOMETRY.source.height
} = {}) {
  if (!fileInspection?.valid) throw new TypeError("Se requiere una inspeccion de archivo valida");
  const source = fileInspection.dimensions;
  const rotationDegrees = source && source.width > source.height ? 90 : 0;

  return Object.freeze({
    mode: "GEOMETRY_ONLY_SIMULATION",
    sourceDimensions: source,
    targetDimensions: Object.freeze({ width: targetWidth, height: targetHeight }),
    rotationDegrees,
    operations: Object.freeze([
      "DECODE_OR_RASTERIZE",
      "NORMALIZE_EXIF_ORIENTATION",
      "DETECT_PAGE_QUADRILATERAL",
      "APPLY_PERSPECTIVE_HOMOGRAPHY",
      "NORMALIZE_GRAYSCALE_CONTRAST",
      "ALIGN_TO_TEMPLATE"
    ]),
    pixelTransformApplied: false,
    requiresPixelAdapterForProduction: true
  });
}

