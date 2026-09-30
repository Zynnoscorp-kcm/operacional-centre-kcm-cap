import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryPreReleaseRepository } from "../../src/adapters/memoria/preliberacion.ts";
import { WorkbenchService } from "../../src/domain/preliberacion/banco-de-trabajo.ts";
import {
  blockingReasons,
  buildRosterRow,
  derivedFindings,
  counters,
  rosterSituation,
  ROSTER_SITUATION_LABELS,
} from "../../src/domain/preliberacion/servicio.ts";
import {
  InvalidPreReleaseStateError,
  PreReleaseDuplicateError,
  PreReleaseCapacityError,
  PreReleaseInputError,
  PreReleaseNotFoundError,
} from "../../src/domain/preliberacion/errores.ts";
import type {
  AttendanceRecord,
  SessionRecord,
  ActorIdentity,
} from "../../src/domain/quiosco/tipos.ts";
import type { WorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { EmployeeInfo, RosterRow } from "../../src/domain/preliberacion/tipos.ts";

const FIXED_DATE = new Date("2026-08-03T10:00:00.000Z");
const testClock = { now: () => FIXED_DATE, nowIso: () => FIXED_DATE.toISOString() };

const IDENTITY: ActorIdentity = { actor: "REVISOR_TEST", role: "CAPACITACION" };

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "ses-001",
    sessionCode: "KCM-260803-ABC123",
    trainingId: "CAP-SINT-001",
    instructor: "CAPACITADOR_SINT",
    date: "2026-08-03",
    durationMinutes: 60,
    eventType: "Capacitacion",
    maxCapacity: 40,
    status: "CERRADA",
    authorized: false,
    createdBy: "ADMIN",
    createdAt: "2026-08-03T08:00:00Z",
    creationRequestId: "req-create-001",
    version: 1,
    ...overrides,
  };
}

function makeAttendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    attendanceId: `att-${overrides.workerNumber ?? "10001"}`,
    sessionId: "ses-001",
    workerNumber: "10001" as WorkerNumber,
    route: "DIGITAL",
    origin: "QUIOSCO",
    identityValidated: true,
    attendanceProven: false,
    examStatus: "EXAMEN_PENDIENTE",
    status: "CAPTURADA",
    excludedFromRelease: false,
    released: false,
    createdAt: "2026-08-03T09:00:00Z",
    updatedAt: "2026-08-03T09:00:00Z",
    version: 1,
    ...overrides,
  };
}

function makeEmployee(id: string, name: string = `EMPLEADO ${id}`): EmployeeInfo {
  return {
    employeeId: id,
    displayName: name,
    area: "PRODUCCION",
    position: "*OPERARIO 1°",
    active: true,
  };
}

function setupWorkbench(
  opts: {
    session?: Partial<SessionRecord>;
    attendances?: AttendanceRecord[];
    employees?: EmployeeInfo[];
  } = {},
) {
  const session = makeSession(opts.session);
  const repo = new MemoryPreReleaseRepository({
    sessions: [session],
    attendances: opts.attendances ?? [
      makeAttendance({ workerNumber: "10001" as WorkerNumber }),
      makeAttendance({ attendanceId: "att-10002", workerNumber: "10002" as WorkerNumber }),
      makeAttendance({ attendanceId: "att-10003", workerNumber: "10003" as WorkerNumber }),
    ],
    employees: opts.employees ?? [
      makeEmployee("10001"),
      makeEmployee("10002"),
      makeEmployee("10003"),
      makeEmployee("10004"),
      makeEmployee("10005"),
    ],
  });
  const service = new WorkbenchService({ repository: repo, clock: testClock });
  return { repo, service, session };
}

