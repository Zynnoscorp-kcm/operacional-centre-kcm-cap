import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import {
  TESSERACT_PROVIDER_NAME,
  TesseractDigitsProvider,
  detectTesseract
} from "../../src/ocr/adapters/tesseract-provider.js";
import { TEMPLATE_GEOMETRY } from "../../src/ocr/config/template-geometry.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";

const FONT = Object.freeze({
  "0": ["0011100", "0110110", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "0110110", "0011100"],
  "1": ["0001100", "0011100", "0111100", "0001100", "0001100", "0001100", "0001100", "0001100", "0001100", "0001100", "0111110"],
  "2": ["0011100", "0110110", "1100011", "0000011", "0000110", "0001100", "0011000", "0110000", "1100000", "1100000", "1111111"],
  "3": ["0111100", "1100110", "0000011", "0000011", "0000110", "0011100", "0000110", "0000011", "0000011", "1100110", "0111100"],
  "4": ["0000110", "0001110", "0011110", "0110110", "1100110", "1100110", "1111111", "0000110", "0000110", "0000110", "0001111"]
});

function setPixel(image, x, y, value) {
  const offset = ((y * image.width) + x) * 4;
  image.data[offset] = value;
  image.data[offset + 1] = value;
  image.data[offset + 2] = value;
  image.data[offset + 3] = 255;
}

function drawSyntheticDigit(image, rect, digit) {
  const glyph = FONT[digit];
  const scale = 2;
  const glyphWidth = glyph[0].length * scale;
  const glyphHeight = glyph.length * scale;
  const startX = rect.x + Math.floor((rect.width - glyphWidth) / 2);
  const startY = rect.y + Math.floor((rect.height - glyphHeight) / 2);
  glyph.forEach((line, row) => [...line].forEach((pixel, column) => {
    if (pixel === "0") return;
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) setPixel(image, startX + (column * scale) + dx, startY + (row * scale) + dy, 0);
    }
  }));
}

function createDigitsFixture(value = "01234") {
  const image = new PNG({ width: TEMPLATE_GEOMETRY.source.width, height: TEMPLATE_GEOMETRY.source.height });
  image.data.fill(255);
  const segmentation = segmentTemplate({ width: image.width, height: image.height });
  const row = segmentation.templateMap.rows[0];
  [...value].forEach((digit, index) => drawSyntheticDigit(image, row.digitBoxes[index].recognitionRect, digit));
  return { bytes: PNG.sync.write(image), segmentation };
}

const detection = detectTesseract();
const tesseractSkip = detection.available ? false : "Tesseract no esta instalado en /opt/homebrew/bin ni en PATH";

test("detecta una version ejecutable de Tesseract sin usar shell", { skip: tesseractSkip }, () => {
  assert.equal(detection.available, true);
  assert.match(detection.version, /^\d+\.\d+/);
  assert.ok(detection.binaryPath === "/opt/homebrew/bin/tesseract" || detection.binaryPath === "tesseract");
});

test("extrae 200 recortes PNG umbralizados con hashes y blancos detectados", () => {
  const fixture = createDigitsFixture();
  const extraction = extractDigitCrops({ imageBytes: fixture.bytes, segmentation: fixture.segmentation });
  assert.equal(extraction.crops.length, 200);
  assert.deepEqual(extraction.source, TEMPLATE_GEOMETRY.source.width === extraction.source.width
    ? { width: 1216, height: 2002 }
    : extraction.source);
  assert.ok(extraction.crops.slice(0, 5).every((crop) => !crop.isBlank));
  assert.ok(extraction.crops.slice(5).every((crop) => crop.isBlank));
  assert.ok(extraction.crops.every((crop) => Buffer.isBuffer(crop.pngBytes) && /^[a-f0-9]{64}$/.test(crop.sha256)));
  assert.ok(extraction.crops.every((crop) => Buffer.isBuffer(crop.visualPngBytes) && /^[a-f0-9]{64}$/.test(crop.visualSha256)));
});

test("reconoce cinco casillas sinteticas, conserva cero inicial y reporta confianza", { skip: tesseractSkip, timeout: 30_000 }, () => {
  const fixture = createDigitsFixture("01234");
  const provider = new TesseractDigitsProvider({ binaryPath: detection.binaryPath, imageBytes: fixture.bytes });
  const recognition = provider.recognize({ segmentation: fixture.segmentation });

  assert.equal(recognition.provider, TESSERACT_PROVIDER_NAME);
  assert.equal(recognition.engine.version, detection.version);
  assert.equal(recognition.rows.length, 40);
  assert.equal(recognition.rows[0].rawDigits, "01234");
  assert.equal(recognition.rows[0].digitConfidences.length, 5);
  assert.ok(recognition.rows[0].digitConfidences.every((confidence) => confidence >= 0 && confidence <= 1));
  assert.equal(recognition.rows[1].detected, false);
  assert.equal(recognition.rows[1].rawDigits, "");
  assert.equal(recognition.cropArtifacts.length, 200);
  assert.equal(recognition.binaryArtifactsIncluded, false);
  assert.equal("extraction" in recognition, false);
  assert.equal("binaryPath" in recognition.engine, false);
});

test("errores de entrada no incluyen contenido OCR ni rutas arbitrarias", { skip: tesseractSkip }, () => {
  const provider = new TesseractDigitsProvider({ binaryPath: detection.binaryPath });
  assert.throws(
    () => provider.recognize({ segmentation: { templateMap: { rows: [] }, digitCrops: [] } }),
    (error) => error instanceof TypeError && error.message === "El proveedor Tesseract requiere la imagen PNG normalizada o una lista de recortes"
  );
});
