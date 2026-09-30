import { ReleaseConflictError, ReleaseInputError } from "./errores.ts";
import {
  MAX_ENTRIES_PER_BATCH,
  OVERWRITE_POLICIES,
  type MatrixMapping,
  type PlanEntry,
  type PlanSession,
  type WritePlan,
} from "./tipos.ts";

const EMPLOYEE_ID = /^\d{5}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMN = /^[A-Z]{1,3}$/;
const MAPPING_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export function assertIdentifier(value: string, field: string): string {
  const text = String(value ?? "").trim();
  if (!IDENTIFIER.test(text)) {
    throw new ReleaseInputError(`El campo ${field} no es un identificador válido`);
  }
  return text;
}

export function assertEmployeeId(value: string): string {
  const text = String(value ?? "")
    .trim()
    .padStart(5, "0");
  if (!EMPLOYEE_ID.test(text)) {
    throw new ReleaseInputError("El número de trabajador debe ser texto de cinco dígitos");
  }
  return text;
}

export function assertIsoDate(value: string, field = "fecha"): string {
  const text = String(value ?? "").trim();
  if (!ISO_DATE.test(text)) {
    throw new ReleaseInputError(`El campo ${field} debe usar formato YYYY-MM-DD`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ReleaseInputError(`El campo ${field} no es una fecha válida`);
  }
  return text;
}

export function releaseIdempotencyKey(params: {
  sessionId: string;
  employeeId: string;
  trainingId: string;
  mappingVersion: string;
}): string {
  return [params.sessionId, params.employeeId, params.trainingId, params.mappingVersion].join("|");
}

export function assertMapping(mapping: MatrixMapping): MatrixMapping {
  const column = String(mapping.destinationColumn ?? "")
    .trim()
    .toUpperCase();
  const version = String(mapping.mappingVersion ?? "").trim();

  if (!mapping.active) {
    throw new ReleaseConflictError("El mapeo de destino no está vigente");
  }
  if (!String(mapping.destinationName ?? "").trim()) {
    throw new ReleaseConflictError("El mapeo no declara un destino");
  }
  if (!String(mapping.destinationSheet ?? "").trim()) {
    throw new ReleaseConflictError("El mapeo no declara hoja destino");
  }
  if (!String(mapping.destinationHeader ?? "").trim()) {
    throw new ReleaseConflictError("El mapeo no declara encabezado esperado");
  }
  if (!COLUMN.test(column)) {
    throw new ReleaseConflictError("El mapeo declara una columna destino inválida");
  }
  if (!MAPPING_VERSION.test(version)) {
    throw new ReleaseConflictError("El mapeo declara una versión inválida");
  }
  if (!Number.isInteger(mapping.headerRow) || mapping.headerRow < 1 || mapping.headerRow > 100) {
    throw new ReleaseConflictError("El mapeo declara una fila de encabezado inválida");
  }
  if (!OVERWRITE_POLICIES.includes(mapping.overwritePolicy)) {
    throw new ReleaseConflictError("El mapeo declara una política de sobrescritura desconocida");
  }

  return {
    ...mapping,
    trainingId: assertIdentifier(mapping.trainingId, "trainingId"),
    destinationColumn: column,
    mappingVersion: version,
  };
}

export function sameMapping(left: MatrixMapping, right: MatrixMapping): boolean {
  const fields: readonly (keyof MatrixMapping)[] = [
    "trainingId",
    "destinationName",
    "destinationSheet",
    "destinationColumn",
    "destinationHeader",
    "headerRow",
    "mappingVersion",
    "overwritePolicy",
  ];
  return fields.every((field) => String(left[field]) === String(right[field]));
}

export interface PlanCandidate {
  readonly attendanceId: string;
  readonly employeeId: string;
}

export function buildWritePlan(
  session: PlanSession,
  mapping: MatrixMapping,
  candidates: readonly PlanCandidate[],
): WritePlan {
  const normalizedMapping = assertMapping(mapping);
  const sessionId = assertIdentifier(session.sessionId, "sessionId");
  const trainingId = assertIdentifier(session.trainingId, "trainingId");
  const completionDate = assertIsoDate(session.date, "fecha de sesión");

  if (normalizedMapping.trainingId !== trainingId) {
    throw new ReleaseConflictError("El mapeo no corresponde a la capacitación de la sesión");
  }

  const seenEmployees = new Set<string>();
  const seenAttendances = new Set<string>();

  const entries: PlanEntry[] = candidates.map((candidate) => {
    const attendanceId = assertIdentifier(candidate.attendanceId, "attendanceId");
    const employeeId = assertEmployeeId(candidate.employeeId);

    if (seenEmployees.has(employeeId) || seenAttendances.has(attendanceId)) {
      throw new ReleaseConflictError("El plan de liberación contiene registros duplicados");
    }
    seenEmployees.add(employeeId);
    seenAttendances.add(attendanceId);

    return {
      attendanceId,
      employeeId,
      trainingId,
      mappingVersion: normalizedMapping.mappingVersion,
      idempotencyKey: releaseIdempotencyKey({
        sessionId,
        employeeId,
        trainingId,
        mappingVersion: normalizedMapping.mappingVersion,
      }),
      completionDate,
    };
  });

  return validateWritePlan({
    session: { sessionId, trainingId, date: completionDate },
    mapping: normalizedMapping,
    completionDate,
    entries,
  });
}

export function validateWritePlan(plan: WritePlan): WritePlan {
  if (!plan || typeof plan !== "object") {
    throw new ReleaseConflictError("El plan de liberación no es válido");
  }

  const mapping = assertMapping(plan.mapping);
  const completionDate = assertIsoDate(plan.completionDate, "fecha de conclusión");

  if (plan.session.trainingId !== mapping.trainingId) {
    throw new ReleaseConflictError("El plan de liberación no coincide con su mapeo");
  }
  if (plan.session.date !== completionDate) {
    throw new ReleaseConflictError("El plan de liberación no coincide con la fecha de la sesión");
  }
  const rawEntries: unknown = plan.entries;
  if (!Array.isArray(rawEntries) || plan.entries.length < 1) {
    throw new ReleaseConflictError("El plan de liberación no contiene un lote válido");
  }
  if (plan.entries.length > MAX_ENTRIES_PER_BATCH) {
    throw new ReleaseConflictError(
      `El plan de liberación excede el máximo de ${MAX_ENTRIES_PER_BATCH} registros`,
    );
  }

  const seenEmployees = new Set<string>();
  const seenAttendances = new Set<string>();
  const seenKeys = new Set<string>();

  for (const entry of plan.entries) {
    const expectedKey = releaseIdempotencyKey({
      sessionId: plan.session.sessionId,
      employeeId: entry.employeeId,
      trainingId: entry.trainingId,
      mappingVersion: entry.mappingVersion,
    });

    if (
      entry.idempotencyKey !== expectedKey ||
      entry.trainingId !== plan.session.trainingId ||
      entry.mappingVersion !== mapping.mappingVersion ||
      entry.completionDate !== completionDate ||
      !EMPLOYEE_ID.test(entry.employeeId) ||
      seenEmployees.has(entry.employeeId) ||
      seenAttendances.has(entry.attendanceId) ||
      seenKeys.has(entry.idempotencyKey)
    ) {
      throw new ReleaseConflictError("El plan de liberación contiene registros inconsistentes");
    }

    seenEmployees.add(entry.employeeId);
    seenAttendances.add(entry.attendanceId);
    seenKeys.add(entry.idempotencyKey);
  }

  return plan;
}

export function validateResults<T extends { idempotencyKey: string; status: string }>(
  plan: WritePlan,
  results: readonly T[],
): readonly T[] {
  const rawResults: unknown = results;
  if (!Array.isArray(rawResults) || results.length !== plan.entries.length) {
    throw new ReleaseConflictError("Los resultados no coinciden con el plan de liberación");
  }

  const entriesByKey = new Map(plan.entries.map((entry) => [entry.idempotencyKey, entry]));
  const seen = new Set<string>();

  for (const result of results) {
    const entry = entriesByKey.get(result.idempotencyKey);
    if (!entry || seen.has(result.idempotencyKey)) {
      throw new ReleaseConflictError("Los resultados no coinciden con el plan de liberación");
    }
    const asRecord = result as unknown as Record<string, unknown>;
    for (const field of [
      "attendanceId",
      "employeeId",
      "trainingId",
      "mappingVersion",
      "completionDate",
    ] as const) {
      if (String(asRecord[field]) !== String(entry[field])) {
        throw new ReleaseConflictError("Los resultados no coinciden con el plan de liberación");
      }
    }
    seen.add(result.idempotencyKey);
  }

  return results;
}
