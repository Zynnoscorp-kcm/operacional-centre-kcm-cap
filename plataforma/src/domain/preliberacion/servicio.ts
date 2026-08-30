/**
 * Servicio de preliberación — cálculos puros de elegibilidad y vista previa.
 *
 * Porta las funciones `blockingReasons`, `participantAttendance` y `preview`
 * del servicio de preliberación. La compuerta de reconocimiento óptico
 * se retira porque el OCR quedó fuera de alcance .
 *
 * No muta estado: es consulta pura. Las mutaciones viven en WorkbenchService.
 */

import type { AttendanceRecord, SessionRecord } from "../quiosco/tipos.ts";
import type {
  BlockingReason,
  ParticipantAttendance,
  EmployeeInfo,
  RosterRow,
  ExamOutcome,
} from "./tipos.ts";
import { PRERELEASE_FINDINGS } from "./tipos.ts";
import type {
  FindingCode,
  PreReleaseCounters,
  ReviewDto,
  PreReleaseReviewRecord,
  SessionHeader,
} from "./tipos.ts";

// ---------------------------------------------------------------------------
// Motivos de bloqueo
// ---------------------------------------------------------------------------

export function blockingReasons(
  attendance: AttendanceRecord,
  session: SessionRecord,
): BlockingReason[] {
  const reasons: BlockingReason[] = [];

  if (!attendance.identityValidated) reasons.push("IDENTIDAD_INVALIDA");
  if (!attendance.attendanceProven) reasons.push("ASISTENCIA_NO_COMPROBADA");

  const examStatus = attendance.examStatus;
  if (examStatus === "EXAMEN_NO_ENCONTRADO") reasons.push("EXAMEN_NO_ENCONTRADO");
  else if (examStatus === ("EXAMEN_REPROBADO" as string)) reasons.push("EXAMEN_REPROBADO");
  else if (examStatus !== "EXAMEN_CONFIRMADO") reasons.push("EXAMEN_NO_CONFIRMADO");

  if (attendance.excludedFromRelease) reasons.push("EXCLUIDO_EN_REVISION");
  if (!session.authorized) reasons.push("SESION_NO_AUTORIZADA");
  if (attendance.released) reasons.push("YA_LIBERADO_PREVIAMENTE");

  return reasons;
}

// ---------------------------------------------------------------------------
// Participant attendance DTO — porta la función homónima
// ---------------------------------------------------------------------------

export function participantAttendance(
  attendance: AttendanceRecord,
  session: SessionRecord,
): ParticipantAttendance {
  return {
    attendanceId: attendance.attendanceId,
    sessionId: attendance.sessionId,
    employeeId: String(attendance.workerNumber),
    captureRoute: attendance.route,
    identityValidated: attendance.identityValidated,
    attendanceProven: attendance.attendanceProven,
    examStatus: attendance.examStatus,
    sessionAuthorized: session.authorized,
    released: attendance.released,
    excludedFromRelease: attendance.excludedFromRelease,
    exclusionReason: attendance.exclusionReason ?? "",
    blockingReasons: blockingReasons(attendance, session),
  };
}

// ---------------------------------------------------------------------------
// Fila del listado de participantes
// ---------------------------------------------------------------------------

