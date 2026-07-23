import test from "node:test";
import assert from "node:assert/strict";

import {
  detectMimeType,
  inspectInputFile,
  validateInputFile
} from "../../src/ocr/preprocessing/file-validation.js";
import {
  createSyntheticAttendancePng,
  createSyntheticPdf
} from "../fixtures/synthetic/image-fixtures.js";

test("valida la firma real, resolucion y hash de un PNG sintetico", () => {
  const bytes = createSyntheticAttendancePng();
  const first = validateInputFile(bytes, { declaredMimeType: "image/png" });
  const second = validateInputFile(bytes, { declaredMimeType: "image/png" });

  assert.equal(detectMimeType(bytes), "image/png");
  assert.equal(first.valid, true);
  assert.deepEqual(first.dimensions, { width: 1216, height: 2002 });
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sha256, second.sha256);
});

test("rechaza discrepancia de MIME y resolucion insuficiente", () => {
  const bytes = createSyntheticAttendancePng({ width: 600, height: 900 });
  const inspection = inspectInputFile(bytes, { declaredMimeType: "image/jpeg" });

  assert.equal(inspection.valid, false);
  assert.ok(inspection.errors.includes("MIME_MISMATCH"));
  assert.ok(inspection.errors.includes("IMAGE_RESOLUTION_TOO_LOW"));
  assert.throws(
    () => validateInputFile(bytes, { declaredMimeType: "image/jpeg" }),
    (error) => error.code === "OCR_FILE_INVALID" && !error.message.includes(".png")
  );
});

test("acepta PDF de una pagina y bloquea PDF multipagina", () => {
  assert.equal(validateInputFile(createSyntheticPdf(), { declaredMimeType: "application/pdf" }).pageCount, 1);
  const multiple = inspectInputFile(createSyntheticPdf({ pages: 2 }), { declaredMimeType: "application/pdf" });
  assert.equal(multiple.valid, false);
  assert.ok(multiple.errors.includes("PDF_MULTIPAGE_NOT_ALLOWED"));
});

