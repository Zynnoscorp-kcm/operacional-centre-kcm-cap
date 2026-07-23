import test from "node:test";
import assert from "node:assert/strict";
import {
  AttendanceCaptureService,
  AuditLedger,
  BLOCKING_REASONS,
  ExamReconciliationService,
  InMemoryAttendanceRepository,
  InMemoryEmployeeRepository,
  createInMemoryCore,
  evaluateEligibility
} from "../../src/core/index.js";
import { CAPTURE_ROUTES, EXAM_STATUSES, OCR_DECISIONS, createParticipantAttendance } from "../../src/shared/contracts.js";

const session = Object.freeze({ sessionId: "session-01", authorized: true });

function makeContext(employeeIds = ["00123", "00456"]) {
  let sequence = 0;
  const employees = new InMemoryEmployeeRepository(employeeIds.map((employeeId, index) => ({
    employeeId,
    displayName: `Persona sintetica ${index + 1}`,
    area: "AREA-SINTETICA",
    position: "PUESTO-SINTETICO",
    shift: "T1",
    active: true
  })));
  const attendances = new InMemoryAttendanceRepository();
  const audit = new AuditLedger({
    clock: () => new Date("2026-07-21T12:00:00.000Z"),
    idFactory: () => `audit-${++sequence}`
  });
  const capture = new AttendanceCaptureService({
    employees, attendances, audit, idFactory: () => `attendance-${++sequence}`
  });
  return { employees, attendances, audit, capture, nextId: () => `id-${++sequence}` };
}

test("el padron conserva ceros iniciales y rechaza identificadores duplicados", () => {
  const employees = new InMemoryEmployeeRepository([{ employeeId: "00123", active: true }]);
  assert.equal(employees.findByEmployeeId("00123").employeeId, "00123");
  assert.throws(
    () => new InMemoryEmployeeRepository([{ employeeId: "00123" }, { employeeId: "00123" }]),
    (error) => error.code === "DUPLICATE_EMPLOYEE"
  );
});

test("las rutas digital y OCR convergen al mismo contrato ParticipantAttendance", () => {
  const { capture } = makeContext();
  const digital = capture.registerDigital({
    session, employeeId: "00123", actor: "capacitador@example.invalid", requestId: "req-digital"
  });
  const ocr = capture.registerOcr({
    session,
    candidate: { normalizedEmployeeId: "00456", decision: OCR_DECISIONS.HUMAN_CONFIRMED },
    evidenceId: "evidence-synthetic-01",
    actor: "operador@example.invalid",
    role: "CAPACITACION",
    requestId: "req-ocr"
  });

  assert.deepEqual(Object.keys(digital).sort(), Object.keys(ocr).sort());
  assert.equal(digital.captureRoute, CAPTURE_ROUTES.DIGITAL);
  assert.equal(ocr.captureRoute, CAPTURE_ROUTES.OCR);
  assert.equal(digital.version, ocr.version);
  assert.equal(digital.examStatus, EXAM_STATUSES.PENDING);
  assert.equal(ocr.examStatus, EXAM_STATUSES.PENDING);
  assert.equal(typeof digital.employeeId, "string");
});

test("un numero inexistente queda invalidado sin exponer datos del padron", () => {
  const { capture, attendances } = makeContext(["00123"]);
  const result = capture.registerDigital({
    session, employeeId: "99999", actor: "capacitador@example.invalid", requestId: "req-unknown"
  });
  assert.equal(result.identityValidated, false);
  assert.deepEqual(result.blockingReasons, ["IDENTIDAD_INVALIDA"]);
  assert.equal(attendances.getState(session.sessionId, "99999"), "IDENTIDAD_INVALIDA");
  assert.equal("displayName" in result, false);
});

test("la misma persona no puede registrarse dos veces en una sesion", () => {
  const { capture } = makeContext(["00123"]);
  const input = { session, employeeId: "00123", actor: "capacitador@example.invalid" };
  capture.registerDigital({ ...input, requestId: "req-1" });
  assert.throws(
    () => capture.registerDigital({ ...input, requestId: "req-2" }),
    (error) => error.code === "DUPLICATE_ATTENDANCE"
  );
});

test("una lectura OCR dudosa siempre requiere revision", () => {
  const { capture, attendances } = makeContext(["00123"]);
  assert.throws(() => capture.registerOcr({
    session,
    candidate: { normalizedEmployeeId: "00123", decision: OCR_DECISIONS.REVIEW_REQUIRED },
    evidenceId: "evidence-synthetic-01",
    actor: "operador@example.invalid"
  }), (error) => error.code === "OCR_REVIEW_REQUIRED");
  assert.equal(attendances.listBySession(session.sessionId).length, 0);
});