describe("Caracterización de Preliberación — Funciones puras", () => {
  describe("blockingReasons", () => {
    it("no tiene motivos de bloqueo cuando todo está correcto", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
        excludedFromRelease: false,
        released: false,
      });
      const reasons = blockingReasons(attendance, session);
      assert.deepStrictEqual(reasons, []);
    });

    it("bloquea por identidad inválida", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: false,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
      });
      assert.ok(blockingReasons(attendance, session).includes("IDENTIDAD_INVALIDA"));
    });

    it("bloquea por asistencia no comprobada", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: false,
        examStatus: "EXAMEN_CONFIRMADO",
      });
      assert.ok(blockingReasons(attendance, session).includes("ASISTENCIA_NO_COMPROBADA"));
    });

    it("bloquea por examen no encontrado", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_NO_ENCONTRADO",
      });
      assert.ok(blockingReasons(attendance, session).includes("EXAMEN_NO_ENCONTRADO"));
    });

    it("bloquea por examen no confirmado (PENDIENTE)", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_PENDIENTE",
      });
      assert.ok(blockingReasons(attendance, session).includes("EXAMEN_NO_CONFIRMADO"));
    });

    it("bloquea por exclusión en revisión", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
        excludedFromRelease: true,
        exclusionReason: "Motivo test",
      });
      assert.ok(blockingReasons(attendance, session).includes("EXCLUIDO_EN_REVISION"));
    });

    it("bloquea por sesión no autorizada", () => {
      const session = makeSession({ authorized: false });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
      });
      assert.ok(blockingReasons(attendance, session).includes("SESION_NO_AUTORIZADA"));
    });

    it("bloquea por ya liberado previamente", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
        released: true,
      });
      assert.ok(blockingReasons(attendance, session).includes("YA_LIBERADO_PREVIAMENTE"));
    });

    it("acumula múltiples motivos de bloqueo", () => {
      const session = makeSession({ authorized: false });
      const attendance = makeAttendance({
        identityValidated: false,
        attendanceProven: false,
        examStatus: "EXAMEN_PENDIENTE",
        excludedFromRelease: true,
        exclusionReason: "Test",
      });
      const reasons = blockingReasons(attendance, session);
      assert.ok(reasons.length >= 4);
    });
  });

  describe("buildRosterRow", () => {
    it("pone examen como CONFIRMADO por defecto cuando está PENDIENTE", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({ examStatus: "EXAMEN_PENDIENTE" });
      const employee = makeEmployee("10001");
      const row = buildRosterRow(attendance, session, employee);
      assert.equal(row.examStatus, "EXAMEN_CONFIRMADO");
      assert.equal(row.examDefaulted, true);
    });

    it("conserva EXAMEN_NO_ENCONTRADO cuando no es pendiente", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({ examStatus: "EXAMEN_NO_ENCONTRADO" });
      const employee = makeEmployee("10001");
      const row = buildRosterRow(attendance, session, employee);
      assert.equal(row.examStatus, "EXAMEN_NO_ENCONTRADO");
      assert.equal(row.examDefaulted, false);
    });

    it("muestra NUMERO_NO_IDENTIFICADO cuando employee no existe", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({ identityValidated: false });
      const row = buildRosterRow(attendance, session, null);
      assert.ok(row.blockingReasons.includes("NUMERO_NO_IDENTIFICADO"));
      assert.equal(row.knownEmployee, false);
    });

    it("marca elegible solo cuando no hay razones de bloqueo y examen no es pendiente", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
      });
      const employee = makeEmployee("10001");
      const row = buildRosterRow(attendance, session, employee);
      assert.equal(row.eligible, true);
    });

    it("NO marca elegible cuando examen está pendiente (aunque el efecto sea CONFIRMADO)", () => {
      const session = makeSession({ authorized: true });
      const attendance = makeAttendance({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_PENDIENTE",
      });
      const employee = makeEmployee("10001");
      const row = buildRosterRow(attendance, session, employee);
      assert.equal(row.eligible, false);
    });
  });

  describe("rosterSituation", () => {
    it("una fila sin revisión guardada está pendiente, no excluida", () => {
      const row = buildRosterRow(
        makeAttendance({
          identityValidated: true,
          attendanceProven: true,
          examStatus: "EXAMEN_PENDIENTE",
        }),
        makeSession({ authorized: true }),
        makeEmployee("10001"),
      );

      assert.equal(row.eligible, false);
      assert.deepEqual(row.blockingReasons, []);
      assert.equal(rosterSituation(row), "PENDIENTE");
    });

    it("con la revisión guardada pasa a liberable", () => {
      const row = buildRosterRow(
        makeAttendance({
          identityValidated: true,
          attendanceProven: true,
          examStatus: "EXAMEN_CONFIRMADO",
        }),
        makeSession({ authorized: true }),
        makeEmployee("10001"),
      );

      assert.equal(rosterSituation(row), "A_LIBERAR");
    });

    it("un motivo de bloqueo manda sobre lo pendiente", () => {
      const row = buildRosterRow(
        makeAttendance({
          identityValidated: true,
          attendanceProven: true,
          examStatus: "EXAMEN_PENDIENTE",
          excludedFromRelease: true,
        }),
        makeSession({ authorized: true }),
        makeEmployee("10001"),
      );

      assert.equal(rosterSituation(row), "EXCLUIDO");
    });

    it("cada situación tiene su texto", () => {
      assert.equal(ROSTER_SITUATION_LABELS.PENDIENTE, "Pendiente");
      assert.equal(ROSTER_SITUATION_LABELS.A_LIBERAR, "A liberar");
      assert.equal(ROSTER_SITUATION_LABELS.EXCLUIDO, "Excluido");
    });
  });

  describe("derivedFindings", () => {
    it("detecta exámenes faltantes", () => {
      const roster: RosterRow[] = [
        buildRosterRow(
          makeAttendance({ examStatus: "EXAMEN_NO_ENCONTRADO" }),
          makeSession(),
          makeEmployee("10001"),
        ),
      ];
      assert.ok(derivedFindings(roster, 0).includes("EXAMENES_FALTANTES"));
    });

    it("detecta colaboradores excluidos", () => {
      const roster: RosterRow[] = [
        buildRosterRow(
          makeAttendance({ excludedFromRelease: true, exclusionReason: "Test" }),
          makeSession(),
          makeEmployee("10001"),
        ),
      ];
      assert.ok(derivedFindings(roster, 1).includes("COLABORADORES_EXCLUIDOS"));
    });

    it("detecta exámenes excedentes", () => {
      const roster: RosterRow[] = [
        buildRosterRow(makeAttendance(), makeSession(), makeEmployee("10001")),
      ];
      assert.ok(derivedFindings(roster, 5).includes("EXAMENES_EXCEDENTES"));
    });

    it("detecta asistencia no cotejada", () => {
      const roster: RosterRow[] = [
        buildRosterRow(
          makeAttendance({ attendanceProven: false }),
          makeSession(),
          makeEmployee("10001"),
        ),
      ];
      assert.ok(derivedFindings(roster, 1).includes("ASISTENCIA_NO_COTEJADA"));
    });

    it("no reporta hallazgos cuando todo está limpio", () => {
      const roster: RosterRow[] = [
        buildRosterRow(
          makeAttendance({
            identityValidated: true,
            attendanceProven: true,
            examStatus: "EXAMEN_CONFIRMADO",
          }),
          makeSession({ authorized: true }),
          makeEmployee("10001"),
        ),
      ];
      assert.deepStrictEqual(derivedFindings(roster, 1), []);
    });
  });

  describe("counters", () => {
    it("calcula contadores correctamente", () => {
      const session = makeSession({ authorized: true });
      const roster: RosterRow[] = [
        buildRosterRow(
          makeAttendance({
            examStatus: "EXAMEN_CONFIRMADO",
            identityValidated: true,
            attendanceProven: true,
          }),
          session,
          makeEmployee("10001"),
        ),
        buildRosterRow(
          makeAttendance({
            attendanceId: "att-2",
            workerNumber: "10002" as WorkerNumber,
            examStatus: "EXAMEN_NO_ENCONTRADO",
          }),
          session,
          makeEmployee("10002"),
        ),
        buildRosterRow(
          makeAttendance({
            attendanceId: "att-3",
            workerNumber: "10003" as WorkerNumber,
            excludedFromRelease: true,
            exclusionReason: "Test",
          }),
          session,
          makeEmployee("10003"),
        ),
      ];
      const c = counters(roster, 2);
      assert.equal(c.expectedExams, 3);
      assert.equal(c.missingExams, 1);
      assert.equal(c.excludedCount, 1);
    });
  });
});

