import { civilDateToIso, normalizedLabel, XlsxWorkbook } from "./xlsx-reader.js";

const ACTIVE_SHEETS = Object.freeze(["SND ACTIVOS", "EMP ACTIVOS"]);
const REQUIRED_HEADERS = Object.freeze({
  employeeId: ["NUMERO", "NO", "NUMERO DE TRABAJADOR"],
  displayName: ["NOMBRE", "NOMBRE COMPLETO"],
  position: ["NOMBRE DE PUESTO", "PUESTO"],
  curp: ["C U R P", "CURP", "CLAVE UNICA DE REGISTRO DE POBLACION"],
  hireDate: ["FEC ALTA", "FECHA DE ALTA"]
});

/**
 * Encabezados que pueden faltar sin que el archivo deje de leerse.
 *
 * `cnoKey` es la clave del Catalogo Nacional de Ocupaciones, el ultimo dato que
 * le falta al recuadro «Ocupacion especifica» del DC-3. Se declara opcional a
 * proposito: los libros de semanas anteriores no la traen, y volverlos
 * ilegibles de golpe convertiria una mejora en una interrupcion. En cuanto la
 * columna exista en las dos hojas, se lee sola.
 *
 * El nombre de la columna admite varias formas porque nadie escribe dos veces
 * igual un encabezado largo. Cuidado al agregar alias: si uno de ellos coincide
 * —ya normalizado— con un alias de otro campo, `headerColumns` deja de resolver
 * un encabezado unico y rechaza el libro entero.
 */
const OPTIONAL_HEADERS = Object.freeze({
  /**
   * La planta, aunque la columna del libro se llame `AREA`.
   *
   * Es una trampa que conviene dejar escrita. En `sem 29 CAP.xlsx` la columna
   * rotulada AREA trae tres valores para las 1,686 filas —`ECATEPEC I`,
   * `ECATEPEC II` y `MANTTO INGENIERIA`—, es decir el centro de trabajo. El
   * `area` de la matriz es otra cosa: treinta y ocho valores operativos como
   * `SERVILLETAS Y FACIALES` o `GERENCIA DE MANTTO. ELECTRICO`. Compararlas
   * porque comparten rotulo produciria mil seiscientas divergencias falsas.
   *
   * Se lee como `plant` y se contrasta con `organizacion.trabajador.planta`, que es el
   * campo que si significa lo mismo. Opcional, como la clave de ocupacion: un
   * libro sin la columna se sigue leyendo.
   */
  plant: ["AREA", "PLANTA", "CENTRO DE TRABAJO"],
  // El primero es el rotulo declarado por el departamento el 2026-08-13:
  // «Clave de ocupacion», provisional hasta que fijen el definitivo. Los demas
  // son formas que se siguen aceptando; los libros anteriores traen `CLAVE CNO`
  // y volverlos ilegibles al renombrar seria convertir una mejora en una
  // interrupcion. La comparacion es sobre el rotulo ya normalizado, asi que
  // acentos, mayusculas, puntos y espacios dan igual.
  cnoKey: [
    "CLAVE DE OCUPACION",
    "CLAVE OCUPACION",
    "OCUPACION ESPECIFICA",
    "CLAVE CNO",
    "CNO",
    "OCUPACION CNO",
    "CATALOGO NACIONAL DE OCUPACIONES",
    "CLAVE CATALOGO NACIONAL DE OCUPACIONES",
    // Como el departamento la nombro al pedirla: «la clave del tipo de trabajo
    // que desarrollan los trabajadores». Es el mismo dato.
    "TIPO DE TRABAJO",
    "CLAVE TIPO DE TRABAJO",
    "CLAVE DE TIPO DE TRABAJO",
    "CLAVE DEL TIPO DE TRABAJO"
  ],
  // El resto del padrón, desde el 2026-09-25: el departamento pidió que el
  // panel de cambios cubra todas las columnas. Opcionales como las anteriores:
  // un libro que no las traiga se sigue leyendo.
  rfc: ["R F C", "RFC"],
  nss: ["I M S S", "IMSS", "NSS", "NUMERO DE SEGURO SOCIAL"],
  costCenterKey: ["CVE C COSTOS", "CLAVE C COSTOS", "CLAVE CENTRO DE COSTOS"],
  costCenterName: ["NOMBRE C COSTOS", "NOMBRE CENTRO DE COSTOS", "CENTRO DE COSTOS"],
  address: ["DIRECCIO", "DIRECCION", "DOMICILIO"],
  postalCode: ["C POSTAL", "CODIGO POSTAL", "CP"],
  maritalStatus: ["E CIVIL", "ESTADO CIVIL"],
  sex: ["SEXO", "GENERO"]
});

/**
 * Hojas de bajas: `SND BAJAS` y `EMP BAJAS`. No hacen falta para leer el
 * padrón; si vienen, dan la fecha de baja de quien ya no está en activos.
 */
const TERMINATION_SHEET_PATTERN = /BAJAS/;
const TERMINATION_HEADERS = Object.freeze({
  employeeId: ["NUMERO", "NO", "NUMERO DE TRABAJADOR"],
  terminationDate: ["FEC BAJA", "FECHA DE BAJA"]
});

/**
 * La clave del CNO se guarda tal como la escribe el departamento, sin acentos ni
 * espacios de sobra y en mayusculas. No se valida su forma: el catalogo usa
 * claves numericas de cuatro digitos, pero mientras Capacitacion no declare por
 * escrito que ese es el formato obligatorio, rechazar aqui una clave con otra
 * forma seria inventar una regla. Lo que si se hace es no dejar pasar basura
 * evidente: mas de veinte caracteres no es una clave.
 */
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

/**
 * Resuelve los encabezados de la hoja y deja constancia de cual fue cada uno.
 *
 * Devuelve dos cosas por separado a proposito. `columns` es lo que la lectura
 * necesita —el indice numerico de cada campo— y no cambio de forma. `detected`
 * es para ensenar: el rotulo tal como esta escrito en el libro y la letra de su
 * columna, que es lo que permite ir a la hoja a mirar sin buscar a ojo, y el
 * campo opcional ausente dicho por su nombre en lugar de por su silencio.
 */
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
  // Un opcional ausente deja la columna en `null` y su valor sale vacio. Dos
  // encabezados que apunten al mismo campo opcional si son un error: no hay
  // forma de saber cual es el bueno, y elegir uno en silencio es peor que fallar.
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

/**
 * De que hoja salio el trabajador, traducido al tipo de nomina del dominio.
 *
 * El padron divide sindicalizados y personal de confianza por hoja, no por
 * columna: `SND ACTIVOS` y `EMP ACTIVOS`. Es la fuente que origina esa
 * clasificacion, asi que aqui se conserva; que la base la tome de la matriz es
 * una decision aparte, y justamente por eso hace falta poder compararlas.
 *
 * Una hoja con otro nombre devuelve cadena vacia en vez de adivinar: preferir
 * "no se" a una clasificacion inventada es la regla de todo este extractor.
 */
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
      // La clave del CNO sólo se reclama cuando la columna existe: en un libro
      // que todavía no la trae, anotar mil setecientas incidencias no informaría
      // de nada. Con columna presente y celda vacía, sí es un hueco real.
      // Una celda con texto que no es clave (mas de veinte caracteres) no es un
      // hueco: nadie debe escribir encima como si estuviera vacia.
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

  // Las bajas: número y fecha, de las hojas que las traigan. Una hoja sin los
  // dos encabezados se ignora; la baja es un dato de más, no un requisito.
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
      // Si alguien tiene varias bajas, vale la más reciente.
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