test("la elegibilidad exige identidad, asistencia, examen, sesion y no liberado", () => {
  const base = {
    attendanceId: "attendance-1",
    sessionId: session.sessionId,
    employeeId: "00123",
    captureRoute: CAPTURE_ROUTES.DIGITAL,
    identityValidated: true,
    attendanceProven: true,
    examStatus: EXAM_STATUSES.CONFIRMED,
    sessionAuthorized: true,
    released: false
  };
  assert.deepEqual(evaluateEligibility(createParticipantAttendance(base)), { eligible: true, reasons: [] });

  const blocked = createParticipantAttendance({
    ...base,
    identityValidated: false,
    attendanceProven: false,
    examStatus: EXAM_STATUSES.NOT_FOUND,
    sessionAuthorized: false,
    released: true
  });
  assert.deepEqual(evaluateEligibility(blocked).reasons, [
    BLOCKING_REASONS.INVALID_IDENTITY,
    BLOCKING_REASONS.ATTENDANCE_NOT_PROVEN,
    BLOCKING_REASONS.EXAM_NOT_FOUND,
    BLOCKING_REASONS.SESSION_NOT_AUTHORIZED,
    BLOCKING_REASONS.ALREADY_RELEASED
  ]);
});

test("la conciliacion exige que la diferencia coincida con los faltantes marcados", () => {
  const { capture, attendances, audit, nextId } = makeContext();
  capture.registerDigital({
    session, employeeId: "00123", attendanceProven: true,
    actor: "capacitador@example.invalid", requestId: "req-a"
  });
  capture.registerOcr({
    session,
    candidate: { normalizedEmployeeId: "00456", decision: OCR_DECISIONS.HUMAN_CONFIRMED },
    evidenceId: "evidence-synthetic-01",
    attendanceProven: true,
    actor: "operador@example.invalid",
    role: "CAPACITACION",
    requestId: "req-b"
  });
  const exams = new ExamReconciliationService({
    attendances,
    audit,
    clock: () => new Date("2026-07-21T12:05:00.000Z"),
    idFactory: nextId
  });

  assert.throws(() => exams.reconcile({
    sessionId: session.sessionId,
    receivedExamCount: 1,
    missingEmployeeIds: [],
    actor: "operador@example.invalid"
  }), (error) => error.code === "EXAM_COUNT_MISMATCH");

  const reconciliation = exams.reconcile({
    sessionId: session.sessionId,
    receivedExamCount: 1,
    missingEmployeeIds: ["00456"],
    actor: "operador@example.invalid",
    requestId: "req-exams"
  });
  assert.equal(reconciliation.eligibleAttendanceCount, 2);
  assert.equal(attendances.get(session.sessionId, "00123").examStatus, EXAM_STATUSES.CONFIRMED);
  assert.equal(attendances.get(session.sessionId, "00456").examStatus, EXAM_STATUSES.NOT_FOUND);
  assert.equal(evaluateEligibility(attendances.get(session.sessionId, "00456")).eligible, false);
});

test("la auditoria es append-only y sus eventos no pueden mutarse", () => {
  const audit = new AuditLedger({
    idFactory: () => "audit-1",
    clock: () => new Date("2026-07-21T12:00:00.000Z")
  });
  const event = audit.record({ entityType: "Session", entityId: "session-01", action: "CREADA" });
  assert.equal(Object.isFrozen(event), true);
  assert.throws(() => { event.action = "ALTERADA"; }, TypeError);
  const listed = audit.list();
  listed.length = 0;
  assert.equal(audit.list().length, 1);
});

test("la fabrica publica ensambla una vertical local utilizable por el demo", () => {
  let id = 0;
  const core = createInMemoryCore({
    employees: [{ employeeId: "00123", active: true }],
    clock: () => new Date("2026-07-21T12:00:00.000Z"),
    idFactory: () => `factory-${++id}`
  });
  const attendance = core.capture.registerDigital({
    session, employeeId: "00123", actor: "capacitador@example.invalid", requestId: "factory-request"
  });
  assert.equal(attendance.employeeId, "00123");
  assert.equal(core.repositories.attendances.listBySession(session.sessionId).length, 1);
  assert.equal(typeof core.exams.reconcile, "function");
  assert.equal(typeof core.release.preview, "function");
});
