// Banco de pruebas local del modulo DC-3. Expone en loopback las tres preguntas que hoy solo se
// pueden responder leyendo JSON en la terminal: cuantas constancias salen con ciertos metadatos,
// como queda impreso el formato oficial y si la emision completa se comporta como se documento.
//
// Dos garantias fijan su alcance:
//   1. Sobre las fuentes reales solo corre el plan de solo lectura y publica los mismos agregados
//      que la CLI. Ningun nombre, CURP o numero de trabajador sale por HTTP.
//   2. La emision con escritura solo ocurre en un proyecto sintetico temporal. La emision real
//      sigue siendo un acto deliberado de `npm run dc3:generate`, con su lock y su ledger.
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../ooxml.js";
import { canonicalJson, planDc3Documents, validateDc3Config } from "../planner.js";
import { materializeDc3Plan, publicPlanSummary, runDc3Generator } from "../runner.js";
import { generateDc3Document } from "../pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "../pdf/leyendas-oficiales.js";
import { buildSyntheticDc3Dataset } from "./synthetic-dataset.js";

const PREVIEW_HTML = fileURLToPath(new URL("./preview.html", import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_TEXT_LENGTH = 200;
const SANDBOX_WORKERS = 12;

// Identidad de ensayo para la vista previa del formato. Es la misma persona inventada que usan las
// pruebas, para que una diferencia visual provenga de la plantilla o de los metadatos y no del dato.
const SAMPLE_WORKER = Object.freeze({
  workerName: "PERSONA SINTÉTICA DE ENSAYO",
  curp: "SAAA950101HDFBBB08",
  position: "OPERADOR SINTÉTICO",
  completionDate: "2026-02-04"
});

export class Dc3PreviewError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "Dc3PreviewError";
    this.code = code;
    this.status = status;
  }
}

function responseHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    // `frame-src blob:` habilita el visor de PDF: la constancia se arma en memoria y se muestra desde
    // un blob del propio documento, sin que la pagina pueda cargar nada de la red.
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow"
  };
}

function writeResponse(response, status, body, contentType) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, { ...responseHeaders(contentType), "Content-Length": bytes.length });
  response.end(bytes);
}

function writeJson(response, status, payload) {
  writeResponse(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readJsonBody(request) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let byteSize = 0;
    let exceeded = false;
    request.on("data", (chunk) => {
      byteSize += chunk.length;
      if (byteSize > MAX_BODY_BYTES) exceeded = true;
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceeded) {
        reject(new Dc3PreviewError("REQUEST_TOO_LARGE", "La solicitud excede el límite local", 413));
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("invalid");
        resolvePromise(value);
      } catch {
        reject(new Dc3PreviewError("INVALID_JSON", "La solicitud JSON no es válida"));
      }
    });
    request.on("error", () => reject(new Dc3PreviewError("REQUEST_ERROR", "No fue posible leer la solicitud")));
  });
}

// El banco escucha en loopback, pero un navegador puede llegar por un nombre que resuelva ahi desde
// otra maquina. Fijar Host y Origen mantiene la superficie en la sesion que abrio el proceso.
function assertLocalApiRequest(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new Dc3PreviewError("UNSUPPORTED_MEDIA_TYPE", "La API local requiere application/json", 415);
  }
  const hostname = String(request.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Dc3PreviewError("FORBIDDEN_HOST", "El encabezado Host no está autorizado", 403);
  }
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(String(origin));
    if (!ALLOWED_HOSTS.has(originUrl.hostname) || originUrl.host !== String(request.headers.host || "")) {
      throw new Error("cross-origin");
    }
  } catch {
    throw new Dc3PreviewError("FORBIDDEN_ORIGIN", "El origen no está autorizado", 403);
  }
}

