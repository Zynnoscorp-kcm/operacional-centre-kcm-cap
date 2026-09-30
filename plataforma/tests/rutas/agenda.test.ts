import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config/environment.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { renderAgendaPage } from "../../src/web/pages/agenda.ts";

const now = "2026-08-06T12:00:00.000Z";
const clock: Clock = { now: () => new Date(now), nowIso: () => now };

const abiertos: FastifyInstance[] = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()?.close();
});

async function servidor(entorno: Record<string, string> = {}): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig({ KCM_ENV: "development", ...entorno }),
    clock,
  });
  abiertos.push(app);
  return app;
}

const reserva = {
  roomId: "VOGUE",
  date: "2026-08-20",
  startTime: "09:00",
  endTime: "10:00",
  requesterName: "SOLICITANTE SINTETICO",
  requesterPosition: "PUESTO SINTETICO",
  requesterArea: "AREA SINTETICA",
  reason: "CAPACITACION SINTETICA",
  estimatedAttendees: "8",
};

function comoFormulario(campos: Record<string, string>): string {
  return new URLSearchParams(campos).toString();
}

describe("Agenda pública de salas", () => {
  it("el formulario ya no pide la nómina", async () => {
    const app = await servidor();
    const pantalla = await app.inject({ method: "GET", url: "/agenda" });

    assert.equal(pantalla.statusCode, 200);
    assert.doesNotMatch(pantalla.body, /name="requesterWorkerNumber"/u);
  });

  it("reserva de punta a punta con los campos que la pantalla ofrece", async () => {
    const app = await servidor();
    const respuesta = await app.inject({
      method: "POST",
      url: "/agenda",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      payload: comoFormulario(reserva),
    });

    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.body, /Reservación confirmada/u);
    assert.doesNotMatch(respuesta.body, /Falta el nombre/u);
  });

  it("una nómina mal escrita vuelve a la pantalla con lo capturado", async () => {
    const app = await servidor();
    const respuesta = await app.inject({
      method: "POST",
      url: "/agenda",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      payload: comoFormulario({ ...reserva, requesterWorkerNumber: "123" }),
    });

    assert.match(respuesta.body, /cinco dígitos/u);
    assert.match(respuesta.body, /SOLICITANTE SINTETICO/u);
    assert.match(respuesta.body, /CAPACITACION SINTETICA/u);
  });

  it("con contraseña de agenda declarada, la pantalla la pide y el servidor la comprueba", async () => {
    const app = await servidor({ KCM_PILOT_ROOM_PASSWORD: "clave-de-prueba" });

    const pantalla = await app.inject({ method: "GET", url: "/agenda" });
    assert.match(pantalla.body, /name="clave"/u);

    const sinClave = await app.inject({
      method: "POST",
      url: "/agenda",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      payload: comoFormulario(reserva),
    });
    assert.match(sinClave.body, /contraseña de agenda no es correcta/iu);

    const conClave = await app.inject({
      method: "POST",
      url: "/agenda",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      payload: comoFormulario({ ...reserva, clave: "clave-de-prueba" }),
    });
    assert.match(conClave.body, /Reservación confirmada/u);
  });

  it("con el acceso abierto no se pide contraseña en ninguna de las dos agendas", async () => {
    const app = await servidor({
      KCM_PILOT_ROOM_PASSWORD: "clave-de-prueba",
      KCM_PILOT_OPEN_ACCESS: "1",
    });

    const publica = await app.inject({ method: "GET", url: "/agenda" });
    assert.doesNotMatch(publica.body, /name="clave"/u);

    const administrativa = await app.inject({ method: "GET", url: "/salas" });
    assert.doesNotMatch(administrativa.body, /name="clave"/u);

    const respuesta = await app.inject({
      method: "POST",
      url: "/agenda",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      payload: comoFormulario(reserva),
    });
    assert.match(respuesta.body, /Reservación confirmada/u);
  });
});

