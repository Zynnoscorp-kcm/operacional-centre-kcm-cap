#!/usr/bin/env node
import { TesseractDigitsProvider, detectTesseract } from "../src/ocr/adapters/tesseract-provider.js";
import { TEMPLATE_GEOMETRY_VERSION } from "../src/ocr/config/template-geometry.js";
import { createSyntheticAttendancePng } from "../src/ocr/testing/synthetic-fixture.js";
import { createPipelineDocumentRecognizer } from "../deploy/ocr-worker/pipeline-recognizer.js";

const detection = detectTesseract();
if (!detection.available) {
  process.stderr.write("Tesseract no esta disponible; no se ejecuto el smoke test del worker.\n");
  process.exitCode = 2;
} else {
  const recognizer = createPipelineDocumentRecognizer({
    provider: new TesseractDigitsProvider({
      binaryPath: detection.binaryPath,
      includeBinaryArtifacts: true
    })
  });
  const startedAt = performance.now();
  const result = await recognizer({
    bytes: createSyntheticAttendancePng(),
    mimeType: "image/png",
    templateVersion: TEMPLATE_GEOMETRY_VERSION
  });
  const output = {
    smokeVersion: "ocr-worker-tesseract-smoke-v1",
    privacy: "SYNTHETIC_BLANK_TEMPLATE_NO_PERSONAL_DATA",
    engine: { name: "tesseract", version: detection.version },
    rows: result.rows.length,
    cropPairs: result.cropPairs.length,
    rowsWithRecognizedDigits: result.rows.filter((row) => row.digits.some((digit) => digit.digit !== "")).length,
    elapsedMs: Number((performance.now() - startedAt).toFixed(3))
  };
  if (output.rows !== 40 || output.cropPairs !== 200 || output.rowsWithRecognizedDigits !== 0) {
    process.stderr.write("El smoke test del worker no conservo la plantilla vacia 40x5.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}
