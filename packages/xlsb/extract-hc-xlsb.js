#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import path from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_MASTER_NAME = "Matriz de Competencias 24 Julio_.xlsb";
const SNAPSHOT_SCHEMA = "HC_SNAPSHOT_V1";
const MAX_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_BIFF_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const FIRST_COURSE_COLUMN = 9;
const DEFAULT_LAST_COURSE_COLUMN = 35;
const BLOCKING_DIAGNOSTIC_CODES = new Set([
  "AMBIGUOUS_COURSE_SOURCE_KEY",
  "COMPLETION_FORMULA_CACHE_ERROR",
  "COURSE_HEADER_MISSING",
  "COURSE_RANGE_TRUNCATED",
  "DUPLICATE_CELL_RECORD",
  "DUPLICATE_EMPLOYEE_ID",
  "EMPLOYEE_FORMULA_CACHE_ERROR",
  "EMPTY_DISPLAY_NAME",
  "FORMULA_CACHE_ERROR",
  "INVALID_COMPLETION_DATE",
  "INVALID_EMPLOYEE_ID",
  "INVALID_HIRE_DATE",
  "UNEXPECTED_COURSE_COUNT"
]);

const BIFF = Object.freeze({
  ROW_HEADER: 0x0000,
  CELL_BLANK: 0x0001,
  CELL_RK: 0x0002,
  CELL_ERROR: 0x0003,
  CELL_BOOL: 0x0004,
  CELL_REAL: 0x0005,
  CELL_STRING: 0x0006,
  CELL_SHARED_STRING: 0x0007,
  FORMULA_STRING: 0x0008,
  FORMULA_NUMBER: 0x0009,
  FORMULA_BOOL: 0x000a,
  FORMULA_ERROR: 0x000b,
  BEGIN_SHEET_DATA: 0x0091,
  END_SHEET_DATA: 0x0092,
  WORKBOOK_PROPERTIES: 0x0099,
  BUNDLE_SHEET: 0x009c,
  BEGIN_SHARED_STRINGS: 0x009f,
  END_SHARED_STRINGS: 0x00a0,
  MERGED_CELL: 0x00b0,
  SHARED_STRING_ITEM: 0x0013
});

const CELL_RECORD_TYPES = new Set([
  BIFF.CELL_BLANK,
  BIFF.CELL_RK,
  BIFF.CELL_ERROR,
  BIFF.CELL_BOOL,
  BIFF.CELL_REAL,
  BIFF.CELL_STRING,
  BIFF.CELL_SHARED_STRING,
  BIFF.FORMULA_STRING,
  BIFF.FORMULA_NUMBER,
  BIFF.FORMULA_BOOL,
  BIFF.FORMULA_ERROR
]);

const ERROR_VALUES = Object.freeze({
  0x00: "#NULL!",
  0x07: "#DIV/0!",
  0x0f: "#VALUE!",
  0x17: "#REF!",
  0x1d: "#NAME?",
  0x24: "#NUM!",
  0x2a: "#N/A",
  0x2b: "#GETTING_DATA"
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
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
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("El ZIP contiene una ruta fuera del paquete");
  }
  return normalized;
}

class ZipArchive {
  constructor(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
      throw new TypeError("Se esperaba el contenido binario de un XLSB");
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
      totalEntries === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    ) {
      throw new Error("ZIP multidisco o ZIP64 no soportado");
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
      if ((flags & 0x0001) !== 0) throw new Error("Los XLSB cifrados no son compatibles");
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

  read(name) {
    const normalizedName = path.posix.normalize(name);
    const entry = this.entries.get(normalizedName);
    if (!entry) throw new Error(`Falta una parte requerida del XLSB: ${normalizedName}`);
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
      throw new Error("La integridad CRC de una parte XLSB no coincide");
    }
    return output;
  }
}

function readRecordType(buffer, state) {
  if (state.offset >= buffer.length) throw new Error("Encabezado BIFF12 truncado");
  const first = buffer[state.offset];
  state.offset += 1;
  if ((first & 0x80) === 0) return first;
  if (state.offset >= buffer.length) throw new Error("Tipo BIFF12 truncado");
  const second = buffer[state.offset];
  state.offset += 1;
  if ((second & 0x80) !== 0) throw new Error("Tipo BIFF12 invalido");
  return (first & 0x7f) | (second << 7);
}

function readRecordLength(buffer, state) {
  let value = 0;
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    if (state.offset >= buffer.length) throw new Error("Longitud BIFF12 truncada");
    const byte = buffer[state.offset];
    state.offset += 1;
    value |= (byte & 0x7f) << (byteIndex * 7);
    if ((byte & 0x80) === 0) {
      if (value > MAX_BIFF_RECORD_BYTES) throw new Error("Registro BIFF12 demasiado grande");
      return value;
    }
  }
  throw new Error("Longitud BIFF12 invalida");
}

function* biffRecords(buffer) {
  const state = { offset: 0 };
  while (state.offset < buffer.length) {
    const type = readRecordType(buffer, state);
    const length = readRecordLength(buffer, state);
    const end = state.offset + length;
    if (end > buffer.length) throw new Error("Registro BIFF12 truncado");
    yield { type, payload: buffer.subarray(state.offset, end) };
    state.offset = end;
  }
}

