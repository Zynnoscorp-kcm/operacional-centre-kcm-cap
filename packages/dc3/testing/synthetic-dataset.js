// Padron, plantilla y libros XLSX sinteticos para ejercitar el modulo DC-3 sin tocar un original.
// Viven en src/ y no en tests/ porque el banco de pruebas local y la suite necesitan exactamente la
// misma plantilla y el mismo padron: si cada uno construyera el suyo, un ensayo interactivo podria
// pasar sobre un formato que la suite ya no valida.
import { buildZip, sha256 } from "../ooxml.js";

function xmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function syntheticInlineCell(reference, value) {
  return `<c r="${reference}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
}

export function buildSyntheticWorksheetXml(rows) {
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
      <sheets>${sheets.map((name, index) => `<sheet name="${xmlText(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
    </workbook>`;
}

function relationships(count) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
    </Relationships>`;
}

export function buildSyntheticWorkbook(sheets, options = {}) {
  const entries = [
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>"],
    ["xl/workbook.xml", workbookXml(sheets.map(({ name }) => name), options.includePrivatePath)],
    ["xl/_rels/workbook.xml.rels", relationships(sheets.length)],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet.xml])
  ];
  if (options.core) entries.push(["docProps/core.xml", options.core]);
  return buildZip(entries);
}

const ROSTER_HEADERS = Object.freeze([
  ["A", "NUMERO"],
  ["B", "NOMBRE"],
  ["C", "NOMBRE DE PUESTO"],
  ["D", "R.F.C."],
  ["E", "C.U.R.P."],
  ["F", "I.M.S.S."],
  ["G", "FEC ALTA"]
]);

export function buildSyntheticRosterSheetXml(...employees) {
  return buildSyntheticWorksheetXml([
    [1, ROSTER_HEADERS.map(([column, header]) => syntheticInlineCell(`${column}1`, header))],
    ...employees.map(([employeeId, name, position, curp, hireDate], index) => {
      const row = index + 2;
      return [row, [
        syntheticInlineCell(`A${row}`, employeeId),
        syntheticInlineCell(`B${row}`, name),
        syntheticInlineCell(`C${row}`, position),
        syntheticInlineCell(`E${row}`, curp),
        syntheticInlineCell(`G${row}`, hireDate)
      ]];
    })
  ]);
}

// Leyendas que el documento imprime y que se leen de la plantilla oficial. La sintetica las declara
// en las mismas celdas con textos inventados: asi el generador de PDF se ejercita completo sin usar
// el archivo privado, y el contrato del archivo real lo fija su propia prueba.
export const DC3_TEMPLATE_LEGENDS = Object.freeze({
  G8: "FORMATO DC-3 CONSTANCIA SINTÉTICA DE COMPETENCIAS O DE HABILIDADES LABORALES",
  E10: "DATOS DEL TRABAJADOR",
  E12: "Nombre sintético (apellido paterno, apellido materno y nombre)",
  E15: "Clave Única de Registro de Población",
  Z15: "Ocupación específica sintética 1/",
  E18: "Puesto*",
  E22: "DATOS DE LA EMPRESA",
  E24: "Nombre o razón social sintética",
  F26: "EMPRESA SINTÉTICA S.A. DE C.V.",
  E27: "Registro Federal de Contribuyentes con homoclave (SHCP)",
  E31: "DATOS DEL PROGRAMA DE CAPACITACIÓN SINTÉTICO",
  E33: "Nombre del curso",
  E36: "Duración en horas",
  P36: "Periodo de ejecución",
  V36: "Año",
  Z36: "Mes",
  AD36: "Día",
  AJ36: "Año",
  AN36: "Mes",
  AR36: "Día",
  T38: "De",
  AH38: "a",
  E39: "Área temática del curso 2/",
  E42: "Nombre del agente capacitador o STPS 3/",
  E47: "Los datos se asientan en esta constancia sintética bajo protesta de decir verdad,",
  E48: "apercibidos de la responsabilidad en que incurre quien no se conduce con verdad.",
  H51: "Instructor o tutor",
  U51: "Patrón o representante legal 4/",
  AH51: "Representante de los trabajadores 5/",
  H55: "Nombre y firma",
  E59: "INSTRUCCIONES",
  E60: "- Instrucción sintética de llenado del formato de prueba. 1/ Nota sintética. 2/ Nota sintética.",
  E66: "DC-3",
  G53: "INSTRUCTOR SINTÉTICO",
  T53: "PATRÓN SINTÉTICO",
  AG53: "TRABAJADOR SINTÉTICO"
});

const SYNTHETIC_TAX_ID = Object.freeze({
  E29: "S", G29: "I", H29: "N", I29: "9", J29: "0", K29: "0", L29: "1", M29: "0",
  N29: "1", O29: "-", P29: "S", Q29: "N", R29: "T"
});

const SYNTHETIC_CORE_PROPERTIES =
  "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\"" +
  " xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\">" +
  "<dc:creator>PERSONA REAL</dc:creator><cp:lastModifiedBy>PERSONA REAL</cp:lastModifiedBy>" +
  "<dcterms:modified>2025-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>";

// La ruta privada y el autor falsos son deliberados: la plantilla oficial los trae y sirven para
// comprobar que el PDF no arrastra metadatos de su origen. Ninguno corresponde a una persona real.
export function buildSyntheticDc3Template() {
  const cells = { ...DC3_TEMPLATE_LEGENDS, ...SYNTHETIC_TAX_ID };
  const rowGroups = new Map();
  for (const [reference, value] of Object.entries(cells)) {
    const row = Number(reference.match(/\d+$/)[0]);
    if (!rowGroups.has(row)) rowGroups.set(row, []);
    rowGroups.get(row).push(syntheticInlineCell(reference, value));
  }
  const sheetXml = buildSyntheticWorksheetXml(
    [...rowGroups.entries()].sort(([left], [right]) => left - right)
  );
  return buildSyntheticWorkbook(
    [{ name: "Hoja 1", xml: sheetXml }],
    { includePrivatePath: true, core: SYNTHETIC_CORE_PROPERTIES }
  );
}

