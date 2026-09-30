import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryPreReleaseRepository } from "../../src/adapters/memoria/preliberacion.ts";
import { WorkbenchService } from "../../src/domain/preliberacion/banco-de-trabajo.ts";
import { PreReleaseReportService } from "../../src/domain/preliberacion/reporte.ts";
import { PreReleaseInputError } from "../../src/domain/preliberacion/errores.ts";
import type {
  ActorIdentity,
  AttendanceRecord,
  SessionRecord,
} from "../../src/domain/quiosco/tipos.ts";
import type { WorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { EmployeeInfo } from "../../src/domain/preliberacion/tipos.ts";

const FIXED_DATE = new Date("2026-08-03T10:00:00.000Z");
const testClock = { now: () => FIXED_DATE, nowIso: () => FIXED_DATE.toISOString() };
const IDENTITY: ActorIdentity = { actor: "REVISOR_TEST", role: "CAPACITACION" };

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "ses-001",
    sessionCode: "KCM-260803-ABC123",
    trainingId: "CAP-SINT-001",
    instructor: "CAPACITADOR SINTÉTICO",
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
    attendanceProven: true,
    examStatus: "EXAMEN_CONFIRMADO",
    status: "COTEJADA",
    excludedFromRelease: false,
    released: false,
    createdAt: "2026-08-03T09:00:00Z",
    updatedAt: "2026-08-03T09:00:00Z",
    version: 1,
    ...overrides,
  };
}

function makeEmployee(id: string, name = `EMPLEADO SINTÉTICO ${id}`): EmployeeInfo {
  return {
    employeeId: id,
    displayName: name,
    area: "PRODUCCION",
    position: "*OPERARIO 1°",
    active: true,
  };
}

function setup(opts: { session?: Partial<SessionRecord>; attendances?: AttendanceRecord[] } = {}) {
  const session = makeSession(opts.session);
  const repo = new MemoryPreReleaseRepository({
    sessions: [session],
    attendances: opts.attendances ?? [
      makeAttendance({ workerNumber: "10001" as WorkerNumber }),
      makeAttendance({ attendanceId: "att-10002", workerNumber: "10002" as WorkerNumber }),
    ],
    employees: [makeEmployee("10001"), makeEmployee("10002"), makeEmployee("10003")],
  });
  const workbench = new WorkbenchService({ repository: repo, clock: testClock });
  const service = new PreReleaseReportService({ repository: repo, workbench, clock: testClock });
  return { repo, workbench, service };
}

function assertEsPdf(bytes: Uint8Array): void {
  const texto = Buffer.from(bytes).toString("latin1");
  assert.ok(texto.startsWith("%PDF-1.4"), "el archivo debe empezar con la firma PDF");
  assert.ok(texto.trimEnd().endsWith("%%EOF"), "el archivo debe cerrar con %%EOF");
  assert.match(texto, /\/Type \/Catalog/, "debe declarar su catálogo");
  assert.match(texto, /startxref/, "debe declarar la tabla de referencias cruzadas");
}