function readWideString(buffer, offset, context) {
  if (offset + 4 > buffer.length) throw new Error(`${context}: cadena truncada`);
  const codeUnits = buffer.readUInt32LE(offset);
  if (codeUnits === 0xffffffff) return { value: "", offset: offset + 4 };
  const start = offset + 4;
  const end = start + codeUnits * 2;
  if (codeUnits > 32_767 || end > buffer.length) throw new Error(`${context}: cadena invalida`);
  return { value: buffer.toString("utf16le", start, end), offset: end };
}

function parseRichString(payload) {
  if (payload.length < 5) throw new Error("Cadena compartida XLSB truncada");
  const flags = payload[0];
  const parsed = readWideString(payload, 1, "Cadena compartida XLSB");
  let offset = parsed.offset;
  if ((flags & 0x01) !== 0) {
    if (offset + 4 > payload.length) throw new Error("Formato enriquecido XLSB truncado");
    const runCount = payload.readUInt32LE(offset);
    offset += 4 + runCount * 4;
  }
  if ((flags & 0x02) !== 0) {
    if (offset + 4 > payload.length) throw new Error("Extension de cadena XLSB truncada");
    const extensionSize = payload.readUInt32LE(offset);
    offset += 4 + extensionSize;
  }
  if (offset > payload.length) throw new Error("Cadena compartida XLSB invalida");
  return parsed.value;
}

function parseSharedStrings(buffer) {
  if (!buffer) return [];
  const values = [];
  let declaredUnique = null;
  let inside = false;
  for (const record of biffRecords(buffer)) {
    if (record.type === BIFF.BEGIN_SHARED_STRINGS) {
      if (record.payload.length < 8) throw new Error("Tabla de cadenas compartidas truncada");
      declaredUnique = record.payload.readUInt32LE(4);
      inside = true;
    } else if (record.type === BIFF.SHARED_STRING_ITEM && inside) {
      values.push(parseRichString(record.payload));
    } else if (record.type === BIFF.END_SHARED_STRINGS) {
      inside = false;
    }
  }
  if (declaredUnique !== null && values.length !== declaredUnique) {
    throw new Error("La tabla de cadenas compartidas esta incompleta");
  }
  return values;
}

function parseWorkbook(buffer) {
  const sheets = [];
  let dateSystem = "1900";
  for (const record of biffRecords(buffer)) {
    if (record.type === BIFF.WORKBOOK_PROPERTIES) {
      if (record.payload.length < 4) throw new Error("Propiedades del libro truncadas");
      dateSystem = (record.payload.readUInt32LE(0) & 0x00000001) !== 0 ? "1904" : "1900";
    } else if (record.type === BIFF.BUNDLE_SHEET) {
      if (record.payload.length < 16) throw new Error("Definicion de hoja truncada");
      const state = record.payload.readUInt32LE(0);
      const sheetId = record.payload.readUInt32LE(4);
      const relationship = readWideString(record.payload, 8, "Relacion de hoja");
      const name = readWideString(record.payload, relationship.offset, "Nombre de hoja");
      sheets.push({
        name: name.value,
        relationshipId: relationship.value,
        sheetId,
        state
      });
    }
  }
  if (sheets.length === 0) throw new Error("El libro no contiene definiciones de hojas");
  return { dateSystem, sheets };
}

function decodeXml(value) {
  return value.replace(
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

function parseRelationships(buffer, ownerPart) {
  const xml = buffer.toString("utf8");
  const relationships = new Map();
  const elementPattern = /<(?:\w+:)?Relationship\b([^>]*)\/?>/gi;
  let element;
  while ((element = elementPattern.exec(xml)) !== null) {
    const attributes = {};
    const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/gs;
    let attribute;
    while ((attribute = attributePattern.exec(element[1])) !== null) {
      attributes[attribute[1].replace(/^.*:/, "")] = decodeXml(attribute[3]);
    }
    if (!attributes.Id || !attributes.Target || !attributes.Type) continue;
    if (relationships.has(attributes.Id)) throw new Error("Relacion XLSB duplicada");
    const targetMode = String(attributes.TargetMode || "").toLowerCase();
    let target = null;
    if (targetMode !== "external") {
      let decodedTarget = attributes.Target;
      try {
        decodedTarget = decodeURIComponent(decodedTarget);
      } catch {
      }
      decodedTarget = decodedTarget.replaceAll("\\", "/");
      target = path.posix.normalize(
        decodedTarget.startsWith("/")
          ? decodedTarget.replace(/^\/+/, "")
          : path.posix.join(path.posix.dirname(ownerPart), decodedTarget)
      );
      if (target === ".." || target.startsWith("../")) {
        throw new Error("Una relacion XLSB sale del paquete");
      }
    }
    relationships.set(attributes.Id, {
      external: targetMode === "external",
      target,
      type: attributes.Type
    });
  }
  return relationships;
}

export function normalizedLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function normalizedCourseName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findSheet(workbook, requestedName) {
  const wanted = normalizedLabel(requestedName);
  const matches = workbook.sheets.filter(({ name }) => normalizedLabel(name) === wanted);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? `No se encontro la hoja ${requestedName}`
      : `La hoja ${requestedName} es ambigua`);
  }
  return matches[0];
}