export function buildRosterRow(
  attendance: AttendanceRecord,
  session: SessionRecord,
  employee: EmployeeInfo | null,
): RosterRow {
  const participant = participantAttendance(attendance, session);
  const examStatus = (attendance.examStatus || "EXAMEN_PENDIENTE") as ExamOutcome;

  // En el banco de preliberación todo examen parte como entregado y aprobado.
  // El valor sólo se vuelve durable cuando el revisor guarda la revisión completa.
  const effectiveExamStatus: ExamOutcome =
    examStatus === "EXAMEN_PENDIENTE" ? "EXAMEN_CONFIRMADO" : examStatus;

  const reasons = participant.blockingReasons
    .filter(
      (reason) =>
        !(reason === "EXAMEN_NO_CONFIRMADO" && effectiveExamStatus === "EXAMEN_CONFIRMADO"),
    )
    .map((reason) =>
      reason === "IDENTIDAD_INVALIDA" && !employee ? "NUMERO_NO_IDENTIFICADO" : reason,
    );

  return {
    attendanceId: participant.attendanceId,
    employeeId: String(attendance.workerNumber),
    displayName: employee ? employee.displayName : "",
    area: employee ? employee.area : "",
    position: employee ? employee.position : "",
    knownEmployee: Boolean(employee),
    captureRoute: participant.captureRoute,
    identityValidated: participant.identityValidated,
    attendanceProven: participant.attendanceProven,
    examStatus: effectiveExamStatus,
    examDefaulted: examStatus === "EXAMEN_PENDIENTE",
    excludedFromRelease: participant.excludedFromRelease,
    exclusionReason: participant.exclusionReason,
    released: participant.released,
    blockingReasons: reasons,
    // Un examen que sigue en su valor por omisión no hace elegible a nadie,
    // aunque se muestre como aprobado y aunque `reasons` venga vacío: la
    // compuerta real, `splitEligibility`, evalúa el registro crudo y lo
    // rechazaría igual. Anunciarlo aquí como «a liberar» sería prometer lo que
    // liberación no va a cumplir. Lo provisional se lee en `examDefaulted`.
    eligible: reasons.length === 0 && examStatus !== "EXAMEN_PENDIENTE",
  };
}

// ---------------------------------------------------------------------------
// Hallazgos derivados — el servidor los calcula, no se declaran a mano
// ---------------------------------------------------------------------------

/**
 * Las tres situaciones en que puede estar una fila del padrón, en el orden en
 * que mandan.
 *
 * Un motivo de bloqueo manda sobre lo provisional: a quien está excluido se le
 * dice excluido aunque su examen conserve el valor por omisión. Sólo después
 * viene lo pendiente, que es la fila cuyo examen todavía no se vuelve durable
 * porque nadie ha guardado la revisión. Llamar «Excluido» a esa fila —como
 * hacía el banco de trabajo— acusaba de exclusión a quien nadie excluyó, y sin
 * un motivo que mostrar al lado, porque no había ninguno.
 *
 * Vive aquí y no en cada vista porque el banco y el reporte tienen que decir lo
 * mismo de la misma fila; separados ya habían empezado a discrepar.
 */
export type RosterSituation = "EXCLUIDO" | "PENDIENTE" | "A_LIBERAR";

export const ROSTER_SITUATION_LABELS: Readonly<Record<RosterSituation, string>> = Object.freeze({
  EXCLUIDO: "Excluido",
  PENDIENTE: "Pendiente",
  A_LIBERAR: "A liberar",
});

export function rosterSituation(row: RosterRow): RosterSituation {
  // Lo que guardar la revisión resuelve por sí solo, sin que nadie decida nada:
  // el examen que sigue en su valor por omisión, y el cotejo de asistencia de
  // quien sí está en el padrón activo —`save` lo confirma para toda identidad
  // validada—. Recién registrada en el quiosco, una fila llega con los dos, y
  // llamarla «Excluido» por eso describía como decisión lo que sólo era trabajo
  // sin empezar.
  //
  // La distinción importa en el caso contrario: para quien no está en el padrón
  // el cotejo no se resuelve guardando, y ahí sí es un bloqueo de verdad.
  const resueltoAlGuardar = new Set<string>();
  if (row.examDefaulted) resueltoAlGuardar.add("EXAMEN_NO_CONFIRMADO");
  if (row.identityValidated) resueltoAlGuardar.add("ASISTENCIA_NO_COMPROBADA");

  const bloqueos = row.blockingReasons.filter((motivo) => !resueltoAlGuardar.has(motivo));
  if (bloqueos.length > 0) return "EXCLUIDO";
  return row.eligible ? "A_LIBERAR" : "PENDIENTE";
}

