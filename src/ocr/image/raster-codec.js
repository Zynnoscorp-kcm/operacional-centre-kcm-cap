import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { RasterProcessingError } from "./errors.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new RasterProcessingError("RASTER_BYTES_REQUIRED", "La imagen raster no contiene bytes validos", {
    stage: "DECODE",
    recoverable: false
  });
}

export function detectRasterMimeType(bytes) {
  const buffer = asBuffer(bytes);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
}

export function readJpegExifOrientation(bytes) {
  const buffer = asBuffer(bytes);
  if (detectRasterMimeType(buffer) !== "image/jpeg") return 1;
  let offset = 2;

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;

    if (marker === 0xe1 && length >= 16 && buffer.subarray(offset + 2, offset + 8).toString("ascii") === "Exif\0\0") {
      const tiff = offset + 8;
      const littleEndian = buffer.subarray(tiff, tiff + 2).toString("ascii") === "II";
      const read16 = (position) => littleEndian ? buffer.readUInt16LE(position) : buffer.readUInt16BE(position);
      const read32 = (position) => littleEndian ? buffer.readUInt32LE(position) : buffer.readUInt32BE(position);
      if (read16(tiff + 2) !== 42) return 1;
      const ifd = tiff + read32(tiff + 4);
      if (ifd + 2 > buffer.length) return 1;
      const entries = read16(ifd);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + (index * 12);
        if (entry + 12 > buffer.length) break;
        if (read16(entry) !== 0x0112) continue;
        const orientation = read16(entry + 8);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    offset += length;
  }
  return 1;
}

function assertDecodedRaster(decoded) {
  if (!Number.isInteger(decoded?.width) || !Number.isInteger(decoded?.height) || decoded.width <= 0 || decoded.height <= 0) {
    throw new RasterProcessingError("RASTER_DIMENSIONS_INVALID", "No fue posible determinar las dimensiones raster", {
      stage: "DECODE"
    });
  }
  if (!decoded.data || decoded.data.length !== decoded.width * decoded.height * 4) {
    throw new RasterProcessingError("RASTER_RGBA_INVALID", "La decodificacion no produjo RGBA completo", {
      stage: "DECODE"
    });
  }
}

export function decodeRaster(bytes, {
  declaredMimeType = null,
  maxBytes = 20 * 1024 * 1024,
  maxPixels = 50_000_000,
  maxDimension = 18_000
} = {}) {
  const buffer = asBuffer(bytes);
  if (![maxBytes, maxPixels, maxDimension].every((value) => Number.isInteger(value) && value > 0)) {
    throw new RasterProcessingError("RASTER_LIMITS_INVALID", "Los limites de decodificacion raster son invalidos", {
      stage: "DECODE",
      recoverable: false
    });
  }
  if (buffer.length > maxBytes) {
    throw new RasterProcessingError("RASTER_BYTES_TOO_LARGE", "La imagen raster excede el limite de bytes", { stage: "DECODE" });
  }
  const mimeType = detectRasterMimeType(buffer);
  if (!mimeType) {
    throw new RasterProcessingError("RASTER_FORMAT_UNSUPPORTED", "Solo se admiten imagenes PNG o JPEG ya rasterizadas", {
      stage: "DECODE"
    });
  }
  if (declaredMimeType && declaredMimeType !== mimeType) {
    throw new RasterProcessingError("RASTER_MIME_MISMATCH", "El tipo declarado no coincide con la firma raster", {
      stage: "DECODE"
    });
  }

  try {
    let decoded;
    let exifOrientation = 1;
    if (mimeType === "image/png") {
      if (buffer.length < 24 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
        throw new RasterProcessingError("RASTER_DECODE_FAILED", "El encabezado PNG es invalido", { stage: "DECODE" });
      }
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > maxDimension || height > maxDimension || (width * height) > maxPixels) {
        throw new RasterProcessingError("RASTER_DIMENSIONS_TOO_LARGE", "La imagen raster excede el limite de pixeles", { stage: "DECODE" });
      }
      decoded = PNG.sync.read(buffer, { skipRescale: false });
    } else {
      exifOrientation = readJpegExifOrientation(buffer);
      decoded = jpeg.decode(buffer, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: true,
        maxResolutionInMP: maxPixels / 1_000_000,
        maxMemoryUsageInMB: 256
      });
    }
    if (decoded.width > maxDimension || decoded.height > maxDimension || (decoded.width * decoded.height) > maxPixels) {
      throw new RasterProcessingError("RASTER_DIMENSIONS_TOO_LARGE", "La imagen raster excede el limite de pixeles", { stage: "DECODE" });
    }
    assertDecodedRaster(decoded);
    return Object.freeze({
      width: decoded.width,
      height: decoded.height,
      data: Buffer.from(decoded.data),
      mimeType,
      exifOrientation
    });
  } catch (error) {
    if (error instanceof RasterProcessingError) throw error;
    throw new RasterProcessingError("RASTER_DECODE_FAILED", "No fue posible decodificar la imagen raster", {
      stage: "DECODE",
      cause: error
    });
  }
}

export function encodeRasterPng(raster, { compressionLevel = 9 } = {}) {
  assertDecodedRaster(raster);
  try {
    return PNG.sync.write({
      width: raster.width,
      height: raster.height,
      data: Buffer.from(raster.data)
    }, {
      colorType: 6,
      inputColorType: 6,
      inputHasAlpha: true,
      deflateLevel: compressionLevel,
      deflateStrategy: 3
    });
  } catch (error) {
    throw new RasterProcessingError("PNG_ENCODE_FAILED", "No fue posible codificar la imagen normalizada", {
      stage: "ENCODE",
      cause: error
    });
  }
}
