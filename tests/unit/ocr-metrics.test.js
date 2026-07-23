import test from "node:test";
import assert from "node:assert/strict";

import { measureOcrRun, aggregateOcrMetrics } from "../../src/ocr/metrics.js";
import { createOcrCandidates } from "../../src/ocr/validation/candidate-validator.js";

test("calcula exactitud, revision, aceptacion falsa y deteccion de filas", () => {
  const recognitions = [
    { rowIndex: 1, detected: true, rawDigits: "00001", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99], overallConfidence: 0.99 },
    { rowIndex: 2, detected: true, rawDigits: "22282", digitConfidences: [0.99, 0.99, 0.97, 0.99, 0.99], overallConfidence: 0.97 }
  ];
  const candidates = createOcrCandidates(recognitions, {
    documentId: "metrics-doc",
    employeeRoster: new Set(["00001", "22222"])
  });
  const metrics = measureOcrRun({
    expectedRows: [
      { rowIndex: 1, expectedDigits: "00001", expectedDetected: true },
      { rowIndex: 2, expectedDigits: "22222", expectedDetected: true }
    ],
    recognitions,
    candidates,
    elapsedMs: 12
  });

  assert.equal(metrics.fullNumberAccuracyPercent, 50);
  assert.equal(metrics.digitAccuracyPercent, 90);
  assert.equal(metrics.falseAcceptanceRatePercent, 0);
  assert.equal(metrics.manualReviewRatePercent, 50);
  assert.equal(metrics.correctlyDetectedRowsPercent, 100);
  assert.equal(aggregateOcrMetrics([metrics, metrics]).averageProcessingTimeMs, 12);
});

test("compara cada digito con su casilla aunque rawDigits omita una posicion", () => {
  const recognition = {
    rowIndex: 1,
    detected: true,
    rawDigits: "1245",
    digits: ["1", "2", "", "4", "5"].map((digit, digitIndex) => ({ digit, digitIndex })),
    digitConfidences: [0.9, 0.9, 0, 0.9, 0.9],
    overallConfidence: 0
  };
  const [candidate] = createOcrCandidates([recognition], {
    documentId: "metrics-slot-doc",
    employeeRoster: new Set(["12345"])
  });
  const metrics = measureOcrRun({
    expectedRows: [{ rowIndex: 1, expectedDigits: "12345", expectedDetected: true }],
    recognitions: [recognition],
    candidates: [candidate]
  });

  assert.equal(metrics.fullNumberAccuracyPercent, 0);
  assert.equal(metrics.counts.correctDigits, 4);
  assert.equal(metrics.digitAccuracyPercent, 80);
  assert.equal(metrics.digitMetricMeaning, "DIGIT_COMPARED_IN_ORIGINAL_BOX_SLOT_WITH_RAW_FALLBACK");
});
