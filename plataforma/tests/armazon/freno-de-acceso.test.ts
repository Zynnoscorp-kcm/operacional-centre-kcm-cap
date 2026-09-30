import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import type {
  ConsoleDirectoryPort,
  CuentaDeConsola,
} from "../../src/ports/directorio-consola.port.ts";
import { buildServer } from "../../src/server/build-server.ts";

const FECHA_FIJA = new Date("2026-08-23T12:00:00.000Z");
const clock = { now: () => FECHA_FIJA, nowIso: () => FECHA_FIJA.toISOString() };

function alta(usuario: string, clave: string): CuentaDeConsola {
  const sal = randomBytes(16).toString("hex");
  return {
    credencialId: randomUUID(),
    usuario,
    nombreVisible: usuario,
    sal,
    credencialHash: scryptSync(clave, Buffer.from(sal, "hex"), 32).toString("hex"),
  };
}

class DirectorioEnMemoria implements ConsoleDirectoryPort {
  readonly #cuentas: readonly CuentaDeConsola[];

  constructor(cuentas: readonly CuentaDeConsola[]) {
    this.#cuentas = cuentas;
  }

  buscarPorUsuario(usuario: string): Promise<CuentaDeConsola | undefined> {
    return Promise.resolve(
      this.#cuentas.find((cuenta) => cuenta.usuario.toLowerCase() === usuario.toLowerCase()),
    );
  }

  registrarAcceso(): Promise<void> {
    return Promise.resolve();
  }
}

function formulario(campos: Record<string, string>) {
  return {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(campos).toString(),
  };
}

async function servidor() {
  return buildServer({
    config: loadConfig({ KCM_ENV: "development" }),
    clock,
    consoleDirectory: new DirectorioEnMemoria([
      alta("Maricela0000", "Kimberly1"),
      alta("Pablo0000", "Kimberly3"),
    ]),
  });
}

async function intentar(
  app: Awaited<ReturnType<typeof servidor>>,
  usuario: string,
  clave: string,
): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/acceso",
    ...formulario({ usuario, clave }),
  });
  return res.statusCode;
}

describe("Acceso · el freno cuenta por equipo y por cuenta", () => {
  it("corta a los diez intentos contra la misma cuenta", async () => {
    const app = await servidor();
    let ultimo = 0;
    for (let intento = 0; intento < 11; intento += 1) {
      ultimo = await intentar(app, "Pablo0000", "equivocada");
    }
    assert.equal(ultimo, 429);
  });

  it("no cierra la puerta a otra cuenta del mismo equipo", async () => {
    const app = await servidor();
    for (let intento = 0; intento < 15; intento += 1) {
      await intentar(app, "Pablo0000", "equivocada");
    }

    assert.equal(await intentar(app, "Maricela0000", "Kimberly1"), 303);
  });

  it("olvida los intentos de una cuenta en cuanto acierta", async () => {
    const app = await servidor();
    for (let intento = 0; intento < 9; intento += 1) {
      await intentar(app, "Pablo0000", "equivocada");
    }
    assert.equal(await intentar(app, "Pablo0000", "Kimberly3"), 303);

    assert.equal(await intentar(app, "Pablo0000", "equivocada"), 401);
  });
});

describe("Acceso · la dirección que ve la plataforma", () => {
  async function servidorConEco(entorno: Record<string, string>) {
    const app = await buildServer({
      config: loadConfig({ KCM_ENV: "development", KCM_PILOT_OPEN_ACCESS: "1", ...entorno }),
      clock,
    });
    app.get("/eco-de-ip", (peticion, respuesta) => respuesta.send({ ip: peticion.ip }));
    return app;
  }

  it("ignora x-forwarded-for mientras no se declare un proxy de confianza", async () => {
    const app = await servidorConEco({});
    const res = await app.inject({
      method: "GET",
      url: "/eco-de-ip",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    assert.equal(res.json<{ ip: string }>().ip, "127.0.0.1");
  });

  it("toma la del cliente cuando hay un salto de confianza declarado", async () => {
    const app = await servidorConEco({ KCM_TRUST_PROXY: "1" });
    const res = await app.inject({
      method: "GET",
      url: "/eco-de-ip",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    assert.equal(res.json<{ ip: string }>().ip, "203.0.113.9");
  });

  it("no deja que quien llama se invente saltos de más", async () => {
    const app = await servidorConEco({ KCM_TRUST_PROXY: "1" });
    const res = await app.inject({
      method: "GET",
      url: "/eco-de-ip",
      headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.9" },
    });
    assert.equal(res.json<{ ip: string }>().ip, "203.0.113.9");
  });
});
