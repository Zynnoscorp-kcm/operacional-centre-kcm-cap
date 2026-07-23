import assert from "node:assert/strict";
import test from "node:test";

import { SimulatedOcrProvider } from "../../src/ocr/adapters/simulated-provider.js";
import { InMemoryEvidenceStore, ReviewEvidenceProducer } from "../../src/ocr/evidence/index.js";
import { OcrJobOrchestrator } from "../../src/ocr/jobs/ocr-job-orchestrator.js";
import { runRasterOcrPipeline } from "../../src/ocr/raster-pipeline.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";

const INPUT = Object.freeze({
  bytes: createSyntheticAttendancePng(),
  declaredMimeType: "image/png",
  sessionId: "session-job-evidence-synthetic",
  documentId: "document-job-evidence-synthetic",
  evidenceId: "source-job-evidence-synthetic",
  actor: "operator.synthetic@example.invalid",
  requestId: "request-job-evidence-synthetic",
  createdAt: "2026-07-21T17:00:00.000Z"
});

function createRealPipeline(counter) {
  const provider = new SimulatedOcrProvider();
  return (input) => {
    counter.calls += 1;
    return runRasterOcrPipeline({
      ...input,
      provider,
      allowSimulatedProvider: true,
      recognitionHints: [{
        rowIndex: 1,
        expectedDigits: "01234",
        digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99]
      }],
      employeeRoster: new Set(["01234"])
    });
  };
}

function createProducer(store) {
  return new ReviewEvidenceProducer({
    store,
    clock: () => new Date("2026-07-21T17:01:00.000Z")
  });
}

test("orquestador integra raster, 40 candidatos, 200 casillas y 400 evidencias sin duplicar", async () => {
  const store = new InMemoryEvidenceStore();
  const counter = { calls: 0 };
  const orchestrator = new OcrJobOrchestrator({
    pipeline: createRealPipeline(counter),
    evidenceProducer: createProducer(store),
    backoff: async () => {}
  });

  const [first, concurrent] = await Promise.all([
    orchestrator.process(INPUT),
    orchestrator.process({ ...INPUT, requestId: "request-job-evidence-concurrent" })
  ]);

  assert.equal(first.job.state, "REVISION_OCR");
  assert.equal(first.candidates.length, 40);
  assert.equal(first.candidates.every((candidate) => candidate.cropEvidenceRefs.length === 5), true);
  assert.equal(first.evidence.evidenceCount, 400);
  assert.equal(first.evidence.effectiveWrites, 400);
  assert.equal(store.size, 400);
  assert.equal(counter.calls, 1);
  assert.equal(concurrent.repeated, true);
  assert.equal(concurrent.concurrent, true);
  assert.equal(JSON.stringify(first).includes("pngBytes"), false);
  assert.equal(JSON.stringify(first).includes("bytes"), false);

  const repeated = await orchestrator.process({ ...INPUT, requestId: "request-job-evidence-repeat" });
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.concurrent, false);
  assert.equal(store.size, 400);
  assert.equal(counter.calls, 1);
});

test("rollback parcial de evidencia se recupera con backoff y termina en un solo lote", async () => {
  const store = new InMemoryEvidenceStore();
  store.failNextCommitAfter(17);
  const counter = { calls: 0 };
  const delays = [];
  const orchestrator = new OcrJobOrchestrator({
    pipeline: createRealPipeline(counter),
    evidenceProducer: createProducer(store),
    maxAttempts: 2,
    backoff: async (delayMs) => { delays.push(delayMs); }
  });

  const result = await orchestrator.process({
    ...INPUT,
    documentId: "document-job-evidence-recovery",
    evidenceId: "source-job-evidence-recovery",
    requestId: "request-job-evidence-recovery"
  });

  assert.equal(result.job.attempts, 2);
  assert.equal(result.evidence.effectiveWrites, 400);
  assert.equal(store.size, 400);
  assert.equal(counter.calls, 2);
  assert.deepEqual(delays, [100]);
  assert.deepEqual(orchestrator.errors(result.job.jobKey).map(({ code, retryable }) => ({ code, retryable })), [{
    code: "REVIEW_EVIDENCE_TRANSACTION_RECOVERABLE",
    retryable: true
  }]);
  assert.deepEqual(orchestrator.audit(result.job.jobKey).map(({ action }) => action), [
    "OCR_JOB_STARTED",
    "OCR_JOB_RETRY_SCHEDULED",
    "OCR_JOB_STARTED",
    "OCR_JOB_COMPLETED"
  ]);
});
