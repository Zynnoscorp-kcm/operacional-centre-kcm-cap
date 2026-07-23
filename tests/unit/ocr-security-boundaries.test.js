import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import { SimulatedOcrProvider } from "../../src/ocr/adapters/simulated-provider.js";
import { normalizeRasterPixels } from "../../src/ocr/preprocessing/pixel-normalizer.js";
import { inspectInputFile } from "../../src/ocr/preprocessing/file-validation.js";
import { runRasterOcrPipeline } from "../../src/ocr/raster-pipeline.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";
import { createOcrCandidates } from "../../src/ocr/validation/candidate-validator.js";

function recognition(rowIndex, rawDigits = "01234", confidence = 0) {
  return {
    rowIndex,
    detected: true,
    rawDigits,
    digitConfidences: Array(5).fill(confidence),
    overallConfidence: confidence
  };
}

test("umbrales vacios usan defaults y NaN se rechaza sin fail-open", () => {
  const [candidate] = createOcrCandidates([recognition(1)], {
    documentId: "document-thresholds",
    employeeRoster: new Set(["01234"]),
    thresholds: {}
  });
  assert.equal(candidate.decision, "REVISION_REQUERIDA");
  assert.ok(candidate.validationFlags.includes("LOW_DIGIT_CONFIDENCE"));
  assert.throws(
    () => createOcrCandidates([recognition(1, "01234", 1)], {
      documentId: "document-thresholds-nan",
      employeeRoster: new Set(["01234"]),
      thresholds: { autoAcceptOverall: Number.NaN, autoAcceptPerDigit: Number.NaN }
    }),
    /numero finito/
  );
});

test("rechaza indices OCR duplicados, fraccionarios o fuera de las 40 filas", () => {
  const options = { documentId: "document-rows", employeeRoster: new Set(["01234", "05678"]) };
  assert.throws(() => createOcrCandidates([recognition(1), recognition(1, "05678")], options), /rowIndex duplicado/);
  assert.throws(() => createOcrCandidates([recognition(1.5)], options), /rowIndex debe ser un entero/);
  assert.throws(() => createOcrCandidates([recognition(41)], options), /rowIndex debe ser un entero/);
});

test("pipeline raster exige proveedor explicito y permiso para simulacion", () => {
  const input = {
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: "session-provider",
    documentId: "document-provider",
    evidenceId: "evidence-provider",
    actor: "tester@example.invalid",
    employeeRoster: new Set(["01234"])
  };
  assert.throws(() => runRasterOcrPipeline(input), /proveedor OCR explicito/);
  assert.throws(
    () => runRasterOcrPipeline({ ...input, provider: new SimulatedOcrProvider() }),
    /allowSimulatedProvider=true/
  );
});

test("fallback geometrico fuerza revision aun con lectura simulada de alta confianza", () => {
  const result = runRasterOcrPipeline({
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: "session-fallback",
    documentId: "document-fallback",
    evidenceId: "evidence-fallback",
    actor: "tester@example.invalid",
    employeeRoster: new Set(["01234"]),
    provider: new SimulatedOcrProvider(),
    allowSimulatedProvider: true,
    recognitionHints: [
      { rowIndex: 1, expectedDigits: "01234", digitConfidences: [0.999, 0.999, 0.999, 0.999, 0.999] }
    ]
  });
  assert.equal(result.normalization.diagnostics.quadrilateralSource, "FULL_FRAME_FALLBACK");
  assert.equal(result.candidates[0].decision, "REVISION_REQUERIDA");
  assert.ok(result.candidates[0].validationFlags.includes("PAGE_ALIGNMENT_REVIEW_REQUIRED"));
  assert.equal(result.document.status, "REVISION_OCR");
});

test("PNG transparente no puede aportar contenido RGB oculto", () => {
  const image = new PNG({ width: 120, height: 200 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const value = (offset / 4) % 2 === 0 ? 0 : 255;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 0;
  }
  const result = normalizeRasterPixels(PNG.sync.write(image), {
    targetWidth: 120,
    targetHeight: 200,
    quadrilateral: [
      { x: 0, y: 0 }, { x: 119, y: 0 }, { x: 119, y: 199 }, { x: 0, y: 199 }
    ]
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LOW_CONTRAST_IMAGE");
});

test("bytes normalizados se entregan como copias defensivas del hash", () => {
  const result = runRasterOcrPipeline({
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: "session-copy",
    documentId: "document-copy",
    evidenceId: "evidence-copy",
    actor: "tester@example.invalid",
    employeeRoster: new Set(),
    provider: new SimulatedOcrProvider(),
    allowSimulatedProvider: true,
    includeNormalizedImageBytes: true,
    normalizationOptions: { targetWidth: 50_000, targetHeight: 50_000 }
  });
  assert.deepEqual([result.normalizedImage.width, result.normalizedImage.height], [1216, 2002]);
  const first = result.normalizedImage.bytes;
  first[0] ^= 0xff;
  const second = result.normalizedImage.bytes;
  assert.notEqual(first[0], second[0]);
  assert.equal(createHash("sha256").update(second).digest("hex"), result.normalizedImage.sha256);
});

test("limita resolucion declarada antes de decodificar PNG", () => {
  const oversizedHeader = Buffer.from(createSyntheticAttendancePng());
  oversizedHeader.writeUInt32BE(20_000, 16);
  oversizedHeader.writeUInt32BE(20_000, 20);
  const inspection = inspectInputFile(oversizedHeader, { declaredMimeType: "image/png" });
  assert.equal(inspection.valid, false);
  assert.ok(inspection.errors.includes("IMAGE_RESOLUTION_TOO_HIGH"));
});

test("trazo junto al borde requiere revision y polvo minimo permanece blanco", () => {
  const image = new PNG({ width: 1216, height: 2002 });
  image.data.fill(255);
  const segmentation = segmentTemplate({ width: image.width, height: image.height });
  const first = segmentation.digitCrops[0].recognitionRect;
  for (let y = first.y + 3; y < first.y + 24; y += 1) {
    for (let x = first.x; x < first.x + 2; x += 1) {
      const offset = ((y * image.width) + x) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 255;
    }
  }
  const second = segmentation.digitCrops[1].recognitionRect;
  for (let pixel = 0; pixel < 3; pixel += 1) {
    const offset = (((second.y + 8 + pixel) * image.width) + second.x + 8) * 4;
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
    image.data[offset + 3] = 255;
  }
  const extraction = extractDigitCrops({ imageBytes: PNG.sync.write(image), segmentation });
  assert.equal(extraction.crops[0].isBlank, false);
  assert.ok(extraction.crops[0].edgeInkRatio >= 0.06);
  assert.equal(extraction.crops[1].isBlank, true);
});
