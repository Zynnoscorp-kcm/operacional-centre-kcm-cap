import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import { PNG } from "pngjs";

import {
  InMemoryEvidenceStore,
  ReviewEvidenceProducer,
  REVIEW_EVIDENCE_STATUS
} from "../../src/ocr/evidence/index.js";
import { OCR_DECISIONS } from "../../src/shared/contracts.js";

const DOCUMENT_ID = "document-synthetic-evidence";
const SESSION_ID = "session-synthetic-evidence";
const ACTOR = "operator.synthetic@example.invalid";

function pngFixture(color) {
  const png = new PNG({ width: 3, height: 4 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = color;
    png.data[offset + 1] = color;
    png.data[offset + 2] = color;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

function extractionFixture() {
  const processed = pngFixture(0);
  const visual = pngFixture(140);
  const processedSha = createHash("sha256").update(processed).digest("hex");
  const visualSha = createHash("sha256").update(visual).digest("hex");
  const crops = [];
  for (let rowIndex = 1; rowIndex <= 40; rowIndex += 1) {
    for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
      crops.push(Object.freeze({
        cropId: `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`,
        rowIndex,
        digitIndex,
        rect: Object.freeze({ x: digitIndex * 4, y: rowIndex * 5, width: 3, height: 4 }),
        visualRect: Object.freeze({ x: digitIndex * 4, y: rowIndex * 5, width: 3, height: 4 }),
        pngBytes: Buffer.from(processed),
        width: 3,
        height: 4,
        sha256: processedSha,
        visualPngBytes: Buffer.from(visual),
        visualWidth: 3,
        visualHeight: 4,
        visualSha256: visualSha,
        threshold: 127,
        inkRatio: 0.25,
        edgeInkRatio: 0.02,
        isBlank: false
      }));
    }
  }
  return Object.freeze({ crops: Object.freeze(crops) });
}

function candidatesFixture() {
  return Object.freeze([1, 2].map((rowIndex) => Object.freeze({
    candidateId: `${DOCUMENT_ID}:row:${String(rowIndex).padStart(2, "0")}`,
    documentId: DOCUMENT_ID,
    rowIndex,
    rawDigits: rowIndex === 1 ? "01234" : "56789",
    digitConfidences: Object.freeze([0.99, 0.98, 0.97, 0.96, 0.95]),
    overallConfidence: 0.95,
    decision: OCR_DECISIONS.REVIEW_REQUIRED,
    validationFlags: Object.freeze(["SYNTHETIC_REVIEW"])
  })));
}

function input(requestId = "request-evidence-1") {
  return {
    documentId: DOCUMENT_ID,
    sessionId: SESSION_ID,
    candidates: candidatesFixture(),
    extraction: extractionFixture(),
    actor: ACTOR,
    requestId
  };
}

function containsBinary(value, seen = new Set()) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((nested) => containsBinary(nested, seen));
}

test("produce cinco pares de referencias por candidato y conserva binarios fuera del DTO", async () => {
  const store = new InMemoryEvidenceStore();
  const producer = new ReviewEvidenceProducer({
    store,
    clock: () => new Date("2026-07-21T15:00:00.000Z")
  });
  const result = await producer.produce(input());

  assert.equal(result.status, REVIEW_EVIDENCE_STATUS.COMPLETED);
  assert.equal(result.candidateEvidence.length, 2);
  assert.equal(result.candidateEvidence.every((item) => item.cropEvidenceRefs.length === 5), true);
  assert.equal(result.evidenceCount, 20);
  assert.equal(result.effectiveWrites, 20);
  assert.equal(result.repeatedWrites, 0);
  assert.equal(store.size, 20);
  assert.equal(containsBinary(result), false);

  const firstRef = result.candidateEvidence[0].cropEvidenceRefs[0];
  const visual = store.getMetadata(firstRef.visualEvidenceId);
  const processed = store.getMetadata(firstRef.processedEvidenceId);
  assert.equal(visual.kind, "OCR_CROP_VISUAL");
  assert.equal(visual.variant, "CROP_VISUAL");
  assert.equal(processed.kind, "OCR_CROP_PROCESSED");
  assert.equal(processed.variant, "CROP_PROCESSED");
  assert.equal(visual.documentId, DOCUMENT_ID);
  assert.equal(visual.sessionId, SESSION_ID);
  assert.equal(visual.cropId, "r01-d1");
  assert.equal(visual.digitIndex, 0);
  assert.equal(visual.immutable, true);
  assert.match(visual.driveFileId, /^mem_/);
  assert.equal(containsBinary(store.listMetadata()), false);
  assert.equal(store.readBytes(firstRef.visualEvidenceId).subarray(1, 4).toString("ascii"), "PNG");
});

test("un reintento reutiliza documentId+cropId+variant+sha sin duplicar evidencia", async () => {
  const store = new InMemoryEvidenceStore();
  let tick = 0;
  const producer = new ReviewEvidenceProducer({
    store,
    clock: () => new Date(`2026-07-21T15:00:0${tick++}.000Z`)
  });
  const first = await producer.produce(input("request-first"));
  const repeated = await producer.produce(input("request-repeated"));

  assert.equal(first.effectiveWrites, 20);
  assert.equal(repeated.status, REVIEW_EVIDENCE_STATUS.NO_CHANGES);
  assert.equal(repeated.effectiveWrites, 0);
  assert.equal(repeated.repeatedWrites, 20);
  assert.equal(store.size, 20);
  assert.deepEqual(repeated.candidateEvidence, first.candidateEvidence);
});

test("dos productores concurrentes materializan un solo conjunto efectivo", async () => {
  const store = new InMemoryEvidenceStore();
  const producer = new ReviewEvidenceProducer({ store });
  const results = await Promise.all([
    producer.produce(input("request-concurrent-a")),
    producer.produce(input("request-concurrent-b"))
  ]);

  assert.deepEqual(results.map((item) => item.effectiveWrites).sort((a, b) => a - b), [0, 20]);
  assert.deepEqual(results.map((item) => item.repeatedWrites).sort((a, b) => a - b), [0, 20]);
  assert.equal(store.size, 20);
  assert.deepEqual(results[0].candidateEvidence, results[1].candidateEvidence);
});

test("un fallo parcial revierte el lote, publica estado recuperable y permite reintento", async () => {
  const store = new InMemoryEvidenceStore();
  const producer = new ReviewEvidenceProducer({ store });
  store.failNextCommitAfter(3);

  await assert.rejects(
    producer.produce(input("request-failing")),
    (error) => {
      assert.equal(error.code, "REVIEW_EVIDENCE_TRANSACTION_RECOVERABLE");
      assert.equal(error.recoverable, true);
      assert.equal(error.cause.rolledBack, true);
      assert.equal(error.state.status, REVIEW_EVIDENCE_STATUS.RECOVERABLE);
      assert.equal(error.state.effectiveWrites, 0);
      assert.equal(containsBinary(error.state), false);
      return true;
    }
  );
  assert.equal(store.size, 0);

  const recovered = await producer.produce(input("request-recovery"));
  assert.equal(recovered.status, REVIEW_EVIDENCE_STATUS.COMPLETED);
  assert.equal(recovered.effectiveWrites, 20);
  assert.equal(store.size, 20);
});