describe("Caracterización de Preliberación — WorkbenchService", () => {
  describe("open", () => {
    it("abre una sesión CERRADA y muestra el roster", async () => {
      const { service } = setupWorkbench();
      const state = await service.open("ses-001");
      assert.equal(state.session.sessionId, "ses-001");
      assert.equal(state.roster.length, 3);
      assert.ok(state.findingCatalog.length > 0);
      assert.ok(state.examOutcomes.length > 0);
    });

    it("rechaza abrir una sesión en BORRADOR", async () => {
      const { service } = setupWorkbench({ session: { status: "BORRADOR" } });
      await assert.rejects(() => service.open("ses-001"), InvalidPreReleaseStateError);
    });

    it("rechaza abrir una sesión en ABIERTA", async () => {
      const { service } = setupWorkbench({ session: { status: "ABIERTA" } });
      await assert.rejects(() => service.open("ses-001"), InvalidPreReleaseStateError);
    });
  });

  describe("save — Invariante: guardar NO cambia el estado de la sesión", () => {
    it("guarda revisión con resultados de exámenes y la sesión permanece CERRADA", async () => {
      const { service, repo } = setupWorkbench();
      const state = await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-save-001",
          examOutcomes: [
            { employeeId: "10001", examStatus: "EXAMEN_CONFIRMADO" },
            { employeeId: "10002", examStatus: "EXAMEN_NO_ENCONTRADO" },
            { employeeId: "10003", examStatus: "EXAMEN_CONFIRMADO" },
          ],
          exclusions: [],
          findings: [],
          comments: "Sin observaciones",
        },
        IDENTITY,
      );

      const session = await repo.getSessionById("ses-001");
      assert.equal(session!.status, "CERRADA");
      assert.equal(state.session.status, "CERRADA");

      const review = repo.getReview("ses-001");
      assert.ok(review);
      assert.equal(review.comments, "Sin observaciones");

      const att10002 = repo.getAttendance("att-10002");
      assert.equal(att10002!.examStatus, "EXAMEN_NO_ENCONTRADO");
    });

    it("confirma asistencia (attendanceProven) al guardar", async () => {
      const { service, repo } = setupWorkbench();
      await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-save-002",
          examOutcomes: [
            { employeeId: "10001", examStatus: "EXAMEN_CONFIRMADO" },
            { employeeId: "10002", examStatus: "EXAMEN_CONFIRMADO" },
            { employeeId: "10003", examStatus: "EXAMEN_CONFIRMADO" },
          ],
          exclusions: [],
          findings: [],
          comments: "",
        },
        IDENTITY,
      );

      const att = repo.getAttendance("att-10001");
      assert.equal(att!.attendanceProven, true);
      assert.equal(att!.status, "COTEJADA");
    });

    it("audita cada cambio de examen", async () => {
      const { service, repo } = setupWorkbench();
      await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-save-audit",
          examOutcomes: [{ employeeId: "10001", examStatus: "EXAMEN_CONFIRMADO" }],
          exclusions: [],
          findings: [],
          comments: "",
        },
        IDENTITY,
      );

      const audits = repo.getAllAudits().filter((a) => a.action === "EXAM_STATUS_RECONCILED");
      assert.ok(audits.length >= 1);
    });

    it("calcula hallazgos derivados automáticamente", async () => {
      const { service } = setupWorkbench();
      const state = await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-save-findings",
          examOutcomes: [
            { employeeId: "10001", examStatus: "EXAMEN_NO_ENCONTRADO" },
            { employeeId: "10002", examStatus: "EXAMEN_CONFIRMADO" },
            { employeeId: "10003", examStatus: "EXAMEN_CONFIRMADO" },
          ],
          exclusions: [],
          findings: [],
          comments: "",
        },
        IDENTITY,
      );

      assert.ok(state.findings.includes("EXAMENES_FALTANTES"));
      assert.equal(state.review.status, "CON_HALLAZGOS");
    });

    it("rechaza declarar un hallazgo derivado a mano", async () => {
      const { service } = setupWorkbench();
      await assert.rejects(
        () =>
          service.save(
            {
              sessionId: "ses-001",
              requestId: "req-save-bad",
              examOutcomes: [],
              exclusions: [],
              findings: ["EXAMENES_FALTANTES"],
              comments: "",
            },
            IDENTITY,
          ),
        PreReleaseInputError,
      );
    });
  });

  describe("save — exclusiones", () => {
    it("Invariante: excluir exige motivo", async () => {
      const { service } = setupWorkbench();
      await assert.rejects(
        () =>
          service.save(
            {
              sessionId: "ses-001",
              requestId: "req-excl-no-reason",
              examOutcomes: [],
              exclusions: [{ employeeId: "10001", excluded: true }],
              findings: [],
              comments: "",
            },
            IDENTITY,
          ),
        PreReleaseInputError,
      );
    });

    it("excluye con motivo y lo audita", async () => {
      const { service, repo } = setupWorkbench();
      await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-excl-ok",
          examOutcomes: [],
          exclusions: [
            { employeeId: "10001", excluded: true, reason: "No presentó documentación" },
          ],
          findings: [],
          comments: "",
        },
        IDENTITY,
      );

      const att = repo.getAttendance("att-10001");
      assert.equal(att!.excludedFromRelease, true);
      assert.equal(att!.exclusionReason, "No presentó documentación");

      const audits = repo.getAllAudits().filter((a) => a.action === "ATTENDANCE_EXCLUDED");
      assert.equal(audits.length, 1);
    });

    it("Invariante: asistencia ya liberada no admite exclusión", async () => {
      const { service } = setupWorkbench({
        attendances: [
          makeAttendance({
            workerNumber: "10001" as WorkerNumber,
            released: true,
            releasedAt: "2026-08-03T10:00:00Z",
          }),
        ],
      });
      await assert.rejects(
        () =>
          service.save(
            {
              sessionId: "ses-001",
              requestId: "req-excl-released",
              examOutcomes: [],
              exclusions: [{ employeeId: "10001", excluded: true, reason: "Test" }],
              findings: [],
              comments: "",
            },
            IDENTITY,
          ),
        InvalidPreReleaseStateError,
      );
    });

    it("reincorpora un excluido y audita como REINSTATED", async () => {
      const { service, repo } = setupWorkbench({
        attendances: [
          makeAttendance({
            workerNumber: "10001" as WorkerNumber,
            excludedFromRelease: true,
            exclusionReason: "Motivo original",
            excludedBy: "ADMIN",
            excludedAt: "2026-08-03T09:30:00Z",
          }),
        ],
      });
      await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-reinstate",
          examOutcomes: [],
          exclusions: [{ employeeId: "10001", excluded: false }],
          findings: [],
          comments: "",
        },
        IDENTITY,
      );

      const att = repo.getAttendance("att-10001");
      assert.equal(att!.excludedFromRelease, false);

      const audits = repo.getAllAudits().filter((a) => a.action === "ATTENDANCE_REINSTATED");
      assert.equal(audits.length, 1);
    });
  });

  describe("addWorker — alta manual", () => {
    it("agrega un trabajador activo al padrón de la sesión", async () => {
      const { service } = setupWorkbench();
      const state = await service.addWorker(
        {
          sessionId: "ses-001",
          employeeId: "10004",
          requestId: "req-add-001",
        },
        IDENTITY,
      );

      assert.equal(state.roster.length, 4);
      const added = state.roster.find((r) => r.employeeId === "10004");
      assert.ok(added);
      assert.equal(added.identityValidated, true);
      assert.equal(added.attendanceProven, true);
      assert.equal(added.examStatus, "EXAMEN_CONFIRMADO");
    });

    it("Invariante: alta manual idempotente por requestId", async () => {
      const { service } = setupWorkbench();
      const state1 = await service.addWorker(
        {
          sessionId: "ses-001",
          employeeId: "10004",
          requestId: "req-add-idem",
        },
        IDENTITY,
      );
      const state2 = await service.addWorker(
        {
          sessionId: "ses-001",
          employeeId: "10004",
          requestId: "req-add-idem",
        },
        IDENTITY,
      );
      assert.equal(state1.roster.length, state2.roster.length);
    });

    it("Invariante: alta duplicada con otra solicitud se rechaza", async () => {
      const { service } = setupWorkbench();
      await service.addWorker(
        {
          sessionId: "ses-001",
          employeeId: "10004",
          requestId: "req-add-first",
        },
        IDENTITY,
      );
      await assert.rejects(
        () =>
          service.addWorker(
            {
              sessionId: "ses-001",
              employeeId: "10004",
              requestId: "req-add-second",
            },
            IDENTITY,
          ),
        PreReleaseDuplicateError,
      );
    });

    it("rechaza trabajador inexistente en el padrón", async () => {
      const { service } = setupWorkbench();
      await assert.rejects(
        () =>
          service.addWorker(
            {
              sessionId: "ses-001",
              employeeId: "99999",
              requestId: "req-add-bad",
            },
            IDENTITY,
          ),
        PreReleaseNotFoundError,
      );
    });

    it("rechaza cuando se alcanza el cupo de 40", async () => {
      const attendances = Array.from({ length: 40 }, (_, i) => {
        const num = String(10001 + i).padStart(5, "0");
        return makeAttendance({
          attendanceId: `att-${num}`,
          workerNumber: num as WorkerNumber,
        });
      });
      const employees = Array.from({ length: 42 }, (_, i) => {
        const num = String(10001 + i).padStart(5, "0");
        return makeEmployee(num);
      });
      const { service } = setupWorkbench({ attendances, employees });
      await assert.rejects(
        () =>
          service.addWorker(
            {
              sessionId: "ses-001",
              employeeId: String(10001 + 40).padStart(5, "0"),
              requestId: "req-add-full",
            },
            IDENTITY,
          ),
        PreReleaseCapacityError,
      );
    });

    it("audita el alta manual con PRERELEASE_ATTENDANCE_ADDED", async () => {
      const { service, repo } = setupWorkbench();
      await service.addWorker(
        {
          sessionId: "ses-001",
          employeeId: "10004",
          requestId: "req-add-audit",
        },
        IDENTITY,
      );

      const audits = repo.getAllAudits().filter((a) => a.action === "PRERELEASE_ATTENDANCE_ADDED");
      assert.equal(audits.length, 1);
      assert.ok(audits[0]!.reason!.includes("10004"));
    });
  });

  describe("enterPreRelease — transición a PRELIBERACION", () => {
    it("cambia de CERRADA a PRELIBERACION cuando hay revisión guardada", async () => {
      const { service } = setupWorkbench();
      await service.save(
        {
          sessionId: "ses-001",
          requestId: "req-save-enter",
          examOutcomes: [
            { employeeId: "10001", examStatus: "EXAMEN_CONFIRMADO" },
            { employeeId: "10002", examStatus: "EXAMEN_CONFIRMADO" },
            { employeeId: "10003", examStatus: "EXAMEN_CONFIRMADO" },
          ],
          exclusions: [],
          findings: [],
          comments: "",
        },
        IDENTITY,
      );

      const state = await service.enterPreRelease("ses-001", IDENTITY);
      assert.equal(state.session.status, "PRELIBERACION");
    });

    it("es idempotente: si ya está en PRELIBERACION, devuelve el estado", async () => {
      const { service, repo } = setupWorkbench({ session: { status: "PRELIBERACION" } });
      await repo.upsertReview({
        revisionId: "rev-001",
        sessionId: "ses-001",
        requestId: "req-rev",
        expectedExams: 3,
        receivedExams: 3,
        approvedExams: 3,
        failedExams: 0,
        missingExams: 0,
        extraExams: 0,
        findings: "[]",
        comments: "",
        excludedCount: 0,
        status: "SIN_HALLAZGOS",
        reportEvidenceId: "",
        reviewedBy: "TEST",
        reviewedAt: "2026-08-03T10:00:00Z",
        updatedAt: "2026-08-03T10:00:00Z",
      });
      const state = await service.enterPreRelease("ses-001", IDENTITY);
      assert.equal(state.session.status, "PRELIBERACION");
    });

    it("rechaza entrar sin revisión guardada", async () => {
      const { service } = setupWorkbench();
      await assert.rejects(
        () => service.enterPreRelease("ses-001", IDENTITY),
        InvalidPreReleaseStateError,
      );
    });

    it("rechaza entrar desde ABIERTA", async () => {
      const { service } = setupWorkbench({ session: { status: "ABIERTA" } });
      await assert.rejects(
        () => service.enterPreRelease("ses-001", IDENTITY),
        InvalidPreReleaseStateError,
      );
    });
  });

  describe("submit — pasar a LISTA_PARA_LIBERAR", () => {
    it("pasa de PRELIBERACION a LISTA_PARA_LIBERAR cuando todo está clasificado y autorizado", async () => {
      const { service, repo } = setupWorkbench({
        session: { status: "PRELIBERACION", authorized: true },
        attendances: [
          makeAttendance({
            workerNumber: "10001" as WorkerNumber,
            examStatus: "EXAMEN_CONFIRMADO",
            identityValidated: true,
            attendanceProven: true,
          }),
        ],
      });
      await repo.upsertReview({
        revisionId: "rev-001",
        sessionId: "ses-001",
        requestId: "req-rev",
        expectedExams: 1,
        receivedExams: 1,
        approvedExams: 1,
        failedExams: 0,
        missingExams: 0,
        extraExams: 0,
        findings: "[]",
        comments: "",
        excludedCount: 0,
        status: "SIN_HALLAZGOS",
        reportEvidenceId: "",
        reviewedBy: "TEST",
        reviewedAt: "2026-08-03T10:00:00Z",
        updatedAt: "2026-08-03T10:00:00Z",
      });

      const state = await service.submit("ses-001", IDENTITY);
      assert.equal(state.editable, false);
      assert.equal(state.releaseAvailable, false);
    });

    it("rechaza si hay exámenes pendientes", async () => {
      const { service, repo } = setupWorkbench({
        session: { status: "PRELIBERACION", authorized: true },
        attendances: [
          makeAttendance({ workerNumber: "10001" as WorkerNumber, examStatus: "EXAMEN_PENDIENTE" }),
        ],
      });
      await repo.upsertReview({
        revisionId: "rev-001",
        sessionId: "ses-001",
        requestId: "req-rev",
        expectedExams: 1,
        receivedExams: 0,
        approvedExams: 0,
        failedExams: 0,
        missingExams: 1,
        extraExams: 0,
        findings: "[]",
        comments: "",
        excludedCount: 0,
        status: "SIN_HALLAZGOS",
        reportEvidenceId: "",
        reviewedBy: "TEST",
        reviewedAt: "2026-08-03T10:00:00Z",
        updatedAt: "2026-08-03T10:00:00Z",
      });
      await assert.rejects(() => service.submit("ses-001", IDENTITY), InvalidPreReleaseStateError);
    });

    it("rechaza si la sesión no está autorizada", async () => {
      const { service, repo } = setupWorkbench({
        session: { status: "PRELIBERACION", authorized: false },
        attendances: [
          makeAttendance({
            workerNumber: "10001" as WorkerNumber,
            examStatus: "EXAMEN_CONFIRMADO",
          }),
        ],
      });
      await repo.upsertReview({
        revisionId: "rev-001",
        sessionId: "ses-001",
        requestId: "req-rev",
        expectedExams: 1,
        receivedExams: 1,
        approvedExams: 1,
        failedExams: 0,
        missingExams: 0,
        extraExams: 0,
        findings: "[]",
        comments: "",
        excludedCount: 0,
        status: "SIN_HALLAZGOS",
        reportEvidenceId: "",
        reviewedBy: "TEST",
        reviewedAt: "2026-08-03T10:00:00Z",
        updatedAt: "2026-08-03T10:00:00Z",
      });
      await assert.rejects(() => service.submit("ses-001", IDENTITY), InvalidPreReleaseStateError);
    });
  });

  describe("returnToPreRelease — retornar desde bandeja de liberación", () => {
    it("retorna de LISTA_PARA_LIBERAR a PRELIBERACION", async () => {
      const { service } = setupWorkbench({ session: { status: "LISTA_PARA_LIBERAR" } });
      const state = await service.returnToPreRelease("ses-001", IDENTITY);
      assert.equal(state.session.status, "PRELIBERACION");
    });

    it("es idempotente cuando ya está en PRELIBERACION", async () => {
      const { service } = setupWorkbench({ session: { status: "PRELIBERACION" } });
      const state = await service.returnToPreRelease("ses-001", IDENTITY);
      assert.equal(state.session.status, "PRELIBERACION");
    });

    it("rechaza retornar desde CERRADA", async () => {
      const { service } = setupWorkbench({ session: { status: "CERRADA" } });
      await assert.rejects(
        () => service.returnToPreRelease("ses-001", IDENTITY),
        InvalidPreReleaseStateError,
      );
    });

    it("audita la transición", async () => {
      const { service, repo } = setupWorkbench({ session: { status: "LISTA_PARA_LIBERAR" } });
      await service.returnToPreRelease("ses-001", IDENTITY);
      const audits = repo
        .getAllAudits()
        .filter((a) => a.action === "SESSION_STATE_CHANGED" && a.newState === "PRELIBERACION");
      assert.ok(audits.length >= 1);
    });
  });
});

