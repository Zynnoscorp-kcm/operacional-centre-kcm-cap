import { createHash } from "node:crypto";

import { extractDigitCrops } from "../recognition/crop-extractor.js";
import {
  InMemoryOcrJobRepository,
  OCR_JOB_STATES,
  OcrJobRepositoryError
} from "./in-memory-job-repository.js";

export const OCR_JOB_PIPELINE_VERSION = "ocr-job-pipeline-v1";

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} es obligatorio`);
  return value.trim();
}

function inputBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new TypeError("bytes debe ser Buffer o Uint8Array");
  const bytes = Buffer.from(value);
  if (!bytes.length) throw new TypeError("bytes no puede estar vacio");
  return bytes;
}

function stableSourceHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function ocrJobKey({ documentId, sourceSha256, pipelineVersion = OCR_JOB_PIPELINE_VERSION }) {
  const payload = [
    requiredText(pipelineVersion, "pipelineVersion"),
    requiredText(documentId, "documentId"),
    requiredText(sourceSha256, "sourceSha256")
  ].join("\0");
  return `ocrjob_${createHash("sha256").update(payload).digest("base64url").slice(0, 36)}`;
}

function safeErrorCode(error) {
  const code = String(error?.code || "OCR_JOB_FAILED");
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "OCR_JOB_FAILED";
}

function publicCandidate(candidate, cropEvidenceRefs) {
  return Object.freeze({
    candidateId: String(candidate.candidateId),
    documentId: String(candidate.documentId),
    rowIndex: Number(candidate.rowIndex),
    rawDigits: String(candidate.rawDigits || ""),
    digitConfidences: Object.freeze([...(candidate.digitConfidences ?? [])].map(Number)),
    overallConfidence: Number(candidate.overallConfidence || 0),
    normalizedEmployeeId: String(candidate.normalizedEmployeeId || ""),
    decision: String(candidate.decision),
    validationFlags: Object.freeze([...(candidate.validationFlags ?? [])].map(String)),
    originalValue: String(candidate.originalValue || ""),
    correctedValue: String(candidate.correctedValue || ""),
    correctionAt: candidate.correctionAt ? String(candidate.correctionAt) : "",
    correctionReason: candidate.correctionReason ? String(candidate.correctionReason) : "",
    cropEvidenceRefs: Object.freeze(cropEvidenceRefs.map((reference) => Object.freeze({
      cropId: String(reference.cropId),
      digitIndex: Number(reference.digitIndex),
      visualEvidenceRef: String(reference.visualEvidenceRef || reference.visualEvidenceId || ""),
      processedEvidenceRef: String(reference.processedEvidenceRef || reference.processedEvidenceId || "")
    })))
  });
}

function normalizeEvidenceOutput(evidence, candidates) {
  const entries = evidence?.candidateEvidence;
  if (!Array.isArray(entries)) throw new TypeError("El productor de evidencia no devolvio candidateEvidence");
  const byCandidate = new Map();
  for (const entry of entries) {
    const candidateId = requiredText(entry?.candidateId, "candidateEvidence.candidateId");
    if (byCandidate.has(candidateId)) throw new TypeError("El productor de evidencia duplico candidateId");
    if (!Array.isArray(entry.cropEvidenceRefs) || entry.cropEvidenceRefs.length !== 5) {
      throw new TypeError("Cada candidato OCR debe conservar exactamente cinco referencias de casilla");
    }
    const digits = new Set();
    const crops = new Set();
    const refs = entry.cropEvidenceRefs.map((reference) => {
      const digitIndex = Number(reference.digitIndex);
      const cropId = requiredText(reference.cropId, "cropId");
      if (!Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex > 4 || digits.has(digitIndex) || crops.has(cropId)) {
        throw new TypeError("Las referencias de casilla son invalidas o duplicadas");
      }
      const visualRef = String(reference.visualEvidenceRef || reference.visualEvidenceId || "");
      const processedRef = String(reference.processedEvidenceRef || reference.processedEvidenceId || "");
      if (!visualRef || !processedRef || visualRef === processedRef) {
        throw new TypeError("Cada casilla requiere referencias visual y procesada separadas");
      }
      digits.add(digitIndex);
      crops.add(cropId);
      return reference;
    }).sort((left, right) => left.digitIndex - right.digitIndex);
    byCandidate.set(candidateId, refs);
  }
  const candidateIds = new Set(candidates.map((candidate) => String(candidate.candidateId)));
  if (byCandidate.size !== candidateIds.size || [...candidateIds].some((candidateId) => !byCandidate.has(candidateId))) {
    throw new TypeError("La evidencia no cubre todos los candidatos OCR");
  }
  return byCandidate;
}

function finiteNonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${field} debe ser un entero no negativo`);
  }
  return number;
}

