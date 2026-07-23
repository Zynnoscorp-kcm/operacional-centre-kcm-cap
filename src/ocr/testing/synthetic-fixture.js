import { deflateSync } from "node:zlib";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(payload), data.length + 8);
  return chunk;
}

function setPixel(raw, width, height, x, y, value = 0) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * ((width * 3) + 1)) + 1 + (x * 3);
  raw[offset] = value;
  raw[offset + 1] = value;
  raw[offset + 2] = value;
}

function drawLine(raw, width, height, x1, y1, x2, y2, value = 0) {
  if (y1 === y2) {
    for (let x = x1; x <= x2; x += 1) setPixel(raw, width, height, x, y1, value);
    return;
  }
  if (x1 === x2) {
    for (let y = y1; y <= y2; y += 1) setPixel(raw, width, height, x1, y, value);
  }
}

function drawBox(raw, width, height, x, y, boxWidth, boxHeight) {
  drawLine(raw, width, height, x, y, x + boxWidth, y);
  drawLine(raw, width, height, x, y + boxHeight, x + boxWidth, y + boxHeight);
  drawLine(raw, width, height, x, y, x, y + boxHeight);
  drawLine(raw, width, height, x + boxWidth, y, x + boxWidth, y + boxHeight);
}

export function createSyntheticAttendancePng({ width = 1216, height = 2002 } = {}) {
  const stride = (width * 3) + 1;
  const raw = Buffer.alloc(stride * height, 0xff);
  for (let row = 0; row < height; row += 1) raw[row * stride] = 0;

  const scaleX = width / 1216;
  const scaleY = height / 2002;
  const x = (value) => Math.round(value * scaleX);
  const y = (value) => Math.round(value * scaleY);
  const boundaries = [
    265, 306, 348, 389, 431, 473, 515, 556, 598, 640,
    681, 723, 765, 807, 848, 890, 932, 973, 1015, 1057,
    1099, 1140, 1182, 1224, 1265, 1307, 1349, 1390, 1432, 1474,
    1516, 1557, 1599, 1641, 1682, 1724, 1766, 1808, 1849, 1891, 1933
  ];
  const digitX = [140, 167, 193, 220, 246];
  const digitWidths = [26, 25, 26, 25, 26];

  for (const boundary of boundaries) drawLine(raw, width, height, x(95), y(boundary), x(1190), y(boundary), 40);
  for (const column of [95, 131, 281, 603, 738, 889, 1068, 1129, 1190]) {
    drawLine(raw, width, height, x(column), y(214), x(column), y(1933), 40);
  }
  for (let rowIndex = 0; rowIndex < 40; rowIndex += 1) {
    for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
      drawBox(
        raw,
        width,
        height,
        x(digitX[digitIndex]),
        y(boundaries[rowIndex] + 5),
        x(digitWidths[digitIndex]),
        y(31)
      );
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export function createSyntheticPdf({ pages = 1 } = {}) {
  const pageObjects = Array.from({ length: pages }, (_, index) => `${index + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj`).join("\n");
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n${pageObjects}\n%%EOF`, "ascii");
}

