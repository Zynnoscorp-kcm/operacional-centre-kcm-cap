import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildSyntheticXlsb, syntheticCourseNames } from "../fixtures/synthetic/xlsb-fixture.js";
import { buildZip, sha256 } from "../../dc3/ooxml.js";
import { extractDc3Legends, generateDc3Document } from "../../dc3/pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "../../dc3/pdf/leyendas-oficiales.js";
import { measureText } from "../../dc3/pdf/pdf-writer.js";
import { planDc3Documents } from "../../dc3/planner.js";
import { extractActiveRosterFromBuffer } from "../../dc3/roster-extractor.js";
import { materializeDc3Plan, runDc3Generator } from "../../dc3/runner.js";
import { buildSyntheticDc3Template } from "../../dc3/testing/synthetic-dataset.js";

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

function completeConfig() {
  return {
    schemaVersion: "DC3_CONFIG_V1",
    configVersion: "synthetic-v1",
    cutoffDate: "2026-01-01",
    courses: [
      {
        courseId: "INDUCCION_EMPRESA",
        source: { kind: "ACTIVE_HIRE_DATE" },
        dc3Name: "INDUCCIÓN SINTÉTICA",
        durationHours: 2,
        thematicArea: "ÁREA SINTÉTICA",
        trainingAgent: "AGENTE SINTÉTICO"
      },
      {
        courseId: "QMS",
        source: { kind: "HC_COURSE", normalizedNames: ["QMS"] },
        dc3Name: "QMS SINTÉTICO",
        durationHours: 3,
        thematicArea: "ÁREA SINTÉTICA",
        trainingAgent: "AGENTE SINTÉTICO"
      },
      {
        courseId: "LOTO",
        source: { kind: "HC_COURSE", normalizedNames: ["CURSO LOTO"] },
        dc3Name: "LOTO SINTÉTICO",
        durationHours: 8,
        thematicArea: "SEGURIDAD SINTÉTICA",
        trainingAgent: "AGENTE SINTÉTICO"
      }
    ]
  };
}

function syntheticRoster() {
  return {
    schemaVersion: "DC3_ACTIVE_ROSTER_V1",
    employees: [{
      employeeId: "00001",
      displayName: "PERSONA SINTÉTICA UNO",
      position: "PUESTO SINTÉTICO",
      curp: "AAAA000101HDFBBBB0",
      hireDate: "2026-01-03",
      active: true,
      issues: []
    }]
  };
}

function syntheticSnapshot() {
  return {
    schemaVersion: "HC_SNAPSHOT_V1",
    courses: [
      { sourceKey: "course:qms", displayName: "QMS", normalizedName: "QMS" },
      { sourceKey: "course:loto", displayName: "CURSO LOTO", normalizedName: "CURSO LOTO" }
    ],
    completions: [
      { employeeId: "00001", sourceKey: "course:qms", completionDate: "2026-02-01" },
      { employeeId: "00001", sourceKey: "course:qms", completionDate: "2026-03-01" },
      { employeeId: "00001", sourceKey: "course:loto", completionDate: "2026-02-02" }
    ]
  };
}

test("planea exactamente tres DC-3 y conserva la primera fecha elegible", () => {
  const plan = planDc3Documents({
    snapshot: syntheticSnapshot(),
    roster: syntheticRoster(),
    config: completeConfig()
  });
  assert.equal(plan.summary.detected, 3);
  assert.equal(plan.summary.ready, 3);
  assert.equal(plan.summary.coverage.withThreeDocuments, 1);
  assert.equal(plan.documents.find(({ courseId }) => courseId === "QMS").completionDate, "2026-02-01");
  assert.equal(new Set(plan.documents.map(({ logicalKey }) => logicalKey)).size, 3);
});

test("bloquea la emisión si falta un metadato legal del curso", () => {
  const config = completeConfig();
  config.courses[1].trainingAgent = "";
  const plan = planDc3Documents({
    snapshot: syntheticSnapshot(),
    roster: syntheticRoster(),
    config
  });
  const qms = plan.documents.find(({ courseId }) => courseId === "QMS");
  assert.equal(qms.ready, false);
  assert.deepEqual(qms.issues, ["MISSING_TRAINING_AGENT"]);
  assert.equal(plan.summary.ready, 2);
});

