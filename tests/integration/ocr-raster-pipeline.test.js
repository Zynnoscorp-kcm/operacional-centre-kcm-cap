import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { runRasterOcrPipeline } from "../../src/ocr/raster-pipeline.js";
import { SimulatedOcrProvider } from "../../src/ocr/adapters/simulated-provider.js";
import { inspectLocalPdfRasterizer } from "../../src/ocr/preprocessing/pdf-rasterizer.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";

const referencePdf = new URL("../../referencias/formato/Formato_Control_Asistencia_OCR.pdf", import.meta.url);

test("pipeline raster aplica transformacion real antes del proveedor simulado", () => {
  const result = runRasterOcrPipeline({
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: "session-raster-001",
    documentId: "document-raster-001",
    evidenceId: "evidence-raster-001",
    actor: "tester@example.invalid",
    provider: new SimulatedOcrProvider(),
    allowSimulatedProvider: true,
    createdAt: "2026-07-21T12:00:00.000Z",
    employeeRoster: new Set(["01234"]),
    recognitionHints: [
      { rowIndex: 1, expectedDigits: "01234", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99] }
    ]
  });

  assert.equal(result.normalization.pixelTransformApplied, true);
  assert.equal(result.normalization.mode, "PIXEL_HOMOGRAPHY_V1");
  assert.equal(result.normalizedImage.width, 1216);
  assert.equal(result.normalizedImage.height, 2002);
  assert.match(result.normalizedImage.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.segmentation.digitCrops.length, 200);
  assert.equal(result.candidates[0].normalizedEmployeeId, "01234");
});

test("pipeline raster compone y normaliza PDF de una pagina", {
  skip: !existsSync(referencePdf) || !inspectLocalPdfRasterizer().available
}, () => {
  const result = runRasterOcrPipeline({
    bytes: readFileSync(referencePdf),
    declaredMimeType: "application/pdf",
    sessionId: "session-pdf-001",
    documentId: "document-pdf-001",
    evidenceId: "evidence-pdf-001",
    actor: "tester@example.invalid",
    provider: new SimulatedOcrProvider(),
    allowSimulatedProvider: true,
    createdAt: "2026-07-21T12:00:00.000Z",
    employeeRoster: new Set(["00001"]),
    recognitionHints: [
      { rowIndex: 1, expectedDigits: "00001", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99] }
    ]
  });

  assert.equal(result.document.mimeType, "application/pdf");
  assert.equal(result.rasterization.adapter, "MACOS_SIPS_SINGLE_PAGE_V1");
  assert.equal(result.rasterization.transparencyComposited, true);
  assert.equal(result.normalization.pixelTransformApplied, true);
  assert.equal(result.candidates[0].normalizedEmployeeId, "00001");
});