describe("Reporte de preliberación — composición", () => {
  it("produce un PDF bien formado con el padrón de la sesión", async () => {
    const { service } = setup();
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    assertEsPdf(reporte.content);
    assert.equal(reporte.byteSize, reporte.content.byteLength);
    assert.equal(reporte.sessionCode, "KCM-260803-ABC123");
    assert.match(reporte.fileName, /^Preliberacion-KCM-260803-ABC123-\d{8}-\d{4}\.pdf$/);
  });

  it("emite el talón de sesión concluida cuando no hay hallazgos", async () => {
    const { service } = setup();
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    assert.equal(reporte.clean, true);
    assert.deepEqual(reporte.findings, []);
    const texto = Buffer.from(reporte.content).toString("latin1");
    assert.match(texto, /Tal\\363n de sesi\\363n concluida/);
  });

  it("lleva el logotipo de la empresa aunque no exista referencias/privado", async () => {
    const { repo, workbench } = setup();
    const service = new PreReleaseReportService({
      repository: repo,
      workbench,
      clock: testClock,
      projectRoot: "/ruta/que/no/existe",
    });
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    const texto = Buffer.from(reporte.content).toString("latin1");
    assert.match(texto, /\/Subtype \/Image/, "el talón debe llevar el logotipo");
  });

  it("emite el acta de hallazgos cuando la revisión encontró algo", async () => {
    const { service } = setup({
      attendances: [
        makeAttendance({ workerNumber: "10001" as WorkerNumber }),
        makeAttendance({
          attendanceId: "att-10002",
          workerNumber: "10002" as WorkerNumber,
          examStatus: "EXAMEN_NO_ENCONTRADO",
        }),
      ],
    });

    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    assert.equal(reporte.clean, false);
    assert.ok(reporte.findings.includes("EXAMENES_FALTANTES"));
    const texto = Buffer.from(reporte.content).toString("latin1");
    assert.match(texto, /Acta de hallazgos de preliberaci\\363n/);
    assert.match(texto, /Ex\\341menes faltantes/);
    assert.doesNotMatch(texto, /EXAMENES_FALTANTES/);
  });

  it("no lleva banda, recuadros de contadores ni firmas", async () => {
    const { service } = setup();
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );
    const texto = Buffer.from(reporte.content).toString("latin1");

    for (const retirado of [
      /APTA PARA LIBERACI/,
      /REVISI\\323N REQUERIDA/,
      /REGISTRADOS/,
      /APROBADOS/,
      /SIN ENTREGAR/,
      /A LIBERAR\)/,
      /REVISOR/,
    ]) {
      assert.doesNotMatch(texto, retirado, `el reporte conserva ${String(retirado)}`);
    }

    const encabezado = texto.indexOf("DATOS GENERALES DE LA SESI");
    const detalle = texto.indexOf("DETALLE DE LA SESI");
    assert.ok(encabezado > 0 && detalle > encabezado, "encabezado arriba, detalle abajo");
    assert.match(texto, /Type \/Pages \/Count 1/);
  });

  it("lleva los contadores de la revisión, no un recuento propio", async () => {
    const { service, workbench } = setup();
    const estado = await workbench.open("ses-001");
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    assert.deepEqual(reporte.counters, estado.counters);
  });

  it("pagina el padrón cuando no cabe en una hoja", async () => {
    const attendances = Array.from({ length: 40 }, (_, i) =>
      makeAttendance({
        attendanceId: `att-${11000 + i}`,
        workerNumber: String(11000 + i) as WorkerNumber,
      }),
    );
    const { service } = setup({ attendances });
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    const texto = Buffer.from(reporte.content).toString("latin1");
    const paginas = texto.match(/\/Type \/Page[^s]/g) ?? [];
    assert.ok(paginas.length > 1, "40 renglones deben desbordar a una segunda hoja");
    assert.match(texto, /P\\341gina 1 de/);
  });

  it("compone el mismo archivo byte por byte para el mismo estado", async () => {
    const { service } = setup();
    const primero = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );
    const segundo = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    assert.equal(primero.sha256, segundo.sha256);
    assert.deepEqual(Buffer.from(primero.content), Buffer.from(segundo.content));
  });

  it("cambia el archivo cuando cambia el padrón", async () => {
    const { service, workbench } = setup();
    const antes = await service.generate({ sessionId: "ses-001", mode: "VISTA_PREVIA" }, IDENTITY);

    await workbench.save(
      {
        sessionId: "ses-001",
        requestId: "req-cambio",
        examOutcomes: [{ employeeId: "10002", examStatus: "EXAMEN_REPROBADO" }],
        exclusions: [],
        findings: [],
        comments: "",
      },
      IDENTITY,
    );

    const despues = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );
    assert.notEqual(antes.sha256, despues.sha256);
  });

  it("no rompe el archivo con un comentario que trae acentos y paréntesis", async () => {
    const { service, workbench } = setup();
    await workbench.save(
      {
        sessionId: "ses-001",
        requestId: "req-comentario",
        examOutcomes: [],
        exclusions: [],
        findings: [],
        comments: "Revisión con acentos (y paréntesis) \\ además de una barra invertida.",
      },
      IDENTITY,
    );

    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );
    assertEsPdf(reporte.content);
  });
});

describe("Reporte de preliberación — vista previa sin efectos", () => {
  it("no archiva evidencia", async () => {
    const { service, repo } = setup();
    const reporte = await service.generate(
      { sessionId: "ses-001", mode: "VISTA_PREVIA" },
      IDENTITY,
    );

    assert.equal(reporte.archived, false);
    assert.equal(reporte.evidenceId, "");
    assert.deepEqual(await repo.listReportsBySession("ses-001"), []);
  });

  it("no deja asiento de auditoría", async () => {
    const { service, repo } = setup();
    await service.generate({ sessionId: "ses-001", mode: "VISTA_PREVIA" }, IDENTITY);

    const asientos = repo.getAllAudits();
    assert.equal(asientos.length, 0);
  });

  it("no cambia la etapa de la sesión", async () => {
    const { service, repo } = setup();
    await service.generate({ sessionId: "ses-001", mode: "VISTA_PREVIA" }, IDENTITY);

    const sesion = await repo.getSessionById("ses-001");
    assert.equal(sesion?.status, "CERRADA");
  });

  it("se puede pedir muchas veces sin acumular nada", async () => {
    const { service, repo } = setup();
    for (let i = 0; i < 5; i += 1) {
      await service.generate({ sessionId: "ses-001", mode: "VISTA_PREVIA" }, IDENTITY);
    }

    assert.deepEqual(await repo.listReportsBySession("ses-001"), []);
    assert.equal(repo.getAllAudits().length, 0);
  });

  it("rechaza un modo que no existe", async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.generate({ sessionId: "ses-001", mode: "OTRO" as never }, IDENTITY),
      PreReleaseInputError,
    );
  });

  it("rechaza una sesión que no está en etapa revisable", async () => {
    const { service } = setup({ session: { status: "ABIERTA" } });
    await assert.rejects(() =>
      service.generate({ sessionId: "ses-001", mode: "VISTA_PREVIA" }, IDENTITY),
    );
  });
});