function templateWorkbook() {
  return buildSyntheticDc3Template();
}

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

// El flujo de contenido del PDF se escribe sin comprimir a proposito: permite verificar renglon por
// renglon lo que se imprime, que es la unica forma de comprobar que un texto no se desborda ni se
// cuela algo que no deberia salir.
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
  // La CURP y el RFC se imprimen caracter por caracter, cada uno en su recuadro.
  assert.equal(drawnLines(output).filter(({ text }) => text.length === 1).length >= 18 + 12, true);
  assert.doesNotMatch(output.toString("latin1"), /absPath|Private|PERSONA REAL/i);
  assert.match(output.toString("latin1"), /\/Producer \(KCM Cap DC3\)/);
});

// El ledger compara el SHA-256 del archivo emitido: si el PDF llevara una fecha de generacion o un
// identificador aleatorio, un reintento identico se convertiria en conflicto y bloquearia la corrida.
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
  // Ninguna linea excede el ancho util de la caja: 612 de pagina menos margenes y respiro interior.
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
  // Los nombres al pie se comparan contra las leyendas, no contra literales: son personas reales y
  // no tienen por que quedar transcritas tambien en la prueba.
  const firmas = LEYENDAS_DC3.templateSignatures;
  assert.match(printed, /INSTRUCTOR CONFIGURADO/);
  if (firmas.instructor) assert.equal(printed.includes(firmas.instructor), false);
  for (const nombre of [firmas.employerRepresentative, firmas.workerRepresentative]) {
    if (nombre) assert.equal(printed.includes(nombre), true);
  }
});

test("la razon social de los datos sustituye la que traen las leyendas horneadas", () => {
  // Sin razon social en los datos se imprime la horneada, ya corregida. Aun asi la buena viaja
  // siempre en los datos: al hacerlo entra en la huella del documento y un cambio de razon social
  // no se emite en silencio.
  assert.match(printedText(generateDc3Document(SAMPLE_DOCUMENT)), /KIMBERLY CLARK DE MÉXICO S\.A\.B DE C\.V/);
  const output = generateDc3Document({ ...SAMPLE_DOCUMENT, employerName: "RAZÓN SOCIAL CORREGIDA" });
  assert.match(printedText(output), /RAZÓN SOCIAL CORREGIDA/);
});

// `extractDc3Legends` ya no participa en la emision: solo la usa la prueba que compara las leyendas
// horneadas contra el borrador oficial. Se conserva su exigencia porque esa comparacion no sirve de
// nada si el extractor acepta una hoja incompleta y devuelve leyendas a medias.
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

// El archivo oficial es una hoja de calculo con dos catalogos de consulta en el reverso. Esa parte no
// pertenece a la constancia que se entrega, y sin una prueba nadie notaria si volviera a colarse.
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
  // Reverso de consulta: ni el titulo de los catalogos ni sus renglones deben aparecer. La leyenda
  // oficial de instrucciones si menciona "el reverso de este formato" y se conserva textual: es
  // redaccion de la STPS, no una marca de pagina.
  assert.doesNotMatch(printed, /CLAVES Y DENOMINACIONES/i);
  assert.doesNotMatch(printed, /Cultivo, crianza/i);
  assert.doesNotMatch(printed, /Desarrollo personal y familiar/i);
  assert.doesNotMatch(printed, /Gestión y soporte administrativo/i);
  assert.doesNotMatch(printed, /\bANVERSO\b/i);

  const after = statSync(OFFICIAL_TEMPLATE);
  assert.equal(sha256(readFileSync(OFFICIAL_TEMPLATE)), before.sha256);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

