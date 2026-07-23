import { buildTemplateMap, TEMPLATE_GEOMETRY } from "../config/template-geometry.js";
import { applyHomography } from "../testing/distorted-fixture.js";

export const IDENTITY_HOMOGRAPHY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function rectCorners(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ];
}

function boundingBox(points) {
  const x = points.map((point) => point.x);
  const y = points.map((point) => point.y);
  return {
    left: Math.min(...x),
    top: Math.min(...y),
    right: Math.max(...x),
    bottom: Math.max(...y)
  };
}

function boundingBoxIou(first, second) {
  const intersectionWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const intersectionHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const intersection = intersectionWidth * intersectionHeight;
  const firstArea = Math.max(0, first.right - first.left) * Math.max(0, first.bottom - first.top);
  const secondArea = Math.max(0, second.right - second.left) * Math.max(0, second.bottom - second.top);
  const union = firstArea + secondArea - intersection;
  return union === 0 ? 0 : intersection / union;
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function multiplyHomographies(left, right) {
  const product = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        product[(row * 3) + column] += left[(row * 3) + inner] * right[(inner * 3) + column];
      }
    }
  }
  const scale = product[8];
  return Object.freeze(product.map((value) => value / scale));
}

export function translationHomography(deltaX, deltaY) {
  return Object.freeze([1, 0, deltaX, 0, 1, deltaY, 0, 0, 1]);
}

/**
 * Compara una homografia estimada contra la verdad del fixture sobre las 200
 * casillas. Los errores estan en pixeles de la fotografia deformada.
 */
export function measureNormalizationAlignment({
  expectedHomography,
  estimatedHomography,
  templateMap = buildTemplateMap(),
  centerErrorThresholdPx = 4,
  meanIouThreshold = 0.75
}) {
  if (expectedHomography?.length !== 9 || estimatedHomography?.length !== 9) {
    throw new TypeError("Se requieren homografias esperada y estimada de nueve coeficientes");
  }
  const centerErrors = [];
  const cornerErrors = [];
  const boundingBoxIous = [];
  for (const row of templateMap.rows) {
    for (const box of row.digitBoxes) {
      const rect = box.visualRect;
      const center = { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) };
      const expectedCenter = applyHomography(expectedHomography, center);
      const estimatedCenter = applyHomography(estimatedHomography, center);
      centerErrors.push(distance(expectedCenter, estimatedCenter));
      const corners = rectCorners(rect);
      const expectedCorners = corners.map((point) => applyHomography(expectedHomography, point));
      const estimatedCorners = corners.map((point) => applyHomography(estimatedHomography, point));
      for (let index = 0; index < corners.length; index += 1) {
        cornerErrors.push(distance(expectedCorners[index], estimatedCorners[index]));
      }
      boundingBoxIous.push(boundingBoxIou(boundingBox(expectedCorners), boundingBox(estimatedCorners)));
    }
  }
  const meanCenterErrorPx = mean(centerErrors);
  const rootMeanSquareCenterErrorPx = Math.sqrt(mean(centerErrors.map((value) => value * value)));
  const meanBoundingBoxIou = mean(boundingBoxIous);
  const expectedPageCorners = [
    { x: 0, y: 0 },
    { x: TEMPLATE_GEOMETRY.source.width - 1, y: 0 },
    { x: TEMPLATE_GEOMETRY.source.width - 1, y: TEMPLATE_GEOMETRY.source.height - 1 },
    { x: 0, y: TEMPLATE_GEOMETRY.source.height - 1 }
  ].map((point) => applyHomography(expectedHomography, point));
  const pageDiagonal = Math.max(
    distance(expectedPageCorners[0], expectedPageCorners[2]),
    distance(expectedPageCorners[1], expectedPageCorners[3])
  );
  return Object.freeze({
    boxesMeasured: centerErrors.length,
    cornersMeasured: cornerErrors.length,
    meanCenterErrorPx,
    rootMeanSquareCenterErrorPx,
    p95CenterErrorPx: percentile(centerErrors, 0.95),
    maximumCenterErrorPx: Math.max(...centerErrors),
    meanCornerErrorPx: mean(cornerErrors),
    meanBoundingBoxIou,
    minimumBoundingBoxIou: Math.min(...boundingBoxIous),
    normalizedMeanCenterError: meanCenterErrorPx / pageDiagonal,
    passed: meanCenterErrorPx <= centerErrorThresholdPx && meanBoundingBoxIou >= meanIouThreshold,
    thresholds: Object.freeze({ centerErrorThresholdPx, meanIouThreshold })
  });
}
