import { RasterProcessingError } from "./errors.js";
import { assertRgbaRaster, grayscaleStatistics } from "./raster-ops.js";

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function solveSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }
  return augmented.map((row) => row[size]);
}

function surfaceTerms(x, y, width, height) {
  const normalizedX = (x / Math.max(1, width - 1)) - 0.5;
  const normalizedY = (y / Math.max(1, height - 1)) - 0.5;
  return [1, normalizedX, normalizedY, normalizedX ** 2, normalizedX * normalizedY, normalizedY ** 2];
}

function fitBackgroundSurface(raster, borderThickness) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(raster.width, raster.height) / 220));
  for (let y = 0; y < raster.height; y += step) {
    for (let x = 0; x < raster.width; x += step) {
      if (x >= borderThickness && y >= borderThickness && x < raster.width - borderThickness && y < raster.height - borderThickness) continue;
      const observed = raster.data[((y * raster.width) + x) * 4];
      const terms = surfaceTerms(x, y, raster.width, raster.height);
      samples.push({ x, y, observed, terms });
    }
  }
  let selected = samples;
  let coefficients = null;
  let predict = null;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const normal = Array.from({ length: 6 }, () => Array(6).fill(0));
    const values = Array(6).fill(0);
    for (const sample of selected) {
      for (let row = 0; row < 6; row += 1) {
        values[row] += sample.terms[row] * sample.observed;
        for (let column = 0; column < 6; column += 1) normal[row][column] += sample.terms[row] * sample.terms[column];
      }
    }
    coefficients = solveSystem(normal, values);
    if (!coefficients) return null;
    predict = (x, y) => surfaceTerms(x, y, raster.width, raster.height)
      .reduce((value, term, index) => value + (term * coefficients[index]), 0);
    const residuals = selected.map((sample) => sample.observed - predict(sample.x, sample.y));
    const residualMedian = percentile(residuals, 0.5);
    const medianAbsoluteDeviation = percentile(residuals.map((value) => Math.abs(value - residualMedian)), 0.5);
    const limit = Math.max(2, 3.5 * 1.4826 * medianAbsoluteDeviation);
    const filtered = selected.filter((sample) => Math.abs((sample.observed - predict(sample.x, sample.y)) - residualMedian) <= limit);
    if (filtered.length < samples.length * 0.55 || filtered.length === selected.length) break;
    selected = filtered;
  }
  const residuals = selected.map((sample) => sample.observed - predict(sample.x, sample.y));
  const residualMean = mean(residuals);
  const residualStandardDeviation = Math.sqrt(mean(residuals.map((value) => (value - residualMean) ** 2)));
  return {
    coefficients,
    predict,
    residualMean,
    residualStandardDeviation,
    sampleCount: selected.length,
    rejectedSampleCount: samples.length - selected.length
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)))];
}

function fitLine(points, dependent) {
  const independent = dependent === "x" ? "y" : "x";
  const count = points.length;
  const independentMean = mean(points.map((point) => point[independent]));
  const dependentMean = mean(points.map((point) => point[dependent]));
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point[independent] - independentMean) * (point[dependent] - dependentMean);
    denominator += (point[independent] - independentMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = dependentMean - (slope * independentMean);
  const rmse = Math.sqrt(points.reduce((sum, point) => {
    const predicted = (slope * point[independent]) + intercept;
    return sum + ((predicted - point[dependent]) ** 2);
  }, 0) / Math.max(1, count));
  return { slope, intercept, rmse };
}

function fitLineRobust(points, dependent) {
  let selected = points;
  let line = fitLine(selected, dependent);
  const independent = dependent === "x" ? "y" : "x";
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const residuals = selected.map((point) => Math.abs(point[dependent] - ((line.slope * point[independent]) + line.intercept)));
    const medianResidual = percentile(residuals, 0.5);
    const deviations = residuals.map((residual) => Math.abs(residual - medianResidual));
    const medianAbsoluteDeviation = percentile(deviations, 0.5);
    const limit = Math.max(1.5, medianResidual + (3 * 1.4826 * medianAbsoluteDeviation));
    const filtered = selected.filter((point) => Math.abs(point[dependent] - ((line.slope * point[independent]) + line.intercept)) <= limit);
    if (filtered.length < Math.max(8, points.length * 0.45) || filtered.length === selected.length) break;
    selected = filtered;
    line = fitLine(selected, dependent);
  }
  return { ...line, pointsUsed: selected.length, pointsAvailable: points.length };
}

