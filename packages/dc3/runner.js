import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  extractHcSnapshotFromBuffer,
  snapshotIsApplicable
} from "../xlsb/extract-hc-xlsb.js";
import { sha256 } from "./ooxml.js";
import { canonicalJson, planDc3Documents, validateDc3Config } from "./planner.js";
import { extractActiveRosterFromBuffer } from "./roster-extractor.js";
import { renderDc3Pdf } from "./pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "./pdf/leyendas-oficiales.js";

const LEDGER_SCHEMA = "DC3_LEDGER_V1";

function readStableFile(path) {
  const before = statSync(path);
  if (!before.isFile()) throw new Error(`La entrada no es un archivo: ${basename(path)}`);
  const buffer = readFileSync(path);
  const after = statSync(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`La entrada cambio durante la lectura: ${basename(path)}`);
  }
  return buffer;
}

function resolveConfigPath(projectRoot, value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Falta la ruta ${field}`);
  return isAbsolute(text) ? resolve(text) : resolve(projectRoot, text);
}

function realPotentialPath(targetPath) {
  let cursor = resolve(targetPath);
  const remainder = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    remainder.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...remainder);
}

function isWithin(root, target) {
  const difference = relative(root, target);
  return difference === "" ||
    (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

function assertPrivatePath(projectRoot, targetPath, expectedExtension = null) {
  const privateRoot = realPotentialPath(join(projectRoot, "referencias", "privado"));
  const target = realPotentialPath(targetPath);
  if (!isWithin(privateRoot, target)) {
    throw new Error("La salida DC-3 debe permanecer dentro de referencias/privado/");
  }
  if (expectedExtension && !target.toLowerCase().endsWith(expectedExtension)) {
    throw new Error(`La salida debe terminar en ${expectedExtension}`);
  }
  return target;
}

function loadLedger(path) {
  if (!existsSync(path)) return { schemaVersion: LEDGER_SCHEMA, records: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed?.schemaVersion !== LEDGER_SCHEMA || !Array.isArray(parsed.records)) {
    throw new Error("El ledger DC-3 no usa DC3_LEDGER_V1");
  }
  const keys = new Set();
  for (const record of parsed.records) {
    if (!/^[a-f0-9]{64}$/.test(String(record.logicalKey || "")) || keys.has(record.logicalKey)) {
      throw new Error("El ledger DC-3 contiene claves invalidas o duplicadas");
    }
    keys.add(record.logicalKey);
  }
  return parsed;
}

function writeLedger(path, ledger) {
  const serialized = `${JSON.stringify({
    schemaVersion: LEDGER_SCHEMA,
    records: ledger.records.slice().sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
  }, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function writeDocumentExclusive(path, buffer) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, buffer);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
}

function outputName(document) {
  const course = document.courseId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `DC3_${document.employeeKeyHash.slice(0, 16)}_${course}_${document.completionDate}.pdf`;
}

function effectiveFingerprint(document, templateSha256) {
  return sha256(canonicalJson({
    schemaVersion: "DC3_EFFECTIVE_SOURCE_V1",
    logicalKey: document.logicalKey,
    planFingerprint: document.sourceFingerprint,
    templateSha256
  }));
}

// Exportada para que el banco de pruebas local publique exactamente los mismos campos agregados que
// la CLI: ningun consumidor debe inventar su propio resumen con datos que no pasaron por este filtro.
export function publicPlanSummary(plan, sources) {
  return {
    schemaVersion: plan.schemaVersion,
    cutoffDate: plan.cutoffDate,
    selectionPolicy: plan.selectionPolicy,
    sources,
    detected: plan.summary.detected,
    ready: plan.summary.ready,
    blocked: plan.summary.blocked,
    issues: plan.summary.issues,
    courses: plan.summary.courses,
    coverage: plan.summary.coverage,
    readiness: plan.summary.readiness
  };
}

// Proyección segura para la plataforma: conserva el estado por candidato sin
// publicar número de trabajador, nombre, CURP, hoja ni fila de origen.
export function publicCandidateStatuses(plan) {
  return plan.documents.map((document) => ({
    candidateKey: document.employeeKeyHash,
    courseId: document.courseId,
    completionDate: document.completionDate,
    status: document.ready ? "LISTO" : "BLOQUEADO",
    blockingReasons: document.issues.slice()
  }));
}

export class Dc3NotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = "Dc3NotReadyError";
    this.code = "DC3_NOT_READY";
  }
}

