import { constants as fsConstants, accessSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { extractDigitCrops } from "../recognition/crop-extractor.js";

const PROVIDER_NAME = "LOCAL_TESSERACT_DIGITS_V1";
const DEFAULT_BINARY_CANDIDATES = Object.freeze([
  "/opt/homebrew/bin/tesseract",
  "tesseract"
]);

export class TesseractProviderError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = "TesseractProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isExecutableAbsolutePath(candidate) {
  if (!candidate.startsWith("/")) return true;
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function cleanVersion(stdout) {
  const firstLine = String(stdout ?? "").split(/\r?\n/, 1)[0].trim();
  const match = firstLine.match(/^tesseract\s+([0-9]+(?:\.[0-9]+){1,3}(?:[-+._a-z0-9]*)?)/i);
  return match ? match[1] : null;
}

export function detectTesseract({ candidates = DEFAULT_BINARY_CANDIDATES, timeoutMs = 3_000 } = {}) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate || !isExecutableAbsolutePath(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      maxBuffer: 128 * 1024
    });
    const version = probe.status === 0 ? cleanVersion(probe.stdout) : null;
    if (version) return Object.freeze({ available: true, binaryPath: candidate, version });
  }
  return Object.freeze({ available: false, binaryPath: null, version: null });
}

function parseTsv(stdout) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/);
  if (lines.length < 2) return Object.freeze({ digit: "", confidence: 0 });
  const candidates = [];
  for (const line of lines.slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const text = columns.slice(11).join("\t").replace(/[^0-9]/g, "");
    const confidence = Number(columns[10]);
    if (text && Number.isFinite(confidence) && confidence >= 0) candidates.push({ text, confidence });
  }
  candidates.sort((left, right) => right.confidence - left.confidence);
  if (!candidates.length || candidates[0].text.length !== 1) return Object.freeze({ digit: "", confidence: 0 });
  return Object.freeze({
    digit: candidates[0].text,
    confidence: Number(Math.max(0, Math.min(1, candidates[0].confidence / 100)).toFixed(6))
  });
}

function recognizeCrop(binaryPath, crop, { language, timeoutMs, psm }) {
  if (crop.isBlank) return Object.freeze({ digit: "", confidence: 0, skippedBlank: true });
  const invocation = spawnSync(binaryPath, [
    "stdin", "stdout",
    "--dpi", "300",
    "--psm", String(psm),
    "-l", language,
    "-c", "tessedit_char_whitelist=0123456789",
    "-c", "classify_bln_numeric_mode=1",
    "tsv"
  ], {
    input: crop.pngBytes,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    shell: false,
    maxBuffer: 512 * 1024
  });
  if (invocation.error?.code === "ETIMEDOUT" || invocation.signal) {
    throw new TesseractProviderError("TESSERACT_TIMEOUT", "El reconocimiento local excedio el tiempo permitido", { retryable: true });
  }
  if (invocation.error?.code === "ENOENT") {
    throw new TesseractProviderError("TESSERACT_UNAVAILABLE", "El motor OCR local no esta disponible");
  }
  if (invocation.error || invocation.status !== 0) {
    // stderr puede contener rutas o texto OCR; deliberadamente no se propaga.
    throw new TesseractProviderError("TESSERACT_FAILED", "El motor OCR local no pudo procesar un recorte", { retryable: true });
  }
  return parseTsv(invocation.stdout);
}

