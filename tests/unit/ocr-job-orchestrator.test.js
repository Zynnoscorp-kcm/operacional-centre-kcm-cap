import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  InMemoryOcrJobRepository,
  OCR_JOB_STATES,
  OcrJobRepositoryError
} from "../../src/ocr/jobs/in-memory-job-repository.js";
import {
  OcrJobExecutionError,
  OcrJobOrchestrator,
  ocrJobKey
} from "../../src/ocr/jobs/ocr-job-orchestrator.js";

const BASE_INPUT = Object.freeze({
  bytes: Buffer.from("synthetic-image-content"),
  declaredMimeType: "image/png",
  sessionId: "session-job-001",
  documentId: "document-job-001",
  evidenceId: "evidence-source-001",
  actor: "ocr-worker@example.invalid",
  requestId: "request-job-001"
});

function pipelineResult() {
  return {
    document: {
      documentId: BASE_INPUT.documentId,
      sessionId: BASE_INPUT.sessionId,
      evidenceId: BASE_INPUT.evidenceId,
      sha256: "a".repeat(64),
      mimeType: "image/png",
      byteSize: 100,
      pageCount: 1,
      status: "REVISION_OCR",
      createdBy: BASE_INPUT.actor,
      createdAt: "2026-07-21T16:00:00.000Z",
      version: "1.0.0"
    },
    processing: { geometryVersion: "geometry-v1", provider: "PROVIDER_TEST", engine: null },
    normalizedImage: {
      sha256: "b".repeat(64),
      bytes: Buffer.from("normalized-png")
    },
    segmentation: { digitCrops: [] },
    recognition: {
      extraction: { crops: Array.from({ length: 200 }, (_, index) => ({ index })) }
    },
    candidates: [1, 2].map((rowIndex) => ({
      candidateId: `candidate-job-${rowIndex}`,
      documentId: BASE_INPUT.documentId,
      rowIndex,
      rawDigits: rowIndex === 1 ? "00123" : "00456",
      digitConfidences: [0.9, 0.9, 0.9, 0.9, 0.9],
      overallConfidence: 0.9,
      normalizedEmployeeId: rowIndex === 1 ? "00123" : "00456",
      decision: "REVISION_REQUERIDA",
      validationFlags: ["LOW_CONFIDENCE"],
      originalValue: rowIndex === 1 ? "00123" : "00456",
      correctedValue: ""
    }))
  };
}

function evidenceOutput(candidates = pipelineResult().candidates) {
  return {
    candidateEvidence: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      cropEvidenceRefs: Array.from({ length: 5 }, (_, digitIndex) => ({
        cropId: `r${String(candidate.rowIndex).padStart(2, "0")}-d${digitIndex + 1}`,
        digitIndex,
        visualEvidenceRef: `visual-${candidate.rowIndex}-${digitIndex}`,
        processedEvidenceRef: `processed-${candidate.rowIndex}-${digitIndex}`
      }))
    })),
    evidenceCount: candidates.length * 10,
    effectiveWrites: candidates.length * 10,
    repeatedWrites: 0,
    status: "COMPLETA"
  };
}

function createOrchestrator({ pipeline, producer, repository, maxAttempts = 3, backoff } = {}) {
  return new OcrJobOrchestrator({
    pipeline: pipeline ?? (() => pipelineResult()),
    evidenceProducer: producer ?? { produce: async ({ candidates }) => evidenceOutput(candidates) },
    repository,
    maxAttempts,
    backoff: backoff ?? (async () => {})
  });
}

