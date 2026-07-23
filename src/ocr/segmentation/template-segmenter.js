import { buildTemplateMap } from "../config/template-geometry.js";

export function segmentTemplate({ width, height }) {
  const templateMap = buildTemplateMap({ width, height });
  const crops = templateMap.rows.flatMap((row) => row.digitBoxes.map((digitBox) => Object.freeze({
    cropId: `r${String(row.rowIndex).padStart(2, "0")}-d${digitBox.digitIndex + 1}`,
    rowIndex: row.rowIndex,
    digitIndex: digitBox.digitIndex,
    visualRect: digitBox.visualRect,
    visualRectNormalized: digitBox.visualRectNormalized,
    recognitionRect: digitBox.recognitionRect,
    recognitionRectNormalized: digitBox.recognitionRectNormalized
  })));

  return Object.freeze({
    geometryVersion: templateMap.version,
    templateMap,
    rowsDetected: templateMap.rows.length,
    digitCrops: Object.freeze(crops)
  });
}