function tsvField(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

// El reporte vive bajo referencias/privado/ porque su proposito es corregir la fuente: sin numero de
// trabajador ni hoja y fila no hay forma de arreglar una CURP invalida. Nunca sale de esa carpeta.
function writeBlockedReport(path, plan) {
  const rows = plan.documents
    .filter(({ ready }) => !ready)
    .sort((left, right) => (
      left.employeeId.localeCompare(right.employeeId) || left.courseId.localeCompare(right.courseId)
    ))
    .map((document) => [
      document.employeeId,
      document.courseId,
      document.completionDate,
      document.issues.join(";"),
      document.sourceSheet,
      document.sourceRow || ""
    ].map(tsvField).join("\t"));
  const header = ["numero", "curso", "fecha", "motivos", "hoja_origen", "fila_origen"].join("\t");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, `${[header, ...rows].join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return rows.length;
}

function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = statSync(path);
    if (Date.now() - existing.mtimeMs <= 24 * 60 * 60 * 1000) {
      throw new Error("Existe otra ejecucion DC-3 activa o pendiente de revision");
    }
    const stalePath = `${path}.stale-${Math.trunc(existing.mtimeMs)}`;
    if (existsSync(stalePath)) {
      throw new Error("Existe un lock DC-3 obsoleto que requiere revision manual");
    }
    renameSync(path, stalePath);
    descriptor = openSync(path, "wx", 0o600);
  }
  writeFileSync(descriptor, `${JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  closeSync(descriptor);
  return () => {
    if (!existsSync(path)) return;
    try {
      const current = JSON.parse(readFileSync(path, "utf8"));
      if (current.token === token) unlinkSync(path);
    } catch {
      // Un lock ilegible se conserva como evidencia y se revisa manualmente.
    }
  };
}

export function materializeDc3Plan({
  projectRoot,
  plan,
  templateSha256,
  outputDirectory,
  ledgerPath,
  configVersion = "",
  allowBlank = false
}) {
  const ledger = loadLedger(ledgerPath);
  const records = new Map(ledger.records.map((record) => [record.logicalKey, record]));
  // `partialDocuments`, no `partial`: `execution.partial` ya existe como booleano —"el lote corrio
  // con metadatos sin aprobar"— y el spread de este objeto lo habria sustituido por un numero,
  // cambiando en silencio el significado de un campo publicado.
  const result = {
    generated: 0, repeated: 0, recovered: 0, conflicts: 0, partialDocuments: 0, superseded: 0
  };
  // Las leyendas ya no se leen de ningun archivo: viven en el codigo y son las mismas para toda la
  // corrida. Antes se extraian del XLSX una vez por corrida para no reparsearlo 1,743 veces.
  const legends = LEYENDAS_DC3;

  // Con `allowBlank` entra tambien el documento bloqueado por metadatos, que es el caso que se pidio
  // poder entregar. Lo que no entra nunca es el documento sin identidad en el padron: sin nombre ni
  // CURP no hay formato que imprimir, solo una hoja anonima.
  const emitable = allowBlank
    ? plan.documents.filter(({ data }) => data !== null)
    : plan.documents.filter(({ ready }) => ready);

  for (const document of emitable) {
    const buffer = renderDc3Pdf({ legends, data: document.data, allowBlank });
    const partial = !document.ready;
    const contentSha256 = sha256(buffer);
    const sourceFingerprint = effectiveFingerprint(document, templateSha256);
    const name = outputName(document);
    const outputPath = assertPrivatePath(projectRoot, join(outputDirectory, name), ".pdf");
    const existing = records.get(document.logicalKey);
    let record = existing;
    if (record) {
      const identico =
        record.sourceFingerprint === sourceFingerprint &&
        record.contentSha256 === contentSha256 &&
        record.outputFile === name &&
        record.courseId === document.courseId &&
        record.employeeKeyHash === document.employeeKeyHash;
      // Un registro parcial no es una constancia definitiva: es el formato entregado con huecos.
      // Cuando el metadato se captura, la huella cambia, y ese registro debe ceder en lugar de
      // bloquear la emision correcta para siempre. Entre dos registros completos la regla estricta
      // sigue intacta, porque ahi la divergencia si significa que algo cambio bajo los pies.
      const reemplazable =
        record.partial === true &&
        record.courseId === document.courseId &&
        record.employeeKeyHash === document.employeeKeyHash;
      if (!identico && !reemplazable) {
        result.conflicts += 1;
        continue;
      }
      if (!identico) {
        record.sourceFingerprint = sourceFingerprint;
        record.contentSha256 = contentSha256;
        record.outputFile = name;
        record.partial = partial;
        record.status = "PENDING";
        record.supersededAt = new Date().toISOString();
        writeLedger(ledgerPath, ledger);
        // El archivo con huecos se retira aqui: `writeDocumentExclusive` no sobrescribe, y dejarlo
        // haria que la comprobacion de huella de mas abajo lo tomara por un conflicto.
        if (existsSync(outputPath)) unlinkSync(outputPath);
        result.superseded += 1;
      }
    } else {
      record = {
        logicalKey: document.logicalKey,
        employeeKeyHash: document.employeeKeyHash,
        courseId: document.courseId,
        completionDate: document.completionDate,
        sourceFingerprint,
        contentSha256,
        outputFile: name,
        // Marca durable de que la constancia salio con campos vacios. Es lo que permite que una
        // emision posterior con los datos completos la reemplace en vez de chocar con ella.
        partial,
        status: "PENDING",
        // Etiqueta de auditoria: registra bajo que version de configuracion se emitio. No participa
        // en la comparacion de conflictos, para que renombrarla no invalide lo ya emitido.
        configVersion: String(configVersion || ""),
        createdAt: new Date().toISOString(),
        completedAt: ""
      };
      ledger.records.push(record);
      records.set(record.logicalKey, record);
      writeLedger(ledgerPath, ledger);
    }

    if (existsSync(outputPath)) {
      const storedHash = sha256(readFileSync(outputPath));
      if (storedHash !== contentSha256) {
        result.conflicts += 1;
        continue;
      }
      if (record.status === "COMPLETED") {
        result.repeated += 1;
        continue;
      }
      record.status = "COMPLETED";
      record.completedAt = new Date().toISOString();
      writeLedger(ledgerPath, ledger);
      result.recovered += 1;
      continue;
    }

    mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
    writeDocumentExclusive(outputPath, buffer);
    if (sha256(readFileSync(outputPath)) !== contentSha256) {
      throw new Error("El DC-3 escrito no coincide con el contenido verificado");
    }
    record.status = "COMPLETED";
    record.completedAt = new Date().toISOString();
    writeLedger(ledgerPath, ledger);
    result.generated += 1;
    if (partial) result.partialDocuments += 1;
  }
  return result;
}

export function runDc3Generator(options) {
  const projectRoot = resolve(options.projectRoot);
  const configPath = resolveConfigPath(projectRoot, options.configPath, "configPath");
  const config = validateDc3Config(JSON.parse(readFileSync(configPath, "utf8")));
  const matrixPath = resolveConfigPath(projectRoot, config.paths?.matrix, "paths.matrix");
  const rosterPath = resolveConfigPath(projectRoot, config.paths?.roster, "paths.roster");
  const outputDirectory = assertPrivatePath(
    projectRoot,
    resolveConfigPath(projectRoot, config.paths?.outputDirectory, "paths.outputDirectory")
  );
  const ledgerPath = assertPrivatePath(
    projectRoot,
    resolveConfigPath(projectRoot, config.paths?.ledger, "paths.ledger"),
    ".json"
  );
  const lockPath = assertPrivatePath(projectRoot, `${ledgerPath}.lock`);

  const matrixBuffer = readStableFile(matrixPath);
  const rosterBuffer = readStableFile(rosterPath);
  const snapshot = extractHcSnapshotFromBuffer(matrixBuffer, { fileName: basename(matrixPath) });
  // El extractor marca bloqueante cualquier fila que tuvo que descartar, porque para una
  // *importacion* de matriz perder una fila en silencio es inaceptable: ahi el XLSB manda.
  //
  // Emitir constancias es el caso contrario. Una fila descartada no corrompe las demas; solo
  // significa que ese trabajador no recibe la suya, y eso se reporta. Bloquear 1,684 constancias
  // por dos celdas con error de formula es el porton que se pidio quitar. La tolerancia vive aqui
  // y solo aqui: la ruta de importacion de matriz y el puente VBA siguen fallando cerrados.
  const snapshotApplicable = snapshotIsApplicable(snapshot);
  if (!snapshotApplicable && !options.allowPartial) {
    throw new Error("El snapshot HC contiene diagnosticos bloqueantes");
  }
  const roster = extractActiveRosterFromBuffer(rosterBuffer);
  const plan = planDc3Documents({ snapshot, roster, config });
  // La huella que identifica al formato ya no es la del archivo sino la de las leyendas horneadas:
  // es lo que de verdad determina como sale la constancia. Un cambio en el borrador que no cambie
  // ninguna leyenda deja de invalidar constancias ya emitidas, que es lo correcto.
  const templateSha256 = sha256(canonicalJson(LEYENDAS_DC3));
  const sources = {
    matrixSha256: snapshot.source.sha256,
    rosterSha256: roster.source.sha256,
    templateSha256,
    matrixEmployees: snapshot.employees.length,
    activeRosterEmployees: roster.employees.length,
    validActiveRosterEmployees: roster.diagnostics.readyEmployeeCount,
    rosterIssues: roster.diagnostics.issues,
    // Se publican siempre: si la corrida siguio adelante con filas descartadas, quien lea el
    // resultado tiene que poder verlo sin abrir el XLSB.
    matrixApplicable: snapshotApplicable,
    matrixIssues: snapshot.diagnostics?.issues ?? []
  };
  const summary = publicPlanSummary(plan, sources);
  const candidateStatuses = options.includeCandidateStatuses
    ? publicCandidateStatuses(plan)
    : undefined;

  let report = null;
  if (options.report) {
    const reportPath = assertPrivatePath(
      projectRoot,
      resolveConfigPath(
        projectRoot,
        config.paths?.blockedReport || "referencias/privado/dc3-bloqueos.tsv",
        "paths.blockedReport"
      ),
      ".tsv"
    );
    report = { rows: writeBlockedReport(reportPath, plan), path: relative(projectRoot, reportPath) };
  }

  if (!options.generate) return {
    ...summary,
    ...(candidateStatuses ? { candidateStatuses } : {}),
    execution: { mode: "PLAN_ONLY" },
    report
  };

  // Un lote a medias no se puede deshacer: las constancias ya emitidas quedan fijadas por el ledger.
  // Por eso emitir con metadatos pendientes exige decirlo explicitamente.
  const { metadataApproved, coursesPendingMetadata } = plan.summary.readiness;
  if (!metadataApproved && !options.allowPartial) {
    throw new Dc3NotReadyError(
      "Faltan metadatos legales aprobados en: " +
      `${coursesPendingMetadata.map(({ courseId }) => courseId).join(", ")}. ` +
      "Capturelos en la configuracion privada o repita con --allow-partial para emitir solo los cursos aprobados."
    );
  }

  const releaseLock = acquireLock(lockPath);
  try {
    return {
      ...summary,
      ...(candidateStatuses ? { candidateStatuses } : {}),
      report,
      execution: {
        mode: "GENERATE",
        partial: !metadataApproved,
        ...materializeDc3Plan({
          projectRoot,
          plan,
          templateSha256,
          outputDirectory,
          ledgerPath,
          configVersion: config.configVersion,
          // Antes `--allow-partial` solo saltaba el porton de aprobacion y seguia emitiendo
          // unicamente los cursos completos. Ahora emite tambien el candidato bloqueado, con sus
          // recuadros vacios, que es lo que se pidio para poder entregar el formato mientras el
          // area tematica y el agente capacitador siguen sin capturarse.
          allowBlank: options.allowPartial === true
        })
      }
    };
  } finally {
    releaseLock();
  }
}