// Proyecto sintetico completo: matriz XLSB, padron activo y plantilla. Permite ejercitar el punto de
// entrada real —resolucion de rutas, frontera privada, lock, ledger y salidas— sin tocar un original.
function syntheticProjectRoot() {
  const root = mkdtempSync(join(tmpdir(), "kcm-dc3-proyecto-"));
  mkdirSync(join(root, "referencias", "privado"), { recursive: true });
  const courseNames = syntheticCourseNames();
  courseNames[0] = "QMS";
  courseNames[1] = "LOTO SINTÉTICO";
  writeFileSync(join(root, "matriz.xlsb"), buildSyntheticXlsb({ courseNames }));
  writeFileSync(join(root, "padron.xlsx"), xlsx([
    {
      name: "SND ACTIVOS",
      // Alta anterior al corte: aporta QMS y LOTO desde la matriz, pero no Induccion.
      xml: rosterSheet(["00123", "PERSONA SINTÉTICA UNO", "PUESTO SINTÉTICO", "AAAA000101HDFBBBB0", "2020-02-29"])
    },
    {
      name: "EMP ACTIVOS",
      // Alta posterior al corte: aporta Induccion por fecha de alta.
      xml: rosterSheet(["00007", "PERSONA SINTÉTICA DOS", "OTRO PUESTO", "BABC000101MDFCCCC1", "2026-03-02"])
    }
  ]));
  writeFileSync(join(root, "plantilla.xlsx"), templateWorkbook());
  return root;
}

const PENDING_METADATA = Object.freeze({ durationHours: null, thematicArea: "", trainingAgent: "" });
const APPROVED_METADATA = Object.freeze({
  durationHours: 8,
  thematicArea: "ÁREA SINTÉTICA",
  trainingAgent: "AGENTE SINTÉTICO"
});

function projectConfig({ configVersion = "sintetica-v1", metadata = {} } = {}) {
  const forCourse = (courseId) => ({ ...PENDING_METADATA, ...(metadata[courseId] || {}) });
  return {
    schemaVersion: "DC3_CONFIG_V1",
    configVersion,
    cutoffDate: "2026-01-01",
    paths: {
      matrix: "matriz.xlsb",
      roster: "padron.xlsx",
      template: "plantilla.xlsx",
      outputDirectory: "referencias/privado/dc3-generados",
      ledger: "referencias/privado/dc3-ledger.json",
      blockedReport: "referencias/privado/dc3-bloqueos.tsv"
    },
    courses: [
      {
        courseId: "INDUCCION_EMPRESA",
        source: { kind: "ACTIVE_HIRE_DATE" },
        dc3Name: "INDUCCIÓN SINTÉTICA",
        ...forCourse("INDUCCION_EMPRESA")
      },
      {
        courseId: "QMS",
        source: { kind: "HC_COURSE", normalizedNames: ["QMS"] },
        dc3Name: "QMS SINTÉTICO",
        ...forCourse("QMS")
      },
      {
        courseId: "LOTO",
        source: { kind: "HC_COURSE", normalizedNames: ["LOTO SINTÉTICO"] },
        dc3Name: "LOTO SINTÉTICO",
        ...forCourse("LOTO")
      }
    ]
  };
}

function runProject(root, config, options = {}) {
  writeFileSync(join(root, "dc3-config.json"), JSON.stringify(config));
  return runDc3Generator({ projectRoot: root, configPath: "dc3-config.json", ...options });
}

const ALL_APPROVED = {
  INDUCCION_EMPRESA: APPROVED_METADATA,
  QMS: { ...APPROVED_METADATA, durationHours: 3 },
  LOTO: APPROVED_METADATA
};