describe("Caracterización de Preliberación — bandejas y alternativas", () => {
  describe("listEditableSessions / listReleaseQueue", () => {
    function setupBandejas() {
      const repo = new MemoryPreReleaseRepository({
        sessions: [
          makeSession({ sessionId: "ses-cerrada", sessionCode: "KCM-A", date: "2026-08-01" }),
          makeSession({
            sessionId: "ses-prelib",
            sessionCode: "KCM-B",
            date: "2026-08-03",
            status: "PRELIBERACION",
          }),
          makeSession({
            sessionId: "ses-lista",
            sessionCode: "KCM-C",
            date: "2026-08-02",
            status: "LISTA_PARA_LIBERAR",
          }),
          makeSession({
            sessionId: "ses-borrador",
            sessionCode: "KCM-D",
            date: "2026-08-04",
            status: "BORRADOR",
          }),
        ],
        attendances: [makeAttendance({ workerNumber: "10001" as WorkerNumber })],
        employees: [makeEmployee("10001")],
      });
      return { repo, service: new WorkbenchService({ repository: repo, clock: testClock }) };
    }

    it("lista sólo las sesiones en etapa revisable", async () => {
      const { service } = setupBandejas();
      const bandeja = await service.listEditableSessions(IDENTITY);
      assert.deepEqual(
        bandeja.map((s) => s.sessionCode),
        ["KCM-B", "KCM-A"],
      );
    });

    it("una sesión en borrador no tiene nada que revisar y no aparece", async () => {
      const { service } = setupBandejas();
      const bandeja = await service.listEditableSessions(IDENTITY);
      assert.ok(!bandeja.some((s) => s.sessionCode === "KCM-D"));
    });

    it("ordena de la fecha más reciente a la más antigua", async () => {
      const { service } = setupBandejas();
      const bandeja = await service.listEditableSessions(IDENTITY);
      const fechas = bandeja.map((s) => s.date);
      assert.deepEqual(fechas, [...fechas].sort().reverse());
    });

    it("separa la bandeja de liberación", async () => {
      const { service } = setupBandejas();
      const bandeja = await service.listReleaseQueue(IDENTITY);
      assert.deepEqual(
        bandeja.map((s) => s.sessionCode),
        ["KCM-C"],
      );
    });

    it("un capacitador sólo ve las sesiones que él creó", async () => {
      const repo = new MemoryPreReleaseRepository({
        sessions: [
          makeSession({ sessionId: "ses-propia", sessionCode: "KCM-PROPIA", createdBy: "CAP_UNO" }),
          makeSession({ sessionId: "ses-ajena", sessionCode: "KCM-AJENA", createdBy: "CAP_DOS" }),
        ],
        attendances: [],
        employees: [],
      });
      const service = new WorkbenchService({ repository: repo, clock: testClock });

      const bandeja = await service.listEditableSessions({
        actor: "CAP_UNO",
        role: "CAPACITADOR",
      });
      assert.deepEqual(
        bandeja.map((s) => s.sessionCode),
        ["KCM-PROPIA"],
      );
    });

    it("el encabezado no arrastra el padrón, sólo sus conteos", async () => {
      const { service } = setupBandejas();
      const [primera] = await service.listEditableSessions(IDENTITY);
      assert.ok(primera);
      assert.equal(typeof primera.attendanceCount, "number");
      assert.ok(!("roster" in primera));
    });
  });

  describe("openForStage", () => {
    it("abre editable una sesión revisable", async () => {
      const { service } = setupWorkbench();
      const estado = await service.openForStage("ses-001");
      assert.notEqual(estado.editable, false);
    });

    it("abre en sólo lectura una sesión ya en bandeja de liberación", async () => {
      const { service } = setupWorkbench({ session: { status: "LISTA_PARA_LIBERAR" } });
      const estado = await service.openForStage("ses-001");
      assert.equal(estado.editable, false);
      assert.equal(estado.releaseAvailable, false);
    });

    it("rechaza una etapa que no es ni revisable ni bandeja", async () => {
      const { service } = setupWorkbench({ session: { status: "ABIERTA" } });
      await assert.rejects(() => service.openForStage("ses-001"), InvalidPreReleaseStateError);
    });

    it("rechaza una sesión que no existe", async () => {
      const { service } = setupWorkbench();
      await assert.rejects(() => service.openForStage("ses-inexistente"), PreReleaseNotFoundError);
    });
  });

  describe("alternativas de examen visibles", () => {
    it("ofrece exactamente tres, y ninguna es EXAMEN_PENDIENTE", async () => {
      const { service } = setupWorkbench();
      const estado = await service.open("ses-001");

      assert.deepEqual(
        estado.examOutcomes.map((o) => o.code),
        ["EXAMEN_CONFIRMADO", "EXAMEN_REPROBADO", "EXAMEN_NO_ENCONTRADO"],
      );
    });

    it("cada alternativa lleva su etiqueta legible", async () => {
      const { service } = setupWorkbench();
      const estado = await service.open("ses-001");

      assert.deepEqual(
        estado.examOutcomes.map((o) => o.label),
        ["Aprobado", "Reprobado", "No entregado"],
      );
    });

    it("rechaza que la revisión mande EXAMEN_PENDIENTE", async () => {
      const { service } = setupWorkbench();
      await assert.rejects(
        () =>
          service.save(
            {
              sessionId: "ses-001",
              requestId: "req-pendiente",
              examOutcomes: [{ employeeId: "10001", examStatus: "EXAMEN_PENDIENTE" }],
              exclusions: [],
              findings: [],
              comments: "",
            },
            IDENTITY,
          ),
        PreReleaseInputError,
      );
    });

    it("un examen sin clasificar se muestra como aprobado pero no vuelve elegible", async () => {
      const { service } = setupWorkbench();
      const estado = await service.open("ses-001");
      const fila = estado.roster[0];

      assert.ok(fila);
      assert.equal(fila.examStatus, "EXAMEN_CONFIRMADO");
      assert.equal(fila.examDefaulted, true);
      assert.equal(fila.eligible, false);
    });
  });
});
