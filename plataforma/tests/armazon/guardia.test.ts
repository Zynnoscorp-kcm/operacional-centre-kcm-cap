import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import { buildServer } from "../../src/server/build-server.ts";

const FECHA = new Date("2026-08-18T12:00:00.000Z");
const clock = { now: () => FECHA, nowIso: () => FECHA.toISOString() };

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
  KCM_PILOT_KIOSK_PIN: "0000",
  KCM_PILOT_ROOM_PASSWORD: "0000",
} as const;

async function servidor() {
  return buildServer({ config: loadConfig({ ...ENTORNO }), clock });
}

async function cookieDeConsola(app: Awaited<ReturnType<typeof servidor>>): Promise<string> {
  const entrada = await app.inject({
    method: "POST",
    url: "/acceso",
    payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(entrada.statusCode, 303, "la credencial declarada debería abrir sesión");
  return String(entrada.headers["set-cookie"] ?? "").split(";")[0] ?? "";
}

const PANTALLAS = [
  "/",
  "/sesiones",
  "/preliberacion",
  "/liberacion",
  "/matriz",
  "/padron",
  "/cargas",
  "/cambios",
  "/trabajadores",
  "/trabajadores/cobertura",
  "/salas",
  "/auditoria",
  "/auditoria/sesiones",
  "/auditoria/salas",
  "/auditoria/liberaciones",
  "/campos",
  "/base",
  "/dc3",
  "/ocupaciones",
  "/excel",
] as const;

const APIS = [
  "/api/sessions",
  "/api/pre-release/sessions",
  "/api/rooms/reservations",
  "/api/auditoria/sesiones",
  "/api/campos",
  "/api/base/tablas",
] as const;

const ABIERTAS = ["/healthz", "/acceso", "/quiosco", "/agenda"] as const;

describe("Guardia de la consola", () => {
  it("sin sesión, cada pantalla manda a la puerta con su destino", async () => {
    const app = await servidor();
    try {
      for (const ruta of PANTALLAS) {
        const res = await app.inject({ method: "GET", url: ruta });
        assert.equal(res.statusCode, 303, `${ruta} respondió sin sesión`);
        assert.equal(
          res.headers.location,
          `/acceso?destino=${encodeURIComponent(ruta)}`,
          `${ruta} no conserva el destino`,
        );
      }
    } finally {
      await app.close();
    }
  });

  it("sin sesión, las rutas de máquina responden 401 y no una redirección", async () => {
    const app = await servidor();
    try {
      for (const ruta of APIS) {
        const res = await app.inject({ method: "GET", url: ruta });
        assert.equal(res.statusCode, 401, `${ruta} respondió sin sesión`);
        assert.match(res.body, /SESION_REQUERIDA/u, `${ruta} no explica por qué`);
      }
    } finally {
      await app.close();
    }
  });

  it("emitir o revocar una credencial de equipo exige sesión", async () => {
    const app = await servidor();
    try {
      const emision = await app.inject({
        method: "POST",
        url: "/api/excel/credentials",
        payload: {
          clientId: "KCM-INTRUSO",
          principal: "quien-sea",
          windowsProfile: "quien-sea",
          equipment: "equipo",
          scope: "PUENTE_VBA",
          resource: "bridge",
          permanent: "true",
        },
      });
      assert.equal(emision.statusCode, 401, "se emitió una credencial sin autenticar a nadie");

      const revocacion = await app.inject({
        method: "POST",
        url: "/api/excel/credentials/KCM-OFFICE-01/revoke",
        payload: { scope: "PUENTE_VBA", reason: "prueba" },
      });
      assert.equal(revocacion.statusCode, 401, "se revocó una credencial sin sesión");
    } finally {
      await app.close();
    }
  });

  it("un envío de formulario vuelve a su pantalla, no a la ruta que sólo acepta POST", async () => {
    const app = await servidor();
    try {
      const res = await app.inject({ method: "POST", url: "/matriz/barrido" });
      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, "/acceso?destino=%2Fmatriz");
    } finally {
      await app.close();
    }
  });

  it("lo que tiene su propio secreto sigue abierto", async () => {
    const app = await servidor();
    try {
      for (const ruta of ABIERTAS) {
        const res = await app.inject({ method: "GET", url: ruta });
        assert.equal(res.statusCode, 200, `${ruta} dejó de responder`);
      }
    } finally {
      await app.close();
    }
  });

  it("con sesión, la consola responde", async () => {
    const app = await servidor();
    try {
      const cookie = await cookieDeConsola(app);
      for (const ruta of ["/", "/salas", "/trabajadores"]) {
        const res = await app.inject({ method: "GET", url: ruta, headers: { cookie } });
        assert.equal(res.statusCode, 200, `${ruta} no abrió con sesión`);
      }
    } finally {
      await app.close();
    }
  });

  it("una credencial equivocada no abre nada", async () => {
    const app = await servidor();
    try {
      const intento = await app.inject({
        method: "POST",
        url: "/acceso",
        payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0001" }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      assert.equal(intento.headers["set-cookie"], undefined, "emitió sesión con clave incorrecta");

      const res = await app.inject({ method: "GET", url: "/base" });
      assert.equal(res.statusCode, 303);
    } finally {
      await app.close();
    }
  });

  it("una ruta inexistente tampoco confirma que no existe", async () => {
    const app = await servidor();
    try {
      const res = await app.inject({ method: "GET", url: "/pantalla-que-no-existe" });
      assert.equal(res.statusCode, 303);
    } finally {
      await app.close();
    }
  });
});
