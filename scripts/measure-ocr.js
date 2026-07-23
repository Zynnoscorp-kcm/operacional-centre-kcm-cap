import { readFile } from "node:fs/promises";

import { aggregateOcrMetrics, measureOcrRun } from "../src/ocr/metrics.js";
import { runLocalOcrPipeline } from "../src/ocr/pipeline.js";
import { createSyntheticAttendancePng } from "../src/ocr/testing/synthetic-fixture.js";

const bankUrl = new URL("../tests/fixtures/synthetic/ocr-bank.json", import.meta.url);
const bank = JSON.parse(await readFile(bankUrl, "utf8"));
const runs = [];

for (const sheet of bank.sheets) {
  const startedAt = performance.now();
  const result = runLocalOcrPipeline({
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: `session-${sheet.fixtureId}`,
    documentId: `document-${sheet.fixtureId}`,
    evidenceId: `evidence-${sheet.fixtureId}`,
    actor: "metrics@example.invalid",
    createdAt: "2026-07-21T12:00:00.000Z",
    employeeRoster: new Set(sheet.employeeRoster),
    recognitionHints: sheet.rows
  });
  const elapsedMs = performance.now() - startedAt;
  const hintsByRow = new Map(sheet.rows.map((row) => [row.rowIndex, row]));
  const expectedRows = Array.from({ length: 40 }, (_, offset) => {
    const rowIndex = offset + 1;
    const hint = hintsByRow.get(rowIndex) ?? {};
    const expectedDigits = hint.expectedDigits ?? "";
    return {
      rowIndex,
      expectedDigits,
      expectedDetected: hint.expectedDetected == null ? expectedDigits.length > 0 : hint.expectedDetected === true
    };
  });
  runs.push(measureOcrRun({
    expectedRows,
    recognitions: result.recognition.rows,
    candidates: result.candidates,
    elapsedMs
  }));
}

const metrics = aggregateOcrMetrics(runs);
process.stdout.write(`${JSON.stringify({
  fixtureVersion: bank.fixtureVersion,
  privacy: bank.privacy,
  ...metrics
}, null, 2)}\n`);
