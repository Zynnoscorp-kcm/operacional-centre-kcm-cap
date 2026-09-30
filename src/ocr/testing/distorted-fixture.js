import { createCanvas } from "@napi-rs/canvas";
import { PNG } from "pngjs";

import { buildTemplateMap, TEMPLATE_GEOMETRY } from "../config/template-geometry.js";

const BITMAP_DIGITS = Object.freeze({
  "0": ["01110", "11011", "11011", "11011", "11011", "11011", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "11011", "00011", "00110", "01100", "11000", "11111"],
  "3": ["11110", "00011", "00011", "01110", "00011", "00011", "11110"],
  "4": ["00010", "00110", "01110", "11010", "11111", "00010", "00010"],
  "5": ["11111", "11000", "11000", "11110", "00011", "00011", "11110"],
  "6": ["01110", "11000", "11000", "11110", "11011", "11011", "01110"],
  "7": ["11111", "00011", "00110", "00110", "01100", "01100", "01100"],
  "8": ["01110", "11011", "11011", "01110", "11011", "11011", "01110"],
  "9": ["01110", "11011", "11011", "01111", "00011", "00011", "01110"]
});

function hashSeed(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      throw new Error("No se puede resolver una homografia degenerada");
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function solveHomography(sourcePoints, destinationPoints) {
  if (sourcePoints?.length !== 4 || destinationPoints?.length !== 4) {
    throw new TypeError("Una homografia requiere cuatro correspondencias");
  }
  const matrix = [];
  const vector = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = sourcePoints[index];
    const { x: u, y: v } = destinationPoints[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  return Object.freeze([...solveLinearSystem(matrix, vector), 1]);
}

export function applyHomography(homography, point) {
  const denominator = (homography[6] * point.x) + (homography[7] * point.y) + homography[8];
  if (Math.abs(denominator) < 1e-12) throw new Error("La homografia proyecta el punto al infinito");
  return Object.freeze({
    x: ((homography[0] * point.x) + (homography[1] * point.y) + homography[2]) / denominator,
    y: ((homography[3] * point.x) + (homography[4] * point.y) + homography[5]) / denominator
  });
}

export function invertHomography(homography) {
  const [a, b, c, d, e, f, g, h, i] = homography;
  const determinant = a * ((e * i) - (f * h)) - b * ((d * i) - (f * g)) + c * ((d * h) - (e * g));
  if (Math.abs(determinant) < 1e-12) throw new Error("No se puede invertir una homografia degenerada");
  return Object.freeze([
    ((e * i) - (f * h)) / determinant,
    ((c * h) - (b * i)) / determinant,
    ((b * f) - (c * e)) / determinant,
    ((f * g) - (d * i)) / determinant,
    ((a * i) - (c * g)) / determinant,
    ((c * d) - (a * f)) / determinant,
    ((d * h) - (e * g)) / determinant,
    ((b * g) - (a * h)) / determinant,
    ((a * e) - (b * d)) / determinant
  ]);
}

function setPixel(image, x, y, red, green = red, blue = red, alpha = 255) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = ((y * image.width) + x) * 4;
  image.data[offset] = red;
  image.data[offset + 1] = green;
  image.data[offset + 2] = blue;
  image.data[offset + 3] = alpha;
}

function drawLine(image, x1, y1, x2, y2, value = 45) {
  if (y1 === y2) {
    for (let x = x1; x <= x2; x += 1) setPixel(image, x, y1, value);
  } else if (x1 === x2) {
    for (let y = y1; y <= y2; y += 1) setPixel(image, x1, y, value);
  }
}

function renderAnonymousTemplate() {
  const { width, height } = TEMPLATE_GEOMETRY.source;
  const image = new PNG({ width, height });
  image.data.fill(255);
  const map = buildTemplateMap();
  for (const row of map.rows) {
    drawLine(image, row.rowRect.x, row.rowRect.y, row.rowRect.x + row.rowRect.width, row.rowRect.y, 70);
    if (row.rowIndex === map.rows.length) {
      drawLine(image, row.rowRect.x, row.rowRect.y + row.rowRect.height, row.rowRect.x + row.rowRect.width, row.rowRect.y + row.rowRect.height, 70);
    }
    for (const { visualRect: rect } of row.digitBoxes) {
      drawLine(image, rect.x, rect.y, rect.x + rect.width - 1, rect.y, 35);
      drawLine(image, rect.x, rect.y + rect.height - 1, rect.x + rect.width - 1, rect.y + rect.height - 1, 35);
      drawLine(image, rect.x, rect.y, rect.x, rect.y + rect.height - 1, 35);
      drawLine(image, rect.x + rect.width - 1, rect.y, rect.x + rect.width - 1, rect.y + rect.height - 1, 35);
    }
  }
  return image;
}

function decodeTemplate(templatePng) {
  const image = templatePng ? PNG.sync.read(templatePng) : renderAnonymousTemplate();
  if (image.width !== TEMPLATE_GEOMETRY.source.width || image.height !== TEMPLATE_GEOMETRY.source.height) {
    throw new TypeError(`La plantilla debe medir ${TEMPLATE_GEOMETRY.source.width}x${TEMPLATE_GEOMETRY.source.height}`);
  }
  return image;
}

function drawBitmapDigit(image, digit, rect, tone) {
  const bitmap = BITMAP_DIGITS[digit];
  const bitmapWidth = bitmap[0].length;
  const bitmapHeight = bitmap.length;
  const scale = Math.max(1, Math.min(
    Math.floor((rect.width - 8) / bitmapWidth),
    Math.floor((rect.height - 8) / bitmapHeight)
  ));
  const width = bitmapWidth * scale;
  const height = bitmapHeight * scale;
  const originX = rect.x + Math.floor((rect.width - width) / 2);
  const originY = rect.y + Math.floor((rect.height - height) / 2);
  for (let row = 0; row < bitmap.length; row += 1) {
    for (let column = 0; column < bitmap[row].length; column += 1) {
      if (bitmap[row][column] !== "1") continue;
      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          setPixel(image, originX + (column * scale) + offsetX, originY + (row * scale) + offsetY, tone);
        }
      }
    }
  }
}

