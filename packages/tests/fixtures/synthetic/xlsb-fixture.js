// Constructor de libros XLSB sinteticos. Vive fuera de las pruebas que lo consumen porque el
// extractor HC y el generador DC-3 necesitan la misma matriz binaria: duplicar estos primitivos
// permitiria que las dos suites divergieran sobre el mismo formato.
import { deflateRawSync } from "node:zlib";

const WORKSHEET_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const SHARED_STRINGS_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";
const EXTERNAL_LINK_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink";

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

const CRC_TABLE = crc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [entryIndex, [name, source]] of entries.entries()) {
    const data = Buffer.from(source);
    const nameBuffer = Buffer.from(name, "utf8");
    const method = entryIndex % 2 === 0 ? 8 : 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
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
    central.writeUInt16LE(0x0800, 8);
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

function variableInteger(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function recordType(type) {
  if (type < 0x80) return Buffer.from([type]);
  return Buffer.from([0x80 | (type & 0x7f), (type >>> 7) & 0x7f]);
}

function record(type, payload = Buffer.alloc(0)) {
  return Buffer.concat([recordType(type), variableInteger(payload.length), payload]);
}

function uint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value, 0);
  return output;
}

function wideString(value) {
  const text = Buffer.from(value, "utf16le");
  return Buffer.concat([uint32(text.length / 2), text]);
}

function richString(value) {
  return Buffer.concat([Buffer.from([0]), wideString(value)]);
}

function bundleSheet(name, relationshipId, sheetId) {
  return Buffer.concat([
    uint32(0),
    uint32(sheetId),
    wideString(relationshipId),
    wideString(name)
  ]);
}

function cellHeader(column) {
  return Buffer.concat([uint32(column), uint32(0)]);
}

function sharedStringCell(column, index) {
  return record(0x0007, Buffer.concat([cellHeader(column), uint32(index)]));
}

function rkCell(column, value) {
  const encoded = Buffer.alloc(4);
  encoded.writeInt32LE((value << 2) | 0x02, 0);
  return record(0x0002, Buffer.concat([cellHeader(column), encoded]));
}

function realCell(column, value) {
  const number = Buffer.alloc(8);
  number.writeDoubleLE(value, 0);
  return record(0x0005, Buffer.concat([cellHeader(column), number]));
}

function parsedFormulaTail() {
  return Buffer.alloc(10);
}

function formulaNumberCell(column, value) {
  const number = Buffer.alloc(8);
  number.writeDoubleLE(value, 0);
  return record(
    0x0009,
    Buffer.concat([cellHeader(column), number, parsedFormulaTail()])
  );
}

function formulaStringCell(column, value) {
  return record(
    0x0008,
    Buffer.concat([cellHeader(column), wideString(value), parsedFormulaTail()])
  );
}

function formulaErrorCell(column, errorCode = 0x2a) {
  return record(
    0x000b,
    Buffer.concat([cellHeader(column), Buffer.from([errorCode]), parsedFormulaTail()])
  );
}

function rowHeader(row) {
  const payload = Buffer.alloc(25);
  payload.writeUInt32LE(row, 0);
  return record(0x0000, payload);
}

function mergedCell(firstRow, lastRow, firstColumn, lastColumn) {
  return record(
    0x00b0,
    Buffer.concat([
      uint32(firstRow),
      uint32(lastRow),
      uint32(firstColumn),
      uint32(lastColumn)
    ])
  );
}

function serialForIso(iso, date1904 = false) {
  const utc = Date.parse(`${iso}T00:00:00.000Z`);
  if (date1904) return (utc - Date.UTC(1904, 0, 1)) / 86_400_000;
  const raw = (utc - Date.UTC(1899, 11, 31)) / 86_400_000;
  return raw >= 60 ? raw + 1 : raw;
}

function syntheticCourseNames(count = 27) {
  return Array.from(
    { length: count },
    (_, index) => `Curso Sintético ${String(index + 1).padStart(2, "0")}`
  );
}

