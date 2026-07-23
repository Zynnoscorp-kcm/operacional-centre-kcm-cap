import test from "node:test";
import assert from "node:assert/strict";
import {
  AttendanceCaptureService,
  AuditLedger,
  ExamReconciliationService,
  InMemoryAttendanceRepository,
  InMemoryEmployeeRepository,
  InMemoryReleaseRepository,
  ReleaseService,
  SimulatedMatrixGateway
} from "../../src/core/index.js";
import { OCR_DECISIONS } from "../../src/shared/contracts.js";

const session = Object.freeze({ sessionId: "session-release-01", authorized: true });
const fixedClock = () => new Date("2026-07-21T18:00:00.000Z");

function buildFlow(employeeIds = ["00123", "00456"]) {
  let id = 0;
  const idFactory = () => `synthetic-${++id}`;
  const employees = new InMemoryEmployeeRepository(employeeIds.map((employeeId) => ({
    employeeId, active: true, displayName: "Persona sintetica"
  })));
  const attendances = new InMemoryAttendanceRepository();
  const releases = new InMemoryReleaseRepository();
  const audit = new AuditLedger({ clock: fixedClock, idFactory });
  const matrix = new SimulatedMatrixGateway();
  const capture = new AttendanceCaptureService({ employees, attendances, audit, idFactory });
  const exams = new ExamReconciliationService({ attendances, audit, clock: fixedClock, idFactory });
  const release = new ReleaseService({ attendances, releases, matrix, audit, clock: fixedClock, idFactory });
  return { attendances, releases, audit, matrix, capture, exams, release };
}

function captureBothRoutes(flow) {
  flow.capture.registerDigital({
    session,
    employeeId: "00123",
    attendanceProven: true,
    actor: "capacitador@example.invalid",
    requestId: "request-digital"
  });
  flow.capture.registerOcr({
    session,
    candidate: { normalizedEmployeeId: "00456", decision: OCR_DECISIONS.HUMAN_CONFIRMED },
    evidenceId: "evidence-synthetic-01",
    attendanceProven: true,
    actor: "operador@example.invalid",
    role: "CAPACITACION",
    requestId: "request-ocr"
  });
}

function releaseInput(requestId) {
  return {
    sessionId: session.sessionId,
    trainingId: "training-synthetic-01",
    mappingVersion: "mapping-v1",
    releaseDate: "2026-07-21",
    actor: "operador@example.invalid",
    role: "CAPACITACION",
    requestId
  };
}

test("vertical de ambas rutas permite liberacion parcial y auditable", async () => {
  const flow = buildFlow();
  captureBothRoutes(flow);
  flow.exams.reconcile({
    sessionId: session.sessionId,
    receivedExamCount: 1,
    missingEmployeeIds: ["00456"],
    actor: "operador@example.invalid",
    requestId: "request-exams"
  });

  const preview = flow.release.preview(releaseInput("request-preview"));
  assert.equal(preview.included.length, 1);
  assert.equal(preview.included[0].employeeId, "00123");
  assert.deepEqual(preview.excluded[0].reasons, ["EXAMEN_NO_ENCONTRADO"]);

  const result = await flow.release.release(releaseInput("request-release"));
  assert.equal(result.status, "LIBERADA_PARCIAL");
  assert.equal(result.effectiveWrites, 1);
  assert.equal(flow.matrix.getCell({ employeeId: "00123", trainingId: "training-synthetic-01" }), "2026-07-21");
  assert.equal(flow.matrix.getCell({ employeeId: "00456", trainingId: "training-synthetic-01" }), null);
  assert.equal(flow.attendances.getState(session.sessionId, "00123"), "LIBERADA");
  assert.equal(flow.attendances.getState(session.sessionId, "00456"), "EXAMEN_NO_ENCONTRADO");
  assert.equal(flow.audit.list((event) => event.action === "REGISTRO_LIBERADO").length, 1);
  const actions = new Set(flow.audit.list().map(({ action }) => action));
  for (const requiredAction of [
    "CAPTURA_DIGITAL", "CAPTURA_OCR", "ASISTENCIA_COTEJADA",
    "EXAMENES_CONCILIADOS", "REGISTRO_LIBERADO", "LIBERADA_PARCIAL"
  ]) {
    assert.equal(actions.has(requiredAction), true, `falta evento ${requiredAction}`);
  }
});

test("un examen localizado despues permite completar una liberacion previamente parcial", async () => {
  const flow = buildFlow();
  captureBothRoutes(flow);
  flow.exams.reconcile({
    sessionId: session.sessionId,
    receivedExamCount: 1,
    missingEmployeeIds: ["00456"],
    actor: "operador@example.invalid",
    requestId: "request-exams-partial"
  });
  const partial = await flow.release.release(releaseInput("request-release-partial"));
  assert.equal(partial.status, "LIBERADA_PARCIAL");

  flow.exams.reconcile({
    sessionId: session.sessionId,
    receivedExamCount: 1,
    missingEmployeeIds: [],
    actor: "operador@example.invalid",
    requestId: "request-exams-complete"
  });
  const completed = await flow.release.release(releaseInput("request-release-complete"));
  assert.equal(completed.status, "LIBERADA_TOTAL");
  assert.equal(completed.effectiveWrites, 1);
  assert.equal(flow.matrix.writeCount, 2);
  assert.equal(flow.attendances.getState(session.sessionId, "00456"), "LIBERADA");
});

