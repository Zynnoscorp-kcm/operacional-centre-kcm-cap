import { CONTRACT_VERSION } from "../../shared/contracts.js";
import { createReviewBundle, createReviewEvidenceResolver } from "../review/review-bundle.js";
import { EvidenceStoreError } from "./in-memory-evidence-store.js";

export const REVIEW_EVIDENCE_STATUS = Object.freeze({
  COMPLETED: "COMPLETADA",
  NO_CHANGES: "SIN_CAMBIOS",
  RECOVERABLE: "RECUPERABLE"
});

export const REVIEW_EVIDENCE_VARIANTS = Object.freeze({
  VISUAL: "CROP_VISUAL",
  PROCESSED: "CROP_PROCESSED"
});

export class ReviewEvidenceProductionError extends Error {
  constructor(code, message, { cause, recoverable = false, state = null } = {}) {
    super(message, { cause });
    this.name = "ReviewEvidenceProductionError";
    this.code = code;
    this.recoverable = recoverable;
    this.state = state;
  }
}

function fail(code, message) {
  throw new ReviewEvidenceProductionError(code, message);
}

function requiredText(value, field, maxLength = 180) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maxLength) {
    fail("REVIEW_EVIDENCE_INPUT_INVALID", `${field} debe ser texto no vacio`);
  }
  if (/\p{Cc}/u.test(value)) fail("REVIEW_EVIDENCE_INPUT_INVALID", `${field} contiene caracteres de control`);
  return value;
}

function validDate(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail("REVIEW_EVIDENCE_CLOCK_INVALID", "El reloj produjo una fecha invalida");
  return date.toISOString();
}

function evidenceIdempotencyKey({ documentId, cropId, variant, sha256 }) {
  return [documentId, cropId, variant, sha256].join("|");
}

function evidenceMetadata({
  evidenceId,
  documentId,
  sessionId,
  candidateId,
  actor,
  createdAt,
  slot,
  variant,
  descriptor,
  kind
}) {
  return Object.freeze({
    evidenceId,
    sessionId,
    kind,
    sha256: descriptor.sha256,
    mimeType: descriptor.mimeType,
    immutable: true,
    createdBy: actor,
    createdAt,
    version: CONTRACT_VERSION,
    documentId,
    candidateId,
    cropId: slot.cropId,
    rowIndex: slot.rowIndex,
    digitIndex: slot.digitIndex,
    variant,
    width: descriptor.width,
    height: descriptor.height
  });
}

function recoveryState({ documentId, sessionId, requestId }) {
  return Object.freeze({
    documentId,
    sessionId,
    requestId,
    candidateEvidence: Object.freeze([]),
    evidenceCount: 0,
    effectiveWrites: 0,
    repeatedWrites: 0,
    status: REVIEW_EVIDENCE_STATUS.RECOVERABLE
  });
}

export class ReviewEvidenceProducer {
  #store;
  #clock;

  constructor({ store, clock = () => new Date() } = {}) {
    if (!store || typeof store.runTransaction !== "function") {
      throw new TypeError("ReviewEvidenceProducer requiere un EvidenceStore transaccional");
    }
    if (typeof clock !== "function") throw new TypeError("clock debe ser una funcion");
    this.#store = store;
    this.#clock = clock;
  }