function relationshipByType(relationships, suffix) {
  const matches = [...relationships.values()].filter(
    (relationship) => !relationship.external && relationship.type.endsWith(suffix)
  );
  if (matches.length > 1) throw new Error(`Hay varias relaciones ${suffix}`);
  return matches[0] || null;
}

function parseRkNumber(payload, offset) {
  const raw = payload.readUInt32LE(offset);
  let value;
  if ((raw & 0x02) !== 0) {
    value = raw >> 2;
  } else {
    const double = Buffer.alloc(8);
    double.writeUInt32LE(0, 0);
    double.writeUInt32LE(raw & 0xfffffffc, 4);
    value = double.readDoubleLE(0);
  }
  return (raw & 0x01) !== 0 ? value / 100 : value;
}

function parseCell(record, sharedStrings) {
  const payload = record.payload;
  if (payload.length < 8) throw new Error("Celda BIFF12 truncada");
  const column = payload.readUInt32LE(0);
  if (column >= MAX_COLUMNS) throw new Error("Columna BIFF12 fuera de rango");
  const style = payload.readUInt32LE(4) & 0x00ffffff;
  const formula = record.type >= BIFF.FORMULA_STRING && record.type <= BIFF.FORMULA_ERROR;
  let value = null;
  let error = null;

  switch (record.type) {
    case BIFF.CELL_BLANK:
      break;
    case BIFF.CELL_RK:
      if (payload.length < 12) throw new Error("Numero RK truncado");
      value = parseRkNumber(payload, 8);
      break;
    case BIFF.CELL_ERROR:
    case BIFF.FORMULA_ERROR:
      if (payload.length < 9) throw new Error("Error de celda truncado");
      error = ERROR_VALUES[payload[8]] || `ERROR_${payload[8]}`;
      break;
    case BIFF.CELL_BOOL:
    case BIFF.FORMULA_BOOL:
      if (payload.length < 9) throw new Error("Booleano de celda truncado");
      value = payload[8] !== 0;
      break;
    case BIFF.CELL_REAL:
    case BIFF.FORMULA_NUMBER:
      if (payload.length < 16) throw new Error("Numero de celda truncado");
      value = payload.readDoubleLE(8);
      if (!Number.isFinite(value)) error = "INVALID_NUMBER";
      break;
    case BIFF.CELL_STRING:
    case BIFF.FORMULA_STRING:
      value = readWideString(payload, 8, "Texto de celda").value;
      break;
    case BIFF.CELL_SHARED_STRING: {
      if (payload.length < 12) throw new Error("Indice de cadena compartida truncado");
      const index = payload.readUInt32LE(8);
      if (index >= sharedStrings.length) throw new Error("Indice de cadena compartida invalido");
      value = sharedStrings[index];
      break;
    }
    default:
      throw new Error("Tipo de celda no soportado");
  }
  return { column, error, formula, style, value };
}

function parseWorksheet(buffer, sharedStrings) {
  const rows = new Map();
  const merges = [];
  let currentRow = null;
  let inSheetData = false;
  let formulaCells = 0;
  let formulaValues = 0;
  let formulaErrors = 0;
  let duplicateCells = 0;

  for (const record of biffRecords(buffer)) {
    if (record.type === BIFF.BEGIN_SHEET_DATA) {
      inSheetData = true;
      currentRow = null;
      continue;
    }
    if (record.type === BIFF.END_SHEET_DATA) {
      inSheetData = false;
      currentRow = null;
      continue;
    }
    if (record.type === BIFF.MERGED_CELL) {
      if (record.payload.length !== 16) throw new Error("Rango combinado XLSB invalido");
      const merge = {
        firstRow: record.payload.readUInt32LE(0),
        lastRow: record.payload.readUInt32LE(4),
        firstColumn: record.payload.readUInt32LE(8),
        lastColumn: record.payload.readUInt32LE(12)
      };
      if (
        merge.firstRow > merge.lastRow ||
        merge.firstColumn > merge.lastColumn ||
        merge.lastRow >= MAX_ROWS ||
        merge.lastColumn >= MAX_COLUMNS
      ) {
        throw new Error("Rango combinado XLSB fuera de limites");
      }
      merges.push(merge);
      continue;
    }
    if (!inSheetData) continue;
    if (record.type === BIFF.ROW_HEADER) {
      if (record.payload.length < 4) throw new Error("Encabezado de fila truncado");
      currentRow = record.payload.readUInt32LE(0);
      if (currentRow >= MAX_ROWS) throw new Error("Fila BIFF12 fuera de rango");
      if (!rows.has(currentRow)) rows.set(currentRow, new Map());
      continue;
    }
    if (!CELL_RECORD_TYPES.has(record.type)) continue;
    if (currentRow === null) throw new Error("Celda BIFF12 sin encabezado de fila");
    const cell = parseCell(record, sharedStrings);
    const row = rows.get(currentRow);
    if (row.has(cell.column)) duplicateCells += 1;
    row.set(cell.column, cell);
    if (cell.formula) {
      formulaCells += 1;
      if (cell.error) formulaErrors += 1;
      else formulaValues += 1;
    }
  }
  return {
    duplicateCells,
    formulaCells,
    formulaErrors,
    formulaValues,
    merges,
    rows
  };
}