function extractionFromPipeline(result) {
  if (result?.recognition?.extraction?.crops) return result.recognition.extraction;
  const normalizedBytes = result?.normalizedImage?.bytes;
  if (!normalizedBytes || !result?.segmentation) {
    throw new TypeError("El pipeline no conservo bytes normalizados para producir evidencia");
  }
  return extractDigitCrops({ imageBytes: normalizedBytes, segmentation: result.segmentation });
}

function publicResult(job, pipelineResult, evidence, byCandidate) {
  const candidates = pipelineResult.candidates.map((candidate) => publicCandidate(
    candidate,
    byCandidate.get(String(candidate.candidateId))
  ));
  const evidenceCount = finiteNonNegativeInteger(evidence.evidenceCount, "evidenceCount");
  const effectiveWrites = finiteNonNegativeInteger(evidence.effectiveWrites, "effectiveWrites");
  const repeatedWrites = finiteNonNegativeInteger(evidence.repeatedWrites, "repeatedWrites");
  if (evidenceCount !== candidates.length * 10 || effectiveWrites + repeatedWrites !== evidenceCount) {
    throw new TypeError("Los conteos del lote de evidencia no corresponden a sus candidatos");
  }
  const documentStatus = String(pipelineResult.document.status) === "REVISION_OCR"
    ? OCR_JOB_STATES.REVIEW
    : OCR_JOB_STATES.PROCESSED;
  return Object.freeze({
    job: Object.freeze({
      jobId: job.jobId,
      jobKey: job.jobKey,
      documentId: job.documentId,
      sessionId: job.sessionId,
      state: documentStatus,
      attempts: job.attempts,
      sourceSha256: job.sourceSha256,
      pipelineVersion: job.pipelineVersion
    }),
    document: Object.freeze({ ...pipelineResult.document, status: documentStatus }),
    processing: Object.freeze({ ...pipelineResult.processing }),
    normalizedSha256: String(pipelineResult.normalizedImage.sha256),
    candidates: Object.freeze(candidates),
    evidence: Object.freeze({
      evidenceCount,
      effectiveWrites,
      repeatedWrites,
      status: String(evidence.status || "COMPLETA")
    })
  });
}

export class OcrJobExecutionError extends Error {
  constructor(code, message, { retryable = false, attempts = 0, jobKey = null } = {}) {
    super(message);
    this.name = "OcrJobExecutionError";
    this.code = code;
    this.retryable = retryable;
    this.attempts = attempts;
    this.jobKey = jobKey;
  }
}

export class OcrJobOrchestrator {
  #pipeline;
  #evidenceProducer;
  #repository;
  #pending = new Map();
  #maxAttempts;
  #backoff;
  #pipelineVersion;

  constructor({
    pipeline,
    evidenceProducer,
    repository = new InMemoryOcrJobRepository(),
    maxAttempts = 3,
    backoff = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    pipelineVersion = OCR_JOB_PIPELINE_VERSION
  } = {}) {
    if (typeof pipeline !== "function") throw new TypeError("pipeline debe ser una funcion");
    if (!evidenceProducer || typeof evidenceProducer.produce !== "function") {
      throw new TypeError("evidenceProducer.produce es obligatorio");
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
      throw new TypeError("maxAttempts debe estar entre 1 y 5");
    }
    if (typeof backoff !== "function") throw new TypeError("backoff debe ser una funcion");
    this.#pipeline = pipeline;
    this.#evidenceProducer = evidenceProducer;
    this.#repository = repository;
    this.#maxAttempts = maxAttempts;
    this.#backoff = backoff;
    this.#pipelineVersion = requiredText(pipelineVersion, "pipelineVersion");
  }

  async process(input = {}) {
    const bytes = inputBytes(input.bytes);
    const documentId = requiredText(input.documentId, "documentId");
    const sessionId = requiredText(input.sessionId, "sessionId");
    const actor = requiredText(input.actor, "actor");
    const requestId = requiredText(input.requestId, "requestId");
    const sourceSha256 = stableSourceHash(bytes);
    const jobKey = ocrJobKey({ documentId, sourceSha256, pipelineVersion: this.#pipelineVersion });
    const existing = this.#repository.get(jobKey);
    if (existing?.result && [OCR_JOB_STATES.REVIEW, OCR_JOB_STATES.PROCESSED].includes(existing.state)) {
      return Object.freeze({ ...existing.result, repeated: true, concurrent: false });
    }
    if (existing?.state === OCR_JOB_STATES.FINAL_ERROR) {
      throw new OcrJobExecutionError(existing.lastError?.code || "OCR_JOB_FAILED", "El trabajo OCR ya termino con error", {
        retryable: false,
        attempts: existing.attempts,
        jobKey
      });
    }
    const inFlight = this.#pending.get(jobKey);
    if (inFlight) {
      const result = await inFlight;
      return Object.freeze({ ...result, repeated: true, concurrent: true });
    }

    let registration;
    try {
      registration = this.#repository.register({
        jobKey, documentId, sessionId, sourceSha256,
        pipelineVersion: this.#pipelineVersion, actor, requestId
      });
    } catch (error) {
      if (error instanceof OcrJobRepositoryError) throw error;
      throw error;
    }
    const execution = this.#execute({ ...input, bytes, documentId, sessionId, actor, requestId }, registration.job);
    this.#pending.set(jobKey, execution);
    try {
      return await execution;
    } finally {
      this.#pending.delete(jobKey);
    }
  }

