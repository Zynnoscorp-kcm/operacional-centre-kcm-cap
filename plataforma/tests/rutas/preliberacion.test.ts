/**
 * Pruebas de integración HTTP de Preliberación (Función 4).
 *
 * Cubren lo que sólo se ve al final del camino: que la pantalla se rinda con el
 * padrón, que los formularios lleguen al dominio y vuelvan por redirección, y
 * que el PDF salga por HTTP con su tipo y su nombre.
 *
 * Importa que estas pruebas usen formularios y no JSON: la política de contenido
 * de la plataforma prohíbe scripts, así que el formulario es el único camino real
 * de la pantalla, y probar sólo el JSON dejaría sin cubrir el que usa la gente.
 *
 * Ninguna identidad es real.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryPreReleaseRepository } from "../../src/adapters/memoria/preliberacion.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { buildServer } from "../../src/server/build-server.ts";
import type { AttendanceRecord, SessionRecord } from "../../src/domain/quiosco/tipos.ts";
import type { WorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { EmployeeInfo } from "../../src/domain/preliberacion/tipos.ts";

const FIXED_DATE = new Date("2026-08-03T12:00:00.000Z");
const clock = { now: () => FIXED_DATE, nowIso: () => FIXED_DATE.toISOString() };

const FORMULARIO = { "content-type": "application/x-www-form-urlencoded" };
const NAVEGADOR = { accept: "text/html,application/xhtml+xml" };

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

function makeEmployee(id: string, name = `EMPLEADO SINTÉTICO ${id}`): EmployeeInfo {
  return {
    employeeId: id,
    displayName: name,
    area: "PRODUCCION",
    position: "*OPERARIO 1°",
    active: true,
  };
}

describe("Rutas HTTP de Preliberación", () => {
  const config = loadConfig({
    KCM_ENV: "development",
    KCM_PORT: "8788",
    KCM_PILOT_OPEN_ACCESS: "true",
  });

  async function createTestApp(
    opts: {
      sessions?: SessionRecord[];
      attendances?: AttendanceRecord[];
    } = {},
  ) {
    const preReleaseRepository = new MemoryPreReleaseRepository({
      sessions: opts.sessions ?? [makeSession()],
      attendances: opts.attendances ?? [
        makeAttendance({ workerNumber: "10001" as WorkerNumber }),
        makeAttendance({ attendanceId: "att-10002", workerNumber: "10002" as WorkerNumber }),
      ],
      employees: [makeEmployee("10001"), makeEmployee("10002"), makeEmployee("10003")],
    });

    const app = await buildServer({ config, clock, preReleaseRepository });
    return { app, repo: preReleaseRepository };
  }

  // -----------------------------------------------------------------------
  // Pantallas
  // -----------------------------------------------------------------------

  it("GET /preliberacion lista las sesiones revisables con las cabeceras de seguridad", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "GET", url: "/preliberacion" });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"));
    assert.ok(res.headers["content-security-policy"]?.includes("default-src 'none'"));
    assert.ok(res.body.includes("KCM-260803-ABC123"));
    assert.ok(res.body.includes("Sesiones en revisión"));
  });

  it("GET /preliberacion separa la bandeja de liberación de las revisables", async () => {
    const { app } = await createTestApp({
      sessions: [
        makeSession(),
        makeSession({
          sessionId: "ses-002",
          sessionCode: "KCM-260803-LISTA1",
          status: "LISTA_PARA_LIBERAR",
        }),
      ],
    });

    const res = await app.inject({ method: "GET", url: "/api/pre-release/sessions" });
    const cuerpo = res.json<{
      revisables: { sessionCode: string }[];
      releaseQueue: { sessionCode: string }[];
    }>();

    assert.deepEqual(
      cuerpo.revisables.map((s) => s.sessionCode),
      ["KCM-260803-ABC123"],
    );
    assert.deepEqual(
      cuerpo.releaseQueue.map((s) => s.sessionCode),
      ["KCM-260803-LISTA1"],
    );
  });

  it("GET /preliberacion/:id rinde el padrón con las tres alternativas de examen y ninguna más", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes("10001"));
    assert.ok(res.body.includes("EMPLEADO SINTÉTICO 10001"));

    for (const alternativa of ["EXAMEN_CONFIRMADO", "EXAMEN_REPROBADO", "EXAMEN_NO_ENCONTRADO"]) {
      assert.ok(res.body.includes(`value="${alternativa}"`), `falta ${alternativa}`);
    }
    assert.ok(
      !res.body.includes('value="EXAMEN_PENDIENTE"'),
      "EXAMEN_PENDIENTE no es una alternativa que el revisor pueda escoger",
    );
  });

  it("GET /preliberacion/:id no trae scripts, porque la política los prohíbe", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });

    assert.ok(!/<script/i.test(res.body), "la pantalla no debe traer scripts");
    assert.ok(!/ on[a-z]+=/i.test(res.body), "no debe traer manejadores en atributos");
  });

  it("GET /preliberacion/:id abre en sólo lectura una sesión ya en bandeja de liberación", async () => {
    const { app } = await createTestApp({
      sessions: [makeSession({ status: "LISTA_PARA_LIBERAR", authorized: true })],
    });
    const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes("Sólo lectura"));
    assert.ok(!res.body.includes("Guardar revisión"));
  });

  it("GET /preliberacion/:id de una sesión inexistente responde 404", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/preliberacion/ses-inexistente",
      headers: NAVEGADOR,
    });

    assert.equal(res.statusCode, 404);
  });

  // -----------------------------------------------------------------------
  // Formularios
  // -----------------------------------------------------------------------

  it("POST /api/pre-release/save acepta el formulario del padrón y redirige de vuelta", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: { ...FORMULARIO, ...NAVEGADOR },
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-form-001",
        examen__10001: "EXAMEN_CONFIRMADO",
        examen__10002: "EXAMEN_REPROBADO",
        motivo__10001: "",
        motivo__10002: "",
        comments: "Cotejo de la lista física sin novedad.",
      }).toString(),
    });

    assert.equal(res.statusCode, 303);
    assert.ok(res.headers["location"]?.startsWith("/preliberacion/ses-001?aviso="));

    const revision = repo.getReview("ses-001");
    assert.equal(revision?.comments, "Cotejo de la lista física sin novedad.");
    assert.equal(repo.getAttendance("att-10002")?.examStatus, "EXAMEN_REPROBADO");
  });

  it("POST /api/pre-release/save recoge las casillas repetidas de hallazgos declarados", async () => {
    const { app, repo } = await createTestApp();
    const cuerpo = new URLSearchParams({
      sessionId: "ses-001",
      requestId: "req-form-002",
      examen__10001: "EXAMEN_CONFIRMADO",
      examen__10002: "EXAMEN_CONFIRMADO",
      comments: "",
    });
    cuerpo.append("hallazgo", "FIRMA_INSTRUCTOR_FALTANTE");
    cuerpo.append("hallazgo", "LISTA_FISICA_ILEGIBLE");

    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: { ...FORMULARIO, ...NAVEGADOR },
      payload: cuerpo.toString(),
    });

    assert.equal(res.statusCode, 303);
    const hallazgos = JSON.parse(repo.getReview("ses-001")?.findings ?? "[]") as string[];
    assert.ok(hallazgos.includes("FIRMA_INSTRUCTOR_FALTANTE"));
    assert.ok(hallazgos.includes("LISTA_FISICA_ILEGIBLE"));
  });

  it("POST /api/pre-release/save traduce la casilla de exclusión con su motivo", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: { ...FORMULARIO, ...NAVEGADOR },
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-form-003",
        examen__10001: "EXAMEN_CONFIRMADO",
        examen__10002: "EXAMEN_CONFIRMADO",
        excluir__10002: "1",
        motivo__10002: "Se retiró antes de terminar",
        comments: "",
      }).toString(),
    });

    assert.equal(res.statusCode, 303);
    const asistencia = repo.getAttendance("att-10002");
    assert.equal(asistencia?.excludedFromRelease, true);
    assert.equal(asistencia?.exclusionReason, "Se retiró antes de terminar");
  });

  it("POST /api/pre-release/save rechaza excluir sin motivo, y no toca el padrón", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: FORMULARIO,
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-form-004",
        examen__10001: "EXAMEN_CONFIRMADO",
        examen__10002: "EXAMEN_CONFIRMADO",
        excluir__10002: "1",
        comments: "",
      }).toString(),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(repo.getAttendance("att-10002")?.excludedFromRelease, false);
  });

  it("POST /api/pre-release/save rechaza un resultado de examen fuera de las tres alternativas", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: FORMULARIO,
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-form-005",
        examen__10001: "EXAMEN_PENDIENTE",
        comments: "",
      }).toString(),
    });

    assert.equal(res.statusCode, 400);
  });

  it("POST /api/pre-release/add-worker da de alta por formulario y redirige", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/add-worker",
      headers: { ...FORMULARIO, ...NAVEGADOR },
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-alta-001",
        employeeId: "10003",
      }).toString(),
    });

    assert.equal(res.statusCode, 303);
    const asistencias = await repo.listAttendancesBySession("ses-001");
    assert.equal(asistencias.length, 3);
    assert.ok(asistencias.some((a) => String(a.workerNumber) === "10003"));
  });

  it("POST /api/pre-release/add-worker rechaza un número fuera del padrón activo", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/add-worker",
      headers: FORMULARIO,
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-alta-002",
        employeeId: "99999",
      }).toString(),
    });

    assert.equal(res.statusCode, 404);
    assert.equal((await repo.listAttendancesBySession("ses-001")).length, 2);
  });

  it("POST /api/pre-release/add-worker rechaza el alta duplicada con otra solicitud", async () => {
    const { app } = await createTestApp();
    const alta = (requestId: string) =>
      app.inject({
        method: "POST",
        url: "/api/pre-release/add-worker",
        headers: FORMULARIO,
        payload: new URLSearchParams({
          sessionId: "ses-001",
          requestId,
          employeeId: "10003",
        }).toString(),
      });

    assert.equal((await alta("req-alta-a")).statusCode, 200);
    const repetida = await alta("req-alta-b");
    assert.equal(repetida.statusCode, 409);
  });

  // -----------------------------------------------------------------------
  // Transiciones
  // -----------------------------------------------------------------------

  it("POST /api/pre-release/enter exige revisión guardada antes de cambiar de etapa", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/enter",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });

    assert.equal(res.statusCode, 409);
    assert.equal((await repo.getSessionById("ses-001"))?.status, "CERRADA");
  });

  /**
   * El atajo de la sesión limpia.
   *
   * Su seguridad no está en que la pantalla no dibuje el botón —una sesión puede
   * ensuciarse entre que se pinta y se pulsa, y un `POST` se puede repetir desde
   * el historial— sino en que el servidor vuelva a mirar los hallazgos antes de
   * liberar. Eso es lo que se fija aquí.
   */
  it("el atajo de liberar se niega en cuanto hay un hallazgo", async () => {
    const { app, repo } = await createTestApp({
      sessions: [makeSession({ authorized: true })],
    });

    // Un examen reprobado es un hallazgo derivado: la revisión no queda limpia.
    await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: FORMULARIO,
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-atajo-001",
        examen__10001: "EXAMEN_CONFIRMADO",
        examen__10002: "EXAMEN_REPROBADO",
        comments: "",
      }).toString(),
    });
    await app.inject({
      method: "POST",
      url: "/api/pre-release/enter",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });
    assert.equal((await repo.getSessionById("ses-001"))?.status, "PRELIBERACION");

    const atajo = await app.inject({
      method: "POST",
      url: "/api/pre-release/liberar",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });

    assert.equal(atajo.statusCode, 400);
    // Y lo que importa: la sesión no se movió ni un paso.
    assert.equal((await repo.getSessionById("ses-001"))?.status, "PRELIBERACION");
  });

  it("recorre guardar, entrar y pasar a liberación por formularios", async () => {
    const { app, repo } = await createTestApp({
      sessions: [makeSession({ authorized: true })],
    });

    const guardar = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: FORMULARIO,
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-flujo-001",
        examen__10001: "EXAMEN_CONFIRMADO",
        examen__10002: "EXAMEN_CONFIRMADO",
        comments: "",
      }).toString(),
    });
    assert.equal(guardar.statusCode, 200);
    // Guardar no mueve la etapa: eso es una confirmación aparte.
    assert.equal((await repo.getSessionById("ses-001"))?.status, "CERRADA");

    const entrar = await app.inject({
      method: "POST",
      url: "/api/pre-release/enter",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });
    assert.equal(entrar.statusCode, 200);
    assert.equal((await repo.getSessionById("ses-001"))?.status, "PRELIBERACION");

    const pasar = await app.inject({
      method: "POST",
      url: "/api/pre-release/submit",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });
    assert.equal(pasar.statusCode, 200);
    assert.equal((await repo.getSessionById("ses-001"))?.status, "LISTA_PARA_LIBERAR");

    const regresar = await app.inject({
      method: "POST",
      url: "/api/pre-release/return",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });
    assert.equal(regresar.statusCode, 200);
    assert.equal((await repo.getSessionById("ses-001"))?.status, "PRELIBERACION");
  });

  // -----------------------------------------------------------------------
  // Reporte
  // -----------------------------------------------------------------------

  it("GET /preliberacion/:id/reporte devuelve el PDF de vista previa sin archivar nada", async () => {
    const { app, repo } = await createTestApp();
    const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001/reporte" });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers["content-type"]?.includes("application/pdf"));
    assert.match(String(res.headers["content-disposition"]), /inline; filename="Preliberacion-/);
    assert.ok(res.rawPayload.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));

    assert.deepEqual(await repo.listReportsBySession("ses-001"), []);
    assert.equal(repo.getAllAudits().length, 0);
  });

  it("POST /api/pre-release/report archiva y deja el reporte buscable por sesión", async () => {
    const { app } = await createTestApp();
    const archivar = await app.inject({
      method: "POST",
      url: "/api/pre-release/report",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });

    assert.equal(archivar.statusCode, 200);
    const resumen = archivar.json<{ evidenceId: string; archived: boolean; content?: unknown }>();
    assert.equal(resumen.archived, true);
    // El JSON no arrastra los bytes: se piden por la evidencia.
    assert.equal(resumen.content, undefined);

    const busqueda = await app.inject({ method: "GET", url: "/api/pre-release/report/ses-001" });
    const { reports } = busqueda.json<{ reports: { evidenceId: string; sha256: string }[] }>();
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.evidenceId, resumen.evidenceId);

    const descarga = await app.inject({
      method: "GET",
      url: `/preliberacion/reporte/${resumen.evidenceId}`,
    });
    assert.equal(descarga.statusCode, 200);
    assert.ok(descarga.headers["content-type"]?.includes("application/pdf"));
    assert.ok(descarga.rawPayload.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
  });

  it("GET /preliberacion/reporte/:evidencia responde 404 si la evidencia no existe", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/preliberacion/reporte/evidencia-inexistente",
      headers: NAVEGADOR,
    });

    assert.equal(res.statusCode, 404);
  });

  it("la pantalla muestra el reporte archivado con su huella recortada", async () => {
    const { app } = await createTestApp();
    await app.inject({
      method: "POST",
      url: "/api/pre-release/report",
      headers: FORMULARIO,
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });

    const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });
    assert.ok(res.body.includes("Reportes archivados"));
    assert.ok(res.body.includes("Preliberacion-KCM-260803-ABC123"));
  });

  // -----------------------------------------------------------------------
  // Privacidad
  // -----------------------------------------------------------------------

  it("la bandeja no expone identidades: sólo encabezados de sesión", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "GET", url: "/preliberacion" });

    assert.ok(!res.body.includes("EMPLEADO SINTÉTICO"), "la lista inicial no lleva padrón");
    assert.ok(!res.body.includes("10001"), "la lista inicial no lleva números de nómina");
  });

  it("ninguna respuesta se guarda en caché", async () => {
    const { app } = await createTestApp();
    for (const url of [
      "/preliberacion",
      "/preliberacion/ses-001",
      "/preliberacion/ses-001/reporte",
    ]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.headers["cache-control"], "no-store", url);
    }
  });

  // -----------------------------------------------------------------------
  // Lo que el revisor ve antes de guardar
  // -----------------------------------------------------------------------

  describe("el banco de trabajo recién abierto", () => {
    it("marca las filas como pendientes, no como excluidas", async () => {
      const { app } = await createTestApp({ sessions: [makeSession({ authorized: true })] });
      const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });

      assert.equal(res.statusCode, 200);
      assert.match(res.body, />Pendiente</u);
      assert.equal(
        res.body.includes(">Excluido<"),
        false,
        "nadie fue excluido todavía: decirlo acusa de algo que no pasó",
      );
    });

    it("no ofrece entrar a preliberación mientras no haya revisión guardada", async () => {
      const { app } = await createTestApp();
      const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });

      assert.equal(res.body.includes("/api/pre-release/enter"), false);
      assert.match(res.body, /Requiere la revisión guardada/u);
    });

    it("ofrece el paso en cuanto la revisión existe", async () => {
      const { app } = await createTestApp();
      await app.inject({
        method: "POST",
        url: "/api/pre-release/save",
        headers: { ...FORMULARIO, ...NAVEGADOR },
        payload: new URLSearchParams({
          sessionId: "ses-001",
          requestId: "req-save-vista",
          examen__10001: "EXAMEN_CONFIRMADO",
          examen__10002: "EXAMEN_CONFIRMADO",
        }).toString(),
      });

      const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });
      assert.match(res.body, /\/api\/pre-release\/enter/u);
    });

    /**
     * Un motivo real manda sobre lo provisional: quien está excluido se ve
     * excluido aunque su examen siga en el valor por omisión.
     */
    it("una fila con motivo de bloqueo sí se ve excluida", async () => {
      const { app } = await createTestApp({
        sessions: [makeSession({ authorized: true })],
        attendances: [
          makeAttendance({ workerNumber: "10001" as WorkerNumber, excludedFromRelease: true }),
        ],
      });
      const res = await app.inject({ method: "GET", url: "/preliberacion/ses-001" });

      assert.match(res.body, />Excluido</u);
      assert.match(res.body, /EXCLUIDO_EN_REVISION/u);
    });
  });

  // -----------------------------------------------------------------------
  // Transiciones rechazadas
  // -----------------------------------------------------------------------

  describe("una transición que el dominio rechaza", () => {
    /**
     * El orden lo impone el servidor —guardar, entrar, pasar— y antes el rechazo
     * salía como página de error en JSON: el revisor perdía el padrón y el texto
     * que le decía qué le faltaba quedaba enterrado en un cuerpo crudo.
     */
    it("desde la pantalla vuelve al banco con el motivo escrito", async () => {
      const { app } = await createTestApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/pre-release/enter",
        headers: { ...FORMULARIO, ...NAVEGADOR },
        payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
      });

      assert.equal(res.statusCode, 303);
      const destino = String(res.headers.location);
      assert.match(destino, /^\/preliberacion\/ses-001\?aviso=/u);
      assert.match(decodeURIComponent(destino), /La revisión tiene que guardarse/u);
    });

    it("pasar a liberación sin haber entrado también explica qué falta", async () => {
      const { app } = await createTestApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/pre-release/submit",
        headers: { ...FORMULARIO, ...NAVEGADOR },
        payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
      });

      assert.equal(res.statusCode, 303);
      assert.match(decodeURIComponent(String(res.headers.location)), /cotejo de preliberación/u);
    });

    it("por JSON el rechazo sigue siendo un error con su código, no una redirección", async () => {
      const { app } = await createTestApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/pre-release/enter",
        payload: { sessionId: "ses-001" },
      });

      assert.equal(res.statusCode, 409);
      assert.match(res.body, /ESTADO_PRELIBERACION_INVALIDO|CONFLICTO/u);
    });
  });

  it("desde la pantalla redirige a Liberación cuando la sesión queda lista", async () => {
    const { app, repo } = await createTestApp({ sessions: [makeSession({ authorized: true })] });
    await repo.updateSessionStatus("ses-001", "PRELIBERACION");
    await repo.upsertReview({
      revisionId: "rev-redireccion-liberacion",
      sessionId: "ses-001",
      requestId: "req-redireccion-liberacion",
      expectedExams: 2,
      receivedExams: 2,
      approvedExams: 2,
      failedExams: 0,
      missingExams: 0,
      extraExams: 0,
      findings: "[]",
      excludedCount: 0,
      status: "SIN_HALLAZGOS",
      reportEvidenceId: "",
      reviewedAt: FIXED_DATE.toISOString(),
      reviewedBy: "USUARIO_CAPACITACION",
      comments: "",
      updatedAt: FIXED_DATE.toISOString(),
    });
    await repo.updateAttendance("att-10001", {
      attendanceProven: true,
      examStatus: "EXAMEN_CONFIRMADO",
    });
    await repo.updateAttendance("att-10002", {
      attendanceProven: true,
      examStatus: "EXAMEN_CONFIRMADO",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/pre-release/submit",
      headers: { ...FORMULARIO, ...NAVEGADOR },
      payload: new URLSearchParams({ sessionId: "ses-001" }).toString(),
    });

    assert.equal(res.statusCode, 303);
    assert.match(String(res.headers.location), /^\/liberacion\?aviso=/u);
    await app.close();
  });

  // -----------------------------------------------------------------------
  // El camino completo
  // -----------------------------------------------------------------------

  it("guardar, entrar y pasar a liberación deja la sesión en la bandeja", async () => {
    const { app } = await createTestApp({
      sessions: [makeSession({ authorized: true })],
      attendances: [makeAttendance({ workerNumber: "10001" as WorkerNumber })],
    });

    const guardar = await app.inject({
      method: "POST",
      url: "/api/pre-release/save",
      headers: FORMULARIO,
      payload: new URLSearchParams({
        sessionId: "ses-001",
        requestId: "req-save-camino",
        examen__10001: "EXAMEN_CONFIRMADO",
      }).toString(),
    });
    assert.equal(guardar.statusCode, 200);

    const entrar = await app.inject({
      method: "POST",
      url: "/api/pre-release/enter",
      payload: { sessionId: "ses-001" },
    });
    assert.equal(entrar.statusCode, 200);

    const pasar = await app.inject({
      method: "POST",
      url: "/api/pre-release/submit",
      payload: { sessionId: "ses-001" },
    });
    assert.equal(pasar.statusCode, 200);

    const estado = pasar.json<{
      session: { status: string };
      roster: { eligible: boolean; blockingReasons: string[] }[];
    }>();
    assert.equal(estado.session.status, "LISTA_PARA_LIBERAR");
    assert.equal(estado.roster[0]?.eligible, true);
    assert.deepEqual(estado.roster[0]?.blockingReasons, []);
  });
});