test("trabajo OCR exitoso persiste resultado sanitizado y reintento no repite efectos", async () => {
  let pipelineCalls = 0;
  let evidenceCalls = 0;
  const repository = new InMemoryOcrJobRepository({
    now: () => "2026-07-21T16:00:00.000Z",
    idFactory: (() => { let value = 0; return () => String(++value); })()
  });
  const orchestrator = createOrchestrator({
    repository,
    pipeline: () => { pipelineCalls += 1; return pipelineResult(); },
    producer: { produce: async ({ candidates }) => { evidenceCalls += 1; return evidenceOutput(candidates); } }
  });

  const first = await orchestrator.process(BASE_INPUT);
  assert.equal(first.job.state, OCR_JOB_STATES.REVIEW);
  assert.equal(first.job.attempts, 1);
  assert.equal(first.candidates.length, 2);
  assert.equal(first.candidates[0].cropEvidenceRefs.length, 5);
  assert.equal(first.evidence.evidenceCount, 20);
  assert.equal(first.repeated, false);
  assert.equal(JSON.stringify(first).includes("normalized-png"), false);
  assert.equal(JSON.stringify(first).includes("bytes"), false);

  const repeated = await orchestrator.process({ ...BASE_INPUT, requestId: "request-job-repeat" });
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.concurrent, false);
  assert.equal(repeated.job.jobKey, first.job.jobKey);
  assert.equal(pipelineCalls, 1);
  assert.equal(evidenceCalls, 1);
  assert.deepEqual(orchestrator.audit(first.job.jobKey).map(({ action }) => action), [
    "OCR_JOB_STARTED", "OCR_JOB_COMPLETED"
  ]);
});

test("dos ejecuciones concurrentes comparten un solo pipeline y productor", async () => {
  let releasePipeline;
  let pipelineCalls = 0;
  let producerCalls = 0;
  const barrier = new Promise((resolve) => { releasePipeline = resolve; });
  const orchestrator = createOrchestrator({
    pipeline: async () => { pipelineCalls += 1; await barrier; return pipelineResult(); },
    producer: { produce: async ({ candidates }) => { producerCalls += 1; return evidenceOutput(candidates); } }
  });

  const firstPromise = orchestrator.process(BASE_INPUT);
  const secondPromise = orchestrator.process({ ...BASE_INPUT, requestId: "request-job-concurrent" });
  releasePipeline();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.repeated, false);
  assert.equal(second.repeated, true);
  assert.equal(second.concurrent, true);
  assert.equal(pipelineCalls, 1);
  assert.equal(producerCalls, 1);
});

test("error reintentable aplica backoff y completa sin duplicar evidencia", async () => {
  let calls = 0;
  const delays = [];
  const orchestrator = createOrchestrator({
    pipeline: () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("ruta privada no debe salir"), {
        code: "TESSERACT_TIMEOUT",
        retryable: true
      });
      return pipelineResult();
    },
    backoff: async (delayMs) => { delays.push(delayMs); }
  });

  const result = await orchestrator.process(BASE_INPUT);
  assert.equal(result.job.attempts, 2);
  assert.deepEqual(delays, [100]);
  assert.equal(orchestrator.errors(result.job.jobKey).length, 1);
  assert.deepEqual(orchestrator.audit(result.job.jobKey).map(({ action }) => action), [
    "OCR_JOB_STARTED", "OCR_JOB_RETRY_SCHEDULED", "OCR_JOB_STARTED", "OCR_JOB_COMPLETED"
  ]);
});

test("error recuperable del productor de evidencia se reintenta", async () => {
  let producerCalls = 0;
  const orchestrator = createOrchestrator({
    producer: {
      produce: async ({ candidates }) => {
        producerCalls += 1;
        if (producerCalls === 1) {
          throw Object.assign(new Error("lote revertido"), {
            code: "REVIEW_EVIDENCE_TRANSACTION_RECOVERABLE",
            recoverable: true
          });
        }
        return evidenceOutput(candidates);
      }
    }
  });

  const result = await orchestrator.process(BASE_INPUT);
  assert.equal(result.job.attempts, 2);
  assert.equal(producerCalls, 2);
  assert.equal(orchestrator.errors(result.job.jobKey)[0].retryable, true);
});

test("conteos de evidencia invalidos fallan sin exponer el resultado", async () => {
  const orchestrator = createOrchestrator({
    producer: {
      produce: async ({ candidates }) => ({
        ...evidenceOutput(candidates),
        evidenceCount: Number.NaN
      })
    }
  });

  await assert.rejects(
    orchestrator.process(BASE_INPUT),
    (error) => error instanceof OcrJobExecutionError && error.code === "OCR_JOB_FAILED"
  );
});