function buildSyntheticXlsb(options = {}) {
  const date1904 = Boolean(options.date1904);
  const courseNames = options.courseNames || syntheticCourseNames(options.courseCount || 27);
  const strings = [];
  const stringIndexes = new Map();
  const stringIndex = (value) => {
    if (!stringIndexes.has(value)) {
      stringIndexes.set(value, strings.length);
      strings.push(value);
    }
    return stringIndexes.get(value);
  };

  const employeeHeaders = [
    "Número",
    "Nombre",
    "Fecha de ingreso",
    "Tipo de nómina",
    "Puesto",
    "Departamento",
    "Área",
    "Planta"
  ];
  const row0 = [
    rowHeader(0),
    sharedStringCell(1, stringIndex("Datos laborales")),
    sharedStringCell(9, stringIndex("Grupo Técnico"))
  ];
  const row1 = [rowHeader(1)];
  employeeHeaders.forEach((header, index) => {
    row1.push(sharedStringCell(index + 1, stringIndex(header)));
  });
  courseNames.forEach((courseName, index) => {
    row1.push(sharedStringCell(index + 9, stringIndex(courseName)));
  });

  const row2 = [
    rowHeader(2),
    rkCell(1, 123),
    formulaStringCell(2, "Persona Sintética Alfa"),
    realCell(3, serialForIso("2020-02-29", date1904)),
    sharedStringCell(4, stringIndex("Semanal")),
    sharedStringCell(5, stringIndex("Puesto Sintético A")),
    sharedStringCell(6, stringIndex("Departamento Sintético")),
    sharedStringCell(7, stringIndex("Área Sintética")),
    sharedStringCell(8, stringIndex("Planta Sintética")),
    formulaNumberCell(9, serialForIso("2026-07-24", date1904)),
    realCell(10, serialForIso("2026-07-25", date1904))
  ];
  const row3 = [
    rowHeader(3),
    formulaStringCell(1, "00007"),
    options.blankSecondDisplayName
      ? formulaStringCell(2, "")
      : sharedStringCell(2, stringIndex("Persona Sintética Beta")),
    formulaNumberCell(3, serialForIso("2021-01-15", date1904)),
    sharedStringCell(4, stringIndex("Quincenal")),
    sharedStringCell(5, stringIndex("Puesto Sintético B")),
    sharedStringCell(6, stringIndex("Departamento Sintético")),
    sharedStringCell(7, stringIndex("Área Sintética")),
    sharedStringCell(8, stringIndex("Planta Sintética")),
    options.formulaErrorCompletion
      ? formulaErrorCell(11)
      : realCell(11, serialForIso("2026-07-26", date1904))
  ];

  const worksheet = Buffer.concat([
    record(0x0081),
    record(0x0091),
    ...row0,
    ...row1,
    ...row2,
    ...row3,
    record(0x0092),
    record(0x00b1, uint32(2)),
    mergedCell(0, 0, 1, 8),
    mergedCell(0, 0, 9, 8 + courseNames.length),
    record(0x00b2),
    record(0x0082)
  ]);
  const decoyWorksheet = Buffer.concat([
    record(0x0081),
    record(0x0091),
    rowHeader(0),
    sharedStringCell(1, stringIndex("Hoja sintética no HC")),
    record(0x0092),
    record(0x0082)
  ]);

  const workbookProperties = Buffer.alloc(12);
  if (date1904) workbookProperties.writeUInt32LE(1, 0);
  const workbook = Buffer.concat([
    record(0x0083),
    record(0x0099, workbookProperties),
    record(0x008f),
    record(0x009c, bundleSheet("Otra", "rIdDecoy", 1)),
    record(0x009c, bundleSheet("HC", "rIdHC", 2)),
    record(0x0090),
    record(0x0084)
  ]);
  const sharedStrings = Buffer.concat([
    record(0x009f, Buffer.concat([uint32(strings.length), uint32(strings.length)])),
    ...strings.map((value) => record(0x0013, richString(value))),
    record(0x00a0)
  ]);
  const relationships = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdDecoy" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/decoy.bin"/>` +
    `<Relationship Id="rIdExternal2" Type="${EXTERNAL_LINK_RELATIONSHIP}" Target="externalLinks/externalLink2.bin"/>` +
    `<Relationship Id="rIdHC" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/operational-hc.bin"/>` +
    `<Relationship Id="rIdSst" Type="${SHARED_STRINGS_RELATIONSHIP}" Target="sharedStrings.bin"/>` +
    `<Relationship Id="rIdExternal1" Type="${EXTERNAL_LINK_RELATIONSHIP}" Target="externalLinks/externalLink1.bin"/>` +
    `</Relationships>`
  );
  return zip([
    ["[Content_Types].xml", Buffer.from("<Types/>")],
    ["xl/workbook.bin", workbook],
    ["xl/_rels/workbook.bin.rels", relationships],
    ["xl/sharedStrings.bin", sharedStrings],
    ["xl/worksheets/decoy.bin", decoyWorksheet],
    ["xl/worksheets/operational-hc.bin", worksheet]
  ]);
}


export { buildSyntheticXlsb, syntheticCourseNames, serialForIso };
