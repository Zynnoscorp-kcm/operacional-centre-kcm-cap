#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const workbookPath = process.argv[2] ?? "referencias/privado/matriz/Matriz_de_Competencias_Ejemplo.xlsx";

function entry(path) {
  return execFileSync("unzip", ["-p", workbookPath, path], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
}

function decodeXml(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function attrs(fragment) {
  return Object.fromEntries([...fragment.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], decodeXml(match[2])]));
}

const sharedStringsXml = entry("xl/sharedStrings.xml");
const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
  decodeXml([...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((item) => item[1]).join(""))
);

const stylesXml = entry("xl/styles.xml");
const customFormats = new Map([...stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)].map((match) => {
  const data = attrs(match[1]);
  return [Number(data.numFmtId), data.formatCode];
}));
const builtInDateFormats = new Map([
  [14, "mm-dd-yy"], [15, "d-mmm-yy"], [16, "d-mmm"], [17, "mmm-yy"],
  [18, "h:mm AM/PM"], [19, "h:mm:ss AM/PM"], [20, "h:mm"], [21, "h:mm:ss"], [22, "m/d/yy h:mm"]
]);
const cellXfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
const cellStyles = [...cellXfsBlock.matchAll(/<xf\b([^>]*)\/?>(?:<[^/][\s\S]*?<\/xf>)?/g)].map((match) => {
  const data = attrs(match[1]);
  const numFmtId = Number(data.numFmtId ?? 0);
  return { numFmtId, formatCode: customFormats.get(numFmtId) ?? builtInDateFormats.get(numFmtId) ?? null };
});

function columnNumber(reference) {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "";
  return [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

const workbookXml = entry("xl/workbook.xml");
const relationshipsXml = entry("xl/_rels/workbook.xml.rels");
const relationTargets = new Map([...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].map((match) => {
  const data = attrs(match[1]);
  return [data.Id, data.Target];
}));

const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)].map((match) => {
  const data = attrs(match[1]);
  const target = relationTargets.get(data["r:id"]);
  const xml = entry(`xl/${target}`);
  const dimension = /<dimension ref="([^"]+)"/.exec(xml)?.[1] ?? null;
  const mergeCount = Number(/<mergeCells count="(\d+)"/.exec(xml)?.[1] ?? 0);
  const mergedRanges = [...xml.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((item) => item[1]);
  const formulaCount = (xml.match(/<f(?:\s|>)/g) ?? []).length;
  const externalFormulaCount = (xml.match(/<f[^>]*>[\s\S]*?\[[0-9]+\][\s\S]*?<\/f>/g) ?? []).length;
  const headerCells = [];
  const trainingStyleCounts = new Map();
  if (data.name === "HC") {
    for (const cellMatch of xml.matchAll(/<c\b([^>]*[^/])>([\s\S]*?)<\/c>/g)) {
      const cellAttrs = attrs(cellMatch[1]);
      const reference = cellAttrs.r ?? "";
      const row = Number(/\d+$/.exec(reference)?.[0] ?? 0);
      if (row !== 3) continue;
      const rawValue = /<v>([\s\S]*?)<\/v>/.exec(cellMatch[2])?.[1];
      let value = null;
      if (rawValue !== undefined && cellAttrs.t === "s") value = sharedStrings[Number(rawValue)] ?? null;
      if (rawValue !== undefined && cellAttrs.t === "str") value = decodeXml(rawValue);
      if (value !== null && value.trim() !== "") headerCells.push({ cell: reference, value: value.trim() });
    }
    for (const cellMatch of xml.matchAll(/<c\b([^>]*[^/])>([\s\S]*?)<\/c>/g)) {
      const cellAttrs = attrs(cellMatch[1]);
      const reference = cellAttrs.r ?? "";
      const row = Number(/\d+$/.exec(reference)?.[0] ?? 0);
      const column = columnNumber(reference);
      if (row < 4 || column < 10 || column > 36 || !/<v>/.test(cellMatch[2])) continue;
      const styleId = Number(cellAttrs.s ?? 0);
      trainingStyleCounts.set(styleId, (trainingStyleCounts.get(styleId) ?? 0) + 1);
    }
  }
  return {
    name: data.name,
    state: data.state ?? "visible",
    dimension,
    mergeCount,
    mergedRanges,
    formulaCount,
    externalFormulaCount,
    ...(headerCells.length ? {
      headerCells,
      hcProfile: {
        headerRow: 3,
        dataStartRow: 4,
        identityColumns: "B:I",
        trainingColumnsWithHeaders: "J:AJ",
        trainingColumnCount: headerCells.filter((item) => columnNumber(item.cell) >= 10).length,
        populatedTrainingCellStyles: [...trainingStyleCounts].map(([styleId, count]) => ({
          styleId,
          count,
          numFmtId: cellStyles[styleId]?.numFmtId ?? null,
          formatCode: cellStyles[styleId]?.formatCode ?? null
        }))
      }
    } : {})
  };
});

const externalLinkEntries = Number(/<externalReferences>/.test(workbookXml)
  ? [...workbookXml.matchAll(/<externalReference\b/g)].length
  : 0);

process.stdout.write(`${JSON.stringify({
  source: workbookPath,
  privacy: "No se inspeccionan ni emiten filas de empleados (HC desde fila 4).",
  sheets,
  externalLinkEntries
}, null, 2)}\n`);
