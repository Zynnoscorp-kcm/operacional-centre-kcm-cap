import test from "node:test";
import assert from "node:assert/strict";

import jpeg from "jpeg-js";

import { decodeRaster, encodeRasterPng } from "../../src/ocr/image/raster-codec.js";
import { measureNormalizationAlignment } from "../../src/ocr/metrics/normalization-metrics.js";
import { normalizeRasterPixels } from "../../src/ocr/preprocessing/pixel-normalizer.js";
import { createDistortedAttendanceFixture } from "../../src/ocr/testing/distorted-fixture.js";

function createRaster(width, height, value = 20) {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects = ((a.y > y) !== (b.y > y))
      && (x < (((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9)) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function createPerspectiveSheet(width = 160, height = 240) {
  const quadrilateral = [
    { x: 20, y: 10 },
    { x: 140, y: 18 },
    { x: 150, y: 225 },
    { x: 10, y: 230 }
  ];
  const raster = createRaster(width, height, 18);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!pointInPolygon(x, y, quadrilateral)) continue;
      const gridLine = y % 12 <= 1 || x % 28 <= 1;
      const offset = ((y * width) + x) * 4;
      raster.data[offset] = gridLine ? 45 : 224;
      raster.data[offset + 1] = gridLine ? 52 : 218;
      raster.data[offset + 2] = gridLine ? 60 : 210;
    }
  }
  return { raster, quadrilateral };
}

test("codifica y decodifica PNG raster RGBA", () => {
  const { raster } = createPerspectiveSheet(80, 120);
  const encoded = encodeRasterPng(raster);
  const decoded = decodeRaster(encoded, { declaredMimeType: "image/png" });

  assert.equal(decoded.width, 80);
  assert.equal(decoded.height, 120);
  assert.equal(decoded.data.length, 80 * 120 * 4);
  assert.deepEqual([...decoded.data.subarray(0, 4)], [...raster.data.subarray(0, 4)]);
});

test("rectifica cuadrilatero a 1216x2002 y produce PNG grayscale", () => {
  const { raster, quadrilateral } = createPerspectiveSheet();
  const result = normalizeRasterPixels(encodeRasterPng(raster), {
    declaredMimeType: "image/png",
    quadrilateral
  });

  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.pixelTransformApplied, true);
  assert.equal(result.width, 1216);
  assert.equal(result.height, 2002);
  assert.equal(result.data.length, 1216 * 2002 * 4);
  assert.deepEqual([...result.pngBytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(result.homography.forward.length, 9);
  assert.equal(result.homography.inverse.length, 9);
  assert.equal(result.diagnostics.quadrilateralSource, "PROVIDED_QUADRILATERAL");
  assert.equal(result.diagnostics.stage, "COMPLETE");
  for (let offset = 0; offset < result.data.length; offset += Math.floor(result.data.length / 97 / 4) * 4) {
    assert.equal(result.data[offset], result.data[offset + 1]);
    assert.equal(result.data[offset + 1], result.data[offset + 2]);
    assert.equal(result.data[offset + 3], 255);
  }
});

test("detecta automaticamente una hoja y acepta entrada JPEG", () => {
  const { raster } = createPerspectiveSheet();
  const encoded = jpeg.encode({ width: raster.width, height: raster.height, data: raster.data }, 92).data;
  const result = normalizeRasterPixels(encoded, {
    declaredMimeType: "image/jpeg",
    targetWidth: 304,
    targetHeight: 501,
    allowFullFrameFallback: false
  });

  assert.equal(result.ok, true, `${result.error?.code}: ${result.error?.message}`);
  assert.equal(result.diagnostics.inputMimeType, "image/jpeg");
  assert.equal(result.diagnostics.quadrilateralSource, "LUMINANCE_BOUNDARY_LINES");
  assert.ok(result.diagnostics.pageDetectionConfidence > 0.7);
  assert.equal(result.width, 304);
  assert.equal(result.height, 501);
});

test("auto detector alinea las 200 casillas del fixture distorsionado", () => {
  const fixture = createDistortedAttendanceFixture({
    seed: "pixel-normalizer-auto-gate-v1",
    outputWidth: 640,
    outputHeight: 1050,
    rotationDegrees: 3.25,
    perspective: 0.035,
    illuminationGradient: 0.2,
    noiseAmplitude: 1.5
  });
  const result = normalizeRasterPixels(fixture.png, {
    declaredMimeType: fixture.mimeType,
    allowFullFrameFallback: false
  });

  assert.equal(result.ok, true, `${result.error?.code}: ${result.error?.message}`);
  assert.equal(result.diagnostics.quadrilateralSource, "LUMINANCE_BOUNDARY_LINES");
  const metrics = measureNormalizationAlignment({
    expectedHomography: fixture.groundTruth.templateToPhotoHomography,
    estimatedHomography: result.homography.inverse
  });
  assert.equal(metrics.boxesMeasured, 200);
  assert.ok(metrics.meanCenterErrorPx <= 4, `error medio ${metrics.meanCenterErrorPx}`);
  assert.ok(metrics.meanBoundingBoxIou >= 0.75, `IoU medio ${metrics.meanBoundingBoxIou}`);
  assert.equal(metrics.passed, true);
});

test("corrige automaticamente orientacion horizontal antes de rectificar", () => {
  const raster = createRaster(220, 140, 230);
  for (let y = 0; y < raster.height; y += 10) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = ((y * raster.width) + x) * 4;
      raster.data[offset] = 20;
      raster.data[offset + 1] = 20;
      raster.data[offset + 2] = 20;
    }
  }
  const result = normalizeRasterPixels(encodeRasterPng(raster), {
    targetWidth: 120,
    targetHeight: 200
  });

  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.diagnostics.rotationDegrees, 90);
  assert.deepEqual(result.diagnostics.orientedDimensions, { width: 140, height: 220 });
});

test("devuelve un fallo recuperable y sanitizado ante imagen uniforme", () => {
  const uniform = createRaster(120, 200, 128);
  const result = normalizeRasterPixels(encodeRasterPng(uniform), {
    targetWidth: 120,
    targetHeight: 200
  });

  assert.equal(result.ok, false);
  assert.equal(result.pixelTransformApplied, false);
  assert.equal(result.recoverable, true);
  assert.equal(result.error.code, "LOW_CONTRAST_IMAGE");
  assert.equal(result.error.stage, "GRAYSCALE");
  assert.doesNotMatch(result.error.message, /\.png|empleado|nomina/i);
});

test("rechaza bytes no rasterizados mediante un fallo recuperable", () => {
  const result = normalizeRasterPixels(Buffer.from("contenido-no-raster", "utf8"));

  assert.equal(result.ok, false);
  assert.equal(result.recoverable, true);
  assert.equal(result.error.code, "RASTER_FORMAT_UNSUPPORTED");
  assert.equal(result.error.stage, "DECODE");
  assert.deepEqual(result.diagnostics.operations, []);
});
