import test from "node:test";
import assert from "node:assert/strict";

import { SimulatedOcrProvider } from "../../src/ocr/adapters/simulated-provider.js";
import { InMemoryEvidenceStore, ReviewEvidenceProducer } from "../../src/ocr/evidence/index.js";
import { runRasterOcrPipeline } from "../../src/ocr/raster-pipeline.js";
import { extractDigitCrops } from "../../src/ocr/recognition/crop-extractor.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";

test("vertical raster produce 200 recortes y 400 evidencias idempotentes consumibles por revision", async () => {
  const documentId = "document-raster-evidence-synthetic";
  const sessionId = "session-raster-evidence-synthetic";
  const pipeline = runRasterOcrPipeline({
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId,
    documentId,
    evidenceId: "source-evidence-synthetic",
    actor: "operator.synthetic@example.invalid",
    provider: new SimulatedOcrProvider(),
    allowSimulatedProvider: true,
    includeNormalizedImageBytes: true,
    recognitionHints: [{
      rowIndex: 1,
      expectedDigits: "01234",
      digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99]
    }],
    employeeRoster: new Set(["01234"]),
    createdAt: "2026-07-21T15:00:00.000Z"
  });
  const extraction = extractDigitCrops({
    imageBytes: pipeline.normalizedImage.bytes,
    segmentation: pipeline.segmentation,
    options: { scale: 1, rawScale: 1, padding: 4 }
  });
  const store = new InMemoryEvidenceStore();
  const producer = new ReviewEvidenceProducer({
    store,
    clock: () => new Date("2026-07-21T15:01:00.000Z")
  });
  const produced = await producer.produce({
    documentId: pipeline.document.documentId,
    sessionId: pipeline.document.sessionId,
    candidates: pipeline.candidates,
    extraction,
    actor: "operator.synthetic@example.invalid",
    requestId: "request-raster-evidence"
  });

  assert.equal(extraction.crops.length, 200);
  assert.equal(pipeline.candidates.length, 40);
  assert.equal(produced.candidateEvidence.length, 40);
  assert.equal(produced.candidateEvidence.every((item) => item.cropEvidenceRefs.length === 5), true);
  assert.equal(produced.candidateEvidence[0].cropEvidenceRefs[0].cropId, "r01-d1");
  assert.equal(produced.candidateEvidence[39].cropEvidenceRefs[4].cropId, "r40-d5");
  assert.equal(produced.evidenceCount, 400);
  assert.equal(produced.effectiveWrites, 400);
  assert.equal(store.size, 400);
  assert.equal(JSON.stringify(produced).includes("pngBytes"), false);
  assert.equal(JSON.stringify(produced).includes("visualPngBytes"), false);

  const firstCandidate = pipeline.candidates[0];
  const firstEvidence = produced.candidateEvidence[0];
  const consumableCandidate = Object.freeze({
    ...firstCandidate,
    cropEvidenceRefs: firstEvidence.cropEvidenceRefs
  });
  assert.equal(consumableCandidate.candidateId, firstCandidate.candidateId);
  assert.equal(consumableCandidate.cropEvidenceRefs.length, 5);
  assert.equal(store.getMetadata(consumableCandidate.cropEvidenceRefs[0].visualEvidenceId).candidateId, firstCandidate.candidateId);

  const repeated = await producer.produce({
    documentId,
    sessionId,
    candidates: pipeline.candidates,
    extraction,
    actor: "operator.synthetic@example.invalid",
    requestId: "request-raster-evidence-retry"
  });
  assert.equal(repeated.effectiveWrites, 0);
  assert.equal(repeated.repeatedWrites, 400);
  assert.equal(store.size, 400);
});