function safeError(error) {
  if (error instanceof Dc3PreviewError) {
    return { status: error.status, error: { code: error.code, message: error.message } };
  }
  // Un fallo del planificador o del generador si es util verlo: no contiene datos personales, solo
  // rutas de configuracion y nombres de campo.
  return {
    status: 500,
    error: { code: "DC3_PREVIEW_ERROR", message: String(error?.message || "Error local no identificado") }
  };
}

function sanitizedText(value, field) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Dc3PreviewError("INVALID_INPUT", `${field} excede ${MAX_TEXT_LENGTH} caracteres`);
  }
  return text;
}

function sanitizedDuration(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 999) {
    throw new Dc3PreviewError("INVALID_INPUT", "La duración debe ser un número entre 1 y 999 horas");
  }
  return duration;
}

function sanitizedOverrides(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Dc3PreviewError("INVALID_INPUT", "Los metadatos deben venir en un objeto por curso");
  }
  const overrides = {};
  for (const [courseId, values] of Object.entries(raw)) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Dc3PreviewError("INVALID_INPUT", `Los metadatos de ${courseId} no son un objeto`);
    }
    overrides[courseId] = {
      durationHours: sanitizedDuration(values.durationHours),
      thematicArea: sanitizedText(values.thematicArea, "El área temática"),
      trainingAgent: sanitizedText(values.trainingAgent, "El agente capacitador")
    };
  }
  return overrides;
}

function sanitizedSignatures(raw) {
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    instructor: sanitizedText(values.instructor, "La firma del instructor"),
    employerRepresentative: sanitizedText(values.employerRepresentative, "La firma patronal"),
    workerRepresentative: sanitizedText(values.workerRepresentative, "La firma de los trabajadores")
  };
}

// Los metadatos capturados en el navegador no tocan la configuracion privada: se aplican sobre una
// copia en memoria. Cerrar el banco los descarta, y la aprobacion real sigue siendo capturarlos en
// el JSON privado.
function applyOverrides(config, overrides, signatures) {
  const effective = JSON.parse(JSON.stringify(config));
  effective.signatures = { ...(effective.signatures || {}), ...signatures };
  for (const course of effective.courses) {
    const override = overrides[course.courseId];
    if (!override) continue;
    if (override.durationHours !== null) course.durationHours = override.durationHours;
    if (override.thematicArea) course.thematicArea = override.thematicArea;
    if (override.trainingAgent) course.trainingAgent = override.trainingAgent;
  }
  return validateDc3Config(effective);
}