describe("Reporte de preliberación — archivado y búsqueda en auditoría", () => {
  it("archiva el PDF como evidencia inmutable con su huella", async () => {
    const { service, repo } = setup();
    const reporte = await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    assert.equal(reporte.archived, true);
    assert.notEqual(reporte.evidenceId, "");

    const archivados = await repo.listReportsBySession("ses-001");
    assert.equal(archivados.length, 1);
    const evidencia = archivados[0]!;
    assert.equal(evidencia.kind, "REPORTE_PRELIBERACION");
    assert.equal(evidencia.mimeType, "application/pdf");
    assert.equal(evidencia.immutable, true);
    assert.equal(evidencia.sha256, reporte.sha256);
    assert.equal(evidencia.byteSize, reporte.byteSize);
    assert.equal(evidencia.createdBy, "REVISOR_TEST");
  });

  it("deja el archivado asentado en auditoría con su procedencia", async () => {
    const { service, repo } = setup();
    const reporte = await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    const asiento = repo.getAllAudits().find((a) => a.action === "PRERELEASE_REPORT_ARCHIVED");

    assert.ok(asiento, "el archivado debe quedar asentado");
    assert.equal(asiento.entityId, reporte.evidenceId);
    assert.equal(asiento.entityType, "Evidence");
    assert.equal(asiento.sessionId, "ses-001");
    assert.equal(asiento.actor, "REVISOR_TEST");
    assert.equal(asiento.provenance, "PLATAFORMA");
    assert.equal(asiento.newState, "SIN_HALLAZGOS");
  });

  it("conserva los bytes exactos que se archivaron", async () => {
    const { service } = setup();
    const reporte = await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    const recuperado = await service.content(reporte.evidenceId);
    assert.ok(recuperado);
    assert.deepEqual(Buffer.from(recuperado.content), Buffer.from(reporte.content));
    assert.equal(recuperado.record.sha256, reporte.sha256);
  });

  it("es buscable por sesión, del más reciente al más antiguo", async () => {
    const { service, repo } = setup();
    await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    const despues = new Date(FIXED_DATE.getTime() + 60_000);
    const workbench = new WorkbenchService({
      repository: repo,
      clock: { now: () => despues, nowIso: () => despues.toISOString() },
    });
    const servicioTardio = new PreReleaseReportService({
      repository: repo,
      workbench,
      clock: { now: () => despues, nowIso: () => despues.toISOString() },
    });
    await servicioTardio.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    const archivados = await service.bySession("ses-001");
    assert.equal(archivados.length, 2);
    assert.ok(archivados[0]!.createdAt >= archivados[1]!.createdAt, "el más reciente va primero");
  });

  it("no mezcla los reportes de una sesión con los de otra", async () => {
    const { service, repo } = setup();
    await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    assert.deepEqual(await service.bySession("ses-999"), []);
    assert.equal((await repo.listReportsBySession("ses-001")).length, 1);
  });

  it("archivar dos veces conserva ambos hechos, sin sobrescribir el primero", async () => {
    const { service } = setup();
    const primero = await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);
    const segundo = await service.generate({ sessionId: "ses-001", mode: "ARCHIVO" }, IDENTITY);

    assert.notEqual(primero.evidenceId, segundo.evidenceId);
    assert.equal((await service.bySession("ses-001")).length, 2);
  });

  it("devuelve nada para una evidencia que no existe", async () => {
    const { service } = setup();
    assert.equal(await service.content("evidencia-inexistente"), null);
  });

  it("exige el identificador de la sesión para buscar", async () => {
    const { service } = setup();
    await assert.rejects(() => service.bySession("  "), PreReleaseInputError);
  });
});
