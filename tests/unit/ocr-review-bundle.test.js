import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import { OCR_DECISIONS } from "../../src/shared/contracts.js";
import { encodeRasterPng } from "../../src/ocr/image/raster-codec.js";
import {
  createReviewBundle,
  createReviewEvidenceResolver,
  REVIEW_BUNDLE_VERSION,
  ReviewBundleError
} from "../../src/ocr/review/review-bundle.js";

const DOCUMENT_ID = "document-review-test";

function pngFixture(value) {
  const data = Buffer.alloc(4 * 4 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  const bytes = encodeRasterPng({ width: 4, height: 4, data });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function extractionFixture() {
  const processed = pngFixture(0);
  const visual = pngFixture(128);
  return {
    source: { width: 1216, height: 2002 },
    options: { edgeInkReviewRatio: 0.06 },
    crops: Array.from({ length: 40 }, (_, rowOffset) => Array.from({ length: 5 }, (_, digitIndex) => {
      const rowIndex = rowOffset + 1;
      return {
        cropId: `r${String(rowIndex).padStart(2, "0")}-d${digitIndex + 1}`,
        rowIndex,
        digitIndex,
        rect: { x: 10 + digitIndex, y: 20 + rowIndex, width: 20, height: 25 },
        visualRect: { x: 8 + digitIndex, y: 18 + rowIndex, width: 24, height: 30 },
        width: 4,
        height: 4,
        threshold: 127,
        inkRatio: rowIndex === 2 ? 0 : 0.2,
        edgeInkRatio: rowIndex === 2 ? 0 : 0.1,
        isBlank: rowIndex === 2,
        sha256: processed.sha256,
        pngBytes: Buffer.from(processed.bytes),
        visualWidth: 4,
        visualHeight: 4,
        visualSha256: visual.sha256,
        visualPngBytes: Buffer.from(visual.bytes)
      };
    })).flat()
  };
}

function candidate(rowIndex, overrides = {}) {
  return {
    candidateId: `${DOCUMENT_ID}:row:${String(rowIndex).padStart(2, "0")}`,
    documentId: DOCUMENT_ID,
    rowIndex,
    rawDigits: rowIndex === 1 ? "01234" : "",
    digitConfidences: rowIndex === 1 ? [0.99, 0.98, 0.97, 0.96, 0.95] : [0, 0, 0, 0, 0],
    overallConfidence: rowIndex === 1 ? 0.95 : 0,
    decision: rowIndex === 1 ? OCR_DECISIONS.REVIEW_REQUIRED : OCR_DECISIONS.REJECTED,
    validationFlags: rowIndex === 1 ? ["LOW_OVERALL_CONFIDENCE"] : ["BLANK_ROW"],
    displayName: "NO_DEBE_FILTRARSE",
    employeeRoster: ["NO_DEBE_FILTRARSE"],
    ...overrides
  };
}

test("crea bundle sanitizado con filas y cinco slots ordenados", () => {
  const bundle = createReviewBundle({
    documentId: DOCUMENT_ID,
    candidates: [candidate(2), candidate(1)],
    extraction: extractionFixture()
  });

  assert.equal(bundle.version, REVIEW_BUNDLE_VERSION);
  assert.deepEqual(bundle.rows.map((row) => row.rowIndex), [1, 2]);
  assert.equal(bundle.rows[0].slots.length, 5);
  assert.deepEqual(bundle.rows[0].slots.map((slot) => [slot.cropId, slot.digitIndex]), [
    ["r01-d1", 0], ["r01-d2", 1], ["r01-d3", 2], ["r01-d4", 3], ["r01-d5", 4]
  ]);
  assert.deepEqual(bundle.counts, {
    rows: 2,
    slots: 10,
    blankSlots: 5,
    flaggedRows: 2,
    decisions: { autoAccepted: 0, reviewRequired: 1, rejected: 1 }
  });
  assert.match(bundle.rows[0].candidateRef, /^candidate_[A-Za-z0-9_-]{28}$/);
  assert.match(bundle.rows[0].slots[0].visual.ref, /^ev_[A-Za-z0-9_-]{32}$/);
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /NO_DEBE_FILTRARSE|employeeRoster|displayName|pngBytes|visualPngBytes|"bytes"/);
});

test("resolvedor devuelve copias defensivas visual y procesada", () => {
  const extraction = extractionFixture();
  const candidates = [candidate(1, { candidateId: "candidate-custom-one" })];
  const resolver = createReviewEvidenceResolver({ documentId: DOCUMENT_ID, extraction, candidates });
  const first = resolver.resolve({ candidateId: "candidate-custom-one", cropId: "r01-d1" });

  assert.equal(first.mimeType, "image/png");
  assert.match(first.visual.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Buffer.isBuffer(first.visual.bytes));
  assert.ok(Buffer.isBuffer(first.processed.bytes));
  const originalByte = first.visual.bytes[0];
  first.visual.bytes[0] = 0;
  const second = resolver.resolve({ candidateId: "candidate-custom-one", cropId: "r01-d1" });
  assert.equal(second.visual.bytes[0], originalByte);
  assert.notStrictEqual(first.visual.bytes, second.visual.bytes);
});

test("resolvedor canónico enlaza candidateId y cropId a la misma fila", () => {
  const resolver = createReviewEvidenceResolver({ documentId: DOCUMENT_ID, extraction: extractionFixture() });
  assert.equal(
    resolver.resolve({ candidateId: `${DOCUMENT_ID}:row:40`, cropId: "r40-d5" }).cropId,
    "r40-d5"
  );
  assert.throws(
    () => resolver.resolve({ candidateId: `${DOCUMENT_ID}:row:01`, cropId: "r02-d1" }),
    (error) => error instanceof ReviewBundleError && error.code === "REVIEW_CANDIDATE_CROP_MISMATCH"
  );
  assert.throws(
    () => resolver.resolve({ candidateId: `${DOCUMENT_ID}:row:01`, cropId: "../../r01-d1" }),
    (error) => error instanceof ReviewBundleError && error.code === "REVIEW_CROP_ID_UNSAFE"
  );
});

test("rechaza duplicados, cardinalidad incompleta y hashes alterados", () => {
  const extraction = extractionFixture();
  assert.throws(
    () => createReviewBundle({ documentId: DOCUMENT_ID, candidates: [candidate(1), candidate(1)], extraction }),
    (error) => error.code === "REVIEW_CANDIDATE_DUPLICATE" || error.code === "REVIEW_ROW_DUPLICATE"
  );
  assert.throws(
    () => createReviewBundle({
      documentId: DOCUMENT_ID,
      candidates: [candidate(1)],
      extraction: { ...extraction, crops: extraction.crops.slice(0, -1) }
    }),
    (error) => error.code === "REVIEW_CROP_CARDINALITY_INVALID"
  );
  const altered = extractionFixture();
  altered.crops[0].pngBytes[altered.crops[0].pngBytes.length - 1] ^= 1;
  assert.throws(
    () => createReviewEvidenceResolver({ documentId: DOCUMENT_ID, extraction: altered }),
    (error) => error.code === "REVIEW_EVIDENCE_HASH_MISMATCH"
  );
});

test("rechaza IDs inseguros, posiciones inconsistentes y documentos ajenos", () => {
  const extraction = extractionFixture();
  assert.throws(
    () => createReviewBundle({ documentId: "../document", candidates: [], extraction }),
    (error) => error.code === "REVIEW_ID_UNSAFE"
  );
  const inconsistent = extractionFixture();
  inconsistent.crops[0].digitIndex = 4;
  assert.throws(
    () => createReviewBundle({ documentId: DOCUMENT_ID, candidates: [candidate(1)], extraction: inconsistent }),
    (error) => error.code === "REVIEW_CROP_POSITION_MISMATCH"
  );
  assert.throws(
    () => createReviewBundle({
      documentId: DOCUMENT_ID,
      candidates: [candidate(1, { documentId: "other-document" })],
      extraction
    }),
    (error) => error.code === "REVIEW_DOCUMENT_MISMATCH"
  );
});

