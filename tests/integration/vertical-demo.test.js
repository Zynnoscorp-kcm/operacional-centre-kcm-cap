import test from "node:test";
import assert from "node:assert/strict";
import { runVerticalDemo } from "../../scripts/run-vertical-demo.js";

test("vertical digital y OCR libera parcialmente de forma idempotente", async () => {
  const result = await runVerticalDemo();
  assert.deepEqual(result.participantAttendanceRoutes, ["DIGITAL", "OCR", "OCR"]);
  assert.deepEqual(result.leadingZeroIds, ["00001", "00002", "00003"]);
  assert.equal(result.ocr.rowsDetected, 40);
  assert.equal(result.ocr.digitCrops, 200);
  assert.equal(result.ocr.normalization, "PIXEL_HOMOGRAPHY_V1");
  assert.equal(result.ocr.pixelTransformApplied, true);
  assert.equal(result.ocr.correctionBefore, "0000?");
  assert.equal(result.ocr.correctionAfter, "00003");
  assert.equal(result.reconciliation.receivedExamCount, 2);
  assert.deepEqual(result.preview.included, ["00001", "00002"]);
  assert.equal(result.preview.excluded[0].employeeId, "00003");
  assert.ok(result.preview.excluded[0].reasons.includes("EXAMEN_NO_ENCONTRADO"));
  assert.equal(result.release.status, "LIBERADA_PARCIAL");
  assert.equal(result.release.effectiveWrites, 2);
  assert.equal(result.release.repeatedEffectiveWrites, 0);
  assert.equal(result.release.matrixWriteCount, 2);
  assert.ok(result.auditEventCount > 0);
});
