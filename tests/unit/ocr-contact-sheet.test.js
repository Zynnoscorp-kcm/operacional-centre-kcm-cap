import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import { createCropContactSheet } from "../../src/ocr/review/contact-sheet.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";

test("crea hoja de contacto ordenada para revision de cinco casillas", () => {
  const imageBytes = createSyntheticAttendancePng();
  const segmentation = segmentTemplate({ width: 1216, height: 2002 });
  const extraction = extractDigitCrops({ imageBytes, segmentation });
  const contact = createCropContactSheet(extraction, { rowStart: 1, rowEnd: 3 });
  const decoded = PNG.sync.read(contact.pngBytes);

  assert.equal(contact.layout.length, 15);
  assert.deepEqual(contact.layout.slice(0, 5).map(({ cropId }) => cropId), [
    "r01-d1", "r01-d2", "r01-d3", "r01-d4", "r01-d5"
  ]);
  assert.equal(contact.rows, 3);
  assert.equal(contact.columns, 5);
  assert.ok(contact.layout.every((cell) => cell.visual.width > 0 && cell.processed.width > 0));
  assert.deepEqual([decoded.width, decoded.height], [contact.width, contact.height]);
});
