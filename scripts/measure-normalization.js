import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  IDENTITY_HOMOGRAPHY,
  measureNormalizationAlignment
} from "../src/ocr/metrics/normalization-metrics.js";
import { normalizeRasterPixels } from "../src/ocr/preprocessing/pixel-normalizer.js";
import { createDistortedAttendanceFixture } from "../src/ocr/testing/distorted-fixture.js";

const templateUrl = new URL("../referencias/formato/Formato_Control_Asistencia_OCR.png", import.meta.url);
const templatePng = await readFile(templateUrl);
const scenarios = [
  { name: "moderate", seed: "normalization-moderate-v1", rotationDegrees: 2.5, perspective: 0.02, pageFill: 0.84 },
  { name: "strong-contained", seed: "normalization-strong-v1", rotationDegrees: -4.5, perspective: 0.045, pageFill: 0.82 },
  { name: "edge-extrapolation", seed: "normalization-strong-v1", rotationDegrees: -4.5, perspective: 0.045, pageFill: 0.84 }
];

const results = scenarios.map((scenario) => {
  const fixture = createDistortedAttendanceFixture({
    templatePng,
    seed: scenario.seed,
    outputWidth: 900,
    outputHeight: 1480,
    rotationDegrees: scenario.rotationDegrees,
    perspective: scenario.perspective,
    pageFill: scenario.pageFill
  });
  const startedAt = performance.now();
  const normalized = normalizeRasterPixels(fixture.png, {
    declaredMimeType: fixture.mimeType,
    allowFullFrameFallback: false
  });
  const processingTimeMs = performance.now() - startedAt;
  if (!normalized.ok) {
    return {
      scenario: scenario.name,
      privacy: fixture.privacy,
      seed: fixture.seed,
      pngBytes: fixture.png.length,
      sha256: createHash("sha256").update(fixture.png).digest("hex"),
      distortion: fixture.distortion,
      expectedOutcome: "NORMALIZED",
      passed: false,
      processingTimeMs,
      error: normalized.error
    };
  }
  const measured = measureNormalizationAlignment({
    expectedHomography: fixture.groundTruth.templateToPhotoHomography,
    estimatedHomography: normalized.homography.inverse
  });
  return {
    scenario: scenario.name,
    privacy: fixture.privacy,
    seed: fixture.seed,
    pngBytes: fixture.png.length,
    sha256: createHash("sha256").update(fixture.png).digest("hex"),
    distortion: fixture.distortion,
    expectedOutcome: "NORMALIZED",
    passed: measured.passed,
    boxes: fixture.groundTruth.digitBoxes.length,
    processingTimeMs,
    detector: {
      method: normalized.diagnostics.quadrilateralSource,
      confidence: normalized.diagnostics.pageDetectionConfidence,
      warnings: normalized.diagnostics.warnings
    },
    measured,
    oracleReference: measureNormalizationAlignment({
      expectedHomography: fixture.groundTruth.templateToPhotoHomography,
      estimatedHomography: fixture.groundTruth.templateToPhotoHomography
    }),
    withoutNormalizationBaseline: measureNormalizationAlignment({
      expectedHomography: fixture.groundTruth.templateToPhotoHomography,
      estimatedHomography: IDENTITY_HOMOGRAPHY
    })
  };
});

process.stdout.write(`${JSON.stringify({
  metricVersion: "normalization-alignment-v1",
  note: "Alineacion estimada automaticamente contra verdad geometrica de 200 casillas por escenario.",
  scenarios: results
}, null, 2)}\n`);
