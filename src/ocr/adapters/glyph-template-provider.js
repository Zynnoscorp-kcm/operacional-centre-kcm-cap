import { createCanvas } from "@napi-rs/canvas";
import { PNG } from "pngjs";

import { extractDigitCrops } from "../recognition/crop-extractor.js";

const PROVIDER_NAME = "LOCAL_GLYPH_TEMPLATE_DIGITS_V1";
const ENGINE_VERSION = "1.0.0";
const DIGITS = Object.freeze(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const DEFAULT_TEMPLATE_OPTIONS = Object.freeze({
  fontFamily: "Helvetica Neue",
  fontWeight: 600,
  fontSizes: Object.freeze([25, 26, 27]),
  rotations: Object.freeze([-2.5, -1.25, 0, 1.25, 2.5]),
  sourceWidths: Object.freeze([21, 22]),
  sourceHeight: 27,
  innerInset: 2,
  normalizedWidth: 24,
  normalizedHeight: 36
});
const DEFAULT_CONFIDENCE_CALIBRATION = Object.freeze({
  similarityFloor: 0.48,
  similarityCeiling: 0.88,
  marginFloor: 0.015,
  marginCeiling: 0.14,
  similarityWeight: 0.72,
  standaloneConfidenceCap: 0.93
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertFiniteInterval(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} debe estar entre ${minimum} y ${maximum}`);
  }
}

function validateOptions(templateOptions, confidenceCalibration) {
  if (typeof templateOptions.fontFamily !== "string" || !templateOptions.fontFamily.trim() || templateOptions.fontFamily.length > 80) {
    throw new TypeError("fontFamily es invalida");
  }
  if (!Number.isInteger(templateOptions.fontWeight) || templateOptions.fontWeight < 100 || templateOptions.fontWeight > 900) {
    throw new TypeError("fontWeight es invalido");
  }
  for (const [name, values] of Object.entries({
    fontSizes: templateOptions.fontSizes,
    rotations: templateOptions.rotations,
    sourceWidths: templateOptions.sourceWidths
  })) {
    if (!Array.isArray(values) || !values.length || values.length > 16 || !values.every(Number.isFinite)) {
      throw new TypeError(`${name} debe ser una lista numerica acotada`);
    }
  }
  for (const name of ["sourceHeight", "innerInset", "normalizedWidth", "normalizedHeight"]) {
    if (!Number.isInteger(templateOptions[name]) || templateOptions[name] < 0 || templateOptions[name] > 128) {
      throw new TypeError(`${name} es invalido`);
    }
  }
  for (const name of [
    "similarityFloor", "similarityCeiling", "marginFloor", "marginCeiling",
    "similarityWeight"
  ]) assertFiniteInterval(confidenceCalibration[name], name, 0, 1);
  assertFiniteInterval(confidenceCalibration.standaloneConfidenceCap, "standaloneConfidenceCap", 0, 0.93);
  if (confidenceCalibration.similarityCeiling <= confidenceCalibration.similarityFloor) {
    throw new TypeError("similarityCeiling debe ser mayor que similarityFloor");
  }
  if (confidenceCalibration.marginCeiling <= confidenceCalibration.marginFloor) {
    throw new TypeError("marginCeiling debe ser mayor que marginFloor");
  }
}

function validateTemplateBank(templateBank) {
  if (!templateBank?.settings || !Array.isArray(templateBank?.templates) || !templateBank.templates.length) {
    throw new TypeError("templateBank debe ser un banco tipografico no vacio");
  }
  if (templateBank.templates.length > 5_000) throw new RangeError("templateBank excede el limite seguro");
  validateOptions(templateBank.settings, DEFAULT_CONFIDENCE_CALIBRATION);
  const coveredDigits = new Set();
  for (const template of templateBank.templates) {
    if (!DIGITS.includes(template?.digit)) throw new TypeError("templateBank contiene una etiqueta no numerica");
    const glyph = template?.glyph;
    if (!glyph || !Number.isInteger(glyph.width) || !Number.isInteger(glyph.height) ||
      glyph.width !== templateBank.settings.normalizedWidth || glyph.height !== templateBank.settings.normalizedHeight ||
      !(glyph.pixels instanceof Uint8Array) || glyph.pixels.length !== glyph.width * glyph.height) {
      throw new TypeError("templateBank contiene un glifo invalido");
    }
    coveredDigits.add(template.digit);
  }
  if (coveredDigits.size !== DIGITS.length) throw new TypeError("templateBank debe cubrir los diez digitos");
}

function binaryMaskFromPng(pngBytes) {
  let image;
  try {
    image = PNG.sync.read(Buffer.from(pngBytes), { checkCRC: true });
  } catch {
    throw new TypeError("No fue posible decodificar un recorte PNG para reconocimiento tipografico");
  }
  const grayscale = new Uint8Array(image.width * image.height);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4;
    const alpha = image.data[offset + 3] / 255;
    const red = (image.data[offset] * alpha) + (255 * (1 - alpha));
    const green = (image.data[offset + 1] * alpha) + (255 * (1 - alpha));
    const blue = (image.data[offset + 2] * alpha) + (255 * (1 - alpha));
    const gray = Math.max(0, Math.min(255, Math.round((red * 0.299) + (green * 0.587) + (blue * 0.114))));
    grayscale[index] = gray;
    histogram[gray] += 1;
  }
  let weightedTotal = 0;
  for (let level = 0; level < 256; level += 1) weightedTotal += level * histogram[level];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += histogram[level];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = grayscale.length - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += level * histogram[level];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * ((backgroundMean - foregroundMean) ** 2);
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }
  threshold = Math.max(70, Math.min(210, threshold));
  return Object.freeze({
    width: image.width,
    height: image.height,
    pixels: Uint8Array.from(grayscale, (value) => value <= threshold ? 1 : 0)
  });
}

function connectedComponents(mask) {
  const visited = new Uint8Array(mask.pixels.length);
  const components = [];
  const neighbors = Object.freeze([
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
  ]);
  for (let origin = 0; origin < mask.pixels.length; origin += 1) {
    if (!mask.pixels[origin] || visited[origin]) continue;
    const stack = [origin];
    visited[origin] = 1;
    const indexes = [];
    let minX = mask.width;
    let minY = mask.height;
    let maxX = 0;
    let maxY = 0;
    while (stack.length) {
      const index = stack.pop();
      indexes.push(index);
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= mask.width || nextY >= mask.height) continue;
        const next = (nextY * mask.width) + nextX;
        if (!mask.pixels[next] || visited[next]) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    components.push({ indexes, area: indexes.length, minX, minY, maxX, maxY });
  }
  return components;
}

function selectGlyphComponent(mask) {
  const components = connectedComponents(mask);
  if (!components.length) return null;
  const centerX = (mask.width - 1) / 2;
  const centerY = (mask.height - 1) / 2;
  components.sort((left, right) => {
    const score = (component) => {
      const componentX = (component.minX + component.maxX) / 2;
      const componentY = (component.minY + component.maxY) / 2;
      const distance = Math.hypot(
        (componentX - centerX) / Math.max(1, centerX),
        (componentY - centerY) / Math.max(1, centerY)
      );
      return component.area * (1.15 - Math.min(0.65, distance * 0.35));
    };
    return score(right) - score(left);
  });
  return components[0];
}

function normalizeGlyph(mask, width, height) {
  const component = selectGlyphComponent(mask);
  if (!component || component.area < 3) return null;
  const sourceWidth = component.maxX - component.minX + 1;
  const sourceHeight = component.maxY - component.minY + 1;
  const padding = 2;
  const scale = Math.min((width - (padding * 2)) / sourceWidth, (height - (padding * 2)) / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((width - targetWidth) / 2);
  const offsetY = Math.floor((height - targetHeight) / 2);
  const sourcePixels = new Set(component.indexes);
  const pixels = new Uint8Array(width * height);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = component.minY + Math.min(sourceHeight - 1, Math.floor(((targetY + 0.5) * sourceHeight) / targetHeight));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = component.minX + Math.min(sourceWidth - 1, Math.floor(((targetX + 0.5) * sourceWidth) / targetWidth));
      if (sourcePixels.has((sourceY * mask.width) + sourceX)) {
        pixels[((offsetY + targetY) * width) + offsetX + targetX] = 1;
      }
    }
  }
  return Object.freeze({
    width,
    height,
    pixels,
    aspectRatio: sourceWidth / sourceHeight,
    fillRatio: component.area / (sourceWidth * sourceHeight),
    componentArea: component.area,
    componentCount: connectedComponents(mask).length
  });
}

function shiftedIou(left, right, dx, dy) {
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < left.height; y += 1) {
    const rightY = y - dy;
    for (let x = 0; x < left.width; x += 1) {
      const a = left.pixels[(y * left.width) + x];
      const rightX = x - dx;
      const b = rightX >= 0 && rightY >= 0 && rightX < right.width && rightY < right.height
        ? right.pixels[(rightY * right.width) + rightX]
        : 0;
      if (a && b) intersection += 1;
      if (a || b) union += 1;
    }
  }
  return union ? intersection / union : 0;
}

function glyphSimilarity(left, right) {
  let shape = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) shape = Math.max(shape, shiftedIou(left, right, dx, dy));
  }
  const aspect = 1 - Math.min(1, Math.abs(left.aspectRatio - right.aspectRatio) / Math.max(left.aspectRatio, right.aspectRatio, 0.01));
  const fill = 1 - Math.min(1, Math.abs(left.fillRatio - right.fillRatio) / Math.max(left.fillRatio, right.fillRatio, 0.01));
  return (shape * 0.78) + (aspect * 0.14) + (fill * 0.08);
}

function renderTemplateMask(digit, options, sourceWidth, fontSize, rotation) {
  const canvas = createCanvas(sourceWidth, options.sourceHeight);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(sourceWidth / 2, options.sourceHeight / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.font = `${options.fontWeight} ${fontSize}px "${options.fontFamily}"`;
  context.fillStyle = "rgb(25, 25, 25)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(digit, 0, 1, sourceWidth - 2);
  context.restore();
  const imageData = context.getImageData(
    options.innerInset,
    options.innerInset,
    sourceWidth - (options.innerInset * 2),
    options.sourceHeight - (options.innerInset * 2)
  );
  const png = new PNG({ width: imageData.width, height: imageData.height });
  png.data = Buffer.from(imageData.data);
  return binaryMaskFromPng(PNG.sync.write(png));
}

export function buildGlyphTemplates(options = {}) {
  const settings = { ...DEFAULT_TEMPLATE_OPTIONS, ...options };
  validateOptions(settings, DEFAULT_CONFIDENCE_CALIBRATION);
  const templates = [];
  for (const digit of DIGITS) {
    for (const sourceWidth of settings.sourceWidths) {
      for (const fontSize of settings.fontSizes) {
        for (const rotation of settings.rotations) {
          const glyph = normalizeGlyph(
            renderTemplateMask(digit, settings, sourceWidth, fontSize, rotation),
            settings.normalizedWidth,
            settings.normalizedHeight
          );
          if (glyph) templates.push(Object.freeze({ digit, sourceWidth, fontSize, rotation, glyph }));
        }
      }
    }
  }
  return Object.freeze({ settings: Object.freeze(settings), templates: Object.freeze(templates) });
}

function calibratedConfidence(bestSimilarity, margin, calibration) {
  const similarityScore = clamp(
    (bestSimilarity - calibration.similarityFloor) /
    (calibration.similarityCeiling - calibration.similarityFloor)
  );
  const marginScore = clamp(
    (margin - calibration.marginFloor) /
    (calibration.marginCeiling - calibration.marginFloor)
  );
  const combined = (similarityScore * calibration.similarityWeight) +
    (marginScore * (1 - calibration.similarityWeight));
  return Number(Math.min(calibration.standaloneConfidenceCap, combined).toFixed(6));
}

export function matchGlyphDigit(pngBytes, templateBank, confidenceCalibration = {}) {
  if (!templateBank?.templates?.length) throw new TypeError("Se requiere un banco tipografico no vacio");
  const calibration = { ...DEFAULT_CONFIDENCE_CALIBRATION, ...confidenceCalibration };
  validateOptions(templateBank.settings, calibration);
  const glyph = normalizeGlyph(
    binaryMaskFromPng(pngBytes),
    templateBank.settings.normalizedWidth,
    templateBank.settings.normalizedHeight
  );
  if (!glyph) return Object.freeze({ digit: "", confidence: 0, bestSimilarity: 0, runnerUpSimilarity: 0, margin: 0 });
  const byDigit = new Map(DIGITS.map((digit) => [digit, 0]));
  for (const template of templateBank.templates) {
    const similarity = glyphSimilarity(glyph, template.glyph);
    if (similarity > byDigit.get(template.digit)) byDigit.set(template.digit, similarity);
  }
  const ranked = [...byDigit].map(([digit, similarity]) => ({ digit, similarity }))
    .sort((left, right) => right.similarity - left.similarity || left.digit.localeCompare(right.digit));
  const best = ranked[0];
  const runnerUp = ranked[1];
  const margin = best.similarity - runnerUp.similarity;
  return Object.freeze({
    digit: best.digit,
    confidence: calibratedConfidence(best.similarity, margin, calibration),
    bestSimilarity: Number(best.similarity.toFixed(6)),
    runnerUpSimilarity: Number(runnerUp.similarity.toFixed(6)),
    margin: Number(margin.toFixed(6)),
    componentArea: glyph.componentArea,
    componentCount: glyph.componentCount
  });
}

export class GlyphTemplateDigitsProvider {
  constructor({
    imageBytes,
    cropOptions,
    templateBank,
    templateOptions,
    confidenceCalibration,
    includeBinaryArtifacts = false
  } = {}) {
    this.providerName = PROVIDER_NAME;
    this.imageBytes = imageBytes ? Buffer.from(imageBytes) : null;
    this.cropOptions = cropOptions;
    this.templateBank = templateBank ?? buildGlyphTemplates(templateOptions);
    validateTemplateBank(this.templateBank);
    this.confidenceCalibration = { ...DEFAULT_CONFIDENCE_CALIBRATION, ...confidenceCalibration };
    validateOptions(this.templateBank.settings, this.confidenceCalibration);
    this.includeBinaryArtifacts = includeBinaryArtifacts === true;
  }

  recognize({ segmentation, imageBytes, normalizedImage, crops } = {}) {
    if (!segmentation?.templateMap?.rows) throw new TypeError("El proveedor tipografico requiere una segmentacion de plantilla");
    const normalizedImageBytes = normalizedImage?.bytes ?? normalizedImage?.pngBytes ?? normalizedImage;
    const suppliedImage = normalizedImageBytes ?? imageBytes ?? this.imageBytes;
    const extraction = crops?.crops
      ? crops
      : Array.isArray(crops)
        ? Object.freeze({ source: null, options: null, crops: Object.freeze(crops) })
        : suppliedImage
          ? extractDigitCrops({ imageBytes: Buffer.from(suppliedImage), segmentation, options: this.cropOptions })
          : null;
    if (!extraction) throw new TypeError("El proveedor tipografico requiere la imagen PNG normalizada o una lista de recortes");

    const recognitionByCrop = new Map(extraction.crops.map((crop) => {
      const recognition = crop.isBlank
        ? Object.freeze({ digit: "", confidence: 0, bestSimilarity: 0, runnerUpSimilarity: 0, margin: 0 })
        : matchGlyphDigit(crop.pngBytes, this.templateBank, this.confidenceCalibration);
      return [crop.cropId, { ...recognition, crop }];
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
          recognitionPass: "GLYPH_TEMPLATE",
          isBlank: recognition.crop.isBlank,
          cropSha256: recognition.crop.sha256,
          bestSimilarity: recognition.bestSimilarity,
          runnerUpSimilarity: recognition.runnerUpSimilarity,
          margin: recognition.margin
        });
      });
      const detected = digits.some((digit) => !digit.isBlank);
      const rawDigits = digits.map((digit) => digit.digit).join("");
      const digitConfidences = digits.map((digit) => digit.confidence);
      return Object.freeze({
        rowIndex: row.rowIndex,
        detected,
        rawDigits,
        digitConfidences: Object.freeze(digitConfidences),
        overallConfidence: detected && digitConfidences.length
          ? Number(Math.min(...digitConfidences).toFixed(6))
          : 0,
        digits: Object.freeze(digits),
        provider: this.providerName
      });
    });

    const artifacts = extraction.crops.map(({ pngBytes, visualPngBytes, ...metadata }) => Object.freeze(metadata));
    const output = {
      provider: this.providerName,
      engine: Object.freeze({
        name: "glyph-template",
        version: ENGINE_VERSION,
        fontFamily: this.templateBank.settings.fontFamily,
        confidenceCap: this.confidenceCalibration.standaloneConfidenceCap
      }),
      rows: Object.freeze(rows),
      cropArtifacts: Object.freeze(artifacts),
      binaryArtifactsIncluded: this.includeBinaryArtifacts
    };
    if (this.includeBinaryArtifacts) output.extraction = extraction;
    return Object.freeze(output);
  }
}

export {
  DEFAULT_CONFIDENCE_CALIBRATION as DEFAULT_GLYPH_CONFIDENCE_CALIBRATION,
  DEFAULT_TEMPLATE_OPTIONS as DEFAULT_GLYPH_TEMPLATE_OPTIONS,
  PROVIDER_NAME as GLYPH_TEMPLATE_PROVIDER_NAME
};