  async produce({ documentId, sessionId, candidates, extraction, actor, requestId } = {}) {
    const safeInput = {
      documentId: requiredText(documentId, "documentId"),
      sessionId: requiredText(sessionId, "sessionId"),
      actor: requiredText(actor, "actor"),
      requestId: requiredText(requestId, "requestId")
    };
    const createdAt = validDate(this.#clock);
    let bundle;
    let resolver;
    try {
      bundle = createReviewBundle({ documentId: safeInput.documentId, candidates, extraction });
      resolver = createReviewEvidenceResolver({
        documentId: safeInput.documentId,
        candidates,
        extraction
      });
    } catch (cause) {
      throw new ReviewEvidenceProductionError(
        cause.code ?? "REVIEW_EVIDENCE_CONTRACT_INVALID",
        "No fue posible validar el contrato de evidencia OCR",
        { cause }
      );
    }

    try {
      const transaction = await this.#store.runTransaction((writer) => {
        let repeatedWrites = 0;
        const candidateEvidence = bundle.rows.map((row) => {
          const cropEvidenceRefs = row.slots.map((slot) => {
            const binary = resolver.resolve({ candidateId: row.candidateId, cropId: slot.cropId });
            const variants = [
              {
                variant: REVIEW_EVIDENCE_VARIANTS.VISUAL,
                kind: "OCR_CROP_VISUAL",
                descriptor: slot.visual,
                bytes: binary.visual.bytes
              },
              {
                variant: REVIEW_EVIDENCE_VARIANTS.PROCESSED,
                kind: "OCR_CROP_PROCESSED",
                descriptor: slot.processed,
                bytes: binary.processed.bytes
              }
            ];
            const ids = {};
            for (const item of variants) {
              const write = writer.put({
                idempotencyKey: evidenceIdempotencyKey({
                  documentId: safeInput.documentId,
                  cropId: slot.cropId,
                  variant: item.variant,
                  sha256: item.descriptor.sha256
                }),
                evidenceId: item.descriptor.ref,
                bytes: item.bytes,
                metadata: evidenceMetadata({
                  evidenceId: item.descriptor.ref,
                  documentId: safeInput.documentId,
                  sessionId: safeInput.sessionId,
                  candidateId: row.candidateId,
                  actor: safeInput.actor,
                  createdAt,
                  slot: { ...slot, rowIndex: row.rowIndex },
                  variant: item.variant,
                  descriptor: item.descriptor,
                  kind: item.kind
                })
              });
              if (write.repeated) repeatedWrites += 1;
              ids[item.variant] = write.evidenceId;
            }
            return Object.freeze({
              cropId: slot.cropId,
              digitIndex: slot.digitIndex,
              visualEvidenceId: ids[REVIEW_EVIDENCE_VARIANTS.VISUAL],
              processedEvidenceId: ids[REVIEW_EVIDENCE_VARIANTS.PROCESSED]
            });
          });
          if (cropEvidenceRefs.length !== 5) {
            fail("REVIEW_EVIDENCE_CARDINALITY_INVALID", "Cada candidato debe producir cinco referencias de casilla");
          }
          return Object.freeze({
            candidateId: row.candidateId,
            cropEvidenceRefs: Object.freeze(cropEvidenceRefs)
          });
        });
        return Object.freeze({ candidateEvidence: Object.freeze(candidateEvidence), repeatedWrites });
      });

      const evidenceCount = transaction.value.candidateEvidence.length * 5 * 2;
      return Object.freeze({
        documentId: safeInput.documentId,
        sessionId: safeInput.sessionId,
        requestId: safeInput.requestId,
        candidateEvidence: transaction.value.candidateEvidence,
        evidenceCount,
        effectiveWrites: transaction.summary.effectiveWrites,
        repeatedWrites: transaction.value.repeatedWrites,
        status: transaction.summary.effectiveWrites === 0
          ? REVIEW_EVIDENCE_STATUS.NO_CHANGES
          : REVIEW_EVIDENCE_STATUS.COMPLETED
      });
    } catch (cause) {
      if (cause instanceof ReviewEvidenceProductionError && !cause.recoverable) throw cause;
      const recoverable = cause instanceof EvidenceStoreError ? cause.recoverable : false;
      throw new ReviewEvidenceProductionError(
        recoverable ? "REVIEW_EVIDENCE_TRANSACTION_RECOVERABLE" : "REVIEW_EVIDENCE_WRITE_FAILED",
        recoverable
          ? "La evidencia no se guardo; el lote fue revertido y puede reintentarse"
          : "No fue posible guardar la evidencia OCR",
        {
          cause,
          recoverable,
          state: recoverable ? recoveryState(safeInput) : null
        }
      );
    }
  }
}
