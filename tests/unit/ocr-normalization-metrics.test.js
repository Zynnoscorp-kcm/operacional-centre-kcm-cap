import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

import {
  measureNormalizationAlignment,
  multiplyHomographies,
  translationHomography
} from "../../src/ocr/metrics/normalization-metrics.js";
import {
  applyHomography,
  createDistortedAttendanceFixture
} from "../../src/ocr/testing/distorted-fixture.js";

const templatePng = await readFile(new URL(
  "../../referencias/formato/Formato_Control_Asistencia_OCR.png",
  import.meta.url
));

function fixture(seed = "normalization-test-v1") {
  return createDistortedAttendanceFixture({
    templatePng,
    seed,
    outputWidth: 640,
    outputHeight: 1050,
    rotationDegrees: 3.25,
    perspective: 0.035,
    illuminationGradient: 0.2,
    noiseAmplitude: 1.5
  });
}

test("genera una foto sintetica deformada, anonima y reproducible", () => {
  const first = fixture();
  const second = fixture();
  assert.equal(first.privacy, "SYNTHETIC_ANONYMIZED_NO_REAL_PERSONAL_DATA");
  assert.deepEqual(first.png, second.png);
  assert.deepEqual(first.groundTruth.templateToPhotoHomography, second.groundTruth.templateToPhotoHomography);
  assert.equal(first.syntheticRows.length, 40);
  assert.equal(first.syntheticRows.every(({ digits }) => /^\d{5}$/.test(digits)), true);
  assert.equal(first.groundTruth.digitBoxes.length, 200);
  assert.notEqual(first.groundTruth.photoCorners[0].y, first.groundTruth.photoCorners[1].y);
  assert.notDeepEqual(first.png, fixture("normalization-test-v2").png);
  const decoded = PNG.sync.read(first.png);
  assert.deepEqual({ width: decoded.width, height: decoded.height }, first.dimensions);
});

test("la homografia verdadera conserva correspondencias de las cuatro esquinas", () => {
  const generated = fixture("corner-correspondence-v1");
  const { sourceCorners, photoCorners, templateToPhotoHomography } = generated.groundTruth;
  for (let index = 0; index < 4; index += 1) {
    const projected = applyHomography(templateToPhotoHomography, sourceCorners[index]);
    assert.ok(Math.abs(projected.x - photoCorners[index].x) < 1e-7);
    assert.ok(Math.abs(projected.y - photoCorners[index].y) < 1e-7);
  }
});

test("mide alineacion exacta sobre las 200 casillas", () => {
  const generated = fixture("exact-alignment-v1");
  const homography = generated.groundTruth.templateToPhotoHomography;
  const metrics = measureNormalizationAlignment({
    expectedHomography: homography,
    estimatedHomography: homography
  });
  assert.equal(metrics.boxesMeasured, 200);
  assert.equal(metrics.cornersMeasured, 800);
  assert.equal(metrics.meanCenterErrorPx, 0);
  assert.equal(metrics.meanBoundingBoxIou, 1);
  assert.equal(metrics.passed, true);
});

test("detecta una estimacion desplazada mediante error de centros e IoU", () => {
  const generated = fixture("misalignment-v1");
  const expected = generated.groundTruth.templateToPhotoHomography;
  const displaced = multiplyHomographies(translationHomography(9, -6), expected);
  const metrics = measureNormalizationAlignment({
    expectedHomography: expected,
    estimatedHomography: displaced
  });
  assert.equal(metrics.boxesMeasured, 200);
  assert.ok(Math.abs(metrics.meanCenterErrorPx - Math.hypot(9, 6)) < 1e-8);
  assert.ok(metrics.meanBoundingBoxIou < 0.5);
  assert.equal(metrics.passed, false);
});
