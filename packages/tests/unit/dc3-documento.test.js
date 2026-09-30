import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildZip, sha256 } from "../../dc3/ooxml.js";
import { extractDc3Legends, generateDc3Document } from "../../dc3/pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "../../dc3/pdf/leyendas-oficiales.js";
import { measureText } from "../../dc3/pdf/pdf-writer.js";
import { extractActiveRosterFromBuffer } from "../../dc3/roster-extractor.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OFFICIAL_TEMPLATE = join(
  PROJECT_ROOT,
  "referencias/Software Administración de Curs y Cap/DC-3_KCM_Formato_Oficial_Lleno.xlsx"
);

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineCell(reference, value) {
  return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function worksheet(rows) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${rows.map(([number, cells]) => `<row r="${number}">${cells.join("")}</row>`).join("")}</sheetData>
    </worksheet>`;
}

function workbookXml(sheets, includePrivatePath = false) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
      xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac">
      ${includePrivatePath ? "<mc:AlternateContent><mc:Choice Requires=\"x15ac\"><x15ac:absPath url=\"C:\\Private\\\"/></mc:Choice></mc:AlternateContent>" : ""}
      <sheets>${sheets.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
    </workbook>`;
}

function relationships(count) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
    </Relationships>`;
}

function xlsx(sheets, options = {}) {
  const entries = [
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>"],
    ["xl/workbook.xml", workbookXml(sheets.map(({ name }) => name), options.includePrivatePath)],
    ["xl/_rels/workbook.xml.rels", relationships(sheets.length)],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet.xml])
  ];
  if (options.core) entries.push(["docProps/core.xml", options.core]);
  return buildZip(entries);
}

const ROSTER_HEADERS = [
  ["A", "NUMERO"],
  ["B", "NOMBRE"],
  ["C", "NOMBRE DE PUESTO"],
  ["D", "R.F.C."],
  ["E", "C.U.R.P."],
  ["F", "I.M.S.S."],
  ["G", "FEC ALTA"]
];

function rosterSheet(...employees) {
  return worksheet([
    [1, ROSTER_HEADERS.map(([column, header]) => inlineCell(`${column}1`, header))],
    ...employees.map(([employeeId, name, position, curp, hireDate], index) => {
      const row = index + 2;
      return [row, [
        inlineCell(`A${row}`, employeeId),
        inlineCell(`B${row}`, name),
        inlineCell(`C${row}`, position),
        inlineCell(`E${row}`, curp),
        inlineCell(`G${row}`, hireDate)
      ]];
    })
  ]);
}

test("extrae en memoria las dos hojas activas sin convertir el XLSX", () => {
  const source = xlsx([
    {
      name: "SND ACTIVOS",
      xml: rosterSheet(["00001", "PERSONA SINTÉTICA UNO", "PUESTO SINTÉTICO", "AAAA000101HDFBBBB0", "2026-01-03"])
    },
    {
      name: "EMP ACTIVOS",
      xml: rosterSheet(["00002", "PERSONA SINTÉTICA DOS", "OTRO PUESTO", "BABC000101MDFCCCC1", "2025-12-31"])
    }
  ]);
  const roster = extractActiveRosterFromBuffer(source);
  assert.equal(roster.employees.length, 2);
  assert.equal(roster.diagnostics.readyEmployeeCount, 2);
  assert.equal(roster.employees[0].employeeId, "00001");
  assert.equal(roster.employees[0].hireDate, "2026-01-03");
  assert.equal(roster.source.sha256, sha256(source));
});

const SAMPLE_DOCUMENT = Object.freeze({
  workerName: "PERSONA SINTÉTICA UNO",
  curp: "AAAA000101HDFBBBB0",
  position: "PUESTO SINTÉTICO",
  occupation: "",
  courseName: "CURSO SINTÉTICO",
  durationHours: 8,
  startDate: "2026-02-03",
  endDate: "2026-02-04",
  thematicArea: "SEGURIDAD SINTÉTICA",
  trainingAgent: "AGENTE SINTÉTICO",
  signatures: {}
});

function drawnLines(pdf) {
  const content = pdf.toString("latin1");
  const lines = [];
  let size = 0;
  let bold = false;
  for (const match of content.matchAll(/\/(F1|F2) ([\d.]+) Tf|\(((?:\\.|[^()\\])*)\) Tj/g)) {
    if (match[1]) {
      bold = match[1] === "F2";
      size = Number(match[2]);
      continue;
    }
    const text = match[3]
      .replace(/\\(\d{3})/g, (_whole, code) => Buffer.from([Number.parseInt(code, 8)]).toString("latin1"))
      .replace(/\\([()\\])/g, "$1");
    lines.push({ text, size, bold });
  }
  return lines;
}

function printedText(pdf) {
  return drawnLines(pdf).map(({ text }) => text).join(" ");
}

test("genera un PDF de una pagina sin heredar metadatos de ninguna hoja de calculo", () => {
  const output = generateDc3Document(SAMPLE_DOCUMENT);

  assert.equal(output.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.match(output.toString("latin1"), /%%EOF\n$/);
  assert.equal((output.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
  const printed = printedText(output);
  assert.match(printed, /PERSONA SINTÉTICA UNO/);
  assert.match(printed, /CURSO SINTÉTICO/);
  assert.match(printed, /AGENTE SINTÉTICO/);
  assert.equal(drawnLines(output).filter(({ text }) => text.length === 1).length >= 18 + 12, true);
  assert.doesNotMatch(output.toString("latin1"), /absPath|Private|PERSONA REAL/i);
  assert.match(output.toString("latin1"), /\/Producer \(KCM Cap DC3\)/);
});

test("el mismo DC-3 produce exactamente los mismos bytes en dos corridas", () => {
  const first = generateDc3Document(SAMPLE_DOCUMENT);
  const second = generateDc3Document(SAMPLE_DOCUMENT);
  assert.equal(sha256(first), sha256(second));
  const other = generateDc3Document({ ...SAMPLE_DOCUMENT, durationHours: 9 });
  assert.notEqual(sha256(first), sha256(other));
});

test("acomoda el nombre de curso mas largo dentro del recuadro y sin perder palabras", () => {
  const courseName = "SISTEMAS DE PROTECCIÓN Y DISPOSITIVOS DE SEGURIDAD EN LA MAQUINARIA Y EQUIPO, " +
    "PARA PREVENIR Y PROTEGER A LOS TRABAJADORES CONTRA LOS RIESGOS DE TRABAJO LOTO";
  const output = generateDc3Document({ ...SAMPLE_DOCUMENT, courseName });
  const words = courseName.split(" ");
  const lines = drawnLines(output);
  const start = lines.findIndex(({ text }) => text.startsWith(words[0]));
  assert.notEqual(start, -1);
  const courseLines = [];
  let consumed = 0;
  for (let index = start; index < lines.length && consumed < words.length; index += 1) {
    courseLines.push(lines[index]);
    consumed += lines[index].text.split(" ").length;
  }
  assert.equal(courseLines.map(({ text }) => text).join(" "), courseName);
  assert.equal(courseLines.length <= 2, true);
  for (const line of courseLines) {
    assert.equal(measureText(line.text, { size: line.size }) <= 612 - 44 * 2 - 14, true);
  }
});

test("una firma configurada sustituye la horneada y las demas se conservan", () => {
  const output = generateDc3Document({
    ...SAMPLE_DOCUMENT,
    signatures: { instructor: "INSTRUCTOR CONFIGURADO" }
  });
  const printed = printedText(output);
  const firmas = LEYENDAS_DC3.templateSignatures;
  assert.match(printed, /INSTRUCTOR CONFIGURADO/);
  if (firmas.instructor) assert.equal(printed.includes(firmas.instructor), false);
  for (const nombre of [firmas.employerRepresentative, firmas.workerRepresentative]) {
    if (nombre) assert.equal(printed.includes(nombre), true);
  }
});

test("la razon social de los datos sustituye la que traen las leyendas horneadas", () => {
  assert.match(printedText(generateDc3Document(SAMPLE_DOCUMENT)), /KIMBERLY CLARK DE MÉXICO S\.A\.B DE C\.V/);
  const output = generateDc3Document({ ...SAMPLE_DOCUMENT, employerName: "RAZÓN SOCIAL CORREGIDA" });
  assert.match(printedText(output), /RAZÓN SOCIAL CORREGIDA/);
});

test("una hoja sin las leyendas oficiales no puede usarse para verificarlas", () => {
  const mutilated = buildZip([
    ["[Content_Types].xml", "<Types/>"],
    ["xl/workbook.xml", "<workbook xmlns:r=\"r\"><sheets><sheet name=\"Hoja 1\" r:id=\"rId1\"/></sheets></workbook>"],
    ["xl/_rels/workbook.xml.rels", "<Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>"],
    ["xl/worksheets/sheet1.xml", "<worksheet><sheetData/></worksheet>"]
  ]);
  assert.throws(() => extractDc3Legends(mutilated), /no declara la leyenda/);
});

test("un campo faltante o una CURP invalida detienen la emision", () => {
  assert.throws(
    () => generateDc3Document({ ...SAMPLE_DOCUMENT, thematicArea: "" }),
    /Falta el campo requerido thematicArea/
  );
  assert.throws(
    () => generateDc3Document({ ...SAMPLE_DOCUMENT, curp: "AAAA000101HDFBBBB" }),
    /La CURP debe contener 18 caracteres/
  );
});

test("la plantilla oficial real declara sus leyendas, no se altera y su reverso no se imprime", (t) => {
  if (!existsSync(OFFICIAL_TEMPLATE)) {
    t.skip("La plantilla oficial es material privado y no esta presente en este entorno");
    return;
  }
  const template = readFileSync(OFFICIAL_TEMPLATE);
  const before = { sha256: sha256(template), mtimeMs: statSync(OFFICIAL_TEMPLATE).mtimeMs };
  const legends = extractDc3Legends(template);
  for (const [field, value] of Object.entries(legends)) {
    if (field === "taxId" || field === "templateSignatures") continue;
    assert.equal(typeof value === "string" && value.length > 0, true, `leyenda vacia: ${field}`);
  }
  assert.equal(legends.taxId.length >= 12, true);

  const output = generateDc3Document({
    ...SAMPLE_DOCUMENT,
    courseName: "CURSO SINTÉTICO DE VERIFICACIÓN"
  });
  const printed = printedText(output);
  assert.match(printed, /CONSTANCIA DE COMPETENCIAS O DE HABILIDADES LABORALES/);
  assert.match(printed, /DATOS DEL TRABAJADOR/);
  assert.match(printed, /DATOS DE LA EMPRESA/);
  assert.match(printed, /PERSONA SINTÉTICA UNO/);
  assert.match(printed, /CURSO SINTÉTICO DE VERIFICACIÓN/);
  assert.doesNotMatch(printed, /CLAVES Y DENOMINACIONES/i);
  assert.doesNotMatch(printed, /Cultivo, crianza/i);
  assert.doesNotMatch(printed, /Desarrollo personal y familiar/i);
  assert.doesNotMatch(printed, /Gestión y soporte administrativo/i);
  assert.doesNotMatch(printed, /\bANVERSO\b/i);

  const after = statSync(OFFICIAL_TEMPLATE);
  assert.equal(sha256(readFileSync(OFFICIAL_TEMPLATE)), before.sha256);
  assert.equal(after.mtimeMs, before.mtimeMs);
});
