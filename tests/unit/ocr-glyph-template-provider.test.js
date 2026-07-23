import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";

import {
  GLYPH_TEMPLATE_PROVIDER_NAME,
  GlyphTemplateDigitsProvider,
  buildGlyphTemplates,
  matchGlyphDigit
} from "../../src/ocr/adapters/glyph-template-provider.js";
import { TEMPLATE_GEOMETRY } from "../../src/ocr/config/template-geometry.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";
import { createOcrCandidates } from "../../src/ocr/validation/candidate-validator.js";

function createSystemFontFixture(value = "01234") {
  const canvas = createCanvas(TEMPLATE_GEOMETRY.source.width, TEMPLATE_GEOMETRY.source.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const segmentation = segmentTemplate({ width: canvas.width, height: canvas.height });
  const boxes = segmentation.templateMap.rows[0].digitBoxes;
  for (const [index, digit] of [...value].entries()) {
    const rect = boxes[index].recognitionRect;
    context.save();
    context.translate(rect.x + (rect.width / 2), rect.y + (rect.height / 2));
    context.font = "600 26px \"Helvetica Neue\"";
    context.fillStyle = "rgb(25, 25, 25)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(digit, 0, 1, rect.width - 2);
    context.restore();
  }
  return { bytes: canvas.toBuffer("image/png"), segmentation };
}

test("reconoce cinco casillas tipograficas y conserva el cero inicial", () => {
  const fixture = createSystemFontFixture("01234");
  const provider = new GlyphTemplateDigitsProvider({ imageBytes: fixture.bytes });
  const recognition = provider.recognize({ segmentation: fixture.segmentation });

  assert.equal(recognition.provider, GLYPH_TEMPLATE_PROVIDER_NAME);
  assert.equal(recognition.engine.name, "glyph-template");
  assert.equal(recognition.rows[0].rawDigits, "01234");
  assert.equal(recognition.rows[0].digits.length, 5);
  assert.ok(recognition.rows[0].digits.every((item) => item.digit.length === 1));
  assert.ok(recognition.rows[0].digitConfidences.every((confidence) => confidence >= 0 && confidence <= 0.93));
  assert.equal(recognition.rows[1].detected, false);
  assert.equal(recognition.rows[1].rawDigits, "");
});

test("la inferencia tipografica no consume pistas de verdad esperada", () => {
  const fixture = createSystemFontFixture("01234");
  const extraction = extractDigitCrops({ imageBytes: fixture.bytes, segmentation: fixture.segmentation });
  const provider = new GlyphTemplateDigitsProvider();
  const left = provider.recognize({
    segmentation: fixture.segmentation,
    crops: extraction,
    hints: [{ rowIndex: 1, expectedDigits: "99999" }]
  });
  const right = provider.recognize({
    segmentation: fixture.segmentation,
    crops: extraction,
    hints: [{ rowIndex: 1, expectedDigits: "00000" }]
  });

  assert.deepEqual(left.rows[0], right.rows[0]);
  assert.equal(left.rows[0].rawDigits, "01234");
});

test("expone similitud y margen separados de la confianza calibrada", () => {
  const fixture = createSystemFontFixture("7");
  const extraction = extractDigitCrops({ imageBytes: fixture.bytes, segmentation: fixture.segmentation });
  const bank = buildGlyphTemplates();
  const result = matchGlyphDigit(extraction.crops[0].pngBytes, bank);

  assert.equal(result.digit, "7");
  assert.ok(result.bestSimilarity >= result.runnerUpSimilarity);
  assert.equal(result.margin, Number((result.bestSimilarity - result.runnerUpSimilarity).toFixed(6)));
  assert.ok(result.confidence <= 0.93);
});

test("rechaza una calibracion que invertiría los intervalos", () => {
  assert.throws(
    () => new GlyphTemplateDigitsProvider({
      confidenceCalibration: { similarityFloor: 0.8, similarityCeiling: 0.7 }
    }),
    /similarityCeiling/
  );
});

test("reutiliza por identidad un banco inyectado y valida su cobertura", () => {
  const bank = buildGlyphTemplates();
  const provider = new GlyphTemplateDigitsProvider({ templateBank: bank });

  assert.strictEqual(provider.templateBank, bank);
  assert.throws(
    () => new GlyphTemplateDigitsProvider({
      templateBank: { settings: bank.settings, templates: bank.templates.filter((item) => item.digit !== "9") }
    }),
    /diez digitos/
  );
});

test("el modo conservador no permite elevar el tope hasta los umbrales de autoaceptacion", () => {
  assert.throws(
    () => new GlyphTemplateDigitsProvider({ confidenceCalibration: { standaloneConfidenceCap: 0.94 } }),
    /standaloneConfidenceCap/
  );
  assert.throws(
    () => new GlyphTemplateDigitsProvider({ confidenceCalibration: { standaloneConfidenceCap: 1 } }),
    /standaloneConfidenceCap/
  );
});

test("un renglon adversarial no numerico nunca se autoacepta, incluso si el padron coincide con la lectura", () => {
  const fixture = createSystemFontFixture("X/?+A");
  const provider = new GlyphTemplateDigitsProvider({ imageBytes: fixture.bytes });
  const recognition = provider.recognize({ segmentation: fixture.segmentation });
  const guessedValue = recognition.rows[0].rawDigits;
  const candidates = createOcrCandidates(recognition.rows, {
    documentId: "synthetic-adversarial",
    employeeRoster: new Set([guessedValue])
  });

  assert.match(guessedValue, /^\d{5}$/);
  assert.equal(candidates[0].decision, "REVISION_REQUERIDA");
  assert.ok(candidates[0].validationFlags.includes("LOW_DIGIT_CONFIDENCE"));
  assert.ok(candidates[0].validationFlags.includes("LOW_OVERALL_CONFIDENCE"));
  assert.equal(candidates.filter((candidate) => candidate.decision === "ACEPTADO_AUTOMATICO").length, 0);
});
