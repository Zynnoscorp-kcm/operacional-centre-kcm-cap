import test from "node:test";
import assert from "node:assert/strict";

import { SimulatedOcrProvider } from "../../src/ocr/adapters/simulated-provider.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { createReviewBundle, createReviewEvidenceResolver } from "../../src/ocr/review/review-bundle.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";
import { createOcrCandidates } from "../../src/ocr/validation/candidate-validator.js";

test("integra segmentacion 40x5, candidatos y evidencia sin filtrar binarios", () => {
  const documentId = "document-review-integration";
  const imageBytes = createSyntheticAttendancePng();
  const segmentation = segmentTemplate({ width: 1216, height: 2002 });
  const extraction = extractDigitCrops({ imageBytes, segmentation, options: { scale: 1, rawScale: 1, padding: 4 } });
  const recognition = new SimulatedOcrProvider().recognize({
    segmentation,
    hints: [{ rowIndex: 1, expectedDigits: "01234", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99] }]
  });
  const candidates = createOcrCandidates(recognition.rows, {
    documentId,
    employeeRoster: new Set(["01234"])
  });
  const bundle = createReviewBundle({ documentId, candidates, extraction });

  assert.equal(extraction.crops.length, 200);
  assert.equal(bundle.rows.length, 40);
  assert.equal(bundle.counts.slots, 200);
  assert.equal(bundle.rows.every((row) => row.slots.length === 5), true);
  assert.equal(bundle.rows[0].rawDigits, "01234");
  assert.equal(bundle.rows[39].slots[4].cropId, "r40-d5");
  assert.equal(JSON.stringify(bundle).includes("pngBytes"), false);

  const resolver = createReviewEvidenceResolver({ documentId, extraction, candidates });
  const evidence = resolver.resolve({ candidateId: candidates[0].candidateId, cropId: "r01-d1" });
  assert.equal(evidence.cropId, "r01-d1");
  assert.equal(evidence.visual.bytes.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(evidence.processed.bytes.subarray(1, 4).toString("ascii"), "PNG");
});

