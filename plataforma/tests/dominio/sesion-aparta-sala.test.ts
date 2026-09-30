import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { buildServer } from "../../src/server/build-server.ts";

const FECHA_FIJA = new Date("2026-08-03T12:00:00.000Z");
const clock = { now: () => FECHA_FIJA, nowIso: () => FECHA_FIJA.toISOString() };
const DIA = "2026-08-03";

const config = loadConfig({
  KCM_ENV: "development",
  KCM_PORT: "8787",
  KCM_PILOT_OPEN_ACCESS: "true",
});

async function servidor() {
  return buildServer({
    config,
    clock,
    kioskSessionRepository: new MemoryKioskSessionRepository({ clock }),
    kioskTokenSecret: "test-secret-long-enough-32-chars!!",
  });
}

const CURSO = "CAP-SINT-001";

interface CuerpoDeSesion {
  readonly roomId?: string;
  readonly startTime?: string;
  readonly durationMinutes?: number;
  readonly estimatedAttendees?: number;
}

function crear(app: Awaited<ReturnType<typeof servidor>>, extra: CuerpoDeSesion = {}) {
  return app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: {
      trainingId: CURSO,
      instructor: "INSTRUCTOR_WEB",
      date: DIA,
      durationMinutes: 60,
      ...extra,
    },
  });
}

describe("Crear sesión con sala · la agenda se entera", () => {
  it("sin sala no toca la agenda", async () => {
    const app = await servidor();

    const res = await crear(app);
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().reservation, undefined);

    const agenda = await app.inject({ method: "GET", url: `/api/rooms/reservations?date=${DIA}` });
    assert.deepEqual(agenda.json().reservations, []);
  });

  it("con sala levanta la reservación y la agenda pública la publica ocupada", async () => {
    const app = await servidor();

    const res = await crear(app, { roomId: "VOGUE", startTime: "09:00", estimatedAttendees: 12 });
    assert.equal(res.statusCode, 201);

    const { session, reservation } = res.json();
    assert.equal(session.room, "Vogue", "la sesión guarda el nombre legible de la sala");
    assert.equal(reservation.roomId, "VOGUE");
    assert.equal(reservation.startTime, "09:00");
    assert.equal(reservation.endTime, "10:00");
    assert.equal(reservation.origin, "ADMINISTRACION");
    assert.equal(reservation.estimatedAttendees, 12);
    assert.match(reservation.reason, /Sesión de capacitación/u);

    const publica = await app.inject({ method: "GET", url: `/api/rooms/availability?date=${DIA}` });
    assert.equal(publica.statusCode, 200);
    const ocupacion = publica.json().rooms as {
      roomId: string;
      startTime: string;
      endTime: string;
    }[];
    assert.ok(
      ocupacion.some(
        (fila) => fila.roomId === "VOGUE" && fila.startTime === "09:00" && fila.endTime === "10:00",
      ),
      "la agenda pública no muestra el horario como ocupado",
    );
  });

  it("el tramo se redondea hacia afuera, nunca de menos", async () => {
    const app = await servidor();

    const res = await crear(app, {
      roomId: "KLEENEX",
      startTime: "09:10",
      durationMinutes: 45,
    });

    assert.equal(res.statusCode, 201);
    const { reservation, session } = res.json();
    assert.equal(reservation.startTime, "09:00");
    assert.equal(reservation.endTime, "10:00");
    assert.equal(session.startTime, "09:10");
    assert.equal(session.durationMinutes, 45);
  });

  it("si la sala ya está tomada, ni reservación ni sesión", async () => {
    const app = await servidor();

    assert.equal((await crear(app, { roomId: "MARLI", startTime: "09:00" })).statusCode, 201);

    const choque = await crear(app, { roomId: "MARLI", startTime: "09:30" });
    assert.equal(choque.statusCode, 409);
    assert.match(choque.json().error.message, /ya está reservado/u);

    const sesiones = await app.inject({ method: "GET", url: "/api/sessions" });
    assert.equal(sesiones.json().sessions.length, 1, "se creó una sesión sin sala apartada");

    const reservas = await app.inject({
      method: "GET",
      url: `/api/rooms/reservations?date=${DIA}`,
    });
    assert.equal(reservas.json().reservations.length, 1);
  });

  it("una sala del catálogo exige hora de inicio", async () => {
    const app = await servidor();

    const res = await crear(app, { roomId: "PETALO" });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error.message, /hora de inicio/u);

    const reservas = await app.inject({
      method: "GET",
      url: `/api/rooms/reservations?date=${DIA}`,
    });
    assert.deepEqual(reservas.json().reservations, []);
  });

  it("una sala fuera del catálogo se rechaza sin tocar nada", async () => {
    const app = await servidor();

    const res = await crear(app, { roomId: "SALA_INVENTADA", startTime: "09:00" });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error.message, /catálogo/u);

    const sesiones = await app.inject({ method: "GET", url: "/api/sessions" });
    assert.deepEqual(sesiones.json().sessions, []);
  });

  it("reenviar el mismo formulario no aparta la sala dos veces", async () => {
    const app = await servidor();
    const idem = "solicitud-repetida-1";

    const primera = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        trainingId: CURSO,
        instructor: "INSTRUCTOR_WEB",
        date: DIA,
        durationMinutes: 60,
        roomId: "DELSEY",
        startTime: "11:00",
        requestId: idem,
      },
    });
    assert.equal(primera.statusCode, 201);

    const segunda = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        trainingId: CURSO,
        instructor: "INSTRUCTOR_WEB",
        date: DIA,
        durationMinutes: 60,
        roomId: "DELSEY",
        startTime: "11:00",
        requestId: idem,
      },
    });
    assert.equal(segunda.statusCode, 201);

    const reservas = await app.inject({
      method: "GET",
      url: `/api/rooms/reservations?date=${DIA}`,
    });
    assert.equal(reservas.json().reservations.length, 1, "la reservación se duplicó");

    const sesiones = await app.inject({ method: "GET", url: "/api/sessions" });
    assert.equal(sesiones.json().sessions.length, 1, "la sesión se duplicó");
  });
});
