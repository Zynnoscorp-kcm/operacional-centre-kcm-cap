import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";

const DEFAULT_OPTIONS = Object.freeze({
  scale: 6,
  padding: 18,
  rawScale: 4,
  blankInkRatio: 0.01,
  edgeInkReviewRatio: 0.06,
  innerInset: 2
});

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} debe ser un entero positivo`);
  return value;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function grayscaleAt(image, x, y) {
  const offset = ((y * image.width) + x) * 4;
  const alpha = image.data[offset + 3] / 255;
  const onWhite = (channel) => (image.data[offset + channel] * alpha) + (255 * (1 - alpha));
  return clampByte((onWhite(0) * 0.299) + (onWhite(1) * 0.587) + (onWhite(2) * 0.114));
}

function otsuThreshold(grayscale) {
  const histogram = new Uint32Array(256);
  for (const value of grayscale) histogram[value] += 1;
  const count = grayscale.length;
  let weightedTotal = 0;
  for (let level = 0; level < 256; level += 1) weightedTotal += level * histogram[level];

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 127;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = count - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * ((backgroundMean - foregroundMean) ** 2);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  // Un umbral extremo suele significar fondo uniforme; 210 conserva trazos tenues.
  return Math.max(70, Math.min(210, bestThreshold));
}

function grayscaleRect(image, rect) {
  const grayscale = new Uint8Array(rect.width * rect.height);
  let cursor = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      grayscale[cursor] = grayscaleAt(image, x, y);
      cursor += 1;
    }
  }
  return grayscale;
}

function inkMetrics(grayscale) {
  const threshold = otsuThreshold(grayscale);
  let darkPixels = 0;
  for (const value of grayscale) if (value <= threshold) darkPixels += 1;
  return {
    threshold,
    inkRatio: Number((darkPixels / grayscale.length).toFixed(6))
  };
}

function validateRect(rect, image) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new TypeError("La segmentacion contiene un rectangulo invalido");
  }
  const normalized = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
  assertPositiveInteger(normalized.width, "rect.width");
  assertPositiveInteger(normalized.height, "rect.height");
  if (normalized.x < 0 || normalized.y < 0 || normalized.x + normalized.width > image.width || normalized.y + normalized.height > image.height) {
    throw new RangeError("La segmentacion queda fuera de la imagen normalizada");
  }
  return normalized;
}

function insetRect(rect, inset) {
  if (inset === 0) return rect;
  if ((inset * 2) >= rect.width || (inset * 2) >= rect.height) {
    throw new RangeError("innerInset deja un recorte sin area util");
  }
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: rect.width - (inset * 2),
    height: rect.height - (inset * 2)
  };
}

function encodeThresholdedCrop(image, rect, { scale, padding, blankInkRatio }) {
  const grayscale = grayscaleRect(image, rect);
  const { threshold, inkRatio } = inkMetrics(grayscale);
  const output = new PNG({ width: (rect.width * scale) + (padding * 2), height: (rect.height * scale) + (padding * 2) });
  output.data.fill(255);
  const binary = Uint8Array.from(grayscale, (value) => (value <= threshold ? 0 : 255));
  const scaledWidth = rect.width * scale;
  const scaledHeight = rect.height * scale;
  // La interpolacion bilineal evita convertir cada pixel manuscrito en un bloque
  // grueso; Tesseract conserva mejor curvas como 0, 2, 6, 8 y 9.
  for (let outputY = 0; outputY < scaledHeight; outputY += 1) {
    const sourceY = ((outputY + 0.5) / scale) - 0.5;
    const y0 = Math.max(0, Math.min(rect.height - 1, Math.floor(sourceY)));
    const y1 = Math.max(0, Math.min(rect.height - 1, y0 + 1));
    const yWeight = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));
    for (let outputX = 0; outputX < scaledWidth; outputX += 1) {
      const sourceX = ((outputX + 0.5) / scale) - 0.5;
      const x0 = Math.max(0, Math.min(rect.width - 1, Math.floor(sourceX)));
      const x1 = Math.max(0, Math.min(rect.width - 1, x0 + 1));
      const xWeight = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      const top = (binary[(y0 * rect.width) + x0] * (1 - xWeight)) + (binary[(y0 * rect.width) + x1] * xWeight);
      const bottom = (binary[(y1 * rect.width) + x0] * (1 - xWeight)) + (binary[(y1 * rect.width) + x1] * xWeight);
      const color = clampByte((top * (1 - yWeight)) + (bottom * yWeight));
      const finalX = padding + outputX;
      const finalY = padding + outputY;
      const outputOffset = ((finalY * output.width) + finalX) * 4;
      output.data[outputOffset] = color;
      output.data[outputOffset + 1] = color;
      output.data[outputOffset + 2] = color;
      output.data[outputOffset + 3] = 255;
    }
  }
  const pngBytes = PNG.sync.write(output, { colorType: 0, inputColorType: 6, bitDepth: 8 });
  return Object.freeze({
    pngBytes,
    width: output.width,
    height: output.height,
    threshold,
    inkRatio,
    isBlank: inkRatio < blankInkRatio,
    sha256: createHash("sha256").update(pngBytes).digest("hex")
  });
}

function encodeVisualCrop(image, rect, scale) {
  const output = new PNG({ width: rect.width * scale, height: rect.height * scale });
  for (let outputY = 0; outputY < output.height; outputY += 1) {
    const sourceY = rect.y + Math.min(rect.height - 1, Math.floor(outputY / scale));
    for (let outputX = 0; outputX < output.width; outputX += 1) {
      const sourceX = rect.x + Math.min(rect.width - 1, Math.floor(outputX / scale));
      const gray = grayscaleAt(image, sourceX, sourceY);
      const offset = ((outputY * output.width) + outputX) * 4;
      output.data[offset] = gray;
      output.data[offset + 1] = gray;
      output.data[offset + 2] = gray;
      output.data[offset + 3] = 255;
    }
  }
  const pngBytes = PNG.sync.write(output);
  return Object.freeze({
    pngBytes,
    width: output.width,
    height: output.height,
    sha256: createHash("sha256").update(pngBytes).digest("hex")
  });
}

/**
 * Extrae y prepara cada casilla ya alineada. La funcion no escribe en disco;
 * devuelve PNGs binarios que pueden mostrarse en revision o enviarse al OCR.
 */
export function extractDigitCrops({ imageBytes, segmentation, options = {} }) {
  if (!Buffer.isBuffer(imageBytes) && !(imageBytes instanceof Uint8Array)) {
    throw new TypeError("imageBytes debe ser Buffer o Uint8Array");
  }
  if (!segmentation?.digitCrops || !Array.isArray(segmentation.digitCrops)) {
    throw new TypeError("Se requiere la segmentacion de casillas");
  }
  const settings = { ...DEFAULT_OPTIONS, ...options };
  assertPositiveInteger(settings.scale, "scale");
  assertPositiveInteger(settings.padding, "padding");
  assertPositiveInteger(settings.rawScale, "rawScale");
  if (settings.scale > 12 || settings.rawScale > 8 || settings.padding > 128) {
    throw new RangeError("La ampliacion o padding del recorte excede el limite seguro");
  }
  if (!Number.isInteger(settings.innerInset) || settings.innerInset < 0) {
    throw new TypeError("innerInset debe ser un entero no negativo");
  }
  if (settings.innerInset > 8) throw new RangeError("innerInset excede el limite seguro");
  for (const name of ["blankInkRatio", "edgeInkReviewRatio"]) {
    if (!Number.isFinite(settings[name]) || settings[name] < 0 || settings[name] > 1) {
      throw new TypeError(`${name} debe estar entre cero y uno`);
    }
  }

  let image;
  try {
    image = PNG.sync.read(Buffer.from(imageBytes), { checkCRC: true });
  } catch {
    throw new TypeError("No fue posible decodificar la imagen PNG normalizada");
  }

  if (segmentation.digitCrops.length > 200) throw new RangeError("La segmentacion excede 200 casillas");
  const cropIds = new Set();
  const crops = segmentation.digitCrops.map((crop) => {
    const cropId = String(crop.cropId);
    if (cropIds.has(cropId)) throw new TypeError(`cropId duplicado: ${cropId}`);
    cropIds.add(cropId);
    const recognitionRect = validateRect(crop.recognitionRect, image);
    const visualRect = validateRect(crop.visualRect, image);
    const rect = insetRect(recognitionRect, settings.innerInset);
    const processed = encodeThresholdedCrop(image, rect, settings);
    const edgeInk = inkMetrics(grayscaleRect(image, recognitionRect));
    const visual = encodeVisualCrop(image, visualRect, settings.rawScale);
    const isBlank = processed.inkRatio < settings.blankInkRatio
      && edgeInk.inkRatio < settings.edgeInkReviewRatio;
    return Object.freeze({
      cropId,
      rowIndex: Number(crop.rowIndex),
      digitIndex: Number(crop.digitIndex),
      rect: Object.freeze(rect),
      visualRect: Object.freeze(visualRect),
      ...processed,
      isBlank,
      edgeInkRatio: edgeInk.inkRatio,
      visualPngBytes: visual.pngBytes,
      visualWidth: visual.width,
      visualHeight: visual.height,
      visualSha256: visual.sha256
    });
  });
  return Object.freeze({
    source: Object.freeze({ width: image.width, height: image.height }),
    options: Object.freeze(settings),
    crops: Object.freeze(crops)
  });
}

/** Escribe artefactos anonimizados sólo cuando el llamador lo solicita. */
export function writeCropArtifacts(extraction, { directory }) {
  if (!extraction?.crops || !Array.isArray(extraction.crops)) throw new TypeError("La extraccion de recortes es obligatoria");
  if (typeof directory !== "string" || directory.trim() === "") throw new TypeError("directory es obligatorio");
  const targetDirectory = path.resolve(directory);
  mkdirSync(targetDirectory, { recursive: true });
  const manifest = extraction.crops.map((crop) => {
    const safeCropId = String(crop.cropId);
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(safeCropId)) throw new TypeError("cropId no es seguro para escribir artefactos");
    const fileName = `${safeCropId}.png`;
    const visualFileName = `${safeCropId}-visual.png`;
    writeFileSync(path.join(targetDirectory, fileName), crop.pngBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(path.join(targetDirectory, visualFileName), crop.visualPngBytes, { flag: "wx", mode: 0o600 });
    return {
      cropId: crop.cropId,
      rowIndex: crop.rowIndex,
      digitIndex: crop.digitIndex,
      fileName,
      visualFileName,
      width: crop.width,
      height: crop.height,
      threshold: crop.threshold,
      inkRatio: crop.inkRatio,
      isBlank: crop.isBlank,
      edgeInkRatio: crop.edgeInkRatio,
      sha256: crop.sha256,
      visualSha256: crop.visualSha256
    };
  });
  const manifestPath = path.join(targetDirectory, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify({ source: extraction.source, crops: manifest }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return Object.freeze({
    directory: targetDirectory,
    manifestPath,
    files: Object.freeze(manifest.flatMap((item) => [
      path.join(targetDirectory, item.fileName),
      path.join(targetDirectory, item.visualFileName)
    ]))
  });
}

export { DEFAULT_OPTIONS as DEFAULT_CROP_OPTIONS };