  async #execute(input, initialJob) {
    const { jobKey, documentId, sessionId } = initialJob;
    let lastError = null;
    if (initialJob.attempts >= this.#maxAttempts) {
      const code = initialJob.lastError?.code || "OCR_JOB_ATTEMPTS_EXHAUSTED";
      if (initialJob.state === OCR_JOB_STATES.RETRYABLE_ERROR) {
        this.#repository.transition(jobKey, OCR_JOB_STATES.FINAL_ERROR, {
          lastError: { code, retryable: false }
        });
        this.#repository.appendAudit({
          jobKey, documentId, sessionId, actor: input.actor, requestId: input.requestId,
          action: "OCR_JOB_FAILED", previousState: OCR_JOB_STATES.RETRYABLE_ERROR,
          newState: OCR_JOB_STATES.FINAL_ERROR, reason: code
        });
      }
      throw new OcrJobExecutionError(code, "El trabajo OCR no pudo completarse", {
        retryable: false,
        attempts: initialJob.attempts,
        jobKey
      });
    }
    for (let attempt = initialJob.attempts + 1; attempt <= this.#maxAttempts; attempt += 1) {
      const before = this.#repository.get(jobKey);
      const processing = this.#repository.transition(jobKey, OCR_JOB_STATES.PROCESSING, { lastError: null });
      this.#repository.appendAudit({
        jobKey, documentId, sessionId, actor: input.actor, requestId: input.requestId,
        action: "OCR_JOB_STARTED", previousState: before.state, newState: OCR_JOB_STATES.PROCESSING,
        reason: `attempt:${attempt}`
      });
      try {
        const pipelineResult = await this.#pipeline({ ...input, includeNormalizedImageBytes: true });
        const extraction = extractionFromPipeline(pipelineResult);
        const evidence = await this.#evidenceProducer.produce({
          documentId,
          sessionId,
          candidates: pipelineResult.candidates,
          extraction,
          actor: input.actor,
          requestId: input.requestId
        });
        const byCandidate = normalizeEvidenceOutput(evidence, pipelineResult.candidates);
        const provisional = publicResult(processing, pipelineResult, evidence, byCandidate);
        const result = Object.freeze({
          ...provisional,
          repeated: false,
          concurrent: false
        });
        this.#repository.transition(jobKey, provisional.job.state, {
          result,
          lastError: null
        });
        this.#repository.appendAudit({
          jobKey, documentId, sessionId, actor: input.actor, requestId: input.requestId,
          action: "OCR_JOB_COMPLETED", previousState: OCR_JOB_STATES.PROCESSING,
          newState: provisional.job.state, reason: `evidence:${evidence.evidenceCount}`
        });
        return result;
      } catch (error) {
        const code = safeErrorCode(error);
        const retryable = error?.retryable === true || error?.recoverable === true;
        lastError = { code, retryable };
        this.#repository.appendError({
          jobKey, documentId, requestId: input.requestId, code, retryable, attempt
        });
        const canRetry = retryable && attempt < this.#maxAttempts;
        const state = canRetry ? OCR_JOB_STATES.RETRYABLE_ERROR : OCR_JOB_STATES.FINAL_ERROR;
        this.#repository.transition(jobKey, state, { lastError });
        this.#repository.appendAudit({
          jobKey, documentId, sessionId, actor: input.actor, requestId: input.requestId,
          action: canRetry ? "OCR_JOB_RETRY_SCHEDULED" : "OCR_JOB_FAILED",
          previousState: OCR_JOB_STATES.PROCESSING, newState: state, reason: code
        });
        if (!canRetry) {
          throw new OcrJobExecutionError(code, "El trabajo OCR no pudo completarse", {
            retryable, attempts: attempt, jobKey
          });
        }
        await this.#backoff(Math.min(2_000, 100 * (2 ** (attempt - 1))));
      }
    }
    throw new OcrJobExecutionError(lastError?.code || "OCR_JOB_FAILED", "El trabajo OCR no pudo completarse", {
      retryable: false,
      attempts: this.#maxAttempts,
      jobKey
    });
  }

  job(jobKey) {
    return this.#repository.get(jobKey);
  }

  audit(jobKey) {
    return this.#repository.auditFor(jobKey);
  }

  errors(jobKey) {
    return this.#repository.errorsFor(jobKey);
  }
}
