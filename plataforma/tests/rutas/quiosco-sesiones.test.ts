/**
 * Pruebas de integración HTTP para rutas de Quiosco y Sesiones (Funciones 1, 2 y 3).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import { buildServer } from "../../src/server/build-server.ts";

const FIXED_DATE = new Date("2026-08-03T12:00:00.000Z");
const clock = { now: () => FIXED_DATE, nowIso: () => FIXED_DATE.toISOString() };

/** Cookie de consola: `/sesiones` y `/api/sessions` viven detrás del guardia. */
async function cookieDeConsola(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/acceso",
    payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return String(res.headers["set-cookie"] ?? "").split(";")[0] ?? "";
}

describe("Rutas HTTP de Quiosco y Sesiones", () => {
  const config = loadConfig({
    KCM_ENV: "development",
    KCM_PORT: "8787",
    KCM_PILOT_SESSION_PIN: "8765",
    // Sin acceso abierto: esa bandera apaga la comprobación de PIN del quiosco,
    // que es justo lo que estas pruebas fijan. Para las pantallas que el
    // guardia cierra se entra con credencial, como entraría una persona.
    KCM_PILOT_CONSOLE_USER: "Maricela0000",
    KCM_PILOT_CONSOLE_PASSWORD: "0000",
  });

  async function createTestApp() {
    const kioskSessionRepository = new MemoryKioskSessionRepository({
      activeWorkers: [parseWorkerNumber("12345"), parseWorkerNumber("54321")],
      secrets: {
        REGISTRO_QUIOSCO: "4321",
        APERTURA_SESION: "8765",
      },
    });

    const app = await buildServer({
      config,
      clock,
      kioskSessionRepository,
      kioskTokenSecret: "test-secret-long-enough-32-chars!!",
    });

    return { app, repo: kioskSessionRepository };
  }

  it("GET /quiosco responde HTML con las cabeceras de seguridad y sin scripts externos", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/quiosco",
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"));
    assert.ok(res.body.includes("Registro de capacitación"));
    assert.ok(res.body.includes("Registro de asistencia"));
    assert.ok(res.headers["content-security-policy"]?.includes("default-src 'none'"));

    // Es una pantalla externa: corre en la computadora de la sala y no debe
    // arrastrar la navegación de la consola central.
    assert.equal(res.body.includes('class="lateral"'), false, "el quiosco no lleva menú lateral");
    assert.equal(res.body.includes("Preliberación"), false, "el quiosco no navega a la consola");
  });

  it("POST /api/kiosk/unlock desbloquea la estación con el PIN de quiosco correcto (Secret 1)", async () => {
    const { app } = await createTestApp();

    // PIN incorrecto
    const resFail = await app.inject({
      method: "POST",
      url: "/api/kiosk/unlock",
      payload: { pin: "9999" },
    });
    assert.equal(resFail.statusCode, 400);

    // PIN correcto
    const resOk = await app.inject({
      method: "POST",
      url: "/api/kiosk/unlock",
      payload: { pin: "4321", stationLabel: "SALA-B" },
    });
    assert.equal(resOk.statusCode, 200);
    const body = JSON.parse(resOk.body);
    assert.equal(body.success, true);
    assert.ok(body.grant);
  });

  it("POST /api/kiosk/launch con un curso fuera del catálogo pide elegir de la lista", async () => {
    const { app } = await createTestApp();
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/kiosk/launch",
      payload: {
        pin: "8765",
        trainingId: "CURSO-INEXISTENTE",
        instructor: "INSTRUCTOR_SALA",
        date: "2026-08-03",
        durationMinutes: 60,
      },
    });
    assert.equal(respuesta.statusCode, 400);
    assert.match(respuesta.body, /Seleccione un nombre válido de la lista\./u);
  });

  it("POST /api/kiosk/launch crea la sesión pero la deja esperando autorización", async () => {
    const { app } = await createTestApp();

    // Intento con PIN de quiosco (Secret 1) debe fallar para lanzar sesión
    const resFail = await app.inject({
      method: "POST",
      url: "/api/kiosk/launch",
      payload: {
        pin: "4321",
        trainingId: "CAP-SINT-001",
        instructor: "INSTRUCTOR_SALA",
      },
    });
    assert.equal(resFail.statusCode, 400);

    // Con PIN de apertura (Secret 2)
    const resOk = await app.inject({
      method: "POST",
      url: "/api/kiosk/launch",
      payload: {
        pin: "8765",
        trainingId: "CAP-SINT-001",
        instructor: "INSTRUCTOR_SALA",
        date: "2026-08-03",
        durationMinutes: 90,
        stationLabel: "ESTACION-SALA-B",
      },
    });

    assert.equal(resOk.statusCode, 200);
    const body = JSON.parse(resOk.body);
    assert.equal(body.success, true);
    // La sala levanta la sesión, no la abre: queda en borrador, visible en la
    // consola, y sin ficha con la que registrar a nadie.
    assert.equal(body.pendingAuthorization, true);
    assert.equal(body.session.status, "BORRADOR");
    assert.equal(body.token, undefined);

    // Sin autorizar, la sala no consigue ficha: el registro no se abre.
    const desbloqueo = await app.inject({
      method: "POST",
      url: "/api/kiosk/unlock",
      payload: { pin: "4321" },
    });
    const grant = desbloqueo.json().grant as string;

    const sinAutorizar = await app.inject({
      method: "POST",
      url: "/api/kiosk/token",
      payload: { grant, sessionCode: body.session.sessionCode },
    });
    assert.equal(sinAutorizar.statusCode, 409);
    assert.equal(sinAutorizar.json().error.code, "SESION_NO_AUTORIZADA");

    // Capacitación la autoriza desde la consola y hasta entonces la sala entra.
    const autorizacion = await app.inject({
      method: "POST",
      url: `/api/sessions/${body.session.sessionId}/authorize`,
      headers: { cookie: await cookieDeConsola(app) },
      payload: { pin: "8765", reason: "Autorizada para la prueba" },
    });
    assert.equal(autorizacion.statusCode, 200);

    const vinculo = await app.inject({
      method: "POST",
      url: "/api/kiosk/token",
      payload: { grant, sessionCode: body.session.sessionCode },
    });
    assert.equal(vinculo.statusCode, 200);
    body.token = vinculo.json().token;

    // Comprobar que el quiosco puede hacer bootstrap con el token recibido
    const resBoot = await app.inject({
      method: "GET",
      url: "/api/kiosk/bootstrap",
      headers: { authorization: `Bearer ${body.token}` },
    });
    assert.equal(resBoot.statusCode, 200);
    const bootBody = JSON.parse(resBoot.body);
    assert.equal(bootBody.sessionId, body.session.sessionId);
    assert.equal(bootBody.acceptingRegistrations, true);
    assert.equal(bootBody.availability.maximum, 40);

    // Registro de participante a través de la API
    const resReg = await app.inject({
      method: "POST",
      url: "/api/kiosk/register",
      payload: {
        token: body.token,
        employeeId: "12345",
      },
    });

    assert.equal(resReg.statusCode, 200);
    const regBody = JSON.parse(resReg.body);
    assert.equal(regBody.received, true);
    assert.equal(
      regBody.message,
      "Solicitud recibida; la asistencia se confirmará durante el cotejo físico",
    );

    // Cierre de sesión desde el quiosco
    const resClose = await app.inject({
      method: "POST",
      url: "/api/kiosk/close",
      payload: { token: body.token },
    });
    assert.equal(resClose.statusCode, 200);
    const closeBody = JSON.parse(resClose.body);
    assert.equal(closeBody.session.status, "CERRADA");
  });

  it("GET /sesiones y GET /api/sessions listan sesiones operativas", async () => {
    const { app } = await createTestApp();
    const cookie = await cookieDeConsola(app);

    // Crear sesión por API
    const resCreate = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        trainingId: "CAP-SINT-001",
        instructor: "INSTRUCTOR_WEB",
        date: "2026-08-03",
        durationMinutes: 60,
      },
    });
    assert.equal(resCreate.statusCode, 201);
    const { session } = JSON.parse(resCreate.body);

    // Abrir sesión
    await app.inject({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/open`,
      headers: { cookie },
    });

    // Consultar vista HTML /sesiones
    const resHtml = await app.inject({
      method: "GET",
      url: "/sesiones",
      headers: { cookie },
    });
    assert.equal(resHtml.statusCode, 200);
    assert.ok(resHtml.body.includes("Sesiones operativas"));
    assert.ok(resHtml.body.includes(session.sessionCode));

    // Consultar API JSON /api/sessions
    const resApi = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { cookie },
    });
    assert.equal(resApi.statusCode, 200);
    const apiBody = JSON.parse(resApi.body);
    assert.ok(apiBody.sessions.some((s: any) => s.sessionId === session.sessionId));
  });

  it("autoriza desde BORRADOR sólo con el PIN temporal de pruebas", async () => {
    const { app } = await createTestApp();
    const cookie = await cookieDeConsola(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        trainingId: "CAP-SINT-001",
        instructor: "INSTRUCTOR_WEB",
        date: "2026-08-03",
        durationMinutes: 60,
      },
    });
    const { session } = JSON.parse(created.body);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/authorize`,
      headers: { cookie },
      payload: { pin: "9999" },
    });
    assert.equal(rejected.statusCode, 401);

    const authorized = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/authorize`,
      headers: { cookie },
      payload: { pin: "8765" },
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal(JSON.parse(authorized.body).session.authorized, true);
  });
});

/**
 * La ficha de sesión que confirma la sala antes de registrar a nadie.
 *
 * El código de sesión son doce caracteres que se dictan en voz alta. En un día
 * con dos cursos en la misma sala, teclear el de al lado no daba ninguna señal:
 * el quiosco aceptaba el código y pasaba directo a registrar, y las asistencias
 * quedaban colgadas del curso ajeno hasta que alguien lo notara en la
 * liberación. Estas pruebas fijan que el vínculo viaje con lo que hace falta
 * para darse cuenta: el nombre del curso, no su identificador.
 */
describe("Quiosco · ficha de confirmación de sesión", () => {
  const config = loadConfig({
    KCM_ENV: "development",
    KCM_PORT: "8787",
    KCM_PILOT_SESSION_PIN: "8765",
    // Sin acceso abierto: esa bandera apaga la comprobación de PIN del quiosco,
    // que es justo lo que estas pruebas fijan. Para las pantallas que el
    // guardia cierra se entra con credencial, como entraría una persona.
    KCM_PILOT_CONSOLE_USER: "Maricela0000",
    KCM_PILOT_CONSOLE_PASSWORD: "0000",
  });

  async function appConSesionAbierta() {
    const kioskSessionRepository = new MemoryKioskSessionRepository({
      activeWorkers: [parseWorkerNumber("12345")],
      secrets: { REGISTRO_QUIOSCO: "4321", APERTURA_SESION: "8765" },
    });
    const app = await buildServer({
      config,
      clock,
      kioskSessionRepository,
      kioskTokenSecret: "test-secret-long-enough-32-chars!!",
    });

    const desbloqueo = await app.inject({
      method: "POST",
      url: "/api/kiosk/unlock",
      payload: { pin: "4321" },
    });
    const grant = desbloqueo.json().grant as string;

    const apertura = await app.inject({
      method: "POST",
      url: "/api/kiosk/launch",
      payload: {
        pin: "8765",
        trainingId: "CAP-SINT-001",
        instructor: "Ana Ruiz",
        date: "2026-08-03",
        durationMinutes: 90,
      },
    });
    assert.equal(apertura.statusCode, 200);
    const sessionCode = apertura.json().session.sessionCode as string;
    const sessionId = apertura.json().session.sessionId as string;

    // La sesión nace del quiosco, así que no abre registro hasta que
    // Capacitación la autoriza desde la consola. Es la compuerta que se prueba.
    const autorizacion = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/authorize`,
      headers: { cookie: await cookieDeConsola(app) },
      payload: { pin: "8765", reason: "Autorizada para la prueba" },
    });
    assert.equal(autorizacion.statusCode, 200);

    return { app, grant, sessionCode };
  }

  it("POST /api/kiosk/token devuelve la ficha con el nombre del curso resuelto", async () => {
    const { app, grant, sessionCode } = await appConSesionAbierta();

    const res = await app.inject({
      method: "POST",
      url: "/api/kiosk/token",
      payload: { grant, sessionCode },
    });

    assert.equal(res.statusCode, 200);
    const ficha = res.json().session;
    assert.ok(ficha, "el vínculo viaja con la ficha de la sesión");
    assert.equal(ficha.sessionCode, sessionCode);
    assert.equal(ficha.instructor, "Ana Ruiz");
    assert.equal(ficha.date, "2026-08-03");
    assert.equal(ficha.status, "ABIERTA");

    // Lo que hace útil a la ficha: un nombre que una persona reconoce. Si esto
    // devolviera `CAP-SINT-001`, la pantalla de confirmación no serviría de nada.
    assert.ok(ficha.trainingName, "la ficha trae nombre de curso");
    assert.notEqual(ficha.trainingName, ficha.trainingId);
  });

  it("GET /api/kiosk/bootstrap acompaña el registro con el nombre del curso", async () => {
    const { app, grant, sessionCode } = await appConSesionAbierta();

    const vinculo = await app.inject({
      method: "POST",
      url: "/api/kiosk/token",
      payload: { grant, sessionCode },
    });
    const token = vinculo.json().token as string;

    const res = await app.inject({ method: "GET", url: `/api/kiosk/bootstrap?token=${token}` });
    assert.equal(res.statusCode, 200);
    const estado = res.json();
    assert.ok(estado.trainingName);
    assert.notEqual(estado.trainingName, estado.trainingId);
    assert.equal(estado.date, "2026-08-03");
  });
});