test("el dia de la aprobacion solo se capturan los metadatos y el sistema emite sin rehacer nada", () => {
  const root = syntheticProjectRoot();
  try {
    const pending = runProject(root, projectConfig());
    assert.equal(pending.detected, 3);
    assert.equal(pending.ready, 0);
    assert.equal(pending.execution.mode, "PLAN_ONLY");
    // Nada bloquea por origen: los tres candidatos quedan detenidos solo por los metadatos legales.
    assert.deepEqual(pending.readiness, {
      metadataApproved: false,
      canEmit: false,
      coursesPendingMetadata: ["INDUCCION_EMPRESA", "QMS", "LOTO"].map((courseId) => ({
        courseId,
        missingMetadata: [
          "MISSING_OR_INVALID_DURATION",
          "MISSING_THEMATIC_AREA",
          "MISSING_TRAINING_AGENT"
        ]
      })),
      emitOnApproval: 3,
      blockedBySource: 0,
      sourceIssues: {}
    });

    // Con metadatos pendientes la emision se niega en vez de producir un lote a medias.
    assert.throws(
      () => runProject(root, projectConfig(), { generate: true }),
      (error) => error.code === "DC3_NOT_READY"
    );
    assert.equal(existsSync(join(root, "referencias/privado/dc3-ledger.json")), false);

    const approved = projectConfig({ metadata: ALL_APPROVED });
    const emitted = runProject(root, approved, { generate: true });
    assert.equal(emitted.readiness.canEmit, true);
    assert.equal(emitted.ready, 3);
    assert.deepEqual(emitted.execution, {
      mode: "GENERATE", partial: false, generated: 3, repeated: 0, recovered: 0, conflicts: 0,
      partialDocuments: 0, superseded: 0
    });

    const files = readdirSync(join(root, "referencias/privado/dc3-generados"));
    assert.equal(files.filter((name) => name.endsWith(".pdf")).length, 3);
    // El nombre no revela persona ni numero de nomina.
    assert.ok(files.every((name) => !/00123|00007|SINTÉTICA/.test(name)));

    const replay = runProject(root, approved, { generate: true });
    assert.deepEqual(replay.execution, {
      mode: "GENERATE", partial: false, generated: 0, repeated: 3, recovered: 0, conflicts: 0,
      partialDocuments: 0, superseded: 0
    });

    // Renombrar la version de configuracion es una etiqueta, no un cambio de contenido: no debe
    // convertir en conflicto lo ya emitido ni obligar a reemitir.
    const relabelled = runProject(
      root,
      projectConfig({ configVersion: "sintetica-v2-renombrada", metadata: ALL_APPROVED }),
      { generate: true }
    );
    assert.deepEqual(relabelled.execution, {
      mode: "GENERATE", generated: 0, repeated: 3, recovered: 0, conflicts: 0, partial: false,
      partialDocuments: 0, superseded: 0
    });
    assert.equal(readdirSync(join(root, "referencias/privado/dc3-generados")).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("una aprobacion parcial exige bandera explicita y no invalida lo ya emitido", () => {
  const root = syntheticProjectRoot();
  try {
    const onlyQms = projectConfig({ metadata: { QMS: ALL_APPROVED.QMS } });
    assert.throws(
      () => runProject(root, onlyQms, { generate: true }),
      (error) => error.code === "DC3_NOT_READY"
    );

    // La bandera ya no significa "emite solo lo aprobado": emite tambien lo bloqueado, con los
    // recuadros del metadato faltante en blanco. Se pidio para poder entregar el formato mientras
    // el agente capacitador se captura. Los tres salen; dos salen incompletos y quedan marcados.
    const partial = runProject(root, onlyQms, { generate: true, allowPartial: true });
    assert.equal(partial.execution.partial, true);
    assert.equal(partial.execution.generated, 3);
    assert.equal(partial.execution.partialDocuments, 2);
    assert.equal(partial.readiness.emitOnApproval, 3);
    assert.equal(partial.readiness.blockedBySource, 0);

    // Semanas despues se aprueban los otros dos cursos y se renombra la version.
    const rest = runProject(
      root,
      projectConfig({ configVersion: "sintetica-v3", metadata: ALL_APPROVED }),
      { generate: true }
    );
    // Los dos incompletos ceden ante la version completa en lugar de quedar en conflicto para
    // siempre: eso es lo que impide que entregar el formato en blanco cierre la puerta a la
    // constancia de verdad. El que ya estaba completo no se vuelve a emitir.
    assert.deepEqual(rest.execution, {
      mode: "GENERATE", partial: false, generated: 2, repeated: 1, recovered: 0, conflicts: 0,
      partialDocuments: 0, superseded: 2
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("un cambio real de metadatos queda en conflicto y no sobrescribe el documento emitido", () => {
  const root = syntheticProjectRoot();
  try {
    runProject(root, projectConfig({ metadata: ALL_APPROVED }), { generate: true });
    const directory = join(root, "referencias/privado/dc3-generados");
    const before = new Map(
      readdirSync(directory).map((name) => [name, sha256(readFileSync(join(directory, name)))])
    );

    const corrected = runProject(
      root,
      projectConfig({
        metadata: { ...ALL_APPROVED, QMS: { ...APPROVED_METADATA, durationHours: 4 } }
      }),
      { generate: true }
    );
    assert.deepEqual(corrected.execution, {
      mode: "GENERATE", partial: false, generated: 0, repeated: 2, recovered: 0, conflicts: 1,
      partialDocuments: 0, superseded: 0
    });
    const after = new Map(
      readdirSync(directory).map((name) => [name, sha256(readFileSync(join(directory, name)))])
    );
    assert.deepEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("el reporte de bloqueos detalla el motivo y nunca sale de referencias/privado", () => {
  const root = syntheticProjectRoot();
  try {
    const summary = runProject(root, projectConfig(), { report: true });
    assert.equal(summary.report.rows, 3);
    const reportPath = join(root, "referencias/privado/dc3-bloqueos.tsv");
    const lines = readFileSync(reportPath, "utf8").trim().split("\n");
    assert.equal(lines[0], "numero\tcurso\tfecha\tmotivos\thoja_origen\tfila_origen");
    assert.equal(lines.length, 4);
    // Cada candidato bloqueado trae su motivo y su ubicacion para corregir la fuente.
    assert.deepEqual(lines[1].split("\t"), [
      "00007",
      "INDUCCION_EMPRESA",
      "2026-03-02",
      "MISSING_OR_INVALID_DURATION;MISSING_THEMATIC_AREA;MISSING_TRAINING_AGENT",
      "EMP ACTIVOS",
      "2"
    ]);
    assert.equal(statSync(reportPath).mode & 0o777, 0o600);

    const escape = projectConfig();
    escape.paths.blockedReport = "referencias/privado/../fuga.tsv";
    assert.throws(
      () => runProject(root, escape, { report: true }),
      /referencias\/privado/
    );

    const escapeOutput = projectConfig({ metadata: ALL_APPROVED });
    escapeOutput.paths.outputDirectory = "salida-publica";
    assert.throws(
      () => runProject(root, escapeOutput, { generate: true }),
      /referencias\/privado/
    );
    assert.equal(existsSync(join(root, "salida-publica")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializa el plan de forma idempotente y sin sobrescribir", () => {
  const root = mkdtempSync(join(tmpdir(), "kcm-dc3-ledger-"));
  try {
    const privateRoot = join(root, "referencias", "privado");
    const outputDirectory = join(privateRoot, "dc3-generados");
    const ledgerPath = join(privateRoot, "dc3-ledger.json");
    mkdirSync(privateRoot, { recursive: true });
    const template = templateWorkbook();
    const plan = planDc3Documents({
      snapshot: syntheticSnapshot(),
      roster: syntheticRoster(),
      config: completeConfig()
    });
    const first = materializeDc3Plan({
      projectRoot: root,
      plan,
      templateBuffer: template,
      templateSha256: sha256(template),
      outputDirectory,
      ledgerPath
    });
    assert.deepEqual(first, {
      generated: 3, repeated: 0, recovered: 0, conflicts: 0, partialDocuments: 0, superseded: 0
    });
    const second = materializeDc3Plan({
      projectRoot: root,
      plan,
      templateBuffer: template,
      templateSha256: sha256(template),
      outputDirectory,
      ledgerPath
    });
    assert.deepEqual(second, {
      generated: 0, repeated: 3, recovered: 0, conflicts: 0, partialDocuments: 0, superseded: 0
    });
    assert.equal(readdirSync(outputDirectory).filter((name) => name.endsWith(".pdf")).length, 3);
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    assert.equal(ledger.records.length, 3);
    assert.ok(ledger.records.every(({ status }) => status === "COMPLETED"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
