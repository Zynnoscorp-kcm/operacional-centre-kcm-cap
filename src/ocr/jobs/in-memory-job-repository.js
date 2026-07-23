import { randomUUID } from "node:crypto";

export const OCR_JOB_STATES = Object.freeze({
  PENDING: "PENDIENTE",
  PROCESSING: "OCR_EN_PROCESO",
  REVIEW: "REVISION_OCR",
  PROCESSED: "PROCESADO",
  RETRYABLE_ERROR: "ERROR_REINTENTABLE",
  FINAL_ERROR: "ERROR_FINAL"
});

const FINAL_STATES = new Set([OCR_JOB_STATES.REVIEW, OCR_JOB_STATES.PROCESSED, OCR_JOB_STATES.FINAL_ERROR]);
const TRANSITIONS = Object.freeze({
  [OCR_JOB_STATES.PENDING]: Object.freeze([OCR_JOB_STATES.PROCESSING]),
  [OCR_JOB_STATES.PROCESSING]: Object.freeze([
    OCR_JOB_STATES.REVIEW,
    OCR_JOB_STATES.PROCESSED,
    OCR_JOB_STATES.RETRYABLE_ERROR,
    OCR_JOB_STATES.FINAL_ERROR
  ]),
  [OCR_JOB_STATES.RETRYABLE_ERROR]: Object.freeze([OCR_JOB_STATES.PROCESSING, OCR_JOB_STATES.FINAL_ERROR]),
  [OCR_JOB_STATES.REVIEW]: Object.freeze([]),
  [OCR_JOB_STATES.PROCESSED]: Object.freeze([]),
  [OCR_JOB_STATES.FINAL_ERROR]: Object.freeze([])
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function snapshot(value) {
  return Object.freeze(clone(value));
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} es obligatorio`);
  return value.trim();
}

export class OcrJobRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OcrJobRepositoryError";
    this.code = code;
  }
}

export class InMemoryOcrJobRepository {
  #jobs = new Map();
  #jobKeyByDocument = new Map();
  #audit = [];
  #errors = [];
  #now;
  #idFactory;

  constructor({ now = () => new Date().toISOString(), idFactory = () => randomUUID() } = {}) {
    this.#now = now;
    this.#idFactory = idFactory;
  }

  register({ jobKey, documentId, sessionId, sourceSha256, pipelineVersion, actor, requestId }) {
    const key = requiredText(jobKey, "jobKey");
    const existing = this.#jobs.get(key);
    if (existing) return Object.freeze({ created: false, job: snapshot(existing) });
    const safeDocumentId = requiredText(documentId, "documentId");
    const documentKey = this.#jobKeyByDocument.get(safeDocumentId);
    if (documentKey && documentKey !== key) {
      throw new OcrJobRepositoryError(
        "OCR_DOCUMENT_CONTENT_CONFLICT",
        "El documento OCR ya fue registrado con otro contenido o version de pipeline"
      );
    }
    const timestamp = this.#now();
    const job = {
      jobId: `ocr-job-${this.#idFactory()}`,
      jobKey: key,
      documentId: safeDocumentId,
      sessionId: requiredText(sessionId, "sessionId"),
      sourceSha256: requiredText(sourceSha256, "sourceSha256"),
      pipelineVersion: requiredText(pipelineVersion, "pipelineVersion"),
      state: OCR_JOB_STATES.PENDING,
      attempts: 0,
      actor: requiredText(actor, "actor"),
      firstRequestId: requiredText(requestId, "requestId"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      result: null,
      lastError: null
    };
    this.#jobs.set(key, job);
    this.#jobKeyByDocument.set(safeDocumentId, key);
    return Object.freeze({ created: true, job: snapshot(job) });
  }

  get(jobKey) {
    const job = this.#jobs.get(String(jobKey));
    return job ? snapshot(job) : null;
  }

  transition(jobKey, nextState, patch = {}) {
    const key = requiredText(jobKey, "jobKey");
    const job = this.#jobs.get(key);
    if (!job) throw new OcrJobRepositoryError("OCR_JOB_NOT_FOUND", "El trabajo OCR no existe");
    if (!(TRANSITIONS[job.state] ?? []).includes(nextState)) {
      throw new OcrJobRepositoryError(
        "OCR_JOB_TRANSITION_INVALID",
        `Transicion OCR no permitida: ${job.state} -> ${nextState}`
      );
    }
    Object.assign(job, clone(patch), { state: nextState, updatedAt: this.#now() });
    if (nextState === OCR_JOB_STATES.PROCESSING) job.attempts += 1;
    if (FINAL_STATES.has(nextState)) job.completedAt = this.#now();
    return snapshot(job);
  }

  appendAudit(input) {
    const event = Object.freeze({
      eventId: `ocr-audit-${this.#idFactory()}`,
      timestamp: this.#now(),
      jobKey: requiredText(input.jobKey, "jobKey"),
      documentId: requiredText(input.documentId, "documentId"),
      sessionId: requiredText(input.sessionId, "sessionId"),
      actor: requiredText(input.actor, "actor"),
      requestId: requiredText(input.requestId, "requestId"),
      action: requiredText(input.action, "action"),
      previousState: input.previousState == null ? null : String(input.previousState),
      newState: input.newState == null ? null : String(input.newState),
      reason: input.reason == null ? null : String(input.reason)
    });
    this.#audit.push(event);
    return snapshot(event);
  }

  appendError(input) {
    const error = Object.freeze({
      errorId: `ocr-error-${this.#idFactory()}`,
      timestamp: this.#now(),
      jobKey: requiredText(input.jobKey, "jobKey"),
      documentId: requiredText(input.documentId, "documentId"),
      requestId: requiredText(input.requestId, "requestId"),
      code: requiredText(input.code, "code"),
      retryable: input.retryable === true,
      attempt: Number(input.attempt)
    });
    this.#errors.push(error);
    return snapshot(error);
  }

  auditFor(jobKey) {
    return Object.freeze(this.#audit.filter((event) => event.jobKey === String(jobKey)).map(snapshot));
  }

  errorsFor(jobKey) {
    return Object.freeze(this.#errors.filter((error) => error.jobKey === String(jobKey)).map(snapshot));
  }
}

export function isFinalOcrJobState(state) {
  return FINAL_STATES.has(state);
}
