import { RasterProcessingError } from "./errors.js";

export function assertRgbaRaster(raster) {
  if (!Number.isInteger(raster?.width) || !Number.isInteger(raster?.height) || raster.width <= 0 || raster.height <= 0) {
    throw new RasterProcessingError("RASTER_DIMENSIONS_INVALID", "Dimensiones raster invalidas", { stage: "PIXEL_TRANSFORM" });
  }
  if (!raster.data || raster.data.length !== raster.width * raster.height * 4) {
    throw new RasterProcessingError("RASTER_RGBA_INVALID", "El raster debe contener cuatro canales por pixel", { stage: "PIXEL_TRANSFORM" });
  }
}

export function transformExifOrientation(raster, orientation = 1) {
  assertRgbaRaster(raster);
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) orientation = 1;
  const swapsDimensions = orientation >= 5;
  const width = swapsDimensions ? raster.height : raster.width;
  const height = swapsDimensions ? raster.width : raster.height;
  if (orientation === 1) return { width: raster.width, height: raster.height, data: Buffer.from(raster.data) };

  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      let destinationX;
      let destinationY;
      switch (orientation) {
        case 2: destinationX = raster.width - 1 - x; destinationY = y; break;
        case 3: destinationX = raster.width - 1 - x; destinationY = raster.height - 1 - y; break;
        case 4: destinationX = x; destinationY = raster.height - 1 - y; break;
        case 5: destinationX = y; destinationY = x; break;
        case 6: destinationX = raster.height - 1 - y; destinationY = x; break;
        case 7: destinationX = raster.height - 1 - y; destinationY = raster.width - 1 - x; break;
        case 8: destinationX = y; destinationY = raster.width - 1 - x; break;
        default: destinationX = x; destinationY = y;
      }
      const sourceOffset = ((y * raster.width) + x) * 4;
      const destinationOffset = ((destinationY * width) + destinationX) * 4;
      data.set(raster.data.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return { width, height, data };
}

export function rotateRaster(raster, degrees = 0) {
  const normalized = ((Number(degrees) % 360) + 360) % 360;
  const orientation = normalized === 0 ? 1 : normalized === 90 ? 6 : normalized === 180 ? 3 : normalized === 270 ? 8 : null;
  if (!orientation) {
    throw new RasterProcessingError("ROTATION_UNSUPPORTED", "La rotacion debe ser 0, 90, 180 o 270 grados", {
      stage: "ORIENTATION"
    });
  }
  return transformExifOrientation(raster, orientation);
}

export function toGrayscaleRgba(raster) {
  assertRgbaRaster(raster);
  const data = Buffer.alloc(raster.data.length);
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    const alpha = raster.data[offset + 3] / 255;
    const red = (raster.data[offset] * alpha) + (255 * (1 - alpha));
    const green = (raster.data[offset + 1] * alpha) + (255 * (1 - alpha));
    const blue = (raster.data[offset + 2] * alpha) + (255 * (1 - alpha));
    const gray = Math.round((0.2126 * red) + (0.7152 * green) + (0.0722 * blue));
    data[offset] = gray;
    data[offset + 1] = gray;
    data[offset + 2] = gray;
    data[offset + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}

export function grayscaleStatistics(raster) {
  assertRgbaRaster(raster);
  const histogram = new Uint32Array(256);
  let total = 0;
  let sum = 0;
  let sumSquares = 0;
  let min = 255;
  let max = 0;
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    const value = raster.data[offset];
    histogram[value] += 1;
    total += 1;
    sum += value;
    sumSquares += value * value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const mean = sum / total;
  return Object.freeze({
    min,
    max,
    dynamicRange: max - min,
    mean,
    standardDeviation: Math.sqrt(Math.max(0, (sumSquares / total) - (mean * mean))),
    histogram
  });
}

function percentileFromHistogram(histogram, total, percentile) {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * percentile)));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative > target) return value;
  }
  return 255;
}

export function stretchGrayscaleContrast(raster, {
  lowPercentile = 0.01,
  highPercentile = 0.99,
  minimumRange = 8
} = {}) {
  const before = grayscaleStatistics(raster);
  const total = raster.width * raster.height;
  const low = percentileFromHistogram(before.histogram, total, lowPercentile);
  const high = percentileFromHistogram(before.histogram, total, highPercentile);
  if (high - low < minimumRange) {
    throw new RasterProcessingError("LOW_CONTRAST_IMAGE", "La imagen no contiene contraste suficiente para OCR", {
      stage: "CONTRAST",
      diagnostics: { low, high, dynamicRange: before.dynamicRange }
    });
  }

  const data = Buffer.alloc(raster.data.length);
  const scale = 255 / (high - low);
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    const value = Math.max(0, Math.min(255, Math.round((raster.data[offset] - low) * scale)));
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = raster.data[offset + 3];
  }
  const normalized = { width: raster.width, height: raster.height, data };
  const after = grayscaleStatistics(normalized);
  return Object.freeze({
    raster: normalized,
    diagnostics: Object.freeze({
      lowPercentile,
      highPercentile,
      low,
      high,
      dynamicRangeBefore: before.dynamicRange,
      dynamicRangeAfter: after.dynamicRange,
      standardDeviationBefore: before.standardDeviation,
      standardDeviationAfter: after.standardDeviation
    })
  });
}
