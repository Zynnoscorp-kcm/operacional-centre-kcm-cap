/**
 * Fixtures sintéticos para las pruebas de liberación.
 *
 * Todas las identidades son inventadas. La frontera de privacidad del proyecto
 * prohíbe usar la matriz, el padrón o el DNC como fixture, y estos números de
 * cinco dígitos no corresponden a ninguna persona.
 */

import { parseWorkerNumber, type WorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { HcRecord } from "../../src/domain/importacion-matriz/tipos.ts";
import type { AttendanceRecord, SessionRecord } from "../../src/domain/quiosco/tipos.ts";
import type { MatrixMapping, OverwritePolicy } from "../../src/domain/liberacion/tipos.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";

export const SESSION_ID = "SES-0001";
export const TRAINING_ID = "CAP-SINT-001";
export const MAPPING_VERSION = "operational-hc-v1";
export const SESSION_DATE = "2026-07-15";

/** Reloj fijo: ninguna prueba de este proyecto depende del reloj de la máquina. */
export function fixedClock(iso = "2026-07-15T18:00:00.000Z"): Clock {
  return {
    now: () => new Date(iso),
    nowIso: () => iso,
  };
}

export function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: SESSION_ID,
    sessionCode: "KCM-260715-ABCDEF",
    trainingId: TRAINING_ID,
    instructor: "INSTRUCTOR SINTETICO",
    date: SESSION_DATE,
    durationMinutes: 60,
    eventType: "CURSO",
    maxCapacity: 40,
    status: "LISTA_PARA_LIBERAR",
    authorized: true,
    authorizedBy: "USUARIO_CAPACITACION",
    authorizedAt: "2026-07-15T17:00:00.000Z",
    createdBy: "USUARIO_CAPACITACION",
    createdAt: "2026-07-14T10:00:00.000Z",
    creationRequestId: "req-creacion-0001",
    version: 1,
    ...overrides,
  };
}

export function buildAttendance(
  employeeId: string,
  overrides: Partial<AttendanceRecord> = {},
): AttendanceRecord {
  return {
    attendanceId: `AST-${employeeId}`,
    sessionId: SESSION_ID,
    workerNumber: parseWorkerNumber(employeeId),
    route: "DIGITAL",
    origin: "QUIOSCO",
    identityValidated: true,
    attendanceProven: true,
    examStatus: "EXAMEN_CONFIRMADO",
    status: "EXAMEN_CONFIRMADO",
    excludedFromRelease: false,
    released: false,
    createdAt: "2026-07-15T16:00:00.000Z",
    updatedAt: "2026-07-15T16:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

export function buildMapping(
  overwritePolicy: OverwritePolicy = "NO_OVERWRITE",
  overrides: Partial<MatrixMapping> = {},
): MatrixMapping {
  return {
    trainingId: TRAINING_ID,
    destinationName: "MATRIZ_MAESTRA",
    destinationSheet: "HC_OPERATIVA",
    destinationColumn: "AF",
    destinationHeader: "BUENAS PRACTICAS DE MANUFACTURA",
    headerRow: 3,
    mappingVersion: MAPPING_VERSION,
    overwritePolicy,
    active: true,
    ...overrides,
  };
}

/** Registro previo en la réplica, como el que dejaría una importación XLSB. */
export function buildHcRecord(
  employeeId: string,
  completionDate: string,
  overrides: Partial<HcRecord> = {},
): HcRecord {
  const workerNumber: WorkerNumber = parseWorkerNumber(employeeId);
  return {
    recordId: `hc-${employeeId}`,
    idempotencyKey: `xlsb|${employeeId}|${TRAINING_ID}|${completionDate}`,
    workerNumber,
    trainingId: TRAINING_ID,
    completionDate,
    provenance: "XLSB_IMPORT",
    status: "VIGENTE",
    sessionId: null,
    releaseId: null,
    mappingVersion: MAPPING_VERSION,
    batchId: null,
    marker: null,
    importId: "imp-0001",
    requestId: "req-import-0001",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

export const SECRET = "secreto-de-integridad-de-pruebas-32-bytes";

export const CAPACITACION = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" } as const;
export const AUDITOR = { actor: "USUARIO_AUDITOR", role: "AUDITOR" } as const;