function createCanvasContext(image) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  const canvasImage = context.createImageData(image.width, image.height);
  canvasImage.data.set(image.data);
  context.putImageData(canvasImage, 0, 0);
  return { canvas, context };
}

function drawSystemFontDigit(context, digit, rect, tone, random, fontFamily) {
  const fontSize = Math.max(18, Math.min(rect.height - 3, 25 + Math.floor(random() * 3)));
  context.save();
  context.translate(
    rect.x + (rect.width / 2) + ((random() - 0.5) * 1.5),
    rect.y + (rect.height / 2) + ((random() - 0.5) * 1.5)
  );
  context.rotate(((random() - 0.5) * 5 * Math.PI) / 180);
  context.font = `600 ${fontSize}px "${fontFamily}"`;
  context.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(digit, 0, 1, rect.width - 2);
  context.restore();
}

function createSyntheticRows(image, seed, { digitRenderer, fontFamily, participantCount }) {
  const random = seededRandom(`${seed}:digits`);
  const canvas = digitRenderer === "SYSTEM_FONT" ? createCanvasContext(image) : null;
  const rows = [];
  for (const row of buildTemplateMap().rows) {
    if (row.rowIndex > participantCount) {
      rows.push(Object.freeze({ rowIndex: row.rowIndex, digits: "", expectedDetected: false }));
      continue;
    }
    let digits = "";
    for (const box of row.digitBoxes) {
      const digit = box.digitIndex === 0 && row.rowIndex % 4 === 0
        ? "0"
        : String(Math.floor(random() * 10));
      digits += digit;
      const tone = 18 + Math.floor(random() * 25);
      if (canvas) {
        drawSystemFontDigit(canvas.context, digit, box.recognitionRect, tone, random, fontFamily);
      } else {
        drawBitmapDigit(image, digit, box.visualRect, tone);
      }
    }
    rows.push(Object.freeze({ rowIndex: row.rowIndex, digits, expectedDetected: true }));
  }
  if (canvas) image.data = Buffer.from(canvas.context.getImageData(0, 0, image.width, image.height).data);
  return Object.freeze(rows);
}

function rotatePoint(point, center, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const deltaX = point.x - center.x;
  const deltaY = point.y - center.y;
  return Object.freeze({
    x: center.x + (deltaX * cosine) - (deltaY * sine),
    y: center.y + (deltaX * sine) + (deltaY * cosine)
  });
}

function createDestinationQuadrilateral({ sourceWidth, sourceHeight, outputWidth, outputHeight, pageFill, rotationDegrees, perspective, seed }) {
  const random = seededRandom(`${seed}:geometry`);
  const scale = Math.min((outputWidth * pageFill) / sourceWidth, (outputHeight * pageFill) / sourceHeight);
  const pageWidth = sourceWidth * scale;
  const pageHeight = sourceHeight * scale;
  const left = (outputWidth - pageWidth) / 2;
  const top = (outputHeight - pageHeight) / 2;
  const amplitude = Math.min(pageWidth, pageHeight) * perspective;
  const base = [
    { x: left, y: top },
    { x: left + pageWidth, y: top },
    { x: left + pageWidth, y: top + pageHeight },
    { x: left, y: top + pageHeight }
  ];
  const jittered = base.map((point) => ({
    x: point.x + ((random() - 0.5) * 2 * amplitude),
    y: point.y + ((random() - 0.5) * 2 * amplitude)
  }));
  const center = { x: outputWidth / 2, y: outputHeight / 2 };
  const radians = rotationDegrees * Math.PI / 180;
  return Object.freeze(jittered.map((point) => rotatePoint(point, center, radians)));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function warpTemplate(source, inverseHomography, options) {
  const output = new PNG({ width: options.outputWidth, height: options.outputHeight });
  const noiseRandom = seededRandom(`${options.seed}:noise`);
  const maximumRadiusSquared = 0.5;
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const sourcePoint = applyHomography(inverseHomography, { x, y });
      const sourceX = Math.round(sourcePoint.x);
      const sourceY = Math.round(sourcePoint.y);
      let red = 225;
      let green = 224;
      let blue = 220;
      if (sourceX >= 0 && sourceY >= 0 && sourceX < source.width && sourceY < source.height) {
        const sourceOffset = ((sourceY * source.width) + sourceX) * 4;
        red = source.data[sourceOffset];
        green = source.data[sourceOffset + 1];
        blue = source.data[sourceOffset + 2];
      }
      const normalizedX = (x / Math.max(1, output.width - 1)) - 0.5;
      const normalizedY = (y / Math.max(1, output.height - 1)) - 0.5;
      const radiusSquared = (normalizedX * normalizedX) + (normalizedY * normalizedY);
      const illumination = options.brightness +
        (options.illuminationGradient * ((normalizedX * 0.7) + (normalizedY * 0.3))) -
        (options.vignette * (radiusSquared / maximumRadiusSquared));
      const noise = (noiseRandom() - 0.5) * 2 * options.noiseAmplitude;
      setPixel(
        output,
        x,
        y,
        clampByte((red * illumination) + noise),
        clampByte((green * illumination) + noise),
        clampByte((blue * illumination) + noise)
      );
    }
  }
  return output;
}