function columnName(zeroBasedColumn) {
  let value = zeroBasedColumn + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function columnIndex(value) {
  if (Number.isInteger(value)) {
    if (value < FIRST_COURSE_COLUMN || value >= MAX_COLUMNS) {
      throw new Error("lastCourseColumn esta fuera de J:XFD");
    }
    return value;
  }
  const text = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(text)) {
    throw new Error("lastCourseColumn debe ser una columna Excel");
  }
  let oneBased = 0;
  for (const character of text) {
    oneBased = oneBased * 26 + character.charCodeAt(0) - 64;
  }
  const zeroBased = oneBased - 1;
  if (zeroBased < FIRST_COURSE_COLUMN || zeroBased >= MAX_COLUMNS) {
    throw new Error("lastCourseColumn esta fuera de J:XFD");
  }
  return zeroBased;
}

function cellAt(rows, row, column) {
  return rows.get(row)?.get(column) || null;
}

function mergedCellAt(rows, merges, row, column) {
  const direct = cellAt(rows, row, column);
  if (direct && direct.value !== null && direct.value !== "") return { cell: direct, merge: null };
  for (const merge of merges) {
    if (
      row >= merge.firstRow &&
      row <= merge.lastRow &&
      column >= merge.firstColumn &&
      column <= merge.lastColumn
    ) {
      return { cell: cellAt(rows, merge.firstRow, merge.firstColumn), merge };
    }
  }
  return { cell: direct, merge: null };
}

function scalarText(cell) {
  if (!cell || cell.error || cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "boolean") return cell.value ? "TRUE" : "FALSE";
  return String(cell.value).trim();
}

function normalizeEmployeeId(cell) {
  if (!cell || cell.error) return null;
  const value = cell.value;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 99_999) return null;
    return String(value).padStart(5, "0");
  }
  const text = String(value ?? "").trim();
  return /^\d{5}$/.test(text) ? text : null;
}

