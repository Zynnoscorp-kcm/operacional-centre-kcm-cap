import assert from "node:assert/strict";
import { randomBytes, scryptSync, randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import type {
  ConsoleDirectoryPort,
  CuentaDeConsola,
} from "../../src/ports/directorio-consola.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { hojaDeEstilos } from "../../src/web/estaticos.ts";

const FECHA_FIJA = new Date("2026-08-06T12:00:00.000Z");
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
  readonly accesos: { id: string; cuando: string }[] = [];
  readonly #cuentas: CuentaDeConsola[];

  constructor(cuentas: CuentaDeConsola[]) {
    this.#cuentas = cuentas;
  }

  buscarPorUsuario(usuario: string): Promise<CuentaDeConsola | undefined> {
    return Promise.resolve(
      this.#cuentas.find((cuenta) => cuenta.usuario.toLowerCase() === usuario.toLowerCase()),
    );
  }

  registrarAcceso(credencialId: string, cuando: string): Promise<void> {
    this.accesos.push({ id: credencialId, cuando });
    return Promise.resolve();
  }
}

function directorio(): DirectorioEnMemoria {
  return new DirectorioEnMemoria([
    alta("Maricela0000", "Kimberly1"),
    alta("Stephanie0000", "Kimberly2"),
    alta("Pablo0000", "Kimberly3"),
  ]);
}

function formulario(campos: Record<string, string>) {
  return {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(campos).toString(),
  };
}

async function servidor(consoleDirectory: ConsoleDirectoryPort | undefined) {
  return buildServer({
    config: loadConfig({
      KCM_ENV: "development",
      KCM_PILOT_CONSOLE_USER: "Maricela0000",
      KCM_PILOT_CONSOLE_PASSWORD: "0000",
    }),
    clock,
    ...(consoleDirectory ? { consoleDirectory } : {}),
  });
}

describe("Acceso · directorio de cuentas de consola", () => {
  it("acepta las tres cuentas y deja cookie de sesión firmada", async () => {
    const puerta = directorio();
    const app = await servidor(puerta);

    for (const [usuario, clave] of [
      ["Maricela0000", "Kimberly1"],
      ["Stephanie0000", "Kimberly2"],
      ["Pablo0000", "Kimberly3"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/acceso",
        ...formulario({ usuario, clave, destino: "/trabajadores" }),
      });

      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, "/trabajadores");
      const cookie = String(res.headers["set-cookie"]);
      assert.match(cookie, /^kcm_sesion=/u);
      assert.match(cookie, /HttpOnly/u);
    }

    assert.equal(puerta.accesos.length, 3);
    assert.deepEqual(
      puerta.accesos.map((acceso) => acceso.cuando),
      Array.from({ length: 3 }, () => FECHA_FIJA.toISOString()),
    );
  });

  it("el nombre de la cuenta no distingue mayúsculas; la contraseña sí", async () => {
    const app = await servidor(directorio());

    const conMayusculas = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "  PABLO0000 ", clave: "Kimberly3" }),
    });
    assert.equal(conMayusculas.statusCode, 303);

    const claveEnMinusculas = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Pablo0000", clave: "kimberly3" }),
    });
    assert.equal(claveEnMinusculas.statusCode, 401);
  });

  it("rechaza sin decir qué falló y sin dejar sesión", async () => {
    const puerta = directorio();
    const app = await servidor(puerta);

    for (const campos of [
      { usuario: "Pablo0000", clave: "Kimberly9" },
      { usuario: "Fulano0000", clave: "Kimberly3" },
      { usuario: "", clave: "" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/acceso", ...formulario(campos) });
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers["set-cookie"], undefined);
      assert.match(res.body, /Usuario o contraseña incorrectos/u);
      assert.doesNotMatch(res.body, /usuario no existe|contraseña incorrecta/iu);
    }
    assert.equal(puerta.accesos.length, 0);
  });

  it("con directorio conectado la credencial del entorno deja de servir", async () => {
    const app = await servidor(directorio());
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Maricela0000", clave: "0000" }),
    });
    assert.equal(res.statusCode, 401);
  });

  it("sin directorio sigue valiendo la credencial del entorno", async () => {
    const app = await servidor(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Maricela0000", clave: "0000" }),
    });
    assert.equal(res.statusCode, 303);
  });

  it("corta a los diez intentos desde el mismo equipo", async () => {
    const app = await servidor(directorio());
    let ultimo = 0;
    for (let intento = 0; intento < 11; intento += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/acceso",
        ...formulario({ usuario: "Pablo0000", clave: "equivocada" }),
      });
      ultimo = res.statusCode;
    }
    assert.equal(ultimo, 429);
  });
});

describe("Acceso · la puerta de la consola", () => {
  it("son dos hojas, con la hoja de estilos de la consola y nada de fuera", async () => {
    const app = await servidor(directorio());
    const res = await app.inject({ method: "GET", url: "/acceso" });

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /class="puerta-hoja puerta-marca"/u);
    assert.match(res.body, /class="puerta-hoja puerta-forma"/u);
    assert.match(res.body, /class="puerta-fondo"/u, "falta la silueta que la puerta descubre");

    assert.doesNotMatch(res.body, /beams-canvas|three\.min\.js|fonts\.googleapis/u);
    assert.doesNotMatch(res.body, /<style/u, "el estilo vive en la hoja, no en la pantalla");
    assert.doesNotMatch(res.body, /\sstyle="/u, "un estilo en línea no pasaría la política");
    assert.doesNotMatch(res.body, /https?:\/\//u, "no debe apuntar a ningún origen externo");

    const politica = String(res.headers["content-security-policy"]);
    assert.match(politica, /script-src 'self'(;|$)/u, "el CDN ya no hace falta");
    assert.match(politica, /style-src 'self'(;|$)/u);
    assert.match(politica, /frame-ancestors 'none'/u);
  });

  it("el guion que abre la puerta se sirve con hash desde este mismo origen", async () => {
    const app = await servidor(directorio());
    const res = await app.inject({ method: "GET", url: "/acceso" });

    const guion = /src="(\/assets\/acceso-[a-z]{12}\.js)"/u.exec(res.body)?.[1];
    assert.ok(guion, "la pantalla debe cargar el guion de la puerta");

    const estatico = await app.inject({ method: "GET", url: guion });
    assert.equal(estatico.statusCode, 200);
    assert.match(estatico.body, /puerta-abierta/u, "el guion debe abrir las hojas");
    assert.match(estatico.body, /prefers-reduced-motion/u, "debe respetar menos movimiento");
  });

  it("el campo se sacude y el renglón se pone rojo cuando el intento falló", async () => {
    const app = await servidor(directorio());
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Pablo0000", clave: "equivocada" }),
    });

    assert.match(res.body, /class="campo-rechazado"/u);
    assert.match(res.body, /class="puerta-ayuda puerta-ayuda-error"/u);
    assert.match(hojaDeEstilos.contenido, /animation: puertaSacudon 0\.4s ease/u);
  });
});
