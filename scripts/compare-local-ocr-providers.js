#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { GlyphTemplateDigitsProvider, buildGlyphTemplates } from "../src/ocr/adapters/glyph-template-provider.js";
import { TesseractDigitsProvider, detectTesseract } from "../src/ocr/adapters/tesseract-provider.js";
import { TEMPLATE_GEOMETRY } from "../src/ocr/config/template-geometry.js";
import { aggregateOcrMetrics, measureOcrRun } from "../src/ocr/metrics.js";
import { runRasterOcrPipeline } from "../src/ocr/raster-pipeline.js";
import { segmentTemplate } from "../src/ocr/segmentation/template-segmenter.js";
import { createDistortedAttendanceFixture } from "../src/ocr/testing/distorted-fixture.js";
import { DEFAULT_OCR_THRESHOLDS, createOcrCandidates } from "../src/ocr/validation/candidate-validator.js";

const writeReport = process.argv.includes("--write-report");
const artifactRoot = resolve("artifacts/ocr-public/local-provider-comparison-v1");
const templatePng = await readFile(new URL(
  "../referencias/formato/Formato_Control_Asistencia_OCR.png",
  import.meta.url
));
const tesseract = detectTesseract();

if (!tesseract.available) {
  process.stderr.write("Tesseract local no esta disponible; no se puede construir la comparacion.\n");
  process.exitCode = 2;
} else {
  const bankStartedAt = performance.now();
  const sharedTemplateBank = buildGlyphTemplates();
  const bankBuildMs = performance.now() - bankStartedAt;
  const reuseSamples = [];
  for (let sample = 0; sample < 25; sample += 1) {
    const startedAt = performance.now();
    new GlyphTemplateDigitsProvider({ templateBank: sharedTemplateBank });
    reuseSamples.push(performance.now() - startedAt);
  }
  const scenarios = [
    {
      name: "dense-moderate",
      seed: "local-bank-dense-v1",
      participantCount: 40,
      rotationDegrees: 2.5,
      perspective: 0.02,
      pageFill: 0.84
    },
    {
      name: "sparse-strong",
      seed: "local-bank-sparse-v1",
      participantCount: 8,
      rotationDegrees: -4.5,
      perspective: 0.045,
      pageFill: 0.82
    }
  ];
  const providers = [
    {
      id: "tesseract-baseline",
      create: () => new TesseractDigitsProvider({ binaryPath: tesseract.binaryPath })
    },
    {
      id: "glyph-template-conservative",
      create: () => new GlyphTemplateDigitsProvider({ templateBank: sharedTemplateBank })
    }
  ];
  const results = [];
  const measurementsByProvider = new Map(providers.map((provider) => [provider.id, []]));

  for (const scenario of scenarios) {
    const fixture = createDistortedAttendanceFixture({
      templatePng,
      seed: scenario.seed,
      outputWidth: 1000,
      outputHeight: 1650,
      participantCount: scenario.participantCount,
      rotationDegrees: scenario.rotationDegrees,
      perspective: scenario.perspective,
      pageFill: scenario.pageFill,
      digitRenderer: "SYSTEM_FONT",
      fontFamily: "Helvetica Neue"
    });
    const expectedRows = fixture.syntheticRows.map((row) => ({
      rowIndex: row.rowIndex,
      expectedDigits: row.digits,
      expectedDetected: row.expectedDetected
    }));
    const employeeRoster = new Set(
      fixture.syntheticRows.filter((row) => row.digits).map((row) => row.digits)
    );
    const scenarioProviders = [];

    for (const providerConfig of providers) {
      const startedAt = performance.now();
      const pipeline = runRasterOcrPipeline({
        bytes: fixture.png,
        declaredMimeType: fixture.mimeType,
        sessionId: `session-${scenario.name}`,
        documentId: `document-${scenario.name}-${providerConfig.id}`,
        evidenceId: `evidence-${scenario.name}`,
        actor: "metrics@example.invalid",
        createdAt: "2026-07-21T12:00:00.000Z",
        employeeRoster,
        provider: providerConfig.create(),
        fileLimits: { minWidth: 900, minHeight: 1400 }
      });
      const elapsedMs = performance.now() - startedAt;
      const measurement = measureOcrRun({
        expectedRows,
        recognitions: pipeline.recognition.rows,
        candidates: pipeline.candidates,
        elapsedMs
      });
      measurementsByProvider.get(providerConfig.id).push(measurement);
      scenarioProviders.push({
        providerId: providerConfig.id,
        engine: pipeline.recognition.engine,
        metrics: measurement,
        slotAware: measureSlotAware(expectedRows, pipeline.recognition.rows),
        confidence: measureConfidence(expectedRows, pipeline.recognition.rows),
        decisionCounts: decisionCounts(fixture.syntheticRows, pipeline.candidates)
      });
    }
    results.push({
      scenario: scenario.name,
      privacy: fixture.privacy,
      participants: scenario.participantCount,
      sourceSha256: createHash("sha256").update(fixture.png).digest("hex"),
      distortion: fixture.distortion,
      providers: scenarioProviders
    });
  }

  const aggregate = Object.fromEntries(providers.map((provider) => [
    provider.id,
    aggregateOcrMetrics(measurementsByProvider.get(provider.id))
  ]));
  const aggregateSlotAware = Object.fromEntries(providers.map((provider) => [
    provider.id,
    aggregateSlotAwareMetrics(results, provider.id)
  ]));
  const baseline = aggregate["tesseract-baseline"];
  const improved = aggregate["glyph-template-conservative"];
  const report = {
    metricVersion: "local-provider-comparison-v1",
    createdAt: new Date().toISOString(),
    privacy: "SYNTHETIC_ANONYMIZED_NO_REAL_PERSONAL_DATA",
    inferenceIsolation: {
      expectedTruthPassedToProvider: false,
      employeeRosterPassedToProvider: false,
      expectedTruthUsage: "METRICS_ONLY_AFTER_INFERENCE"
    },
    businessThresholdsUnchanged: DEFAULT_OCR_THRESHOLDS,
    warning: "Banco tipografico sintetico Helvetica Neue; no estima precision sobre escritura manuscrita real.",
    templateBankCost: {
      templates: sharedTemplateBank.templates.length,
      buildOnceMs: bankBuildMs,
      providerConstructionWithReusedBankMeanMs: reuseSamples.reduce((sum, value) => sum + value, 0) / reuseSamples.length,
      providerConstructionWithReusedBankMaximumMs: Math.max(...reuseSamples),
      reuseSamples: reuseSamples.length,
      scenarioRunsReuseSameBank: true
    },
    adversarialNegative: measureAdversarialNegative(sharedTemplateBank),
    aggregate,
    aggregateSlotAware,
    deltaAgainstBaseline: {
      fullNumberAccuracyPercentagePoints: improved.fullNumberAccuracyPercent - baseline.fullNumberAccuracyPercent,
      digitAccuracyPercentagePoints: improved.digitAccuracyPercent - baseline.digitAccuracyPercent,
      totalProcessingTimeMs: improved.totalProcessingTimeMs - baseline.totalProcessingTimeMs,
      manualReviewRatePercentagePoints: improved.manualReviewRatePercent - baseline.manualReviewRatePercent
    },
    scenarios: results
  };

  if (writeReport) {
    await mkdir(artifactRoot, { recursive: true });
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await Promise.all([
      writeFile(resolve(artifactRoot, "metrics.json"), reportBytes, { mode: 0o600 }),
      writeFile(
        resolve(artifactRoot, "metrics.sha256"),
        `${createHash("sha256").update(reportBytes).digest("hex")}  metrics.json\n`,
        { mode: 0o600 }
      )
    ]);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function aggregateSlotAwareMetrics(results, providerId) {
  const totals = results.reduce((aggregate, scenario) => {
    const provider = scenario.providers.find((item) => item.providerId === providerId);
    aggregate.expectedDigits += provider.slotAware.expectedDigits;
    aggregate.correctDigits += provider.slotAware.correctDigits;
    return aggregate;
  }, { expectedDigits: 0, correctDigits: 0 });
  return {
    ...totals,
    digitAccuracyPercent: totals.expectedDigits ? (totals.correctDigits / totals.expectedDigits) * 100 : 0,
    meaning: "DIGIT_COMPARED_IN_ITS_ORIGINAL_BOX_SLOT"
  };
}

function measureAdversarialNegative(templateBank) {
  const canvas = createCanvas(TEMPLATE_GEOMETRY.source.width, TEMPLATE_GEOMETRY.source.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const segmentation = segmentTemplate({ width: canvas.width, height: canvas.height });
  const symbols = ["X", "/", "?", "+", "A"];
  for (const [index, symbol] of symbols.entries()) {
    const rect = segmentation.templateMap.rows[0].digitBoxes[index].recognitionRect;
    context.save();
    context.translate(rect.x + (rect.width / 2), rect.y + (rect.height / 2));
    context.font = "600 26px \"Helvetica Neue\"";
    context.fillStyle = "rgb(25, 25, 25)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(symbol, 0, 1, rect.width - 2);
    context.restore();
  }
  const provider = new GlyphTemplateDigitsProvider({
    imageBytes: canvas.toBuffer("image/png"),
    templateBank
  });
  const recognition = provider.recognize({ segmentation });
  const guessedValue = recognition.rows[0].rawDigits;
  const candidates = createOcrCandidates(recognition.rows, {
    documentId: "synthetic-adversarial",
    employeeRoster: new Set([guessedValue])
  });
  const candidate = candidates[0];
  const falseAcceptanceCount = candidate.decision === "ACEPTADO_AUTOMATICO" ? 1 : 0;
  return {
    privacy: "SYNTHETIC_NON_DIGIT_GLYPHS_NO_PERSONAL_DATA",
    challenges: 1,
    inferredFiveDigitFormat: /^\d{5}$/.test(guessedValue),
    inferredValueSha256: createHash("sha256").update(guessedValue).digest("hex"),
    decision: candidate.decision,
    validationFlags: candidate.validationFlags,
    maximumDigitConfidence: Math.max(...recognition.rows[0].digitConfidences),
    falseAcceptanceCount,
    falseAcceptanceRatePercent: falseAcceptanceCount * 100,
    passed: falseAcceptanceCount === 0
  };
}

function decisionCounts(expectedRows, candidates) {
  const occupied = new Set(expectedRows.filter((row) => row.expectedDetected).map((row) => row.rowIndex));
  const relevant = candidates.filter((candidate) => occupied.has(candidate.rowIndex));
  return Object.fromEntries(
    ["ACEPTADO_AUTOMATICO", "REVISION_REQUERIDA", "RECHAZADO"]
      .map((decision) => [decision, relevant.filter((candidate) => candidate.decision === decision).length])
  );
}

function measureSlotAware(expectedRows, recognitions) {
  const recognitionByRow = new Map(recognitions.map((row) => [row.rowIndex, row]));
  let expectedDigits = 0;
  let correctDigits = 0;
  const confusion = new Map();
  const positions = Array.from({ length: 5 }, (_, index) => ({ position: index + 1, expected: 0, correct: 0, blank: 0 }));
  for (const expected of expectedRows) {
    const value = String(expected.expectedDigits ?? "");
    if (!value) continue;
    const recognition = recognitionByRow.get(expected.rowIndex);
    for (let index = 0; index < value.length; index += 1) {
      const expectedDigit = value[index];
      const observedDigit = String(recognition?.digits?.[index]?.digit ?? "");
      expectedDigits += 1;
      positions[index].expected += 1;
      if (observedDigit === expectedDigit) {
        correctDigits += 1;
        positions[index].correct += 1;
      } else {
        const key = `${expectedDigit}->${observedDigit || "BLANK"}`;
        confusion.set(key, (confusion.get(key) ?? 0) + 1);
      }
      if (!observedDigit) positions[index].blank += 1;
    }
  }
  return {
    expectedDigits,
    correctDigits,
    digitAccuracyPercent: expectedDigits ? (correctDigits / expectedDigits) * 100 : 0,
    positions: positions.map((position) => ({
      ...position,
      accuracyPercent: position.expected ? (position.correct / position.expected) * 100 : 0
    })),
    topConfusions: [...confusion].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 12)
  };
}

function measureConfidence(expectedRows, recognitions) {
  const recognitionByRow = new Map(recognitions.map((row) => [row.rowIndex, row]));
  const correct = [];
  const incorrect = [];
  for (const expected of expectedRows) {
    const value = String(expected.expectedDigits ?? "");
    if (!value) continue;
    const recognition = recognitionByRow.get(expected.rowIndex);
    for (let index = 0; index < value.length; index += 1) {
      const digit = recognition?.digits?.[index];
      const target = digit?.digit === value[index] ? correct : incorrect;
      target.push(Number(digit?.confidence ?? 0));
    }
  }
  return { correct: summarizeValues(correct), incorrect: summarizeValues(incorrect) };
}

function summarizeValues(values) {
  if (!values.length) return { count: 0, minimum: null, mean: null, maximum: null, atLeast094: 0, atLeast096: 0 };
  return {
    count: values.length,
    minimum: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    maximum: Math.max(...values),
    atLeast094: values.filter((value) => value >= 0.94).length,
    atLeast096: values.filter((value) => value >= 0.96).length
  };
}
