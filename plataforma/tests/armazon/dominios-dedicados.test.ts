import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config/environment.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";

const now = "2026-09-25T12:00:00.000Z";
const clock: Clock = { now: () => new Date(now), nowIso: () => now };
const QUIOSCO = "quiosco.kcm.test";
const AGENDA = "agenda.kcm.test";
const CONSOLA = "consola.kcm.test";

const abiertos: FastifyInstance[] = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()?.close();
});

async function servidor(): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig({
      KCM_ENV: "development",
      KCM_DOMINIO_QUIOSCO: QUIOSCO,
      KCM_DOMINIO_AGENDA: `${AGENDA}, OTRA-AGENDA.kcm.test`,
    }),
    clock,
  });
  abiertos.push(app);
  return app;
}

function pedir(app: FastifyInstance, host: string, url: string, method: "GET" | "POST" = "GET") {
  return app.inject({ method, url, headers: { host } });
}

describe("dominios dedicados del quiosco y la agenda", () => {
  it("en el dominio del quiosco, la raíz y la consola vuelven al quiosco", async () => {
    const app = await servidor();
    for (const url of ["/", "/acceso", "/trabajadores", "/dc3", "/agenda", "/excel?x=1"]) {
      const respuesta = await pedir(app, QUIOSCO, url);
      assert.equal(respuesta.statusCode, 302, url);
      assert.equal(respuesta.headers.location, "/quiosco", url);
    }
    assert.equal((await pedir(app, QUIOSCO, "/quiosco")).statusCode, 200);
    assert.equal((await pedir(app, QUIOSCO, "/healthz")).statusCode, 200);
  });

  it("en el dominio de la agenda, la raíz y la consola vuelven a la agenda", async () => {
    const app = await servidor();
    for (const host of [AGENDA, "otra-agenda.kcm.test"]) {
      for (const url of ["/", "/acceso", "/quiosco", "/salas"]) {
        const respuesta = await pedir(app, host, url);
        assert.equal(respuesta.statusCode, 302, `${host}${url}`);
        assert.equal(respuesta.headers.location, "/agenda", `${host}${url}`);
      }
    }
    assert.equal((await pedir(app, AGENDA, "/agenda")).statusCode, 200);
  });

  it("un envío a una ruta ajena no existe en un dominio dedicado", async () => {
    const app = await servidor();
    assert.equal((await pedir(app, AGENDA, "/acceso", "POST")).statusCode, 404);
    assert.equal((await pedir(app, QUIOSCO, "/api/v1/vba-bridge", "POST")).statusCode, 404);
  });

  it("el dominio de la consola no cambia", async () => {
    const app = await servidor();
    assert.equal((await pedir(app, CONSOLA, "/acceso")).statusCode, 200);
    assert.equal((await pedir(app, CONSOLA, "/quiosco")).statusCode, 200);
    assert.equal((await pedir(app, CONSOLA, "/agenda")).statusCode, 200);
  });
});
