import test from "node:test";
import assert from "node:assert/strict";

import { OCR_DECISIONS } from "../../src/shared/contracts.js";
import { runLocalOcrPipeline } from "../../src/ocr/pipeline.js";
import { applyHumanCorrection, confirmEmptyCandidate } from "../../src/ocr/review/human-correction.js";
import { createOcrCandidates } from "../../src/ocr/validation/candidate-validator.js";
import { createSyntheticAttendancePng } from "../fixtures/synthetic/image-fixtures.js";

const baseInput = Object.freeze({
  bytes: createSyntheticAttendancePng(),
  declaredMimeType: "image/png",
  sessionId: "session-synthetic",
  documentId: "document-synthetic",
  evidenceId: "evidence-synthetic",
  actor: "tester@example.invalid",
  createdAt: "2026-07-21T12:00:00.000Z"
});

test("pipeline conserva cero inicial y envia lectura dudosa a revision", () => {
  const result = runLocalOcrPipeline({
    ...baseInput,
    employeeRoster: new Set(["01234", "54321"]),
    recognitionHints: [
      { rowIndex: 1, expectedDigits: "01234", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99] },
      { rowIndex: 2, expectedDigits: "54321", digitConfidences: [0.99, 0.99, 0.72, 0.99, 0.99] }
    ]
  });

  assert.equal(result.document.mimeType, "image/png");
  assert.equal(result.document.status, "REVISION_OCR");
  assert.equal(result.normalization.mode, "GEOMETRY_ONLY_SIMULATION");
  assert.equal(result.normalization.pixelTransformApplied, false);
  assert.equal(result.candidates[0].normalizedEmployeeId, "01234");
  assert.equal(result.candidates[0].decision, OCR_DECISIONS.AUTO_ACCEPTED);
  assert.equal(result.candidates[1].decision, OCR_DECISIONS.REVIEW_REQUIRED);
  assert.ok(result.candidates[1].validationFlags.includes("LOW_DIGIT_CONFIDENCE"));
  assert.equal(result.candidates[2].decision, OCR_DECISIONS.REVIEW_REQUIRED);
});

test("todos los duplicados y numeros inexistentes requieren revision", () => {
  const candidates = createOcrCandidates([
    { rowIndex: 1, detected: true, rawDigits: "11111", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99], overallConfidence: 0.99 },
    { rowIndex: 2, detected: true, rawDigits: "11111", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99], overallConfidence: 0.99 },
    { rowIndex: 3, detected: true, rawDigits: "99999", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99], overallConfidence: 0.99 }
  ], { documentId: "doc", employeeRoster: new Set(["11111"]) });

  assert.equal(candidates[0].decision, OCR_DECISIONS.REVIEW_REQUIRED);
  assert.equal(candidates[1].decision, OCR_DECISIONS.REVIEW_REQUIRED);
  assert.ok(candidates[0].validationFlags.includes("DUPLICATE_IN_DOCUMENT"));
  assert.ok(candidates[2].validationFlags.includes("EMPLOYEE_NOT_FOUND"));
});

test("correccion humana conserva antes, despues, actor, fecha y motivo", () => {
  const [candidate] = createOcrCandidates([
    { rowIndex: 1, detected: true, rawDigits: "1234?", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.42], overallConfidence: 0.42 }
  ], { documentId: "doc", employeeRoster: new Set(["01234"]) });
  const result = applyHumanCorrection(candidate, {
    correctedValue: "01234",
    actor: "reviewer@example.invalid",
    reason: "Comparacion visual de las cinco casillas",
    correctedAt: "2026-07-21T13:00:00.000Z",
    employeeRoster: new Set(["01234"])
  });

  assert.equal(result.candidate.originalValue, "1234?");
  assert.equal(result.candidate.correctedValue, "01234");
  assert.equal(result.candidate.decision, OCR_DECISIONS.HUMAN_CONFIRMED);
  assert.deepEqual(
    [result.correction.before, result.correction.after, result.correction.actor, result.correction.at, result.correction.reason],
    ["1234?", "01234", "reviewer@example.invalid", "2026-07-21T13:00:00.000Z", "Comparacion visual de las cinco casillas"]
  );
});

test("renglon vacio requiere decision humana auditable y queda terminal", () => {
  const [candidate] = createOcrCandidates([
    { rowIndex: 7, detected: false, rawDigits: "", digitConfidences: [], overallConfidence: 0 }
  ], { documentId: "doc", employeeRoster: new Set(["01234"]) });

  const result = confirmEmptyCandidate(candidate, {
    actor: "reviewer@example.invalid",
    reason: "Las cinco casillas se revisaron y el renglon no corresponde a un participante",
    confirmedAt: "2026-07-21T13:05:00.000Z"
  });

  assert.equal(candidate.decision, OCR_DECISIONS.REVIEW_REQUIRED);
  assert.equal(result.candidate.decision, OCR_DECISIONS.EMPTY_CONFIRMED);
  assert.equal(result.candidate.normalizedEmployeeId, null);
  assert.equal(result.candidate.correctedValue, null);
  assert.ok(result.candidate.validationFlags.includes("EMPTY_ROW_CONFIRMED"));
  assert.deepEqual(
    [result.correction.before, result.correction.after, result.correction.actor, result.correction.at, result.correction.reason],
    ["", null, "reviewer@example.invalid", "2026-07-21T13:05:00.000Z", "Las cinco casillas se revisaron y el renglon no corresponde a un participante"]
  );
  assert.throws(
    () => applyHumanCorrection(result.candidate, {
      correctedValue: "01234",
      actor: "reviewer@example.invalid",
      reason: "Intento posterior",
      employeeRoster: new Set(["01234"])
    }),
    /no puede corregirse silenciosamente/
  );
  assert.throws(
    () => confirmEmptyCandidate(result.candidate, {
      actor: "reviewer@example.invalid",
      reason: "Intento repetido"
    }),
    /pendiente o autoaceptado/
  );
});