function excelDateToIso(serial, dateSystem) {
  if (!Number.isFinite(serial)) return null;
  const wholeDays = Math.floor(serial);
  let utcMilliseconds;
  if (dateSystem === "1904") {
    if (wholeDays < 0 || wholeDays > 2_957_003) return null;
    utcMilliseconds = Date.UTC(1904, 0, 1) + wholeDays * 86_400_000;
  } else {
    if (wholeDays <= 0 || wholeDays > 2_958_465 || wholeDays === 60) return null;
    const adjustedDays = wholeDays > 60 ? wholeDays - 1 : wholeDays;
    utcMilliseconds = Date.UTC(1899, 11, 31) + adjustedDays * 86_400_000;
  }
  const date = new Date(utcMilliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function calendarDateToIso(text) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local
      ? [Number(local[3]), Number(local[2]), Number(local[1])]
      : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeDateCell(cell, dateSystem) {
  if (!cell || cell.error || cell.value === null || cell.value === "") return null;
  if (typeof cell.value === "number") return excelDateToIso(cell.value, dateSystem);
  const text = String(cell.value).trim();
  if (text === "") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return excelDateToIso(Number(text), dateSystem);
  }
  return calendarDateToIso(text);
}

function textValue(cell) {
  if (!cell || cell.error || cell.value === null || cell.value === undefined) return "";
  return String(cell.value).trim();
}

class Diagnostics {
  constructor() {
    this.entries = new Map();
  }

  add(code, details = {}, increment = 1) {
    const safeDetails = {};
    for (const key of [
      "occurrences",
      "actual",
      "expected",
      "reason",
      "recordType",
      "sourceColumns",
      "sourceKey"
    ]) {
      if (details[key] !== undefined) safeDetails[key] = details[key];
    }
    const detail = Object.keys(safeDetails).length === 0 ? "" : canonicalJson(safeDetails);
    const signature = canonicalJson({ code, detail });
    const existing = this.entries.get(signature);
    if (existing) existing.count += increment;
    else this.entries.set(signature, { code, count: increment, detail });
  }

  issues() {
    return [...this.entries.values()].sort(
      (left, right) => left.code.localeCompare(right.code) ||
        canonicalJson(left).localeCompare(canonicalJson(right))
    );
  }
}

function firstEmployeeRow(rows) {
  for (const rowNumber of [...rows.keys()].sort((left, right) => left - right)) {
    if (normalizeEmployeeId(cellAt(rows, rowNumber, 1))) return rowNumber;
  }
  throw new Error("La hoja HC no contiene numeros de trabajador validos en la columna B");
}

function headerPathForColumn(rows, merges, headerEndRow, column) {
  const pathSegments = [];
  for (let row = 0; row < headerEndRow; row += 1) {
    const { cell, merge } = mergedCellAt(rows, merges, row, column);
    if (merge && merge.firstColumn < 9) continue;
    const text = scalarText(cell);
    const normalized = normalizedLabel(text);
    if (!normalized || pathSegments.at(-1)?.normalized === normalized) continue;
    pathSegments.push({ label: text, normalized });
  }
  return pathSegments;
}

function courseCandidates(rows, merges, headerEndRow, lastCourseColumn, diagnostics) {
  const candidates = [];
  const missingColumns = [];
  for (let column = FIRST_COURSE_COLUMN; column <= lastCourseColumn; column += 1) {
    const pathSegments = headerPathForColumn(rows, merges, headerEndRow, column);
    if (pathSegments.length === 0) {
      diagnostics.add("COURSE_HEADER_MISSING", { sourceColumns: [columnName(column)] });
      missingColumns.push(column);
      continue;
    }
    const headerPath = pathSegments.map(({ label }) => label);
    const sourceKey = `hc-course:${pathSegments.map(({ normalized }) => normalized).join("/")}`;
    candidates.push({
      sourceKey,
      name: headerPath.at(-1),
      headerPath,
      active: true,
      sourceColumn: columnName(column),
      column
    });
  }
  return { candidates, missingColumns };
}

function courseHeaderColumnsBeyondLimit(rows, merges, headerEndRow, lastCourseColumn) {
  const found = new Set();
  for (const [rowNumber, row] of rows) {
    if (rowNumber >= headerEndRow) continue;
    for (const [column, cell] of row) {
      if (column > lastCourseColumn && column >= FIRST_COURSE_COLUMN && scalarText(cell)) {
        found.add(column);
      }
    }
  }
  for (const merge of merges) {
    if (
      merge.firstRow >= headerEndRow ||
      merge.lastColumn <= lastCourseColumn ||
      merge.lastColumn < FIRST_COURSE_COLUMN
    ) {
      continue;
    }
    const master = cellAt(rows, merge.firstRow, merge.firstColumn);
    if (!scalarText(master)) continue;
    for (
      let column = Math.max(lastCourseColumn + 1, merge.firstColumn, FIRST_COURSE_COLUMN);
      column <= merge.lastColumn;
      column += 1
    ) {
      found.add(column);
    }
  }
  return [...found].sort((left, right) => left - right);
}

function selectUnambiguousCourses(candidates, diagnostics) {
  const grouped = new Map();
  for (const course of candidates) {
    if (!grouped.has(course.sourceKey)) grouped.set(course.sourceKey, []);
    grouped.get(course.sourceKey).push(course);
  }
  const selected = [];
  const ambiguous = [];
  for (const [sourceKey, matches] of grouped) {
    if (matches.length !== 1) {
      ambiguous.push(...matches);
      diagnostics.add("AMBIGUOUS_COURSE_SOURCE_KEY", {
        occurrences: matches.length,
        sourceColumns: matches.map(({ sourceColumn }) => sourceColumn),
        sourceKey
      });
      continue;
    }
    selected.push(matches[0]);
  }
  return {
    ambiguous,
    selected: selected.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
  };
}

function employeeRows(rows, headerEndRow, diagnostics) {
  const grouped = new Map();
  let invalidRows = 0;
  let candidates = 0;
  for (const rowNumber of [...rows.keys()].sort((left, right) => left - right)) {
    if (rowNumber < headerEndRow) continue;
    const identityCell = cellAt(rows, rowNumber, 1);
    if (!identityCell || (identityCell.value === null && !identityCell.error)) continue;
    candidates += 1;
    const employeeId = normalizeEmployeeId(identityCell);
    if (!employeeId) {
      invalidRows += 1;
      diagnostics.add("INVALID_EMPLOYEE_ID");
      continue;
    }
    if (!grouped.has(employeeId)) grouped.set(employeeId, []);
    grouped.get(employeeId).push(rowNumber);
  }

  const selected = [];
  let duplicateRows = 0;
  for (const [employeeId, matches] of grouped) {
    if (matches.length !== 1) {
      duplicateRows += matches.length;
      diagnostics.add("DUPLICATE_EMPLOYEE_ID", { occurrences: matches.length });
      continue;
    }
    selected.push({ employeeId, rowNumber: matches[0] });
  }
  selected.sort((left, right) => left.employeeId.localeCompare(right.employeeId));
  return { candidates, duplicateRows, invalidRows, selected };
}

function buildEmployees(rows, selectedRows, dateSystem, diagnostics) {
  let invalidHireDates = 0;
  let employeeFormulaErrors = 0;
  let emptyDisplayNames = 0;
  let rejectedRows = 0;
  const acceptedRows = [];
  const employees = [];
  for (const selected of selectedRows) {
    const { employeeId, rowNumber } = selected;
    let rowFormulaErrors = 0;
    for (let column = 1; column <= 8; column += 1) {
      if (cellAt(rows, rowNumber, column)?.error) rowFormulaErrors += 1;
    }
    employeeFormulaErrors += rowFormulaErrors;
    const hireDateCell = cellAt(rows, rowNumber, 3);
    const hasHireDateValue = hireDateCell &&
      !hireDateCell.error &&
      hireDateCell.value !== null &&
      String(hireDateCell.value).trim() !== "";
    const hireDate = normalizeDateCell(hireDateCell, dateSystem);
    if (hasHireDateValue && !hireDate) {
      invalidHireDates += 1;
      diagnostics.add("INVALID_HIRE_DATE");
    }
    const displayName = textValue(cellAt(rows, rowNumber, 2));
    if (!displayName) {
      emptyDisplayNames += 1;
      diagnostics.add("EMPTY_DISPLAY_NAME");
    }
    if (!displayName || rowFormulaErrors > 0 || (hasHireDateValue && !hireDate)) {
      rejectedRows += 1;
      continue;
    }
    acceptedRows.push(selected);
    employees.push({
      employeeId,
      displayName,
      hireDate: hireDate || "",
      payrollType: textValue(cellAt(rows, rowNumber, 4)),
      position: textValue(cellAt(rows, rowNumber, 5)),
      department: textValue(cellAt(rows, rowNumber, 6)),
      area: textValue(cellAt(rows, rowNumber, 7)),
      plant: textValue(cellAt(rows, rowNumber, 8))
    });
  }
  if (employeeFormulaErrors > 0) {
    diagnostics.add("EMPLOYEE_FORMULA_CACHE_ERROR", {}, employeeFormulaErrors);
  }
  return {
    acceptedRows,
    employeeFormulaErrors,
    employees,
    emptyDisplayNames,
    invalidHireDates,
    rejectedRows
  };
}

function buildCompletions(rows, selectedRows, courses, dateSystem, diagnostics) {
  const completions = [];
  let invalidDates = 0;
  let formulaErrors = 0;
  for (const { employeeId, rowNumber } of selectedRows) {
    for (const course of courses) {
      const cell = cellAt(rows, rowNumber, course.column);
      if (!cell || (cell.value === null && !cell.error) || cell.value === "") continue;
      if (cell.error) {
        formulaErrors += 1;
        diagnostics.add("COMPLETION_FORMULA_CACHE_ERROR", {
          sourceKey: course.sourceKey
        });
        continue;
      }
      const completionDate = normalizeDateCell(cell, dateSystem);
      if (!completionDate) {
        invalidDates += 1;
        diagnostics.add("INVALID_COMPLETION_DATE", {
          sourceKey: course.sourceKey
        });
        continue;
      }
      completions.push({ employeeId, sourceKey: course.sourceKey, completionDate });
    }
  }
  completions.sort(
    (left, right) => left.employeeId.localeCompare(right.employeeId) ||
      left.sourceKey.localeCompare(right.sourceKey)
  );
  return { completions, formulaErrors, invalidDates };
}

function publicCourses(courses) {
  return courses.map((course) => ({
    sourceKey: course.sourceKey,
    sourceColumn: course.sourceColumn,
    displayName: course.name,
    normalizedName: normalizedCourseName(course.name)
  }));
}

export function extractHcSnapshotFromBuffer(input, options = {}) {
  if (!Buffer.isBuffer(input)) throw new TypeError("input debe ser un Buffer");
  const archive = new ZipArchive(input);
  const workbookPart = "xl/workbook.bin";
  const workbookRelationshipsPart = "xl/_rels/workbook.bin.rels";
  const workbook = parseWorkbook(archive.read(workbookPart));
  const relationships = parseRelationships(
    archive.read(workbookRelationshipsPart),
    workbookPart
  );
  const externalLinkCount = [...relationships.values()].filter(
    ({ type }) => type.endsWith("/externalLink")
  ).length;
  const requestedSheetName = options.sheetName || "HC";
  const sheet = findSheet(workbook, requestedSheetName);
  const sheetRelationship = relationships.get(sheet.relationshipId);
  if (
    !sheetRelationship ||
    sheetRelationship.external ||
    !sheetRelationship.type.endsWith("/worksheet") ||
    !sheetRelationship.target
  ) {
    throw new Error("La relacion de la hoja HC no es una hoja interna valida");
  }
  if (!archive.has(sheetRelationship.target)) {
    throw new Error("La parte binaria de la hoja HC no existe");
  }
  const sharedStringsRelationship = relationshipByType(relationships, "/sharedStrings");
  const sharedStrings = sharedStringsRelationship
    ? parseSharedStrings(archive.read(sharedStringsRelationship.target))
    : [];
  const worksheet = parseWorksheet(archive.read(sheetRelationship.target), sharedStrings);
  const diagnostics = new Diagnostics();
  if (worksheet.duplicateCells > 0) {
    diagnostics.add("DUPLICATE_CELL_RECORD", { occurrences: worksheet.duplicateCells });
  }
  if (worksheet.formulaErrors > 0) {
    diagnostics.add("FORMULA_CACHE_ERROR", {}, worksheet.formulaErrors);
  }

  const headerEndRow = firstEmployeeRow(worksheet.rows);
  const lastCourseColumn = columnIndex(
    options.lastCourseColumn ?? DEFAULT_LAST_COURSE_COLUMN
  );
  const expectedCourseCount = lastCourseColumn - FIRST_COURSE_COLUMN + 1;
  const truncatedCourseColumns = courseHeaderColumnsBeyondLimit(
    worksheet.rows,
    worksheet.merges,
    headerEndRow,
    lastCourseColumn
  );
  if (truncatedCourseColumns.length) {
    diagnostics.add("COURSE_RANGE_TRUNCATED", {
      occurrences: truncatedCourseColumns.length,
      sourceColumns: truncatedCourseColumns.slice(0, 50).map(columnName)
    });
  }
  const courseScan = courseCandidates(
    worksheet.rows,
    worksheet.merges,
    headerEndRow,
    lastCourseColumn,
    diagnostics
  );
  const courseSelection = selectUnambiguousCourses(courseScan.candidates, diagnostics);
  const courses = courseSelection.selected;
  if (courses.length !== expectedCourseCount) {
    diagnostics.add("UNEXPECTED_COURSE_COUNT", {
      actual: courses.length,
      expected: expectedCourseCount
    });
  }
  const employeeSelection = employeeRows(worksheet.rows, headerEndRow, diagnostics);
  const employeeResult = buildEmployees(
    worksheet.rows,
    employeeSelection.selected,
    workbook.dateSystem,
    diagnostics
  );
  const completionResult = buildCompletions(
    worksheet.rows,
    employeeResult.acceptedRows,
    courses,
    workbook.dateSystem,
    diagnostics
  );

  let skippedCompletionColumns = 0;
  const excludedCourseColumns = [
    ...courseScan.missingColumns,
    ...courseSelection.ambiguous.map(({ column }) => column)
  ];
  for (const { rowNumber } of employeeResult.acceptedRows) {
    for (const column of excludedCourseColumns) {
      const cell = cellAt(worksheet.rows, rowNumber, column);
      if (cell && (cell.error || (cell.value !== null && cell.value !== ""))) {
        skippedCompletionColumns += 1;
      }
    }
  }
  const counts = {
    employeeCount: employeeResult.employees.length,
    courseCount: courses.length,
    completionCount: completionResult.completions.length,
    skippedEmployeeCount:
      employeeSelection.invalidRows +
      employeeSelection.duplicateRows +
      employeeResult.rejectedRows,
    skippedCourseCount: courseScan.missingColumns.length + courseSelection.ambiguous.length,
    skippedCompletionCount:
      completionResult.invalidDates +
      completionResult.formulaErrors +
      skippedCompletionColumns,
    formulaCellCount: worksheet.formulaCells,
    formulaCachedValueCount: worksheet.formulaValues,
    formulaErrorCount: worksheet.formulaErrors,
    externalLinkCount,
    mergedCellCount: worksheet.merges.length
  };
  const extractedAt = new Date(options.extractedAt ?? Date.now());
  if (Number.isNaN(extractedAt.getTime())) throw new Error("extractedAt no es una fecha valida");
  const snapshotWithoutHash = {
    schemaVersion: SNAPSHOT_SCHEMA,
    source: {
      fileName: basename(String(options.fileName || "source.xlsb")),
      sha256: sha256(input),
      byteSize: input.length,
      sheetName: sheet.name
    },
    extractedAt: extractedAt.toISOString(),
    employees: employeeResult.employees,
    courses: publicCourses(courses),
    completions: completionResult.completions,
    diagnostics: { counts, issues: diagnostics.issues() }
  };
  return snapshotWithoutHash;
}

export function snapshotIsApplicable(snapshot) {
  return Array.isArray(snapshot?.diagnostics?.issues) &&
    snapshot.diagnostics.issues.every(({ code }) => !BLOCKING_DIAGNOSTIC_CODES.has(code));
}

export function extractHcSnapshot(inputPath, options = {}) {
  const resolvedInput = resolve(inputPath);
  if (extname(resolvedInput).toLowerCase() !== ".xlsb") {
    throw new Error("La entrada debe ser un archivo .xlsb");
  }
  const before = statSync(resolvedInput);
  if (!before.isFile()) throw new Error("La entrada XLSB no es un archivo");
  const input = readFileSync(resolvedInput);
  const firstHash = sha256(input);
  const snapshot = extractHcSnapshotFromBuffer(input, {
    ...options,
    fileName: options.fileName || basename(resolvedInput)
  });
  const secondInput = readFileSync(resolvedInput);
  const secondHash = sha256(secondInput);
  const after = statSync(resolvedInput);
  if (
    firstHash !== secondHash ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error("El XLSB cambio durante la lectura; no se genero snapshot");
  }
  if (snapshot.source.sha256 !== firstHash) throw new Error("El hash fuente no coincide");
  return snapshot;
}

function potentialRealPath(targetPath) {
  let cursor = resolve(targetPath);
  const remainder = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    remainder.unshift(path.basename(cursor));
    cursor = parent;
  }
  const realExisting = realpathSync(cursor);
  return resolve(realExisting, ...remainder);
}

