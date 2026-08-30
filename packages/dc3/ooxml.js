import { createHash } from "node:crypto";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const MAX_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;

function crc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = crc32Table();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("El archivo no contiene un directorio ZIP valido");
}

function decodeZipName(buffer, utf8) {
  const value = buffer.toString(utf8 ? "utf8" : "latin1").replaceAll("\\", "/");
  if (value.includes("\0")) throw new Error("El ZIP contiene un nombre de entrada invalido");
  const normalized = path.posix.normalize(value).replace(/^\/+/, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("El ZIP contiene una ruta fuera del paquete");
  }
  return normalized;
}

export class ZipArchive {
  constructor(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
      throw new TypeError("Se esperaba el contenido binario de un archivo OOXML");
    }
    this.buffer = buffer;
    this.entries = new Map();
    this.#readCentralDirectory();
  }

  #readCentralDirectory() {
    const eocd = findEndOfCentralDirectory(this.buffer);
    const diskNumber = this.buffer.readUInt16LE(eocd + 4);
    const centralDisk = this.buffer.readUInt16LE(eocd + 6);
    const diskEntries = this.buffer.readUInt16LE(eocd + 8);
    const totalEntries = this.buffer.readUInt16LE(eocd + 10);
    const centralSize = this.buffer.readUInt32LE(eocd + 12);
    const centralOffset = this.buffer.readUInt32LE(eocd + 16);
    if (
      diskNumber !== 0 ||
      centralDisk !== 0 ||
      diskEntries !== totalEntries ||
      totalEntries === 0 ||
      totalEntries === 0xffff ||
      totalEntries > MAX_ZIP_ENTRIES ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    ) {
      throw new Error("ZIP vacio, multidisco, ZIP64 o sobredimensionado no soportado");
    }
    if (centralOffset + centralSize > eocd) {
      throw new Error("El directorio ZIP esta truncado");
    }

    let offset = centralOffset;
    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > this.buffer.length || this.buffer.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("Entrada invalida en el directorio ZIP");
      }
      const flags = this.buffer.readUInt16LE(offset + 8);
      const method = this.buffer.readUInt16LE(offset + 10);
      const expectedCrc = this.buffer.readUInt32LE(offset + 16);
      const compressedSize = this.buffer.readUInt32LE(offset + 20);
      const uncompressedSize = this.buffer.readUInt32LE(offset + 24);
      const nameLength = this.buffer.readUInt16LE(offset + 28);
      const extraLength = this.buffer.readUInt16LE(offset + 30);
      const commentLength = this.buffer.readUInt16LE(offset + 32);
      const diskStart = this.buffer.readUInt16LE(offset + 34);
      const localOffset = this.buffer.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > this.buffer.length) throw new Error("Nombre de entrada ZIP truncado");
      if ((flags & 0x0001) !== 0) throw new Error("Los libros cifrados no son compatibles");
      if (diskStart !== 0) throw new Error("ZIP multidisco no soportado");
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("ZIP64 no soportado");
      }
      if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
        throw new Error("Una entrada ZIP excede el limite seguro");
      }
      if (method !== 0 && method !== 8) {
        throw new Error(`Metodo de compresion ZIP no soportado: ${method}`);
      }
      const name = decodeZipName(
        this.buffer.subarray(offset + 46, offset + 46 + nameLength),
        (flags & 0x0800) !== 0
      );
      if (this.entries.has(name)) throw new Error("El ZIP contiene entradas duplicadas");
      this.entries.set(name, {
        compressedSize,
        expectedCrc,
        flags,
        localOffset,
        method,
        uncompressedSize
      });
      offset = end;
    }
    if (offset !== centralOffset + centralSize) {
      throw new Error("El tamano del directorio ZIP no coincide");
    }
  }

  has(name) {
    return this.entries.has(path.posix.normalize(name));
  }

  names() {
    return [...this.entries.keys()];
  }

  read(name) {
    const normalizedName = path.posix.normalize(name);
    const entry = this.entries.get(normalizedName);
    if (!entry) throw new Error(`Falta una parte requerida del libro: ${normalizedName}`);
    const offset = entry.localOffset;
    if (offset + 30 > this.buffer.length || this.buffer.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error("Encabezado local ZIP invalido");
    }
    const localFlags = this.buffer.readUInt16LE(offset + 6);
    const localMethod = this.buffer.readUInt16LE(offset + 8);
    const nameLength = this.buffer.readUInt16LE(offset + 26);
    const extraLength = this.buffer.readUInt16LE(offset + 28);
    if ((localFlags & 0x0001) !== 0 || localMethod !== entry.method) {
      throw new Error("La entrada ZIP no coincide con su directorio");
    }
    const start = offset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > this.buffer.length) throw new Error("Contenido ZIP truncado");
    const compressed = this.buffer.subarray(start, end);
    const output = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
    if (output.length !== entry.uncompressedSize || crc32(output) !== entry.expectedCrc) {
      throw new Error("La integridad CRC de una parte OOXML no coincide");
    }
    return output;
  }
}

