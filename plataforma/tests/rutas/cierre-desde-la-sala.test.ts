/**
 * Cerrar desde la sala una sesión creada en la consola.
 *
 * Era el recorrido normal y estaba roto. `closeSession` rechaza a un
 * `CAPACITADOR` que no creó la sesión, y el equipo de la sala cerraba con ese
 * rol: como las sesiones se crean desde la consola —con actor
 * `USUARIO_CAPACITACION`—, el instructor oprimía «cerrar» en el quiosco, veía
 * «No fue posible cerrar la sesión desde este equipo», y alguien tenía que
 * volver a cerrarla desde la plataforma.
 *
 * La estación cierra ahora con el rol `KIOSK`. Su autoridad es el token firmado
 * para esa sesión, no haberla creado.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { parseWorkerNumber } from "../../src/domain/numero-trabajador.ts";
import { buildServer } from "../../src/server/build-server.ts";

const FECHA_FIJA = new Date("2026-08-03T12:00:00.000Z");
const clock = { now: () => FECHA_FIJA, nowIso: () => FECHA_FIJA.toISOString() };
const DIA = "2026-08-03";

const config = loadConfig({
  KCM_ENV: "development",
  KCM_PORT: "8787",
  KCM_PILOT_SESSION_PIN: "8765",
  KCM_PILOT_OPEN_ACCESS: "true",
});

async function servidor() {
  return buildServer({
    config,
    clock,
    kioskSessionRepository: new MemoryKioskSessionRepository({
      activeWorkers: [parseWorkerNumber("12345")],
      secrets: { REGISTRO_QUIOSCO: "4321", APERTURA_SESION: "8765" },
    }),
    kioskTokenSecret: "test-secret-long-enough-32-chars!!",
  });
}

/**
 * El recorrido real: la consola crea y abre la sesión, y la sala se vincula a
 * ella con el vale y el código, como hace el quiosco de la pared.
 */
async function sesionDeConsolaVinculadaALaSala() {
  const app = await servidor();

  const creada = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: {
      trainingId: "CAP-SINT-001",
      instructor: "INSTRUCTOR_WEB",
      date: DIA,
      durationMinutes: 60,
    },
  });
  assert.equal(creada.statusCode, 201);
  const { session } = creada.json();

  await app.inject({ method: "POST", url: `/api/sessions/${session.sessionId}/open` });

  const desbloqueo = await app.inject({
    method: "POST",
    url: "/api/kiosk/unlock",
    payload: { pin: "4321", stationLabel: "SALA-1" },
  });
  assert.equal(desbloqueo.statusCode, 200);

  const vinculo = await app.inject({
    method: "POST",
    url: "/api/kiosk/token",
    payload: { grant: desbloqueo.json().grant, sessionCode: session.sessionCode },
  });
  assert.equal(vinculo.statusCode, 200);

  return { app, session, token: vinculo.json().token as string };
}

describe("Cierre desde la sala", () => {
  it("la sala cierra una sesión que creó la consola", async () => {
    const { app, session, token } = await sesionDeConsolaVinculadaALaSala();

    const cierre = await app.inject({
      method: "POST",
      url: "/api/kiosk/close",
      payload: { token },
    });
    assert.equal(cierre.statusCode, 200, cierre.body);
    assert.equal(cierre.json().session.status, "CERRADA");

    // Y la consola lo ve sin que nadie vuelva a cerrar nada.
    const lista = await app.inject({ method: "GET", url: "/api/sessions" });
    const enConsola = lista
      .json()
      .sessions.find((s: { sessionId: string }) => s.sessionId === session.sessionId);
    assert.equal(enConsola.status, "CERRADA");
  });

  it("cerrar dos veces no es un conflicto: la segunda no cambia nada", async () => {
    const { app, token } = await sesionDeConsolaVinculadaALaSala();

    const primera = await app.inject({
      method: "POST",
      url: "/api/kiosk/close",
      payload: { token },
    });
    assert.equal(primera.statusCode, 200);
    const cerradaEn = primera.json().session.closedAt;

    const segunda = await app.inject({
      method: "POST",
      url: "/api/kiosk/close",
      payload: { token },
    });
    assert.equal(segunda.statusCode, 200);
    assert.equal(segunda.json().session.status, "CERRADA");
    assert.equal(segunda.json().session.closedAt, cerradaEn, "la hora de cierre se movió");
  });

  it("la consola también puede cerrarla, y el resultado es el mismo", async () => {
    const { app, session } = await sesionDeConsolaVinculadaALaSala();

    const cierre = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/close`,
      payload: {},
    });
    assert.equal(cierre.statusCode, 200);
    assert.equal(cierre.json().session.status, "CERRADA");
  });

  it("sin token la sala no cierra nada", async () => {
    const { app } = await sesionDeConsolaVinculadaALaSala();

    const cierre = await app.inject({ method: "POST", url: "/api/kiosk/close", payload: {} });
    assert.equal(cierre.statusCode, 401);
  });
});