function pathIsWithin(rootPath, targetPath) {
  const difference = relative(rootPath, targetPath);
  return difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference));
}

export function assertSafeOutputPath(outputPath, options = {}) {
  if (!outputPath) throw new Error("Falta la ruta de salida");
  if (extname(outputPath).toLowerCase() !== ".json") {
    throw new Error("La salida debe ser un archivo .json");
  }
  const projectRoot = resolve(options.projectRoot || PROJECT_ROOT);
  const privateRoot = potentialRealPath(join(projectRoot, "referencias", "privado"));
  const resolvedOutput = potentialRealPath(resolve(projectRoot, outputPath));
  if (!pathIsWithin(privateRoot, resolvedOutput)) {
    throw new Error("Salida rechazada: use exclusivamente referencias/privado/");
  }
  return resolvedOutput;
}

export function defaultSnapshotOutputPath(snapshot, projectRoot = PROJECT_ROOT) {
  const snapshotHash = sha256(canonicalJson(snapshot));
  return join(
    resolve(projectRoot),
    "referencias",
    "privado",
    `hc-snapshot-${snapshot.source.sha256.slice(0, 16)}-${snapshotHash.slice(0, 16)}.json`
  );
}

export function writeSnapshotFile(snapshot, outputPath, options = {}) {
  const resolvedOutput = assertSafeOutputPath(outputPath, options);
  const inputPath = options.inputPath ? potentialRealPath(options.inputPath) : null;
  if (inputPath && inputPath === resolvedOutput) {
    throw new Error("La salida no puede sobrescribir el XLSB de origen");
  }
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (existsSync(resolvedOutput)) {
    if (readFileSync(resolvedOutput, "utf8") === serialized) {
      chmodSync(resolvedOutput, 0o600);
      return resolvedOutput;
    }
    throw new Error("La salida ya existe con contenido distinto; elija otra ruta");
  }
  const parent = dirname(resolvedOutput);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const guardedAgain = assertSafeOutputPath(resolvedOutput, options);
  if (guardedAgain !== resolvedOutput) throw new Error("La ruta de salida cambio durante la escritura");
  const temporary = join(
    parent,
    `.${path.basename(resolvedOutput)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    writeFileSync(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, resolvedOutput);
    } catch (error) {
      if (
        error?.code === "EEXIST" &&
        existsSync(resolvedOutput) &&
        readFileSync(resolvedOutput, "utf8") === serialized
      ) {
        chmodSync(resolvedOutput, 0o600);
        return resolvedOutput;
      }
      throw error;
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return resolvedOutput;
}

function discoverDefaultInput(projectRoot) {
  const preferred = join(projectRoot, "referencias", DEFAULT_MASTER_NAME);
  if (existsSync(preferred)) return preferred;
  const candidates = readdirSync(join(projectRoot, "referencias"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".xlsb")
    .map((entry) => join(projectRoot, "referencias", entry.name));
  if (candidates.length !== 1) {
    throw new Error("Use --input para seleccionar un unico archivo XLSB");
  }
  return candidates[0];
}

function cliArguments(argv) {
  const options = {
    inputPath: null,
    outputPath: null,
    lastCourseColumn: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--input" ||
      argument === "--output" ||
      argument === "--last-course-column"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Falta valor para ${argument}`);
      index += 1;
      if (argument === "--input") options.inputPath = value;
      else if (argument === "--output") options.outputPath = value;
      else options.lastCourseColumn = value;
    } else if (argument === "--help") {
      options.help = true;
    } else if (!argument.startsWith("--") && !options.inputPath) {
      options.inputPath = argument;
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }
  return options;
}

