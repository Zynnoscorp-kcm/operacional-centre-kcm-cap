import { RasterProcessingError } from "./errors.js";
import { assertRgbaRaster } from "./raster-ops.js";

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      throw new RasterProcessingError("HOMOGRAPHY_SINGULAR", "El cuadrilatero no permite calcular una homografia estable", {
        stage: "HOMOGRAPHY"
      });
    }
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

export function calculateHomography(fromPoints, toPoints) {
  if (!Array.isArray(fromPoints) || !Array.isArray(toPoints) || fromPoints.length !== 4 || toPoints.length !== 4) {
    throw new RasterProcessingError("HOMOGRAPHY_POINTS_INVALID", "La homografia requiere cuatro pares de puntos", {
      stage: "HOMOGRAPHY",
      recoverable: false
    });
  }
  const matrix = [];
  const values = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = fromPoints[index];
    const { x: destinationX, y: destinationY } = toPoints[index];
    matrix.push([x, y, 1, 0, 0, 0, -destinationX * x, -destinationX * y]);
    values.push(destinationX);
    matrix.push([0, 0, 0, x, y, 1, -destinationY * x, -destinationY * y]);
    values.push(destinationY);
  }
  const solution = solveLinearSystem(matrix, values);
  return Object.freeze([...solution, 1]);
}

export function invertHomography(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 9) {
    throw new RasterProcessingError("HOMOGRAPHY_MATRIX_INVALID", "La matriz de homografia debe tener nueve valores", {
      stage: "HOMOGRAPHY",
      recoverable: false
    });
  }
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = (e * i) - (f * h);
  const B = -((d * i) - (f * g));
  const C = (d * h) - (e * g);
  const determinant = (a * A) + (b * B) + (c * C);
  if (Math.abs(determinant) < 1e-12) {
    throw new RasterProcessingError("HOMOGRAPHY_SINGULAR", "La homografia no tiene inversa estable", { stage: "HOMOGRAPHY" });
  }
  return Object.freeze([
    A / determinant,
    -((b * i) - (c * h)) / determinant,
    ((b * f) - (c * e)) / determinant,
    B / determinant,
    ((a * i) - (c * g)) / determinant,
    -((a * f) - (c * d)) / determinant,
    C / determinant,
    -((a * h) - (b * g)) / determinant,
    ((a * e) - (b * d)) / determinant
  ]);
}

export function projectPoint(matrix, point) {
  const denominator = (matrix[6] * point.x) + (matrix[7] * point.y) + matrix[8];
  if (Math.abs(denominator) < 1e-12) return { x: Number.NaN, y: Number.NaN };
  return {
    x: ((matrix[0] * point.x) + (matrix[1] * point.y) + matrix[2]) / denominator,
    y: ((matrix[3] * point.x) + (matrix[4] * point.y) + matrix[5]) / denominator
  };
}

function sampleBilinear(raster, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > raster.width - 1 || y > raster.height - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(raster.width - 1, x0 + 1);
  const y1 = Math.min(raster.height - 1, y0 + 1);
  const xWeight = x - x0;
  const yWeight = y - y0;
  const topLeft = raster.data[((y0 * raster.width) + x0) * 4];
  const topRight = raster.data[((y0 * raster.width) + x1) * 4];
  const bottomLeft = raster.data[((y1 * raster.width) + x0) * 4];
  const bottomRight = raster.data[((y1 * raster.width) + x1) * 4];
  const top = topLeft + ((topRight - topLeft) * xWeight);
  const bottom = bottomLeft + ((bottomRight - bottomLeft) * xWeight);
  return Math.round(top + ((bottom - top) * yWeight));
}

export function rectifyRaster(raster, inverseHomography, { width, height, background = 255 }) {
  assertRgbaRaster(raster);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 1 || height <= 1) {
    throw new RasterProcessingError("RECTIFIED_DIMENSIONS_INVALID", "Las dimensiones rectificadas son invalidas", {
      stage: "RECTIFICATION",
      recoverable: false
    });
  }
  const data = Buffer.alloc(width * height * 4);
  for (let destinationY = 0; destinationY < height; destinationY += 1) {
    for (let destinationX = 0; destinationX < width; destinationX += 1) {
      const source = projectPoint(inverseHomography, { x: destinationX, y: destinationY });
      const gray = Number.isFinite(source.x) && Number.isFinite(source.y)
        ? sampleBilinear(raster, source.x, source.y)
        : background;
      const offset = ((destinationY * width) + destinationX) * 4;
      data[offset] = gray;
      data[offset + 1] = gray;
      data[offset + 2] = gray;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