function rectCorners(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ];
}

function createBoxGroundTruth(homography) {
  return Object.freeze(buildTemplateMap().rows.flatMap((row) => row.digitBoxes.map((box) => {
    const rect = box.visualRect;
    const templateCenter = { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) };
    return Object.freeze({
      rowIndex: row.rowIndex,
      digitIndex: box.digitIndex,
      templateRect: rect,
      templateCenter: Object.freeze(templateCenter),
      photoPolygon: Object.freeze(rectCorners(rect).map((point) => applyHomography(homography, point))),
      photoCenter: applyHomography(homography, templateCenter)
    });
  })));
}

export function createDistortedAttendanceFixture({
  templatePng,
  seed = "normalization-fixture-v1",
  outputWidth = 1000,
  outputHeight = 1650,
  pageFill = 0.84,
  rotationDegrees = 2.75,
  perspective = 0.025,
  brightness = 0.96,
  illuminationGradient = 0.18,
  vignette = 0.08,
  noiseAmplitude = 2.5,
  digitRenderer = "BITMAP_5X7",
  fontFamily = "Helvetica Neue",
  participantCount = 40
} = {}) {
  if (![outputWidth, outputHeight].every((value) => Number.isInteger(value) && value > 100)) {
    throw new TypeError("Las dimensiones de salida deben ser enteros mayores a 100");
  }
  if (Math.abs(rotationDegrees) > 8 || perspective < 0 || perspective > 0.08) {
    throw new RangeError("La deformacion solicitada excede los limites seguros del fixture");
  }
  if (!["BITMAP_5X7", "SYSTEM_FONT"].includes(digitRenderer)) {
    throw new TypeError("digitRenderer debe ser BITMAP_5X7 o SYSTEM_FONT");
  }
  if (!Number.isInteger(participantCount) || participantCount < 0 || participantCount > 40) {
    throw new TypeError("participantCount debe ser un entero entre 0 y 40");
  }
  const source = decodeTemplate(templatePng);
  const syntheticRows = createSyntheticRows(source, seed, { digitRenderer, fontFamily, participantCount });
  const sourceCorners = Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: source.width - 1, y: 0 }),
    Object.freeze({ x: source.width - 1, y: source.height - 1 }),
    Object.freeze({ x: 0, y: source.height - 1 })
  ]);
  const photoCorners = createDestinationQuadrilateral({
    sourceWidth: source.width,
    sourceHeight: source.height,
    outputWidth,
    outputHeight,
    pageFill,
    rotationDegrees,
    perspective,
    seed
  });
  const templateToPhotoHomography = solveHomography(sourceCorners, photoCorners);
  const photoToTemplateHomography = invertHomography(templateToPhotoHomography);
  const photo = warpTemplate(source, photoToTemplateHomography, {
    outputWidth,
    outputHeight,
    seed,
    brightness,
    illuminationGradient,
    vignette,
    noiseAmplitude
  });
  return Object.freeze({
    png: PNG.sync.write(photo),
    mimeType: "image/png",
    privacy: "SYNTHETIC_ANONYMIZED_NO_REAL_PERSONAL_DATA",
    seed: String(seed),
    dimensions: Object.freeze({ width: outputWidth, height: outputHeight }),
    distortion: Object.freeze({
      rotationDegrees,
      perspective,
      brightness,
      illuminationGradient,
      vignette,
      noiseAmplitude,
      digitRenderer,
      fontFamily: digitRenderer === "SYSTEM_FONT" ? fontFamily : null,
      participantCount
    }),
    syntheticRows,
    groundTruth: Object.freeze({
      sourceCorners,
      photoCorners,
      templateToPhotoHomography,
      photoToTemplateHomography,
      digitBoxes: createBoxGroundTruth(templateToPhotoHomography)
    })
  });
}