export function buildZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
    throw new Error("El conjunto de entradas ZIP es invalido");
  }
  const seen = new Set();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [nameValue, source] of entries) {
    const name = decodeZipName(Buffer.from(String(nameValue), "utf8"), true);
    if (seen.has(name)) throw new Error("No se pueden escribir entradas ZIP duplicadas");
    seen.add(name);
    const data = Buffer.from(source);
    if (data.length > MAX_ZIP_ENTRY_BYTES) throw new Error("Una entrada ZIP excede el limite seguro");
    const compressed = deflateRawSync(data, { level: 6 });
    const nameBuffer = Buffer.from(name, "utf8");
    const checksum = crc32(data);
    const flags = 0x0800;
    const method = 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function rebuildZip(archive, replacements = new Map()) {
  const replacementMap = replacements instanceof Map
    ? replacements
    : new Map(Object.entries(replacements));
  for (const name of replacementMap.keys()) {
    if (!archive.has(name)) throw new Error(`No se puede reemplazar una parte inexistente: ${name}`);
  }
  return buildZip(archive.names().map((name) => [
    name,
    replacementMap.has(name) ? replacementMap.get(name) : archive.read(name)
  ]));
}

export function decodeXml(value) {
  return String(value ?? "").replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const named = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&apos;": "'"
      };
      const lower = entity.toLowerCase();
      if (named[lower]) return named[lower];
      const numeric = lower.startsWith("&#x")
        ? Number.parseInt(lower.slice(3, -1), 16)
        : Number.parseInt(lower.slice(2, -1), 10);
      return Number.isInteger(numeric) ? String.fromCodePoint(numeric) : entity;
    }
  );
}

export function encodeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function parseXmlAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/gs;
  let match;
  while ((match = pattern.exec(String(source ?? ""))) !== null) {
    attributes[match[1].replace(/^.*:/, "")] = decodeXml(match[3]);
  }
  return attributes;
}

export function parseRelationships(xmlBuffer, ownerPart) {
  const relationships = new Map();
  const xml = Buffer.isBuffer(xmlBuffer) ? xmlBuffer.toString("utf8") : String(xmlBuffer);
  const pattern = /<(?:\w+:)?Relationship\b([^>]*)\/?>/gi;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const attributes = parseXmlAttributes(match[1]);
    if (!attributes.Id || !attributes.Target || !attributes.Type) continue;
    if (relationships.has(attributes.Id)) throw new Error("Relacion OOXML duplicada");
    const external = String(attributes.TargetMode || "").toLowerCase() === "external";
    let target = null;
    if (!external) {
      let decodedTarget = attributes.Target;
      try {
        decodedTarget = decodeURIComponent(decodedTarget);
      } catch {
        // Se conserva el nombre literal si no es una URI valida.
      }
      decodedTarget = decodedTarget.replaceAll("\\", "/");
      target = path.posix.normalize(
        decodedTarget.startsWith("/")
          ? decodedTarget.replace(/^\/+/, "")
          : path.posix.join(path.posix.dirname(ownerPart), decodedTarget)
      );
      if (target === ".." || target.startsWith("../")) {
        throw new Error("Una relacion OOXML sale del paquete");
      }
    }
    relationships.set(attributes.Id, { external, target, type: attributes.Type });
  }
  return relationships;
}