function intersection(vertical, horizontal) {
  const denominator = 1 - (horizontal.slope * vertical.slope);
  if (Math.abs(denominator) < 1e-9) return null;
  const y = ((horizontal.slope * vertical.intercept) + horizontal.intercept) / denominator;
  return { x: (vertical.slope * y) + vertical.intercept, y };
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += (current.x * next.y) - (next.x * current.y);
  }
  return Math.abs(area) / 2;
}

export function orderAndValidateQuadrilateral(points, {
  width,
  height,
  minAreaRatio = 0.15,
  maxOutsideRatio = 0.1
} = {}) {
  if (!Array.isArray(points) || points.length !== 4 || points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
    throw new RasterProcessingError("PAGE_QUADRILATERAL_INVALID", "Se requieren cuatro esquinas numericas de la hoja", {
      stage: "PAGE_DETECTION"
    });
  }
  const centroid = {
    x: mean(points.map((point) => point.x)),
    y: mean(points.map((point) => point.y))
  };
  const angular = points.map((point) => ({ ...point, angle: Math.atan2(point.y - centroid.y, point.x - centroid.x) }))
    .sort((left, right) => left.angle - right.angle)
    .map(({ x, y }) => ({ x, y }));
  const start = angular.reduce((best, point, index) => ((point.x + point.y) < (angular[best].x + angular[best].y) ? index : best), 0);
  const ordered = Array.from({ length: 4 }, (_, offset) => angular[(start + offset) % 4]);
  if (ordered[1].x < ordered[3].x) [ordered[1], ordered[3]] = [ordered[3], ordered[1]];

  const horizontalTolerance = width * maxOutsideRatio;
  const verticalTolerance = height * maxOutsideRatio;
  if (ordered.some((point) => (
    point.x < -horizontalTolerance ||
    point.y < -verticalTolerance ||
    point.x > width - 1 + horizontalTolerance ||
    point.y > height - 1 + verticalTolerance
  ))) {
    throw new RasterProcessingError("PAGE_QUADRILATERAL_OUT_OF_BOUNDS", "Las esquinas de hoja exceden el raster", {
      stage: "PAGE_DETECTION"
    });
  }
  const area = polygonArea(ordered);
  const areaRatio = area / (width * height);
  if (areaRatio < minAreaRatio) {
    throw new RasterProcessingError("PAGE_QUADRILATERAL_TOO_SMALL", "La hoja detectada ocupa un area insuficiente", {
      stage: "PAGE_DETECTION",
      diagnostics: { areaRatio }
    });
  }
  return Object.freeze({ points: Object.freeze(ordered.map((point) => Object.freeze(point))), areaRatio });
}

function fullFrame(width, height) {
  return [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 }
  ];
}

