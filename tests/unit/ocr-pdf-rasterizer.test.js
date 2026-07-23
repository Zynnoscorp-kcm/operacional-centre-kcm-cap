import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { PNG } from "pngjs";

import {
  inspectLocalPdfRasterizer,
  rasterizeSinglePagePdf
} from "../../src/ocr/preprocessing/pdf-rasterizer.js";

const referencePdf = new URL("../../referencias/formato/Formato_Control_Asistencia_OCR.pdf", import.meta.url);

test("rasterizador PDF local compone transparencia sobre blanco", {
  skip: !existsSync(referencePdf) || !inspectLocalPdfRasterizer().available
}, () => {
  const result = rasterizeSinglePagePdf(readFileSync(referencePdf));
  const image = PNG.sync.read(result.bytes);
  let nonOpaquePixels = 0;
  let brightPixels = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] !== 255) nonOpaquePixels += 1;
    if (image.data[offset] > 245 && image.data[offset + 1] > 245 && image.data[offset + 2] > 245) brightPixels += 1;
  }

  assert.deepEqual([result.width, result.height], [1216, 2002]);
  assert.equal(result.transparencyComposited, true);
  assert.equal(nonOpaquePixels, 0);
  assert.ok(brightPixels / (image.width * image.height) > 0.7);
});

test("rasterizador PDF falla de forma recuperable sin adaptador", () => {
  assert.throws(
    () => rasterizeSinglePagePdf(Buffer.from("%PDF-1.4\n", "ascii"), { command: "comando-inexistente-kcm" }),
    (error) => error.code === "OCR_PDF_RASTERIZER_COMMAND_NOT_ALLOWED" && error.recoverable === true
  );
});