function withTemporaryConfig(config, callback) {
  const directory = mkdtempSync(join(tmpdir(), "kcm-dc3-banco-"));
  const configPath = join(directory, "dc3-config.json");
  try {
    writeFileSync(configPath, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
    return callback(configPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function missingMetadataFor(course) {
  const missing = [];
  const duration = Number(course.durationHours);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 999) missing.push("duración en horas");
  if (!String(course.thematicArea || "").trim()) missing.push("área temática");
  if (!String(course.trainingAgent || "").trim()) missing.push("agente capacitador");
  return missing;
}

export function createDc3PreviewApplication({
  projectRoot,
  configPath,
  previewHtmlPath = PREVIEW_HTML
} = {}) {
  const root = resolve(projectRoot || process.cwd());
  const resolvedConfigPath = resolve(root, configPath || "config/dc3-generator.example.json");
  const baseConfig = validateDc3Config(JSON.parse(readFileSync(resolvedConfigPath, "utf8")));

  // Las leyendas oficiales ya no salen de ningun archivo: viven en el codigo. Antes esto elegia
  // entre la hoja oficial —material privado que puede no estar— y una sintetica, y el tablero tenia
  // que declarar cual se uso. Ahora la vista previa muestra siempre el mismo formato que se emite.
  function legendsSource() {
    return {
      origin: "HORNEADA",
      name: "packages/dc3/pdf/leyendas-oficiales.js",
      sha256: sha256(canonicalJson(LEYENDAS_DC3))
    };
  }

  function sourcesAvailable() {
    return ["matrix", "roster"].every((field) => {
      try {
        return statSync(resolve(root, String(baseConfig.paths?.[field] || ""))).isFile();
      } catch {
        return false;
      }
    });
  }

  function state() {
    const legends = legendsSource();
    return {
      configPath: relative(root, resolvedConfigPath),
      configVersion: String(baseConfig.configVersion || ""),
      cutoffDate: baseConfig.cutoffDate,
      realSourcesAvailable: sourcesAvailable(),
      legends,
      signatures: {
        instructor: String(baseConfig.signatures?.instructor || ""),
        employerRepresentative: String(baseConfig.signatures?.employerRepresentative || ""),
        workerRepresentative: String(baseConfig.signatures?.workerRepresentative || "")
      },
      courses: baseConfig.courses.map((course) => ({
        courseId: course.courseId,
        dc3Name: course.dc3Name,
        sourceKind: course.source.kind,
        durationHours: course.durationHours ?? null,
        thematicArea: String(course.thematicArea || ""),
        trainingAgent: String(course.trainingAgent || ""),
        missingMetadata: missingMetadataFor(course)
      }))
    };
  }

  // Plan de solo lectura sobre las fuentes reales. Reusa el punto de entrada de la CLI en lugar de
  // replicar su resolucion de rutas y su frontera privada, y devuelve el mismo resumen agregado.
  function plan({ overrides, signatures }) {
    if (!sourcesAvailable()) {
      throw new Dc3PreviewError(
        "SOURCES_UNAVAILABLE",
        "Las fuentes DC-3 privadas no están presentes en este equipo; use el ensayo sintético",
        409
      );
    }
    const effective = applyOverrides(baseConfig, overrides, signatures);
    const startedAt = Date.now();
    const summary = withTemporaryConfig(effective, (temporaryConfigPath) => runDc3Generator({
      projectRoot: root,
      configPath: temporaryConfigPath,
      generate: false,
      report: false
    }));
    return { ...summary, mode: "PLAN_REAL", elapsedMs: Date.now() - startedAt };
  }

  // Ensayo completo con escritura, siempre sobre un proyecto sintetico desechable. Corre dos veces
  // para que la idempotencia sea visible: la segunda vuelta debe reportar repetidas y cero nuevas.
  function rehearsal({ overrides, signatures, workerCount = SANDBOX_WORKERS }) {
    const effective = applyOverrides(baseConfig, overrides, signatures);
    const { snapshot, roster } = buildSyntheticDc3Dataset({ config: effective, workerCount });
    const dc3Plan = planDc3Documents({ snapshot, roster, config: effective });
    const legends = legendsSource();
    const sandbox = mkdtempSync(join(tmpdir(), "kcm-dc3-ensayo-"));
    try {
      const outputDirectory = join(sandbox, "referencias", "privado", "dc3-generados");
      const ledgerPath = join(sandbox, "referencias", "privado", "dc3-ledger.json");
      mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
      const parameters = {
        projectRoot: sandbox,
        plan: dc3Plan,
        templateSha256: legends.sha256,
        outputDirectory,
        ledgerPath,
        configVersion: effective.configVersion
      };
      const startedAt = Date.now();
      const execution = materializeDc3Plan(parameters);
      const replay = materializeDc3Plan(parameters);
      const files = readdirSync(outputDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const content = readFileSync(join(outputDirectory, entry.name));
          return { name: entry.name, byteSize: content.length, sha256: sha256(content) };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      const sample = files.length
        ? {
          name: files[0].name,
          mimeType: "application/pdf",
          base64: readFileSync(join(outputDirectory, files[0].name)).toString("base64")
        }
        : null;
      const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
      return {
        mode: "ENSAYO_SINTETICO",
        elapsedMs: Date.now() - startedAt,
        legends,
        workers: workerCount,
        ...publicPlanSummary(dc3Plan, {
          matrixSha256: snapshot.source.sha256,
          rosterSha256: roster.source.sha256,
          templateSha256: legends.sha256,
          matrixEmployees: roster.employees.length,
          activeRosterEmployees: roster.employees.length,
          validActiveRosterEmployees: roster.diagnostics.readyEmployeeCount,
          rosterIssues: roster.diagnostics.issues
        }),
        execution,
        replay,
        ledgerRecords: ledger.records.length,
        files: files.slice(0, 40),
        sample
      };
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }

  // Vista previa de una constancia: identidad de ensayo, metadatos capturados en el navegador y la
  // plantilla disponible. No consulta las fuentes reales ni escribe nada.
  function sampleDocument({ courseId, overrides, signatures }) {
    const effective = applyOverrides(baseConfig, overrides, signatures);
    const course = effective.courses.find((candidate) => candidate.courseId === courseId)
      || effective.courses[0];
    const missing = missingMetadataFor(course);
    if (missing.length) {
      throw new Dc3PreviewError(
        "METADATA_PENDING",
        `Capture ${missing.join(", ")} de ${course.courseId} para ver la constancia llena`,
        409
      );
    }
    const data = {
      workerName: SAMPLE_WORKER.workerName,
      curp: SAMPLE_WORKER.curp,
      position: SAMPLE_WORKER.position,
      employerName: String(effective.employer?.legalName || "").trim(),
      occupation: String(course.occupation || "").trim(),
      courseName: String(course.dc3Name).trim(),
      durationHours: Number(course.durationHours),
      startDate: SAMPLE_WORKER.completionDate,
      endDate: SAMPLE_WORKER.completionDate,
      thematicArea: String(course.thematicArea).trim(),
      trainingAgent: String(course.trainingAgent).trim(),
      signatures: effective.signatures
    };
    const document = generateDc3Document(data);
    return {
      courseId: course.courseId,
      legends: legendsSource(),
      fields: data,
      document: {
        name: `DC3_ENSAYO_${course.courseId}.pdf`,
        mimeType: "application/pdf",
        byteSize: document.length,
        sha256: sha256(document),
        base64: document.toString("base64")
      }
    };
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        writeJson(response, 200, { ok: true, mode: "DC3_LOCAL_BENCH" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        writeResponse(response, 200, await readFile(previewHtmlPath, "utf8"), "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/estado") {
        writeJson(response, 200, { ok: true, data: state() });
        return;
      }
      if (request.method === "POST" && ["/api/plan", "/api/ensayo", "/api/muestra"].includes(url.pathname)) {
        assertLocalApiRequest(request);
        const body = await readJsonBody(request);
        const parameters = {
          overrides: sanitizedOverrides(body.overrides),
          signatures: sanitizedSignatures(body.signatures)
        };
        if (url.pathname === "/api/plan") {
          writeJson(response, 200, { ok: true, data: plan(parameters) });
          return;
        }
        if (url.pathname === "/api/ensayo") {
          writeJson(response, 200, { ok: true, data: rehearsal(parameters) });
          return;
        }
        writeJson(response, 200, {
          ok: true,
          data: sampleDocument({ ...parameters, courseId: sanitizedText(body.courseId, "El curso") })
        });
        return;
      }
      writeResponse(response, 404, "No encontrado", "text/plain; charset=utf-8");
    } catch (error) {
      const failure = safeError(error);
      writeJson(response, failure.status, { ok: false, error: failure.error });
    }
  }

  return Object.freeze({
    configPath: resolvedConfigPath,
    handleRequest,
    plan,
    rehearsal,
    sampleDocument,
    state
  });
}

export async function startDc3PreviewServer({ host = "127.0.0.1", port = 4175, ...options } = {}) {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new TypeError("El banco de pruebas DC-3 sólo puede escuchar en loopback");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("port debe ser un entero entre 0 y 65535");
  }
  const application = createDc3PreviewApplication(options);
  const server = createServer(application.handleRequest);
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  const effectivePort = typeof address === "object" && address ? address.port : port;
  return Object.freeze({
    ...application,
    server,
    url: `http://${host}:${effectivePort}/`,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    })
  });
}
