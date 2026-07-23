import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PNG } from "pngjs";

import { TEMPLATE_GEOMETRY } from "../config/template-geometry.js";

const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const ALLOWED_COMMANDS = new Set(["sips", "/usr/bin/sips"]);

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError("El PDF debe proporcionarse como Buffer o Uint8Array");
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--help"], {
    encoding: "utf8",
    stdio: "ignore",
    timeout: 5_000
  });
  return result.status === 0 || result.status === 1;
}

function compositeTransparencyOnWhite(image) {
  let transparentPixelCount = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    if (alpha < 255) transparentPixelCount += 1;
    image.data[offset] = Math.round(((image.data[offset] * alpha) + (255 * (255 - alpha))) / 255);
    image.data[offset + 1] = Math.round(((image.data[offset + 1] * alpha) + (255 * (255 - alpha))) / 255);
    image.data[offset + 2] = Math.round(((image.data[offset + 2] * alpha) + (255 * (255 - alpha))) / 255);
    image.data[offset + 3] = 255;
  }
  return transparentPixelCount;
}

export function inspectLocalPdfRasterizer({ command = "sips" } = {}) {
  if (!ALLOWED_COMMANDS.has(command)) {
    return Object.freeze({
      available: false,
      command: null,
      adapter: "MACOS_SIPS_SINGLE_PAGE_V1",
      reason: "OCR_PDF_RASTERIZER_COMMAND_NOT_ALLOWED"
    });
  }
  const available = process.platform === "darwin" && commandAvailable(command);
  return Object.freeze({
    available,
    command,
    adapter: "MACOS_SIPS_SINGLE_PAGE_V1",
    reason: available ? null : "OCR_PDF_RASTERIZER_UNAVAILABLE"
  });
}

export function rasterizeSinglePagePdf(bytes, {
  command = "sips",
  targetLongEdge = TEMPLATE_GEOMETRY.source.height,
  timeoutMs = 30_000,
  temporaryRoot = tmpdir()
} = {}) {
  const buffer = asBuffer(bytes);
  if (buffer.length < PDF_SIGNATURE.length || !buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    const error = new TypeError("El archivo no tiene una firma PDF valida");
    error.code = "OCR_PDF_INVALID_SIGNATURE";
    throw error;
  }
  if (!Number.isInteger(targetLongEdge) || targetLongEdge < 1 || targetLongEdge > 4_000) {
    throw new TypeError("targetLongEdge debe ser un entero entre 1 y 4000");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs debe ser un entero entre 1000 y 60000");
  }

  const inspection = inspectLocalPdfRasterizer({ command });
  if (!inspection.available) {
    const error = new Error("No existe un rasterizador PDF local habilitado");
    error.code = inspection.reason;
    error.recoverable = true;
    throw error;
  }

  const temporaryDirectory = mkdtempSync(join(temporaryRoot, "kcm-ocr-pdf-"));
  const inputPath = join(temporaryDirectory, "input.pdf");
  const outputPath = join(temporaryDirectory, "page-1.png");
  try {
    writeFileSync(inputPath, buffer, { mode: 0o600 });
    execFileSync(command, [
      "-s", "format", "png",
      "-Z", String(targetLongEdge),
      inputPath,
      "--out", outputPath
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024
    });

    const image = PNG.sync.read(readFileSync(outputPath));
    const transparentPixelCount = compositeTransparencyOnWhite(image);
    return Object.freeze({
      bytes: PNG.sync.write(image),
      width: image.width,
      height: image.height,
      mimeType: "image/png",
      page: 1,
      adapter: inspection.adapter,
      transparencyComposited: transparentPixelCount > 0,
      transparentPixelCount
    });
  } catch (cause) {
    if (cause?.code?.startsWith?.("OCR_")) throw cause;
    const error = new Error("No fue posible rasterizar el PDF de una pagina");
    error.code = "OCR_PDF_RASTERIZATION_FAILED";
    error.recoverable = true;
    error.cause = cause;
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