test("reintentar una liberacion no duplica fecha ni evento efectivo", async () => {
  const flow = buildFlow(["00123"]);
  flow.capture.registerDigital({
    session, employeeId: "00123", attendanceProven: true,
    actor: "capacitador@example.invalid", requestId: "request-digital"
  });
  flow.exams.reconcile({
    sessionId: session.sessionId, receivedExamCount: 1, missingEmployeeIds: [],
    actor: "operador@example.invalid", requestId: "request-exams"
  });

  const first = await flow.release.release(releaseInput("request-release-1"));
  const repeated = await flow.release.release(releaseInput("request-release-2"));
  assert.equal(first.status, "LIBERADA_TOTAL");
  assert.equal(repeated.status, "SIN_CAMBIOS");
  assert.equal(flow.matrix.writeCount, 1);
  assert.equal(flow.releases.effectiveCount, 1);
  assert.equal(flow.releases.listAttempts().length, 2);
  assert.equal(flow.audit.list((event) => event.action === "REGISTRO_LIBERADO").length, 1);
});

test("dos liberaciones concurrentes producen un solo resultado efectivo", async () => {
  const flow = buildFlow(["00123"]);
  flow.capture.registerDigital({
    session, employeeId: "00123", attendanceProven: true,
    actor: "capacitador@example.invalid", requestId: "request-digital"
  });
  flow.exams.reconcile({
    sessionId: session.sessionId, receivedExamCount: 1, missingEmployeeIds: [],
    actor: "operador@example.invalid", requestId: "request-exams"
  });

  // Segunda instancia para simular dos ejecuciones independientes compartiendo
  // persistencia; ambas usan el bloqueo local global equivalente a LockService.
  const secondReleaseService = new ReleaseService({
    attendances: flow.attendances,
    releases: flow.releases,
    matrix: flow.matrix,
    audit: flow.audit,
    clock: fixedClock,
    idFactory: () => "concurrent-second-service"
  });

  const results = await Promise.all([
    flow.release.release(releaseInput("request-concurrent-a")),
    secondReleaseService.release(releaseInput("request-concurrent-b"))
  ]);
  assert.deepEqual(results.map(({ effectiveWrites }) => effectiveWrites).sort(), [0, 1]);
  assert.equal(flow.matrix.writeCount, 1);
  assert.equal(flow.releases.effectiveCount, 1);
});

test("una fecha existente no se sobrescribe y queda excluida en la vista previa", async () => {
  const flow = buildFlow(["00123"]);
  flow.capture.registerDigital({
    session, employeeId: "00123", attendanceProven: true,
    actor: "capacitador@example.invalid", requestId: "request-digital"
  });
  flow.exams.reconcile({
    sessionId: session.sessionId, receivedExamCount: 1, missingEmployeeIds: [],
    actor: "operador@example.invalid", requestId: "request-exams"
  });
  flow.matrix.seedCell({
    employeeId: "00123", trainingId: "training-synthetic-01", value: "2026-01-15"
  });

  const preview = flow.release.preview(releaseInput("request-preview"));
  assert.equal(preview.included.length, 0);
  assert.deepEqual(preview.excluded[0].reasons, ["MATRIZ_CON_FECHA_EXISTENTE"]);
  const result = await flow.release.release(releaseInput("request-release"));
  assert.equal(result.status, "SIN_CAMBIOS");
  assert.equal(flow.matrix.getCell({ employeeId: "00123", trainingId: "training-synthetic-01" }), "2026-01-15");
});

test("el gateway simulado aplica lotes atomicamente ante un conflicto", () => {
  const matrix = new SimulatedMatrixGateway();
  matrix.seedCell({ employeeId: "00456", trainingId: "training-synthetic-01", value: "2026-01-15" });
  const writes = [
    { employeeId: "00123", trainingId: "training-synthetic-01", value: "2026-07-21", mappingVersion: "v1", idempotencyKey: "key-1" },
    { employeeId: "00456", trainingId: "training-synthetic-01", value: "2026-07-21", mappingVersion: "v1", idempotencyKey: "key-2" }
  ];
  assert.throws(() => matrix.applyWrites(writes), (error) => error.code === "MATRIX_VALUE_EXISTS");
  assert.equal(matrix.getCell({ employeeId: "00123", trainingId: "training-synthetic-01" }), null);
  assert.equal(matrix.writeCount, 0);
});
