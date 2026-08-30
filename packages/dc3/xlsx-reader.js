import path from "node:path";

import {
  decodeXml,
  parseRelationships,
  parseXmlAttributes,
  sha256,
  ZipArchive
} from "./ooxml.js";

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

export function normalizedLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function columnIndexFromReference(reference) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(String(reference || ""));
  if (!match) throw new Error("Referencia de celda OOXML invalida");
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column < 1 || column > MAX_COLUMNS || row < 1 || row > MAX_ROWS) {
    throw new Error("Referencia de celda OOXML fuera de limites");
  }
  return { column: column - 1, columnName: match[1], row };
}

function plainTextFromRichXml(source) {
  const pieces = [];
  for (const match of String(source ?? "").matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)) {
    pieces.push(decodeXml(match[1]));
  }
  return pieces.join("");
}

function parseSharedStrings(archive, relationship) {
  if (!relationship) return [];
  if (relationship.external || !relationship.target || !archive.has(relationship.target)) {
    throw new Error("La tabla de cadenas compartidas no es una parte interna valida");
  }
  const xml = archive.read(relationship.target).toString("utf8");
  const strings = [];
  for (const match of xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)) {
    strings.push(plainTextFromRichXml(match[1]));
  }
  return strings;
}

function readCellValue(type, body, sharedStrings) {
  const valueMatch = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body);
  const rawValue = valueMatch ? decodeXml(valueMatch[1]) : null;
  if (type === "inlineStr") return plainTextFromRichXml(body);
  if (type === "s") {
    if (rawValue === null || !/^\d+$/.test(rawValue)) return null;
    const index = Number(rawValue);
    if (index >= sharedStrings.length) throw new Error("Indice de cadena compartida invalido");
    return sharedStrings[index];
  }
  if (type === "str") return rawValue ?? "";
  if (type === "b") return rawValue === "1";
  if (type === "e") return null;
  if (rawValue === null || rawValue === "") return null;
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : rawValue;
}

function parseWorksheet(xml, sharedStrings) {
  const cells = new Map();
  let formulaCellCount = 0;
  let formulaWithoutCachedValueCount = 0;
  let errorCellCount = 0;
  const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?<!\/)>([\s\S]*?)<\/(?:\w+:)?c>/gi;
  let match;
  while ((match = cellPattern.exec(xml)) !== null) {
    const attributes = parseXmlAttributes(match[1]);
    if (!attributes.r) throw new Error("Celda OOXML sin referencia");
    const reference = columnIndexFromReference(String(attributes.r).toUpperCase());
    const type = attributes.t || "n";
    const body = match[2];
    const formula = /<(?:\w+:)?f\b/i.test(body);
    const error = type === "e";
    const value = readCellValue(type, body, sharedStrings);
    if (formula) {
      formulaCellCount += 1;
      if (value === null) formulaWithoutCachedValueCount += 1;
    }
    if (error) errorCellCount += 1;
    const key = `${reference.columnName}${reference.row}`;
    if (cells.has(key)) throw new Error("La hoja contiene una celda duplicada");
    cells.set(key, {
      ...reference,
      error,
      formula,
      reference: key,
      style: attributes.s === undefined ? null : Number(attributes.s),
      type,
      value
    });
  }
  return {
    cells,
    diagnostics: { errorCellCount, formulaCellCount, formulaWithoutCachedValueCount }
  };
}

function workbookRelationshipsPart(workbookPart) {
  return path.posix.join(
    path.posix.dirname(workbookPart),
    "_rels",
    `${path.posix.basename(workbookPart)}.rels`
  );
}

export class XlsxWorkbook {
  constructor(buffer) {
    this.buffer = buffer;
    this.sourceSha256 = sha256(buffer);
    this.archive = new ZipArchive(buffer);
    this.workbookPart = "xl/workbook.xml";
    if (!this.archive.has(this.workbookPart)) {
      throw new Error("El archivo no contiene xl/workbook.xml; no es un XLSX compatible");
    }
    const relationshipsPart = workbookRelationshipsPart(this.workbookPart);
    if (!this.archive.has(relationshipsPart)) {
      throw new Error("El XLSX no contiene las relaciones del libro");
    }
    this.workbookXml = this.archive.read(this.workbookPart).toString("utf8");
    this.relationships = parseRelationships(
      this.archive.read(relationshipsPart),
      this.workbookPart
    );
    this.dateSystem = /<workbookPr\b[^>]*\bdate1904=(?:"1"|'1')/i.test(this.workbookXml)
      ? "1904"
      : "1900";
    this.sheets = this.#parseSheets();
    const sharedStringsRelationship = [...this.relationships.values()].find(
      ({ external, type }) => !external && type.endsWith("/sharedStrings")
    );
    this.sharedStrings = parseSharedStrings(this.archive, sharedStringsRelationship || null);
  }

  #parseSheets() {
    const sheets = [];
    const pattern = /<(?:\w+:)?sheet\b([^>]*)\/?>/gi;
    let match;
    while ((match = pattern.exec(this.workbookXml)) !== null) {
      const attributes = parseXmlAttributes(match[1]);
      const relationshipId = attributes.id;
      if (!attributes.name || !relationshipId) continue;
      const relationship = this.relationships.get(relationshipId);
      if (
        !relationship ||
        relationship.external ||
        !relationship.target ||
        !relationship.type.endsWith("/worksheet") ||
        !this.archive.has(relationship.target)
      ) {
        throw new Error("Una hoja declarada no tiene una relacion interna valida");
      }
      sheets.push({
        name: attributes.name,
        normalizedName: normalizedLabel(attributes.name),
        part: relationship.target,
        relationshipId,
        sheetId: attributes.sheetId || ""
      });
    }
    if (sheets.length === 0) throw new Error("El XLSX no contiene hojas");
    return sheets;
  }

  sheetByName(name) {
    const wanted = normalizedLabel(name);
    const matches = this.sheets.filter(({ normalizedName }) => normalizedName === wanted);
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? `No se encontro la hoja ${name}`
        : `La hoja ${name} es ambigua`);
    }
    return matches[0];
  }

  readSheet(sheetOrName) {
    const sheet = typeof sheetOrName === "string" ? this.sheetByName(sheetOrName) : sheetOrName;
    if (!sheet || !this.archive.has(sheet.part)) throw new Error("Hoja XLSX invalida");
    const parsed = parseWorksheet(this.archive.read(sheet.part).toString("utf8"), this.sharedStrings);
    return { ...parsed, ...sheet };
  }
}

export function excelDateToIso(serial, dateSystem = "1900") {
  if (!Number.isFinite(serial)) return null;
  const wholeDays = Math.floor(serial);
  let milliseconds;
  if (dateSystem === "1904") {
    if (wholeDays < 0 || wholeDays > 2_957_003) return null;
    milliseconds = Date.UTC(1904, 0, 1) + wholeDays * 86_400_000;
  } else {
    if (wholeDays <= 0 || wholeDays === 60 || wholeDays > 2_958_465) return null;
    const adjusted = wholeDays > 60 ? wholeDays - 1 : wholeDays;
    milliseconds = Date.UTC(1899, 11, 31) + adjusted * 86_400_000;
  }
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function civilDateToIso(value, dateSystem = "1900") {
  if (typeof value === "number") return excelDateToIso(value, dateSystem);
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return excelDateToIso(Number(text), dateSystem);
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