function printHelp() {
  process.stderr.write(
    "Uso: node scripts/extract-hc-xlsb.js [--input maestro.xlsb] [--output snapshot.json] " +
    "[--last-course-column AJ]\n"
  );
}

function runCli() {
  try {
    const options = cliArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const inputPath = resolve(options.inputPath || discoverDefaultInput(PROJECT_ROOT));
    const snapshot = extractHcSnapshot(inputPath, {
      lastCourseColumn: options.lastCourseColumn ?? DEFAULT_LAST_COURSE_COLUMN
    });
    const snapshotSha256 = sha256(canonicalJson(snapshot));
    const outputPath = options.outputPath
      ? resolve(options.outputPath)
      : defaultSnapshotOutputPath(snapshot);
    writeSnapshotFile(snapshot, outputPath, {
      inputPath,
      projectRoot: PROJECT_ROOT
    });
    process.stdout.write(`${JSON.stringify({
      sourceSha256: snapshot.source.sha256,
      snapshotSha256,
      employees: snapshot.employees.length,
      courses: snapshot.courses.length,
      completions: snapshot.completions.length,
      diagnosticIssues: snapshot.diagnostics.issues.reduce(
        (sum, issue) => sum + issue.count,
        0
      ),
      blockingIssues: snapshot.diagnostics.issues
        .filter(({ code }) => BLOCKING_DIAGNOSTIC_CODES.has(code))
        .reduce((sum, issue) => sum + issue.count, 0)
    })}\n`);
    if (!snapshotIsApplicable(snapshot)) {
      process.stderr.write(
        "Snapshot HC generado para revision; contiene diagnosticos bloqueantes y no es aplicable.\n"
      );
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`No se genero el snapshot HC: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) runCli();