function shiftIsoDate(iso, days) {
  const base = new Date(`${iso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const CONSONANTS = "BCDFGLMNPRSTVZ";

// CURP sintetica que satisface la validacion estructural sin corresponder a ninguna persona: el
// bloque de fecha usa siempre el mismo dia y las letras derivan del indice.
function syntheticCurp(index) {
  const letters = `${CONSONANTS[index % CONSONANTS.length]}A${CONSONANTS[(index + 3) % CONSONANTS.length]}${CONSONANTS[(index + 7) % CONSONANTS.length]}`;
  const tail = `${CONSONANTS[(index + 1) % CONSONANTS.length]}${CONSONANTS[(index + 2) % CONSONANTS.length]}${CONSONANTS[(index + 4) % CONSONANTS.length]}${CONSONANTS[(index + 5) % CONSONANTS.length]}${CONSONANTS[(index + 6) % CONSONANTS.length]}`;
  return `${letters}950101${index % 2 === 0 ? "H" : "M"}${tail}0${index % 10}`;
}

const SYNTHETIC_POSITIONS = Object.freeze([
  "OPERADOR SINTÉTICO",
  "TÉCNICO SINTÉTICO",
  "SUPERVISOR SINTÉTICO",
  "ANALISTA SINTÉTICO"
]);

const PRE_CUTOFF_HIRE_DATE = "2019-03-15";

/**
 * Padron activo y snapshot HC sinteticos derivados de la configuracion real de cursos. El ensayo
 * ejercita las mismas definiciones que se emitiran —los courseId, los nombres normalizados y la
 * regla de corte— con identidades inventadas, de modo que un cambio de configuracion se note aqui
 * antes de la emision.
 */
export function buildSyntheticDc3Dataset({ config, workerCount = 12 }) {
  if (!Number.isInteger(workerCount) || workerCount < 3 || workerCount > 200) {
    throw new TypeError("workerCount debe ser un entero entre 3 y 200");
  }
  const cutoffDate = config.cutoffDate;
  const employees = Array.from({ length: workerCount }, (_, index) => {
    const employeeId = String(90_001 + index).padStart(5, "0");
    // Un tercio ingresa despues del corte: son los unicos candidatos a induccion por fecha de alta.
    const hireDate = index % 3 === 0 ? shiftIsoDate(cutoffDate, index + 2) : PRE_CUTOFF_HIRE_DATE;
    // El ultimo trabajador llega con CURP invalida para que el tablero muestre un bloqueo de origen
    // distinguible de los bloqueos por metadatos pendientes.
    const brokenIdentity = index === workerCount - 1;
    return {
      employeeId,
      displayName: `PERSONA SINTÉTICA ${String(index + 1).padStart(2, "0")}`,
      position: SYNTHETIC_POSITIONS[index % SYNTHETIC_POSITIONS.length],
      curp: brokenIdentity ? "" : syntheticCurp(index),
      hireDate,
      active: true,
      sourceSheet: index % 2 === 0 ? "SND ACTIVOS" : "EMP ACTIVOS",
      sourceRow: index + 2,
      issues: brokenIdentity ? ["INVALID_OR_MISSING_CURP"] : []
    };
  });

  const courses = [];
  const completions = [];
  for (const [courseIndex, course] of config.courses.entries()) {
    if (course.source?.kind !== "HC_COURSE") continue;
    const sourceKey = `synthetic:${course.courseId.toLowerCase()}`;
    const displayName = course.source.normalizedNames[0];
    courses.push({ sourceKey, displayName, normalizedName: displayName });
    for (const [index, employee] of employees.entries()) {
      if ((index + courseIndex) % 2 !== 0) continue;
      const completionDate = shiftIsoDate(cutoffDate, index + courseIndex + 5);
      completions.push({ employeeId: employee.employeeId, sourceKey, completionDate });
      // Repeticion posterior del mismo curso: la constancia debe seguir siendo una sola y conservar
      // la primera fecha elegible.
      completions.push({
        employeeId: employee.employeeId,
        sourceKey,
        completionDate: shiftIsoDate(completionDate, 45)
      });
    }
    // Registro en la matriz sin identidad en las hojas activas: reproduce ACTIVE_IDENTITY_NOT_FOUND.
    completions.push({
      employeeId: "90999",
      sourceKey,
      completionDate: shiftIsoDate(cutoffDate, 9)
    });
  }

  const snapshot = {
    schemaVersion: "HC_SNAPSHOT_V1",
    source: { sha256: sha256(JSON.stringify({ courses, completions })), byteSize: 0 },
    courses,
    completions,
    employees: employees.map(({ employeeId, displayName }) => ({ employeeId, displayName })),
    diagnostics: { blocking: [] }
  };
  const roster = {
    schemaVersion: "DC3_ACTIVE_ROSTER_V1",
    source: { sha256: sha256(JSON.stringify(employees)), byteSize: 0, sheets: ["SND ACTIVOS", "EMP ACTIVOS"] },
    employees,
    diagnostics: {
      sourceRowCount: employees.length,
      employeeCount: employees.length,
      readyEmployeeCount: employees.filter(({ issues }) => issues.length === 0).length,
      issues: { INVALID_OR_MISSING_CURP: employees.filter(({ issues }) => issues.length > 0).length }
    }
  };
  return { snapshot, roster };
}
