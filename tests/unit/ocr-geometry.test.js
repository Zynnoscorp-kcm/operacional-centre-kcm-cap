import test from "node:test";
import assert from "node:assert/strict";

import { buildTemplateMap, TEMPLATE_GEOMETRY } from "../../src/ocr/config/template-geometry.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";

test("el mapa geometrico contiene 40 filas y 200 recortes de digito", () => {
  const segmentation = segmentTemplate(TEMPLATE_GEOMETRY.source);
  assert.equal(segmentation.rowsDetected, 40);
  assert.equal(segmentation.digitCrops.length, 200);
  assert.deepEqual(segmentation.templateMap.rows[0].digitBoxes.map((box) => box.visualRect), [
    { x: 140, y: 270, width: 26, height: 31 },
    { x: 167, y: 270, width: 25, height: 31 },
    { x: 193, y: 270, width: 26, height: 31 },
    { x: 220, y: 270, width: 25, height: 31 },
    { x: 246, y: 270, width: 26, height: 31 }
  ]);
  assert.deepEqual(segmentation.templateMap.rows[0].digitBoxes[0].visualRectNormalized, {
    x: 0.11513158,
    y: 0.13486513,
    width: 0.02138158,
    height: 0.01548452
  });
  assert.equal(segmentation.templateMap.rows[39].rowRect.y + segmentation.templateMap.rows[39].rowRect.height, 1933);
});

test("el mapa escala coordenadas sin perder las cinco casillas", () => {
  const map = buildTemplateMap({ width: 2432, height: 4004 });
  assert.equal(map.rows.length, 40);
  assert.equal(map.rows[0].digitBoxes.length, 5);
  assert.deepEqual(map.rows[0].digitBoxes[0].visualRect, { x: 280, y: 540, width: 52, height: 62 });
  assert.ok(map.rows.every((row) => row.digitBoxes.every((box) => box.recognitionRect.width > 0 && box.recognitionRect.height > 0)));
});
