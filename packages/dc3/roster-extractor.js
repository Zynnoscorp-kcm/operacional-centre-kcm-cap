import { civilDateToIso, normalizedLabel, XlsxWorkbook } from "./xlsx-reader.js";

const ACTIVE_SHEETS = Object.freeze(["SND ACTIVOS", "EMP ACTIVOS"]);
const REQUIRED_HEADERS = Object.freeze({
  employeeId: ["NUMERO", "NO", "NUMERO DE TRABAJADOR"],
  displayName: ["NOMBRE", "NOMBRE COMPLETO"],
  position: ["NOMBRE DE PUESTO", "PUESTO"],
  curp: ["C U R P", "CURP", "CLAVE UNICA DE REGISTRO DE POBLACION"],
  hireDate: ["FEC ALTA", "FECHA DE ALTA"]
});

const OPTIONAL_HEADERS = Object.freeze({
  plant: ["AREA", "PLANTA", "CENTRO DE TRABAJO"],
  cnoKey: [
    "CLAVE DE OCUPACION",
    "CLAVE OCUPACION",
    "OCUPACION ESPECIFICA",
    "CLAVE CNO",
    "CNO",
    "OCUPACION CNO",
    "CATALOGO NACIONAL DE OCUPACIONES",
    "CLAVE CATALOGO NACIONAL DE OCUPACIONES",
    "TIPO DE TRABAJO",
    "CLAVE TIPO DE TRABAJO",
    "CLAVE DE TIPO DE TRABAJO",
    "CLAVE DEL TIPO DE TRABAJO"
  ],
  rfc: ["R F C", "RFC"],
  nss: ["I M S S", "IMSS", "NSS", "NUMERO DE SEGURO SOCIAL"],
  costCenterKey: ["CVE C COSTOS", "CLAVE C COSTOS", "CLAVE CENTRO DE COSTOS"],
  costCenterName: ["NOMBRE C COSTOS", "NOMBRE CENTRO DE COSTOS", "CENTRO DE COSTOS"],
  address: ["DIRECCIO", "DIRECCION", "DOMICILIO"],
  postalCode: ["C POSTAL", "CODIGO POSTAL", "CP"],
  maritalStatus: ["E CIVIL", "ESTADO CIVIL"],
  sex: ["SEXO", "GENERO"]
});

const TERMINATION_SHEET_PATTERN = /BAJAS/;
const TERMINATION_HEADERS = Object.freeze({
  employeeId: ["NUMERO", "NO", "NUMERO DE TRABAJADOR"],
  terminationDate: ["FEC BAJA", "FECHA DE BAJA"]
});

function normalizeCnoKey(value) {
  const clave = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return clave && clave.length <= 20 ? clave : null;
}

function normalizeEmployeeId(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 99_999) return null;
    return String(value).padStart(5, "0");
  }
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  return text.padStart(5, "0");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeCurp(value) {
  const curp = String(value ?? "").toUpperCase().replace(/[^A-Z0-9Ñ]/g, "");
  return /^[A-ZÑ][AEIOUX][A-ZÑ]{2}\d{6}[HM][A-ZÑ]{5}[A-Z0-9]\d$/.test(curp)
    ? curp
    : null;
}

function headerColumns(sheet) {
  const byLabel = new Map();
  for (const cell of sheet.cells.values()) {
    if (cell.row !== 1 || cell.value === null || cell.error) continue;
    const label = normalizedLabel(cell.value);
    if (!label) continue;
    if (byLabel.has(label)) throw new Error(`La hoja ${sheet.name} contiene encabezados duplicados`);
    byLabel.set(label, { column: cell.column, columnName: cell.columnName, header: String(cell.value).trim() });
  }
  const columns = {};
  const detected = [];
  for (const [field, aliases] of Object.entries(REQUIRED_HEADERS)) {
    const matches = resolveColumn(byLabel, aliases);
    if (matches.length !== 1) {
      throw new Error(`La hoja ${sheet.name} no resuelve un encabezado unico para ${field}`);
    }
    columns[field] = matches[0].column;
    detected.push({
      field,
      header: matches[0].header,
      columnName: matches[0].columnName,
      required: true,
      present: true
    });
  }
  for (const [field, aliases] of Object.entries(OPTIONAL_HEADERS)) {
    const matches = resolveColumn(byLabel, aliases);
    if (matches.length > 1) {
      throw new Error(`La hoja ${sheet.name} tiene mas de un encabezado para ${field}`);
    }
    columns[field] = matches.length === 1 ? matches[0].column : null;
    detected.push({
      field,
      header: matches.length === 1 ? matches[0].header : "",
      columnName: matches.length === 1 ? matches[0].columnName : "",
      required: false,
      present: matches.length === 1
    });
  }
  return { columns, detected };
}