export function detectPageQuadrilateral(raster, {
  allowFullFrameFallback = true,
  minAreaRatio = 0.15
} = {}) {
  assertRgbaRaster(raster);
  const statistics = grayscaleStatistics(raster);
  if (statistics.dynamicRange < 8 || statistics.standardDeviation < 2) {
    throw new RasterProcessingError("LOW_CONTRAST_IMAGE", "No hay contraste suficiente para localizar la hoja", {
      stage: "PAGE_DETECTION",
      diagnostics: { dynamicRange: statistics.dynamicRange, standardDeviation: statistics.standardDeviation }
    });
  }

  const borderThickness = Math.max(2, Math.round(Math.min(raster.width, raster.height) * 0.025));
  const background = fitBackgroundSurface(raster, borderThickness);
  if (!background) {
    throw new RasterProcessingError("BACKGROUND_MODEL_FAILED", "No fue posible modelar la iluminacion del fondo", {
      stage: "PAGE_DETECTION"
    });
  }
  const centerResiduals = [];
  for (let y = Math.floor(raster.height * 0.35); y < Math.ceil(raster.height * 0.65); y += Math.max(1, Math.floor(raster.height / 100))) {
    for (let x = Math.floor(raster.width * 0.35); x < Math.ceil(raster.width * 0.65); x += Math.max(1, Math.floor(raster.width / 100))) {
      const observed = raster.data[((y * raster.width) + x) * 4];
      centerResiduals.push(observed - background.predict(x, y));
    }
  }
  const positiveSignal = percentile(centerResiduals, 0.75);
  const negativeSignal = -percentile(centerResiduals, 0.25);
  const pageIsBright = positiveSignal >= negativeSignal;
  const centerSignal = Math.max(positiveSignal, negativeSignal);
  const residualThreshold = Math.max(4, background.residualStandardDeviation * 3.5);
  if (centerSignal < residualThreshold && allowFullFrameFallback) {
    const validated = orderAndValidateQuadrilateral(fullFrame(raster.width, raster.height), {
      width: raster.width,
      height: raster.height,
      minAreaRatio
    });
    return Object.freeze({
      quadrilateral: validated.points,
      method: "FULL_FRAME_FALLBACK",
      confidence: 0.55,
      diagnostics: Object.freeze({
        areaRatio: validated.areaRatio,
        centerSignal,
        residualThreshold,
        backgroundResidualStandardDeviation: background.residualStandardDeviation
      }),
      warnings: Object.freeze(["PAGE_BOUNDARY_NOT_DISTINCT"])
    });
  }

  const rowMin = new Int32Array(raster.height).fill(raster.width);
  const rowMax = new Int32Array(raster.height).fill(-1);
  const columnMin = new Int32Array(raster.width).fill(raster.height);
  const columnMax = new Int32Array(raster.width).fill(-1);
  let foregroundCount = 0;

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const value = raster.data[((y * raster.width) + x) * 4];
      const residual = value - background.predict(x, y);
      const foreground = pageIsBright ? residual > residualThreshold : residual < -residualThreshold;
      if (!foreground) continue;
      foregroundCount += 1;
      rowMin[y] = Math.min(rowMin[y], x);
      rowMax[y] = Math.max(rowMax[y], x);
      columnMin[x] = Math.min(columnMin[x], y);
      columnMax[x] = Math.max(columnMax[x], y);
    }
  }

  const leftPoints = [];
  const rightPoints = [];
  for (let y = 0; y < raster.height; y += 1) {
    if (rowMax[y] - rowMin[y] < raster.width * 0.1) continue;
    leftPoints.push({ x: rowMin[y], y });
    rightPoints.push({ x: rowMax[y], y });
  }
  const topPoints = [];
  const bottomPoints = [];
  for (let x = 0; x < raster.width; x += 1) {
    if (columnMax[x] - columnMin[x] < raster.height * 0.1) continue;
    topPoints.push({ x, y: columnMin[x] });
    bottomPoints.push({ x, y: columnMax[x] });
  }

  if (Math.min(leftPoints.length, rightPoints.length, topPoints.length, bottomPoints.length) < 8) {
    throw new RasterProcessingError("PAGE_NOT_DETECTED", "No fue posible localizar cuatro bordes de hoja", {
      stage: "PAGE_DETECTION",
      diagnostics: {
        foregroundRatio: foregroundCount / (raster.width * raster.height),
        centerSignal,
        residualThreshold
      }
    });
  }

  const left = fitLineRobust(leftPoints, "x");
  const right = fitLineRobust(rightPoints, "x");
  const top = fitLineRobust(topPoints, "y");
  const bottom = fitLineRobust(bottomPoints, "y");
  const corners = [intersection(left, top), intersection(right, top), intersection(right, bottom), intersection(left, bottom)];
  if (corners.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new RasterProcessingError("PAGE_NOT_DETECTED", "Los bordes de hoja no forman un cuadrilatero estable", {
      stage: "PAGE_DETECTION"
    });
  }
  const validated = orderAndValidateQuadrilateral(corners, { width: raster.width, height: raster.height, minAreaRatio });
  const normalizedRmse = (left.rmse + right.rmse + top.rmse + bottom.rmse) / (4 * Math.max(raster.width, raster.height));
  return Object.freeze({
    quadrilateral: validated.points,
    method: "LUMINANCE_BOUNDARY_LINES",
    confidence: Math.max(0, Math.min(1, 1 - (normalizedRmse * 8))),
    diagnostics: Object.freeze({
      centerSignal,
      residualThreshold,
      backgroundResidualMean: background.residualMean,
      backgroundResidualStandardDeviation: background.residualStandardDeviation,
      backgroundSamples: background.sampleCount,
      backgroundRejectedSamples: background.rejectedSampleCount,
      foregroundRatio: foregroundCount / (raster.width * raster.height),
      areaRatio: validated.areaRatio,
      normalizedRmse,
      boundaryPoints: Object.freeze({
        left: Object.freeze({ used: left.pointsUsed, available: left.pointsAvailable }),
        right: Object.freeze({ used: right.pointsUsed, available: right.pointsAvailable }),
        top: Object.freeze({ used: top.pointsUsed, available: top.pointsAvailable }),
        bottom: Object.freeze({ used: bottom.pointsUsed, available: bottom.pointsAvailable })
      })
    }),
    warnings: Object.freeze([])
  });
}
