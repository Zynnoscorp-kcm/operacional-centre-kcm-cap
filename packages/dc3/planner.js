import { createHash } from "node:crypto";

import { normalizedLabel } from "./xlsx-reader.js";
import { sumarDiasIso } from "./fechas.js";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertIsoDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${field} debe usar YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} no es una fecha civil valida`);
  }
  return value;
}

function validateCourse(course) {
  if (!course || typeof course !== "object") throw new Error("Cada curso DC-3 debe ser un objeto");
  if (!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(String(course.courseId || ""))) {
    throw new Error("courseId DC-3 invalido");
  }
  if (!course.source || !["HC_COURSE", "ACTIVE_HIRE_DATE"].includes(course.source.kind)) {
    throw new Error(`Fuente invalida para ${course.courseId}`);
  }
  if (course.source.kind === "HC_COURSE") {
    if (!Array.isArray(course.source.normalizedNames) || course.source.normalizedNames.length === 0) {
      throw new Error(`Faltan nombres fuente para ${course.courseId}`);
    }
  }
  if (!String(course.dc3Name || "").trim()) throw new Error(`Falta dc3Name para ${course.courseId}`);
  // Cursos que se imparten en varias jornadas: la constancia declara un periodo, no un dia. Ausente
  // o cero significa que empieza y termina el mismo dia, que es lo normal.
  if (course.endDateOffsetDays !== undefined) {
    const dias = Number(course.endDateOffsetDays);
    if (!Number.isInteger(dias) || dias < 0 || dias > 30) {
      throw new Error(`endDateOffsetDays invalido para ${course.courseId}`);
    }
  }
}

export function validateDc3Config(config) {
  if (!config || typeof config !== "object" || config.schemaVersion !== "DC3_CONFIG_V1") {
    throw new Error("La configuracion debe usar DC3_CONFIG_V1");
  }
  assertIsoDate(config.cutoffDate, "cutoffDate");
  if (!Array.isArray(config.courses) || config.courses.length === 0) {
    throw new Error("La configuracion no contiene cursos DC-3");
  }
  const ids = new Set();
  for (const course of config.courses) {
    validateCourse(course);
    if (ids.has(course.courseId)) throw new Error("La configuracion repite courseId");
    ids.add(course.courseId);
  }
  return config;
}

const METADATA_ISSUES = Object.freeze([
  "MISSING_OR_INVALID_DURATION",
  "MISSING_THEMATIC_AREA",
  "MISSING_TRAINING_AGENT"
]);

function metadataIssues(course) {
  const issues = [];
  const duration = Number(course.durationHours);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 999) {
    issues.push("MISSING_OR_INVALID_DURATION");
  }
  if (!String(course.thematicArea || "").trim()) issues.push("MISSING_THEMATIC_AREA");
  if (!String(course.trainingAgent || "").trim()) issues.push("MISSING_TRAINING_AGENT");
  return issues;
}

function earliestCompletionByEmployee(snapshot, course, cutoffDate) {
  const wantedNames = new Set(course.source.normalizedNames.map(normalizedLabel));
  const sourceKeys = new Set(
    snapshot.courses
      .filter((candidate) => wantedNames.has(normalizedLabel(candidate.normalizedName || candidate.displayName)))
      .map(({ sourceKey }) => sourceKey)
  );
  const completions = new Map();
  for (const completion of snapshot.completions) {
    if (!sourceKeys.has(completion.sourceKey) || completion.completionDate < cutoffDate) continue;
    const previous = completions.get(completion.employeeId);
    if (!previous || completion.completionDate < previous) {
      completions.set(completion.employeeId, completion.completionDate);
    }
  }
  return { completions, matchedSourceKeyCount: sourceKeys.size };
}

function candidatesForCourse(snapshot, roster, course, cutoffDate) {
  if (course.source.kind === "ACTIVE_HIRE_DATE") {
    return {
      matchedSourceKeyCount: 0,
      completions: new Map(
        roster.employees
          .filter(({ hireDate }) => hireDate && hireDate >= cutoffDate)
          .map(({ employeeId, hireDate }) => [employeeId, hireDate])
      )
    };
  }
  return earliestCompletionByEmployee(snapshot, course, cutoffDate);
}

function recordIssues(rosterRecord, courseIssues) {
  const issues = courseIssues.slice();
  if (!rosterRecord) issues.push("ACTIVE_IDENTITY_NOT_FOUND");
  else issues.push(...rosterRecord.issues);
  return [...new Set(issues)].sort();
}

function signatureOverrides(config) {
  const signatures = config.signatures || {};
  return {
    instructor: String(signatures.instructor || "").trim(),
    employerRepresentative: String(signatures.employerRepresentative || "").trim(),
    workerRepresentative: String(signatures.workerRepresentative || "").trim()
  };
}

function buildDocument(config, course, employeeId, completionDate, rosterRecord, issues) {
  const logicalKey = hash(`DC3_LOGICAL_V1\n${employeeId}\n${course.courseId}`);
  const employeeKeyHash = hash(`DC3_EMPLOYEE_V1\n${employeeId}`);
  const data = rosterRecord ? {
    workerName: rosterRecord.displayName,
    curp: rosterRecord.curp,
    position: rosterRecord.position,
    // Vacio significa "la razon social impresa en la plantilla oficial". Existe porque esa plantilla
    // la trae con una errata y corregirla no debe obligar a editar el archivo firmado; al viajar en
    // los datos, un cambio de razon social si entra en la huella y no se emite en silencio.
    employerName: String(config.employer?.legalName || "").trim(),
    occupation: String(course.occupation || "").trim(),
    courseName: String(course.dc3Name).trim(),
    durationHours: Number(course.durationHours),
    startDate: completionDate,
    // La fecha de termino no siempre es la de inicio: la induccion son doce horas repartidas en
    // tres jornadas, asi que cierra dos dias despues de la fecha de alta.
    endDate: sumarDiasIso(completionDate, Number(course.endDateOffsetDays) || 0),
    thematicArea: String(course.thematicArea || "").trim(),
    trainingAgent: String(course.trainingAgent || "").trim(),
    signatures: signatureOverrides(config)
  } : null;
  return {
    logicalKey,
    employeeKeyHash,
    employeeId,
    courseId: course.courseId,
    completionDate,
    issues,
    ready: issues.length === 0,
    // Ubicacion en la fuente para que un bloqueo de identidad se corrija en la hoja original.
    // Queda fuera de `data` y por lo tanto fuera de la huella: mover una fila no reemite nada.
    sourceSheet: rosterRecord?.sourceSheet || "",
    sourceRow: rosterRecord?.sourceRow || 0,
    data
  };
}

function countIssues(documents) {
  const counts = {};
  for (const document of documents) {
    for (const issue of document.issues) counts[issue] = (counts[issue] || 0) + 1;
  }
  return counts;
}

function coverageSummary(documents, configuredCourseCount) {
  const counts = new Map();
  for (const document of documents) {
    counts.set(document.employeeKeyHash, (counts.get(document.employeeKeyHash) || 0) + 1);
  }
  const values = [...counts.values()];
  return {
    workersDetected: counts.size,
    withOneDocument: values.filter((count) => count === 1).length,
    withTwoDocuments: values.filter((count) => count === 2).length,
    withThreeDocuments: values.filter((count) => count === 3).length,
    withAllConfiguredCourses: values.filter((count) => count === configuredCourseCount).length
  };
}

function isMetadataIssue(issue) {
  return METADATA_ISSUES.includes(issue);
}

// Responde la unica pregunta operativa del dia de la aprobacion: cuantas constancias se emiten en
// cuanto Capacitacion capture los tres metadatos, y que queda pendiente por origen y no por captura.
function readinessSummary(config, documents) {
  const coursesPendingMetadata = config.courses
    .map((course) => ({ courseId: course.courseId, missingMetadata: metadataIssues(course) }))
    .filter(({ missingMetadata }) => missingMetadata.length > 0);
  const sourceBlocked = documents.filter(
    ({ issues }) => issues.some((issue) => !isMetadataIssue(issue))
  );
  const emitOnApproval = documents.filter(
    ({ issues }) => issues.every(isMetadataIssue)
  );
  return {
    metadataApproved: coursesPendingMetadata.length === 0,
    canEmit: coursesPendingMetadata.length === 0 && emitOnApproval.length > 0,
    coursesPendingMetadata,
    emitOnApproval: emitOnApproval.length,
    blockedBySource: sourceBlocked.length,
    sourceIssues: countIssues(
      sourceBlocked.map(({ issues }) => ({ issues: issues.filter((issue) => !isMetadataIssue(issue)) }))
    )
  };
}

export function planDc3Documents({ snapshot, roster, config }) {
  validateDc3Config(config);
  if (snapshot?.schemaVersion !== "HC_SNAPSHOT_V1") {
    throw new Error("El plan DC-3 requiere un snapshot HC_SNAPSHOT_V1");
  }
  if (roster?.schemaVersion !== "DC3_ACTIVE_ROSTER_V1") {
    throw new Error("El plan DC-3 requiere un padron DC3_ACTIVE_ROSTER_V1");
  }
  const rosterById = new Map(roster.employees.map((employee) => [employee.employeeId, employee]));
  const documents = [];
  const courseSummaries = [];

  for (const course of config.courses) {
    const selection = candidatesForCourse(snapshot, roster, course, config.cutoffDate);
    const courseMetadataIssues = metadataIssues(course);
    const courseDocuments = [...selection.completions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([employeeId, completionDate]) => {
        const rosterRecord = rosterById.get(employeeId) || null;
        const issues = recordIssues(rosterRecord, courseMetadataIssues);
        return buildDocument(config, course, employeeId, completionDate, rosterRecord, issues);
      });
    documents.push(...courseDocuments);
    courseSummaries.push({
      courseId: course.courseId,
      detected: courseDocuments.length,
      ready: courseDocuments.filter(({ ready }) => ready).length,
      blocked: courseDocuments.filter(({ ready }) => !ready).length,
      matchedSourceKeyCount: selection.matchedSourceKeyCount,
      issues: countIssues(courseDocuments)
    });
  }

  const readyDocuments = documents.filter(({ ready }) => ready);
  // La huella cubre solo lo que determina el contenido impreso: identidad, curso, fecha, metadatos
  // aprobados, firmas y regla de corte. `configVersion` es una etiqueta humana y queda fuera a
  // proposito. Incluirla convertiria una aprobacion parcial —QMS hoy, LOTO despues— en un conflicto
  // masivo de las constancias ya emitidas, que es justamente lo que este modulo debe evitar.
  //
  // Se calcula para todo documento que tenga datos, no solo para los listos: la emision con campos
  // en blanco necesita huella para que el ledger la reconozca y para que, al completarse el
  // metadato, la huella cambie y el documento se reemita en vez de repetirse. Un documento sin
  // identidad en el padron (`data === null`) no se puede imprimir de ninguna forma y queda fuera.
  for (const document of documents.filter(({ data }) => data !== null)) {
    document.sourceFingerprint = hash(canonicalJson({
      schemaVersion: "DC3_SOURCE_FINGERPRINT_V2",
      courseId: document.courseId,
      completionDate: document.completionDate,
      data: document.data,
      cutoffDate: config.cutoffDate
    }));
  }
  return {
    schemaVersion: "DC3_PLAN_V1",
    cutoffDate: config.cutoffDate,
    selectionPolicy: "EARLIEST_COMPLETION_ON_OR_AFTER_CUTOFF",
    documents,
    summary: {
      detected: documents.length,
      ready: readyDocuments.length,
      blocked: documents.length - readyDocuments.length,
      issues: countIssues(documents),
      courses: courseSummaries,
      coverage: coverageSummary(documents, config.courses.length),
      readiness: readinessSummary(config, documents)
    }
  };
}
