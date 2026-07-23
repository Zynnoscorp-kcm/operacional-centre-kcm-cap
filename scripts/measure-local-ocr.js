#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { TesseractDigitsProvider, detectTesseract } from "../src/ocr/adapters/tesseract-provider.js";
import { aggregateOcrMetrics, measureOcrRun } from "../src/ocr/metrics.js";
import { measureNormalizationAlignment } from "../src/ocr/metrics/normalization-metrics.js";
import { runRasterOcrPipeline } from "../src/ocr/raster-pipeline.js";
import { createCropContactSheet } from "../src/ocr/review/contact-sheet.js";
import { createDistortedAttendanceFixture } from "../src/ocr/testing/distorted-fixture.js";

const writeArtifacts = process.argv.includes("--write-artifacts");
const artifactRoot = resolve("artifacts/ocr-public/local-bank-v1");
const templatePng = await readFile(new URL(
  "../referencias/formato/Formato_Control_Asistencia_OCR.png",
  import.meta.url
));
const tesseract = detectTesseract();
if (!tesseract.available) {
  process.stderr.write("Tesseract local no esta disponible; no se ejecutaron metricas reales.\n");
  process.exitCode = 2;
} else {
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
  const measurements = [];
  const results = [];

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
    const employeeRoster = new Set(fixture.syntheticRows.filter((row) => row.digits).map((row) => row.digits));
    const startedAt = performance.now();
    const pipeline = runRasterOcrPipeline({
      bytes: fixture.png,
      declaredMimeType: fixture.mimeType,
      sessionId: `session-${scenario.name}`,
      documentId: `document-${scenario.name}`,
      evidenceId: `evidence-${scenario.name}`,
      actor: "metrics@example.invalid",
      createdAt: "2026-07-21T12:00:00.000Z",
      employeeRoster,
      provider: new TesseractDigitsProvider({
        binaryPath: tesseract.binaryPath,
        includeBinaryArtifacts: writeArtifacts
      }),
      includeNormalizedImageBytes: writeArtifacts,
      fileLimits: { minWidth: 900, minHeight: 1400 }
    });
    const elapsedMs = performance.now() - startedAt;
    const measurement = measureOcrRun({
      expectedRows,
      recognitions: pipeline.recognition.rows,
      candidates: pipeline.candidates,
      elapsedMs
    });
    measurements.push(measurement);
    const expectedParticipantRows = new Set(
      fixture.syntheticRows.filter((row) => row.expectedDetected).map((row) => row.rowIndex)
    );
    const participantCandidates = pipeline.candidates.filter((candidate) => expectedParticipantRows.has(candidate.rowIndex));
    const decisionCounts = Object.fromEntries(
      ["ACEPTADO_AUTOMATICO", "REVISION_REQUERIDA", "RECHAZADO"]
        .map((decision) => [decision, participantCandidates.filter((candidate) => candidate.decision === decision).length])
    );
    const normalization = measureNormalizationAlignment({
      expectedHomography: fixture.groundTruth.templateToPhotoHomography,
      estimatedHomography: pipeline.normalization.homography.inverse
    });
    const reviewRows = fixture.syntheticRows
      .filter((row) => row.expectedDetected)
      .map((expected) => {
        const recognition = pipeline.recognition.rows.find((row) => row.rowIndex === expected.rowIndex);
        const candidate = pipeline.candidates.find((row) => row.rowIndex === expected.rowIndex);
        return {
          rowIndex: expected.rowIndex,
          expectedDigits: expected.digits,
          observedDigits: recognition.rawDigits,
          overallConfidence: recognition.overallConfidence,
          decision: candidate.decision,
          validationFlags: candidate.validationFlags
        };
      });
    const scenarioResult = {
      scenario: scenario.name,
      privacy: fixture.privacy,
      participants: scenario.participantCount,
      sourceSha256: createHash("sha256").update(fixture.png).digest("hex"),
      normalizedSha256: pipeline.normalizedImage.sha256,
      distortion: fixture.distortion,
      normalization,
      ocr: measurement,
      decisionCounts,
      reviewRows
    };
    results.push(scenarioResult);

    if (writeArtifacts) {
      const scenarioDirectory = resolve(artifactRoot, scenario.name);
      await mkdir(scenarioDirectory, { recursive: true });
      const contactSheet = createCropContactSheet(pipeline.recognition.extraction, {
        rowStart: 1,
        rowEnd: scenario.participantCount === 40 ? 40 : 12
      });
      const reviewManifest = `${JSON.stringify({
        privacy: fixture.privacy,
        contactSheet: { width: contactSheet.width, height: contactSheet.height, layout: contactSheet.layout },
        rows: reviewRows
      }, null, 2)}\n`;
      scenarioResult.artifacts = {
        sourceDistortedSha256: scenarioResult.sourceSha256,
        normalizedSha256: scenarioResult.normalizedSha256,
        reviewCropsSha256: createHash("sha256").update(contactSheet.pngBytes).digest("hex"),
        reviewManifestSha256: createHash("sha256").update(reviewManifest).digest("hex"),
        contactSheetRows: contactSheet.rows,
        contactSheetCrops: contactSheet.layout.length
      };
      await Promise.all([
        writeFile(resolve(scenarioDirectory, "source-distorted.png"), fixture.png, { mode: 0o600 }),
        writeFile(resolve(scenarioDirectory, "normalized.png"), pipeline.normalizedImage.bytes, { mode: 0o600 }),
        writeFile(resolve(scenarioDirectory, "review-crops.png"), contactSheet.pngBytes, { mode: 0o600 }),
        writeFile(resolve(scenarioDirectory, "review-manifest.json"), reviewManifest, { mode: 0o600 })
      ]);
    }
  }

  const report = {
    metricVersion: "local-tesseract-bank-v1",
    privacy: "SYNTHETIC_ANONYMIZED_NO_REAL_PERSONAL_DATA",
    engine: { name: "tesseract", version: tesseract.version, provider: "LOCAL_TESSERACT_DIGITS_V1" },
    warning: "Banco tipografico sintetico; no estima precision sobre escritura manuscrita real.",
    aggregate: aggregateOcrMetrics(measurements),
    scenarios: results
  };
  if (writeArtifacts) {
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