function resolveColumn(byLabel, aliases) {
  return aliases
    .map(normalizedLabel)
    .filter((alias) => byLabel.has(alias))
    .map((alias) => byLabel.get(alias));
}

function rowsByNumber(sheet) {
  const rows = new Map();
  for (const cell of sheet.cells.values()) {
    if (cell.row <= 1) continue;
    if (!rows.has(cell.row)) rows.set(cell.row, new Map());
    rows.get(cell.row).set(cell.column, cell);
  }
  return rows;
}

function cellValue(row, column) {
  if (column === null || column === undefined) return null;
  const cell = row.get(column);
  return !cell || cell.error ? null : cell.value;
}

function payrollTypeFromSheet(sheetName) {
  const normalized = normalizedLabel(sheetName);
  if (normalized.startsWith("SND")) return "NS";
  if (normalized.startsWith("EMP")) return "NQ";
  return "";
}

function sameEmployee(left, right) {
  return ["displayName", "position", "curp", "hireDate", "cnoKey"].every(
    (field) => String(left[field] ?? "") === String(right[field] ?? "")
  );
}

function diagnosticCounts(issues) {
  const counts = {};
  for (const issue of issues) counts[issue] = (counts[issue] || 0) + 1;
  return counts;
}

export function extractActiveRosterFromBuffer(input, options = {}) {
  if (!Buffer.isBuffer(input)) throw new TypeError("input debe ser un Buffer XLSX");
  const workbook = new XlsxWorkbook(input);
  const requestedSheets = options.activeSheets || ACTIVE_SHEETS;
  const employees = new Map();
  const globalIssues = [];
  const sheetDiagnostics = [];
  let sourceRowCount = 0;

  for (const sheetName of requestedSheets) {
    const sheet = workbook.readSheet(sheetName);
    const { columns, detected } = headerColumns(sheet);
    const rows = rowsByNumber(sheet);
    let rowsWithIdentity = 0;
    let acceptedRows = 0;
    const issues = [];

    for (const [rowNumber, row] of rows) {
      const rawEmployeeId = cellValue(row, columns.employeeId);
      if (rawEmployeeId === null || String(rawEmployeeId).trim() === "") continue;
      rowsWithIdentity += 1;
      sourceRowCount += 1;
      const employeeId = normalizeEmployeeId(rawEmployeeId);
      if (!employeeId) {
        issues.push("INVALID_EMPLOYEE_ID");
        continue;
      }
      const displayName = normalizeText(cellValue(row, columns.displayName));
      const position = normalizeText(cellValue(row, columns.position));
      const curp = normalizeCurp(cellValue(row, columns.curp));
      const hireDate = civilDateToIso(cellValue(row, columns.hireDate), workbook.dateSystem);
      const claveEnCelda = cellValue(row, columns.cnoKey);
      const cnoKey = normalizeCnoKey(claveEnCelda);
      const plant = normalizeText(cellValue(row, columns.plant));
      const texto = (campo) => normalizeText(cellValue(row, columns[campo]));
      const employeeIssues = [];
      if (!displayName) employeeIssues.push("MISSING_DISPLAY_NAME");
      if (!position) employeeIssues.push("MISSING_POSITION");
      if (!curp) employeeIssues.push("INVALID_OR_MISSING_CURP");
      if (!hireDate) employeeIssues.push("INVALID_OR_MISSING_HIRE_DATE");
      if (columns.cnoKey !== null && !cnoKey) {
        employeeIssues.push(normalizeText(claveEnCelda) ? "INVALID_CNO_KEY" : "MISSING_CNO_KEY");
      }
      const record = {
        employeeId,
        displayName,
        position,
        curp: curp || "",
        hireDate: hireDate || "",
        cnoKey: cnoKey || "",
        plant: plant || "",
        rfc: texto("rfc").toUpperCase(),
        nss: texto("nss"),
        costCenterKey: texto("costCenterKey"),
        costCenterName: texto("costCenterName"),
        address: texto("address"),
        postalCode: texto("postalCode"),
        maritalStatus: texto("maritalStatus"),
        sex: texto("sex"),
        payrollType: payrollTypeFromSheet(sheet.name),
        active: true,
        sourceSheet: sheet.name,
        sourceRow: rowNumber,
        issues: employeeIssues
      };
      const existing = employees.get(employeeId);
      if (existing) {
        if (!sameEmployee(existing, record)) {
          existing.issues = [...new Set([...existing.issues, "CONFLICTING_ACTIVE_EMPLOYEE"])]
            .sort();
          issues.push("CONFLICTING_ACTIVE_EMPLOYEE");
        }
        continue;
      }
      employees.set(employeeId, record);
      acceptedRows += 1;
      issues.push(...employeeIssues);
    }

    globalIssues.push(...issues);
    sheetDiagnostics.push({
      sheetName: sheet.name,
      columns: detected,
      rowsWithIdentity,
      acceptedRows,
      issues: diagnosticCounts(issues),
      formulaCellCount: sheet.diagnostics.formulaCellCount,
      formulaWithoutCachedValueCount: sheet.diagnostics.formulaWithoutCachedValueCount,
      errorCellCount: sheet.diagnostics.errorCellCount
    });
  }

  const terminations = new Map();
  for (const sheet of workbook.sheets) {
    if (!TERMINATION_SHEET_PATTERN.test(normalizedLabel(sheet.name))) continue;
    const leida = workbook.readSheet(sheet);
    const byLabel = new Map();
    for (const cell of leida.cells.values()) {
      if (cell.row !== 1 || cell.value === null || cell.error) continue;
      const label = normalizedLabel(cell.value);
      if (label && !byLabel.has(label)) byLabel.set(label, cell.column);
    }
    const columna = (aliases) =>
      aliases.map(normalizedLabel).map((alias) => byLabel.get(alias)).find((c) => c !== undefined);
    const colNumero = columna(TERMINATION_HEADERS.employeeId);
    const colFecha = columna(TERMINATION_HEADERS.terminationDate);
    if (colNumero === undefined || colFecha === undefined) continue;
    for (const row of rowsByNumber(leida).values()) {
      const employeeId = normalizeEmployeeId(cellValue(row, colNumero));
      const fecha = civilDateToIso(cellValue(row, colFecha), workbook.dateSystem);
      if (!employeeId || !fecha) continue;
      const previa = terminations.get(employeeId);
      if (!previa || fecha > previa) terminations.set(employeeId, fecha);
    }
  }

  const records = [...employees.values()]
    .map((employee) => ({ ...employee, issues: [...new Set(employee.issues)].sort() }))
    .sort((left, right) => left.employeeId.localeCompare(right.employeeId));
  return {
    schemaVersion: "DC3_ACTIVE_ROSTER_V1",
    source: {
      sha256: workbook.sourceSha256,
      byteSize: input.length,
      sheets: requestedSheets.slice()
    },
    employees: records,
    terminations: [...terminations]
      .map(([employeeId, terminationDate]) => ({ employeeId, terminationDate }))
      .sort((left, right) => left.employeeId.localeCompare(right.employeeId)),
    diagnostics: {
      sourceRowCount,
      employeeCount: records.length,
      readyEmployeeCount: records.filter(({ issues }) => issues.length === 0).length,
      issues: diagnosticCounts(globalIssues),
      sheets: sheetDiagnostics
    }
  };
}
