import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config/environment.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { renderMatrixScanPage } from "../../src/web/pages/barrido-matriz.ts";
import { renderRosterPage } from "../../src/web/pages/padron.ts";

const now = "2026-09-20T12:00:00.000Z";
const clock: Clock = { now: () => new Date(now), nowIso: () => now };

const abiertos: FastifyInstance[] = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()?.close();
});

async function servidor(papel: "local" | "nube"): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig({
      KCM_ENV: "development",
      KCM_ROLE: papel,
      KCM_PILOT_OPEN_ACCESS: "true",
      ...(papel === "nube" ? { KCM_ROOM_PASSWORD: "clave-sintetica-de-agenda" } : {}),
    }),
    clock,
  });
  abiertos.push(app);
  return app;
}

function contiene(documento: string, fragmento: string, que: string): void {
  assert.ok(documento.includes(fragmento), `falta ${que}: ${JSON.stringify(fragmento)}`);
}

function noContiene(documento: string, fragmento: string, que: string): void {
  assert.ok(
    !documento.includes(fragmento),
    `no debería aparecer ${que}: ${JSON.stringify(fragmento)}`,
  );
}

function puente(action: string): Record<string, string> {
  return {
    action,
    clientId: "EQUIPO-SINTETICO",
    requestId: "req-sintetica-0001",
    sentAt: now,
    nonce: "nonce-sintetico-0001",
    token: "token-sintetico",
    payload: "",
  };
}

