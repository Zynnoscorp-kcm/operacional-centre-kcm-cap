import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TesseractDigitsProvider } from "../../src/ocr/adapters/tesseract-provider.js";
import { TEMPLATE_GEOMETRY } from "../../src/ocr/config/template-geometry.js";
import { normalizeRasterPixelsOrThrow } from "../../src/ocr/preprocessing/pixel-normalizer.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";
import { IMAGE_PIPELINE_VERSION } from "./runtime-metadata.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const TOOL_ENVIRONMENT = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });

export function validateSinglePagePdfInfo(output) {
  const text = String(output ?? "");
  const pages = text.match(/^Pages:\s+(\d+)\s*$/mi);
  const encrypted = text.match(/^Encrypted:\s+([^\s]+)\s*$/mi);
  if (!pages || Number(pages[1]) !== 1 || !encrypted || encrypted[1].toLowerCase() !== "no") {
    const error = new Error("La estructura PDF no esta permitida");
    error.code = "PDF_STRUCTURE_INVALID";
    throw error;
  }
  return Object.freeze({ pageCount: 1, encrypted: false });
}

export function rasterizePdfWithPdftoppm(bytes, {
  pdftoppmCommand = "/usr/bin/pdftoppm",
  pdfinfoCommand = "/usr/bin/pdfinfo",
  timeoutMs = 30_000,
  temporaryRoot = tmpdir(),
  execFile = execFileSync
} = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? "");
  if (buffer.length < PDF_SIGNATURE.length || !buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    const error = new Error("La estructura PDF no esta permitida");
    error.code = "PDF_STRUCTURE_INVALID";
    throw error;
  }
  if (pdftoppmCommand !== "/usr/bin/pdftoppm" || pdfinfoCommand !== "/usr/bin/pdfinfo") {
    throw new TypeError("Las herramientas PDF no estan permitidas");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs del rasterizador PDF es invalido");
  }
  if (typeof execFile !== "function") throw new TypeError("execFile debe ser una funcion");
  const temporaryDirectory = mkdtempSync(join(temporaryRoot, "kcm-ocr-worker-"));
  const inputPath = join(temporaryDirectory, "input.pdf");
  const outputPrefix = join(temporaryDirectory, "page");
  const outputPath = `${outputPrefix}.png`;
  let stage = "WRITE";
  try {
    writeFileSync(inputPath, buffer, { mode: 0o600 });
    stage = "PDFINFO";
    const pdfInfoOutput = execFile(pdfinfoCommand, [inputPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      maxBuffer: 256 * 1024,
      env: TOOL_ENVIRONMENT
    });
    validateSinglePagePdfInfo(pdfInfoOutput);
    stage = "PDFTOPPM";
    execFile(pdftoppmCommand, [
      "-f", "1",
      "-l", "1",
      "-singlefile",
      "-png",
      "-r", String(TEMPLATE_GEOMETRY.source.dpi),
      inputPath,
      outputPrefix
    ], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      env: TOOL_ENVIRONMENT,
      maxBuffer: 256 * 1024
    });
    stage = "READ_OUTPUT";
    const pngBytes = readFileSync(outputPath);
    if (pngBytes.length < PNG_SIGNATURE.length || !pngBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("El rasterizador no genero un PNG valido");
    }
    return Buffer.from(pngBytes);
  } catch (cause) {
    if (cause?.code === "PDF_STRUCTURE_INVALID") throw cause;
    if (stage === "PDFINFO") {
      const error = new Error("La estructura PDF no esta permitida");
      error.code = "PDF_STRUCTURE_INVALID";
      throw error;
    }
    const error = new Error("No fue posible rasterizar el PDF");
    error.code = "PDF_RASTERIZATION_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function reviewFlags(normalized) {
  const diagnostics = normalized.diagnostics;
  if (diagnostics.quadrilateralSource === "FULL_FRAME_FALLBACK" ||
      diagnostics.pageDetectionConfidence < 0.8 ||
      (diagnostics.warnings ?? []).length > 0) {
    return Object.freeze(["PAGE_ALIGNMENT_REVIEW_REQUIRED"]);
  }
  return Object.freeze([]);
}

export function createPipelineDocumentRecognizer({
  provider,
  providerFactory = () => new TesseractDigitsProvider({ includeBinaryArtifacts: true }),
  pdfRasterizer = rasterizePdfWithPdftoppm,
  normalizationOptions = {},
  runtimeMetadata = null
} = {}) {
  if (provider != null && typeof provider.recognize !== "function") throw new TypeError("provider debe implementar recognize");
  if (typeof providerFactory !== "function") throw new TypeError("providerFactory debe ser una funcion");
  if (typeof pdfRasterizer !== "function") throw new TypeError("pdfRasterizer debe ser una funcion");
  let recognitionProvider = provider ?? null;

  return async function recognizeDocument({ bytes, mimeType, templateVersion }) {
    if (templateVersion !== TEMPLATE_GEOMETRY.version) throw new TypeError("La version geometrica no coincide");
    const rasterBytes = mimeType === "application/pdf" ? await pdfRasterizer(bytes) : Buffer.from(bytes);
    const rasterMimeType = mimeType === "application/pdf" ? "image/png" : mimeType;
    const normalized = normalizeRasterPixelsOrThrow(rasterBytes, {
      declaredMimeType: rasterMimeType,
      ...normalizationOptions,
      targetWidth: TEMPLATE_GEOMETRY.source.width,
      targetHeight: TEMPLATE_GEOMETRY.source.height
    });
    const segmentation = segmentTemplate({ width: normalized.width, height: normalized.height });
    if (!recognitionProvider) recognitionProvider = providerFactory();
    const recognized = await recognitionProvider.recognize({
      segmentation,
      imageBytes: normalized.pngBytes,
      normalizedImage: normalized.pngBytes
    });
    if (!Array.isArray(recognized?.extraction?.crops) || recognized.extraction.crops.length !== 200) {
      const error = new Error("El proveedor OCR no devolvio evidencia binaria completa");
      error.code = "OCR_EVIDENCE_INCOMPLETE";
      throw error;
    }
    let runtime = null;
    if (runtimeMetadata != null) {
      if (recognized?.engine?.name !== runtimeMetadata.ocrEngineName ||
          recognized?.engine?.version !== runtimeMetadata.ocrEngineVersion ||
          runtimeMetadata.imagePipelineVersion !== IMAGE_PIPELINE_VERSION) {
        const error = new Error("El motor OCR efectivo no coincide con el runtime inspeccionado");
        error.code = "OCR_RUNTIME_MISMATCH";
        throw error;
      }
      runtime = Object.freeze({ ...runtimeMetadata, pdfToolsUsed: mimeType === "application/pdf" });
    }
    const flags = reviewFlags(normalized);
    const rows = recognized.rows.map((row) => Object.freeze({
      rowIndex: row.rowIndex,
      digits: row.digits,
      ...(flags.length ? { flags } : {})
    }));
    const cropPairs = recognized.extraction.crops.map((crop) => Object.freeze({
      cropId: crop.cropId,
      rowIndex: crop.rowIndex,
      digitIndex: crop.digitIndex,
      visual: Object.freeze({ mimeType: "image/png", bytes: Buffer.from(crop.visualPngBytes) }),
      processed: Object.freeze({ mimeType: "image/png", bytes: Buffer.from(crop.pngBytes) })
    }));
    return Object.freeze({ rows: Object.freeze(rows), cropPairs: Object.freeze(cropPairs), runtime });
  };
}