describe("agenda pública · selección de rango", () => {
  interface Bloque {
    readonly clases: string;
    readonly inicio: string | null;
    readonly fin: string | null;
  }

  function bloques(pagina: string): Map<string, Bloque> {
    const mapa = new Map<string, Bloque>();
    const patron = /<a\s+class="([^"]*)"\s+href="([^"]*sala=[^"]*)"[\s\S]*?>\s*(\d\d:\d\d)<\/a/g;
    let hallazgo: RegExpExecArray | null;
    while ((hallazgo = patron.exec(pagina)) !== null) {
      const consulta = hallazgo[2]!.replace(/&amp;/g, "&").split("#")[0]!;
      const parametros = new URLSearchParams(consulta.slice(consulta.indexOf("?") + 1));
      mapa.set(`${parametros.get("sala")} ${hallazgo[3]}`, {
        clases: hallazgo[1]!,
        inicio: parametros.get("inicio"),
        fin: parametros.get("fin"),
      });
    }
    return mapa;
  }

  async function pintar(consulta: string): Promise<Map<string, Bloque>> {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: `/agenda?${consulta}` });
    assert.equal(respuesta.statusCode, 200);
    return bloques(respuesta.body);
  }

  const FECHA = "2026-08-20";

  it("sin selección, un toque ancla el bloque de treinta minutos", async () => {
    const mapa = await pintar(`fecha=${FECHA}`);
    const bloque = mapa.get("VOGUE 08:00");
    assert.equal(bloque?.inicio, "08:00");
    assert.equal(bloque?.fin, "08:30");
    assert.equal(bloque?.clases.includes("elegido"), false);
  });

  it("el segundo toque cierra el rango e incluye ambos bloques", async () => {
    const mapa = await pintar(`fecha=${FECHA}&sala=VOGUE&inicio=08:00&fin=08:30`);
    assert.deepEqual(
      { inicio: mapa.get("VOGUE 10:00")?.inicio, fin: mapa.get("VOGUE 10:00")?.fin },
      { inicio: "08:00", fin: "10:30" },
    );
  });

  it("un toque anterior al ancla vuelve a anclar en lugar de invertir el rango", async () => {
    const mapa = await pintar(`fecha=${FECHA}&sala=VOGUE&inicio=08:00&fin=08:30`);
    assert.deepEqual(
      { inicio: mapa.get("VOGUE 07:00")?.inicio, fin: mapa.get("VOGUE 07:00")?.fin },
      { inicio: "07:00", fin: "07:30" },
    );
  });

  it("el ancla de una sala no afecta a las demás", async () => {
    const mapa = await pintar(`fecha=${FECHA}&sala=VOGUE&inicio=08:00&fin=08:30`);
    assert.deepEqual(
      { inicio: mapa.get("MARLI 10:00")?.inicio, fin: mapa.get("MARLI 10:00")?.fin },
      { inicio: "10:00", fin: "10:30" },
    );
  });

  it("el rango elegido se resalta completo y el ancla se distingue", async () => {
    const mapa = await pintar(`fecha=${FECHA}&sala=VOGUE&inicio=08:00&fin=10:00`);
    for (const hora of ["08:00", "08:30", "09:00", "09:30"]) {
      assert.equal(mapa.get(`VOGUE ${hora}`)?.clases.includes("elegido"), true, hora);
    }
    for (const hora of ["07:30", "10:00"]) {
      assert.equal(mapa.get(`VOGUE ${hora}`)?.clases.includes("elegido"), false, hora);
    }
    assert.equal(mapa.get("VOGUE 08:00")?.clases.includes("ancla"), true);
  });

  it("un rango no puede saltarse una reservación ajena", () => {
    const pagina = renderAgendaPage({
      fecha: FECHA,
      ahora: { fecha: "2026-08-06", minutos: 0 },
      ocupacion: [
        {
          roomId: "VOGUE",
          date: FECHA,
          startTime: "09:00",
          endTime: "09:30",
          status: "RESERVADA",
        },
      ],
      salaElegida: "VOGUE",
      inicioElegido: "08:00",
      finElegido: "08:30",
    });
    const mapa = bloques(pagina);

    assert.deepEqual(
      { inicio: mapa.get("VOGUE 10:00")?.inicio, fin: mapa.get("VOGUE 10:00")?.fin },
      { inicio: "10:00", fin: "10:30" },
    );
    assert.deepEqual(
      { inicio: mapa.get("VOGUE 08:30")?.inicio, fin: mapa.get("VOGUE 08:30")?.fin },
      { inicio: "08:00", fin: "09:00" },
    );
    assert.equal(mapa.has("VOGUE 09:00"), false);
  });
});