describe("papel del despliegue · qué corre en la nube y qué en el equipo", () => {
  it("la nube acepta las cargas del ciclo: no hay acción cerrada por nombre", async () => {
    const app = await servidor("nube");
    for (const accion of [
      "MATRIX_IMPORT_V1",
      "MATRIX_SCAN_V1",
      "ROSTER_SCAN_V1",
      "RELEASE_ACK_V1",
    ]) {
      const respuesta = await app.inject({
        method: "POST",
        url: "/api/v1/vba-bridge",
        payload: puente(accion),
      });
      assert.notEqual(respuesta.statusCode, 413, accion);
      assert.doesNotMatch(respuesta.body, /ACCION_SOLO_LOCAL|CARGA_EXCEDE_NUBE/u, accion);
    }
  });

  it("en la nube, un envío que no cabe se rechaza en el idioma del puente", async () => {
    const app = await servidor("nube");
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v1/vba-bridge",
      payload: { ...puente("MATRIX_SCAN_V1"), payload: "A".repeat(4_300_000) },
    });
    assert.equal(respuesta.statusCode, 413);
    assert.match(respuesta.body, /^status=RECHAZADA\nreason=CARGA_EXCEDE_NUBE\n/u);
    assert.match(respuesta.body, /en partes/u);
    assert.doesNotMatch(respuesta.body, /ENDPOINT_LOCAL|envío local/u);
  });

  it("el equipo local acepta lo que la nube no alcanza a recibir", async () => {
    const app = await servidor("local");
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/v1/vba-bridge",
      payload: { ...puente("MATRIX_SCAN_V1"), payload: "A".repeat(4_300_000) },
    });
    assert.notEqual(respuesta.statusCode, 413);
  });

  it("en la nube, un padrón que no cabe en el navegador dice por dónde sí cabe", async () => {
    const app = await servidor("nube");
    const respuesta = await app.inject({
      method: "POST",
      url: "/padron",
      headers: { "content-type": "multipart/form-data; boundary=limite" },
      payload: Buffer.concat([
        Buffer.from(
          '--limite\r\nContent-Disposition: form-data; name="archivo"; filename="sem.xlsx"\r\n\r\n',
          "utf8",
        ),
        Buffer.alloc(4_300_000, 0x41),
        Buffer.from("\r\n--limite--\r\n", "utf8"),
      ]),
    });
    assert.equal(respuesta.statusCode, 413);
    contiene(respuesta.body, "Padrón de la semana", "el botón de Excel que lo manda en partes");
    noContiene(respuesta.body, "localhost", "la computadora que ya no hace falta encender");
  });

  it("la etiqueta de la barra dice en qué máquina está parada la persona", async () => {
    const nube = await servidor("nube");
    contiene(
      (await nube.inject({ method: "GET", url: "/padron" })).body,
      "En la nube",
      "la etiqueta de la nube",
    );

    const local = await servidor("local");
    contiene(
      (await local.inject({ method: "GET", url: "/padron" })).body,
      "Equipo del departamento",
      "la etiqueta del equipo",
    );
  });

  it("el padrón ofrece el formulario en los dos papeles", () => {
    for (const papel of ["local", "nube"] as const) {
      const pantalla = renderRosterPage({ entorno: "development", papel, sinBase: false });
      contiene(pantalla, 'type="file"', `el selector de archivo (${papel})`);
      noContiene(pantalla, "Esta carga se hace en la computadora", "la instrucción vieja");
    }
  });

  it("en la nube, el barrido dice que una matriz grande llega en partes", () => {
    const pantalla = renderMatrixScanPage({
      entorno: "development",
      papel: "nube",
      sinBase: false,
    });
    contiene(pantalla, "sale de Excel en partes", "que lo grande llega en partes");
    noContiene(pantalla, "Encender envío local", "el botón retirado");
  });

  it("sin base conectada, el aviso del papel no queda eclipsado", () => {
    const matriz = renderMatrixScanPage({ entorno: "development", papel: "nube", sinBase: true });
    contiene(matriz, "sale de Excel en partes", "el aviso del barrido");
  });

  it("en la nube, el módulo DC-3 no dice que allá no se emite", async () => {
    const app = await servidor("nube");
    const pantalla = (await app.inject({ method: "GET", url: "/dc3" })).body;
    noContiene(pantalla, "aquí no se emite", "un aviso de que la nube no emite");
    noContiene(pantalla, "configuración legal", "el aviso de la configuración privada");
    noContiene(pantalla, "lote", "la palabra lote");
  });

  it("la pantalla de Excel dicta una sola dirección y dice que lo grande va en partes", async () => {
    const app = await servidor("local");
    const pantalla = (await app.inject({ method: "GET", url: "/excel" })).body;
    contiene(pantalla, "Dirección del puente", "la sección de la dirección");
    contiene(pantalla, "en partes", "que los envíos grandes salen en partes");
    noContiene(pantalla, "ENDPOINT_LOCAL", "la clave retirada");
    noContiene(pantalla, "CARPETA_PLATAFORMA", "la clave retirada");
  });

  it("el apagado no existe en la nube", async () => {
    const app = await servidor("nube");
    assert.equal((await app.inject({ method: "GET", url: "/apagar" })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/apagar" })).statusCode, 404);
  });

  it("en el equipo, el apagado pregunta antes y sólo apaga al confirmar", async () => {
    let apagados = 0;
    const app = await buildServer({
      config: loadConfig({
        KCM_ENV: "development",
        KCM_ROLE: "local",
        KCM_PILOT_OPEN_ACCESS: "true",
      }),
      clock,
      apagar: () => {
        apagados += 1;
      },
    });
    abiertos.push(app);

    const pregunta = await app.inject({ method: "GET", url: "/apagar" });
    assert.equal(pregunta.statusCode, 200);
    contiene(pregunta.body, "¿Apagar el servidor local?", "la pregunta");
    assert.equal(apagados, 0);

    const hecho = await app.inject({ method: "POST", url: "/apagar" });
    assert.equal(hecho.statusCode, 200);
    contiene(hecho.body, "Servidor local apagado", "el acuse");
    contiene(hecho.body, "Encender KCM", "cómo volver a encenderla");
  });

  it("el tablero apaga sin salir de la consola, y sólo con la acción explícita", async () => {
    let apagados = 0;
    const app = await buildServer({
      config: loadConfig({
        KCM_ENV: "development",
        KCM_ROLE: "local",
        KCM_PILOT_OPEN_ACCESS: "true",
      }),
      clock,
      apagar: () => {
        apagados += 1;
      },
    });
    abiertos.push(app);

    const sinAccion = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ accion: "guardar" }).toString(),
    });
    assert.equal(sinAccion.statusCode, 404);
    assert.equal(apagados, 0);

    const apagado = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ accion: "apagar" }).toString(),
    });
    assert.equal(apagado.statusCode, 200);
    contiene(apagado.body, "Servidor local apagado", "el acuse");
    contiene(apagado.body, "Lo que toca ahora", "el tablero de siempre");
    contiene(apagado.body, "Encender KCM", "cómo volver a encenderla");
  });

  it("en la nube el tablero no apaga nada", async () => {
    const nube = await servidor("nube");
    const respuesta = await nube.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ accion: "apagar" }).toString(),
    });
    assert.equal(respuesta.statusCode, 404);
  });

  it("la pantalla de inicio ofrece apagar sólo en el equipo del departamento", async () => {
    const local = await servidor("local");
    contiene(
      (await local.inject({ method: "GET", url: "/" })).body,
      "Apagar la plataforma",
      "el botón",
    );

    const nube = await servidor("nube");
    noContiene(
      (await nube.inject({ method: "GET", url: "/" })).body,
      "Apagar la plataforma",
      "el botón",
    );
  });

  it("con llave declarada, la sesión de una instancia vale en otra", async () => {
    const crear = async (): Promise<FastifyInstance> => {
      const app = await buildServer({
        config: loadConfig({
          KCM_ENV: "development",
          KCM_ROLE: "nube",
          KCM_ROOM_PASSWORD: "clave-sintetica-de-agenda",
          KCM_PILOT_CONSOLE_USER: "Maricela0000",
          KCM_PILOT_CONSOLE_PASSWORD: "0000",
        }),
        clock,
        sessionSecret: "llave-sintetica-compartida",
      });
      abiertos.push(app);
      return app;
    };
    const entrada = await crear();
    const otra = await crear();

    const acceso = await entrada.inject({
      method: "POST",
      url: "/acceso",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    });
    const cookie = String(acceso.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    assert.match(cookie, /^kcm_sesion=/u);

    const pantalla = await otra.inject({ method: "GET", url: "/", headers: { cookie } });
    assert.equal(pantalla.statusCode, 200);
  });

  it("la nube no arranca sin clave de agenda", () => {
    assert.throws(
      () => loadConfig({ KCM_ENV: "development", KCM_ROLE: "nube" }),
      /KCM_ROOM_PASSWORD es obligatoria/u,
    );
  });

  it("en la nube, reservar desde la agenda pública exige la clave", async () => {
    const app = await buildServer({
      config: loadConfig({
        KCM_ENV: "development",
        KCM_ROLE: "nube",
        KCM_ROOM_PASSWORD: "clave-sintetica-de-agenda",
      }),
      clock,
    });
    abiertos.push(app);
    const pantalla = (await app.inject({ method: "GET", url: "/agenda" })).body;
    contiene(pantalla, 'name="clave"', "el campo de la clave");
  });

  it("el DC-3 no tiene encargo por lote en ningún papel", async () => {
    for (const papel of ["local", "nube"] as const) {
      const app = await servidor(papel);
      const encargo = await app.inject({ method: "POST", url: "/api/dc3/jobs", payload: {} });
      assert.equal(encargo.statusCode, 404, papel);
    }
  });
});