export function derivedFindings(roster: readonly RosterRow[], receivedExams: number): string[] {
  const findings: string[] = [];

  const missing = roster.filter((r) => r.examStatus === "EXAMEN_NO_ENCONTRADO");
  const failed = roster.filter((r) => r.examStatus === "EXAMEN_REPROBADO");
  const excluded = roster.filter((r) => r.excludedFromRelease);
  const uncollated = roster.filter((r) => !r.attendanceProven);

  if (missing.length) findings.push("EXAMENES_FALTANTES");
  if (failed.length) findings.push("EXAMENES_REPROBADOS");
  if (excluded.length) findings.push("COLABORADORES_EXCLUIDOS");
  if (uncollated.length) findings.push("ASISTENCIA_NO_COTEJADA");
  if (receivedExams > roster.length) findings.push("EXAMENES_EXCEDENTES");

  return findings;
}

// ---------------------------------------------------------------------------
// Contadores — porta counters() del legado
// ---------------------------------------------------------------------------

export function counters(roster: readonly RosterRow[], receivedExams: number): PreReleaseCounters {
  const approved = roster.filter((r) => r.examStatus === "EXAMEN_CONFIRMADO");
  const failed = roster.filter((r) => r.examStatus === "EXAMEN_REPROBADO");
  const missingExams = roster.filter((r) => r.examStatus === "EXAMEN_NO_ENCONTRADO");
  const excluded = roster.filter((r) => r.excludedFromRelease);

  return {
    expectedExams: roster.length,
    receivedExams,
    approvedExams: approved.length,
    failedExams: failed.length,
    missingExams: missingExams.length,
    extraExams: Math.max(0, receivedExams - roster.length),
    excludedCount: excluded.length,
    eligibleCount: roster.filter((r) => r.eligible).length,
  };
}

// ---------------------------------------------------------------------------
// Session header — encabezado sin identidades
// ---------------------------------------------------------------------------

export function sessionHeader(
  session: SessionRecord,
  trainingName: string,
  attendances: readonly AttendanceRecord[],
): SessionHeader {
  let excluded = 0;
  let pending = 0;
  for (const a of attendances) {
    if (a.excludedFromRelease) excluded += 1;
    if ((a.examStatus || "EXAMEN_PENDIENTE") === "EXAMEN_PENDIENTE") pending += 1;
  }
  return {
    sessionId: session.sessionId,
    sessionCode: session.sessionCode,
    trainingId: session.trainingId,
    trainingName,
    date: session.date,
    instructor: session.instructor,
    status: session.status,
    authorized: session.authorized,
    attendanceCount: attendances.length,
    excludedCount: excluded,
    pendingExamCount: pending,
  };
}

// ---------------------------------------------------------------------------
// Review DTO
// ---------------------------------------------------------------------------

export function reviewDto(review: PreReleaseReviewRecord | null): ReviewDto {
  if (!review) {
    return {
      revisionId: "",
      findings: [],
      declaredFindings: [],
      comments: "",
      status: "SIN_REVISION",
      reviewedBy: "",
      reviewedAt: "",
      reportEvidenceId: "",
    };
  }

  const parsedFindings = parseFindings(review.findings);
  const declared = parsedFindings.filter(
    (code) => code in PRERELEASE_FINDINGS && !PRERELEASE_FINDINGS[code as FindingCode].derived,
  );

  return {
    revisionId: review.revisionId,
    findings: parsedFindings,
    declaredFindings: declared,
    comments: review.comments,
    status: review.status,
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt,
    reportEvidenceId: review.reportEvidenceId,
  };
}

/**
 * Los hallazgos viajan como JSON en una columna. Un valor corrupto se lee como
 * lista vacía en vez de tumbar la revisión completa: el resto del estado sigue
 * siendo cierto y el revisor puede volver a declararlos.
 */
function parseFindings(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((code) => String(code)).filter((code) => code in PRERELEASE_FINDINGS);
}