export class TesseractDigitsProvider {
  constructor({
    binaryPath,
    imageBytes,
    language = "eng",
    timeoutMs = 8_000,
    totalTimeoutMs = 60_000,
    psm = 10,
    cropOptions,
    includeBinaryArtifacts = false
  } = {}) {
    const detection = binaryPath
      ? detectTesseract({ candidates: [binaryPath] })
      : detectTesseract();
    if (!detection.available) throw new TesseractProviderError("TESSERACT_UNAVAILABLE", "El motor OCR local no esta disponible");
    if (!/^[a-z0-9_+-]{2,20}$/i.test(language)) throw new TypeError("El idioma OCR configurado es invalido");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new TypeError("timeoutMs esta fuera del intervalo permitido");
    if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 1_000 || totalTimeoutMs > 300_000) throw new TypeError("totalTimeoutMs esta fuera del intervalo permitido");
    if (!Number.isInteger(psm) || psm < 6 || psm > 13) throw new TypeError("psm no es apropiado para reconocimiento de digitos");
    this.providerName = PROVIDER_NAME;
    this.binaryPath = detection.binaryPath;
    this.version = detection.version;
    this.imageBytes = imageBytes ? Buffer.from(imageBytes) : null;
    this.language = language;
    this.timeoutMs = timeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.psm = psm;
    this.cropOptions = cropOptions;
    this.includeBinaryArtifacts = includeBinaryArtifacts === true;
  }

  recognize({ segmentation, imageBytes, normalizedImage, crops } = {}) {
    if (!segmentation?.templateMap?.rows) throw new TypeError("El proveedor Tesseract requiere una segmentacion de plantilla");
    const normalizedImageBytes = normalizedImage?.bytes ?? normalizedImage?.pngBytes ?? normalizedImage;
    const suppliedImage = normalizedImageBytes ?? imageBytes ?? this.imageBytes;
    const extraction = crops?.crops
      ? crops
      : Array.isArray(crops)
        ? Object.freeze({ source: null, options: null, crops: Object.freeze(crops) })
        : suppliedImage
          ? extractDigitCrops({ imageBytes: Buffer.from(suppliedImage), segmentation, options: this.cropOptions })
          : null;
    if (!extraction) throw new TypeError("El proveedor Tesseract requiere la imagen PNG normalizada o una lista de recortes");
    // Una segunda representacion compacta rescata curvas que Tesseract puede
    // perder al ampliar trazos muy gruesos. La salida principal y los artefactos
    // de revision siguen siendo los recortes ampliados.
    const compactExtraction = suppliedImage
      ? extractDigitCrops({
        imageBytes: Buffer.from(suppliedImage),
        segmentation,
        options: { ...this.cropOptions, scale: 1, padding: 40 }
      })
      : null;
    const compactByCrop = new Map((compactExtraction?.crops ?? []).map((crop) => [crop.cropId, crop]));
    const startedAt = performance.now();
    const recognizeWithBudget = (crop) => {
      const remainingMs = Math.floor(this.totalTimeoutMs - (performance.now() - startedAt));
      if (remainingMs < 100) {
        throw new TesseractProviderError("TESSERACT_TOTAL_TIMEOUT", "El reconocimiento local excedio el tiempo total permitido", { retryable: true });
      }
      return recognizeCrop(this.binaryPath, crop, {
        language: this.language,
        timeoutMs: Math.min(this.timeoutMs, remainingMs),
        psm: this.psm
      });
    };
    const recognitionByCrop = new Map(extraction.crops.map((crop) => {
      let recognition = recognizeWithBudget(crop);
      let recognitionPass = "ENLARGED";
      const compactCrop = compactByCrop.get(crop.cropId);
      if (!recognition.digit && compactCrop && !compactCrop.isBlank) {
        const compactRecognition = recognizeWithBudget(compactCrop);
        if (compactRecognition.digit) {
          recognition = compactRecognition;
          recognitionPass = "COMPACT_RETRY";
        }
      }
      return [crop.cropId, { ...recognition, recognitionPass, crop }];
    }));

    const rows = segmentation.templateMap.rows.map((row) => {
      const digits = row.digitBoxes.map((digitBox) => {
        const cropId = `r${String(row.rowIndex).padStart(2, "0")}-d${digitBox.digitIndex + 1}`;
        const recognition = recognitionByCrop.get(cropId);
        if (!recognition) throw new TypeError("La segmentacion no contiene todos los recortes esperados");
        return Object.freeze({
          cropId,
          digitIndex: digitBox.digitIndex,
          digit: recognition.digit,
          confidence: recognition.confidence,
          recognitionPass: recognition.recognitionPass,
          isBlank: recognition.crop.isBlank,
          cropSha256: recognition.crop.sha256
        });
      });
      const detected = digits.some((digit) => !digit.isBlank);
      const rawDigits = digits.map((digit) => digit.digit).join("");
      const digitConfidences = digits.map((digit) => digit.confidence);
      const overallConfidence = detected && digitConfidences.length
        ? Number(Math.min(...digitConfidences).toFixed(6))
        : 0;
      return Object.freeze({
        rowIndex: row.rowIndex,
        detected,
        rawDigits,
        digitConfidences: Object.freeze(digitConfidences),
        overallConfidence,
        digits: Object.freeze(digits),
        provider: this.providerName
      });
    });

    const artifacts = extraction.crops.map(({ pngBytes, visualPngBytes, ...metadata }) => Object.freeze(metadata));
    const output = {
      provider: this.providerName,
      engine: Object.freeze({ name: "tesseract", version: this.version }),
      rows: Object.freeze(rows),
      cropArtifacts: Object.freeze(artifacts),
      binaryArtifactsIncluded: this.includeBinaryArtifacts
    };
    if (this.includeBinaryArtifacts) output.extraction = extraction;
    return Object.freeze(output);
  }
}

export { PROVIDER_NAME as TESSERACT_PROVIDER_NAME };