test("error final queda sanitizado y no vuelve a ejecutar el mismo documento", async () => {
  let calls = 0;
  const orchestrator = createOrchestrator({
    pipeline: () => {
      calls += 1;
      throw Object.assign(new Error("/private/path y lectura secreta"), { code: "PROVIDER_FATAL" });
    }
  });

  await assert.rejects(
    orchestrator.process(BASE_INPUT),
    (error) => error instanceof OcrJobExecutionError
      && error.code === "PROVIDER_FATAL"
      && error.message === "El trabajo OCR no pudo completarse"
      && error.attempts === 1
  );
  await assert.rejects(
    orchestrator.process({ ...BASE_INPUT, requestId: "request-after-final" }),
    (error) => error.code === "PROVIDER_FATAL" && !error.message.includes("private")
  );
  assert.equal(calls, 1);
});

test("mismo documentId con contenido distinto se rechaza antes del pipeline", async () => {
  let calls = 0;
  const orchestrator = createOrchestrator({ pipeline: () => { calls += 1; return pipelineResult(); } });
  await orchestrator.process(BASE_INPUT);
  await assert.rejects(
    orchestrator.process({ ...BASE_INPUT, bytes: Buffer.from("different-content"), requestId: "request-conflict" }),
    (error) => error instanceof OcrJobRepositoryError && error.code === "OCR_DOCUMENT_CONTENT_CONFLICT"
  );
  assert.equal(calls, 1);
});

test("clave de trabajo depende de documento, hash y version", () => {
  const base = { documentId: "document", sourceSha256: "a".repeat(64) };
  assert.equal(ocrJobKey(base), ocrJobKey(base));
  assert.notEqual(ocrJobKey(base), ocrJobKey({ ...base, sourceSha256: "b".repeat(64) }));
  assert.notEqual(ocrJobKey(base), ocrJobKey({ ...base, pipelineVersion: "v2" }));
});

test("repositorio impide saltos de estado y conserva snapshots", () => {
  const repository = new InMemoryOcrJobRepository({ idFactory: () => "fixed" });
  const registered = repository.register({
    jobKey: "job-key", documentId: "document", sessionId: "session",
    sourceSha256: "a".repeat(64), pipelineVersion: "v1",
    actor: "actor@example.invalid", requestId: "request"
  });
  assert.equal(registered.job.state, OCR_JOB_STATES.PENDING);
  assert.throws(
    () => repository.transition("job-key", OCR_JOB_STATES.PROCESSED),
    (error) => error.code === "OCR_JOB_TRANSITION_INVALID"
  );
  const processing = repository.transition("job-key", OCR_JOB_STATES.PROCESSING);
  assert.equal(processing.attempts, 1);
  assert.throws(() => { processing.state = "ALTERADO"; }, TypeError);
  assert.equal(repository.get("job-key").state, OCR_JOB_STATES.PROCESSING);
});

test("un trabajo recuperado con intentos agotados pasa a error final sin ejecutar efectos", async () => {
  const repository = new InMemoryOcrJobRepository({
    now: () => "2026-07-21T16:00:00.000Z",
    idFactory: (() => { let value = 0; return () => String(++value); })()
  });
  const sourceSha256 = createHash("sha256").update(BASE_INPUT.bytes).digest("hex");
  const jobKey = ocrJobKey({
    documentId: BASE_INPUT.documentId,
    sourceSha256
  });
  repository.register({
    jobKey,
    documentId: BASE_INPUT.documentId,
    sessionId: BASE_INPUT.sessionId,
    sourceSha256,
    pipelineVersion: "ocr-job-pipeline-v1",
    actor: BASE_INPUT.actor,
    requestId: BASE_INPUT.requestId
  });
  repository.transition(jobKey, OCR_JOB_STATES.PROCESSING);
  repository.transition(jobKey, OCR_JOB_STATES.RETRYABLE_ERROR, {
    lastError: { code: "TIMEOUT_RECOVERED", retryable: true }
  });
  let pipelineCalls = 0;
  const orchestrator = createOrchestrator({
    repository,
    maxAttempts: 1,
    pipeline: () => { pipelineCalls += 1; return pipelineResult(); }
  });

  await assert.rejects(
    orchestrator.process(BASE_INPUT),
    (error) => error instanceof OcrJobExecutionError
      && error.code === "TIMEOUT_RECOVERED"
      && error.attempts === 1
  );
  assert.equal(pipelineCalls, 0);
  assert.equal(repository.get(jobKey).state, OCR_JOB_STATES.FINAL_ERROR);
});
