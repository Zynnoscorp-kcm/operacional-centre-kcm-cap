import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { loadConfig, type AppConfig, type EnvSource } from "../../src/config/environment.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { hojaDeEstilos } from "../../src/web/estaticos.ts";

const MOMENTO_FIJO = "2026-08-02T20:37:00.000Z";

const relojFijo: Clock = {
  now: () => new Date(MOMENTO_FIJO),
  nowIso: () => MOMENTO_FIJO,
};

/** La bitácora va a un sumidero: una prueba no debe ensuciar la salida. */
const sumidero = (): Writable =>
  new Writable({
    write(_fragmento, _codificacion, listo): void {
      listo();
    },
  });

const abiertos: FastifyInstance[] = [];

afterEach(async () => {
  while (abiertos.length > 0) {
    await abiertos.pop()?.close();
  }
});

async function servidor(entorno: EnvSource = {}): Promise<FastifyInstance> {
  // Estas pruebas miran cabeceras, errores y forma de las pantallas, no la
  // puerta: el guardia vive en `guardia.test.ts`. Un entorno propio manda, para
  // que las pruebas de producción sigan cargando su configuración tal cual.
  const config: AppConfig = loadConfig(
    Object.keys(entorno).length === 0 ? { KCM_PILOT_OPEN_ACCESS: "true" } : entorno,
  );
  const app = await buildServer({ config, clock: relojFijo, logDestination: sumidero() });
  abiertos.push(app);
  return app;
}

describe("comprobación de salud", () => {
  it("responde 200 con la forma declarada", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: "/healthz" });

    assert.equal(respuesta.statusCode, 200);
    const cuerpo = respuesta.json<{
      status: string;
      environment: string;
      checkedAt: string;
      uptimeSeconds: number;
      checks: unknown[];
    }>();
    assert.equal(cuerpo.status, "ok");
    assert.equal(cuerpo.environment, "development");
    assert.equal(cuerpo.checkedAt, MOMENTO_FIJO, "la hora debe venir del puerto de reloj");
    assert.equal(typeof cuerpo.uptimeSeconds, "number");
    assert.deepEqual(cuerpo.checks, [], "hoy no hay dependencia externa que comprobar");
  });

  it("no se cachea", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(respuesta.headers["cache-control"], "no-store");
  });
});

describe("pantalla base", () => {
  it("responde HTML con los tokens de marca enlazados", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: "/" });

    assert.equal(respuesta.statusCode, 200);
    assert.match(String(respuesta.headers["content-type"]), /text\/html/u);
    assert.ok(respuesta.body.startsWith("<!doctype html>"));
    assert.ok(respuesta.body.includes(hojaDeEstilos.ruta), "no enlaza la hoja de estilos");
    assert.ok(respuesta.body.includes('lang="es-MX"'));
  });

  /**
   * Inicio dejó de ser un índice de funciones con su disponibilidad al lado. Lo
   * que se comprueba ahora es que sea un tablero del día: los cuatro mosaicos y
   * las tres tarjetas, cada una con su estado vacío escrito, porque con
   * repositorios en memoria no hay nada que listar y una tarjeta en blanco no
   * dice si está vacía o rota.
   */
  it("es un tablero del día y no un índice de funciones", async () => {
    const app = await servidor();
    const cuerpo = (await app.inject({ method: "GET", url: "/" })).body;

    for (const mosaico of [
      "Sesiones de hoy",
      "Sesiones abiertas",
      "Salas ocupadas",
      "Pendientes de liberación",
    ]) {
      assert.ok(cuerpo.includes(mosaico), `falta el mosaico «${mosaico}»`);
    }

    assert.ok(cuerpo.includes("Sin sesiones agendadas para hoy."));
    assert.ok(cuerpo.includes("Sin reservaciones para hoy."));
    assert.ok(cuerpo.includes("Sin pendientes de liberación."));

    // La retícula de funciones y sus estados de proyecto ya no existen.
    assert.equal(cuerpo.includes("rejilla-funciones"), false);
    assert.equal(cuerpo.includes("Función 1"), false);
    assert.equal(cuerpo.includes("Disponible; pantalla de sala"), false);
  });

  /**
   * El menú lateral es la única lista de secciones que queda, y son doce: las
   * veinte entradas planas de antes se agruparon en secciones con sub-pestañas
   * dentro de cada pantalla. Sin esta prueba, añadir la vigésimo primera entrada
   * al lateral vuelve a ser gratis.
   */
  it("el lateral lleva doce secciones y ninguna función quedó sin puerta", async () => {
    const app = await servidor();
    const cuerpo = (await app.inject({ method: "GET", url: "/" })).body;

    // Sólo el menú, sin el pie de pantallas de sala, que no son secciones.
    const menu = cuerpo.slice(
      cuerpo.indexOf('<nav class="lateral-nav"'),
      cuerpo.indexOf('<nav class="lateral-pie"'),
    );
    const entradas = menu.match(/class="lateral-enlace"/gu) ?? [];
    assert.equal(entradas.length, 12, "el lateral cambió de tamaño");

    for (const destino of [
      "/",
      "/sesiones",
      "/salas",
      "/preliberacion",
      "/liberacion",
      "/auditoria",
      "/trabajadores",
      "/matriz",
      "/ocupaciones",
      "/dc3",
      "/excel",
      "/base",
    ]) {
      assert.ok(cuerpo.includes(`href="${destino}"`), `el lateral no lleva a ${destino}`);
    }
  });

  it("no publica porcentajes ni identidad alguna", async () => {
    const app = await servidor();
    const cuerpo = (await app.inject({ method: "GET", url: "/" })).body;

    assert.ok(!/\d+\s?%/u.test(cuerpo), "apareció un porcentaje; no se publican todavía");
    assert.ok(!/(?<!\d)\d{5}(?!\d)/u.test(cuerpo), "apareció algo con forma de número de nómina");
    assert.ok(!/\bCURP\b/u.test(cuerpo));
  });

  it("no carga script alguno, en línea ni externo", async () => {
    const app = await servidor();
    const cuerpo = (await app.inject({ method: "GET", url: "/" })).body;

    assert.ok(!cuerpo.includes("<script"), "la política de contenido lo bloquearía");
    assert.ok(!cuerpo.includes("style="), "un estilo en línea no se aplicaría bajo la política");
    assert.ok(!/https?:\/\//u.test(cuerpo), "no debe apuntar a ningún origen externo");
  });
});

describe("cabeceras de seguridad", () => {
  it("van en toda respuesta, incluida la de error", async () => {
    const app = await servidor();
    for (const url of ["/", "/healthz", "/no-existe"]) {
      const respuesta = await app.inject({ method: "GET", url });
      assert.equal(respuesta.headers["x-content-type-options"], "nosniff", url);
      assert.equal(respuesta.headers["x-frame-options"], "DENY", url);
      assert.equal(respuesta.headers["referrer-policy"], "no-referrer", url);
      assert.match(
        String(respuesta.headers["content-security-policy"]),
        /default-src 'none'/u,
        url,
      );
      assert.match(
        String(respuesta.headers["content-security-policy"]),
        /frame-ancestors 'none'/u,
        url,
      );
    }
  });

  it("no anuncia transporte estricto fuera de producción, y sí en producción", async () => {
    const desarrollo = await servidor();
    assert.equal(
      (await desarrollo.inject({ method: "GET", url: "/healthz" })).headers[
        "strict-transport-security"
      ],
      undefined,
    );

    const produccion = await servidor({
      KCM_ENV: "production",
      // Producción exige base declarada; aquí sólo se ejercita la cabecera.
      KCM_DATABASE_URL: "postgresql://u:p@localhost:5432/postgres",
    });
    assert.match(
      String(
        (await produccion.inject({ method: "GET", url: "/healthz" })).headers[
          "strict-transport-security"
        ],
      ),
      /max-age=31536000/u,
    );
  });
});

describe("identificador de petición", () => {
  it("viaja en la respuesta", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: "/healthz" });
    assert.match(
      String(respuesta.headers["x-request-id"]),
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u,
    );
  });

  it("lo genera el servidor y no lo toma de la cabecera de quien llama", async () => {
    const app = await servidor();
    const respuesta = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "elegido-por-quien-llama" },
    });
    assert.notEqual(respuesta.headers["x-request-id"], "elegido-por-quien-llama");
  });

  it("cambia entre peticiones", async () => {
    const app = await servidor();
    const uno = await app.inject({ method: "GET", url: "/healthz" });
    const dos = await app.inject({ method: "GET", url: "/healthz" });
    assert.notEqual(uno.headers["x-request-id"], dos.headers["x-request-id"]);
  });
});

describe("manejo de errores", () => {
  it("una ruta que no existe responde 404 en JSON con su requestId", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: "/no-existe" });

    assert.equal(respuesta.statusCode, 404);
    const cuerpo = respuesta.json<{ error: { code: string; requestId: string } }>();
    assert.equal(cuerpo.error.code, "NO_ENCONTRADO");
    assert.equal(cuerpo.error.requestId, respuesta.headers["x-request-id"]);
  });

  it("la misma ruta responde la pantalla de error si el cliente pide HTML", async () => {
    const app = await servidor();
    const respuesta = await app.inject({
      method: "GET",
      url: "/no-existe",
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    assert.equal(respuesta.statusCode, 404);
    assert.match(String(respuesta.headers["content-type"]), /text\/html/u);
    assert.ok(respuesta.body.includes("NO_ENCONTRADO"));
    assert.ok(respuesta.body.includes(String(respuesta.headers["x-request-id"])));
  });

  it("una falla interna no filtra su causa, ni siquiera fuera de producción", async () => {
    const app = await servidor();
    app.get("/falla", () => {
      throw new Error("la contraseña de la base es hunter2");
    });

    const respuesta = await app.inject({ method: "GET", url: "/falla" });

    assert.equal(respuesta.statusCode, 500);
    assert.ok(!respuesta.body.includes("hunter2"), "filtró el mensaje interno");
    assert.ok(!respuesta.body.includes("at "), "filtró el rastro de pila");
    const cuerpo = respuesta.json<{ error: { code: string; message: string } }>();
    assert.equal(cuerpo.error.code, "ERROR_INTERNO");
    assert.match(cuerpo.error.message, /identificador de esta petición/u);
  });

  it("un error del dominio se traduce a 400, no a 500", async () => {
    const app = await servidor();
    app.get("/dominio", () => parseWorkerNumber("no-es-un-numero"));

    const respuesta = await app.inject({ method: "GET", url: "/dominio" });

    assert.equal(respuesta.statusCode, 400);
    const cuerpo = respuesta.json<{ error: { code: string; message: string } }>();
    assert.equal(cuerpo.error.code, "SOLICITUD_INVALIDA");
    assert.match(cuerpo.error.message, /Número de trabajador inválido/u);
    assert.ok(!cuerpo.error.message.includes("no-es-un-numero"), "filtró el valor recibido");
  });
});

describe("hoja de estilos", () => {
  it("se sirve bajo su hash y se puede cachear para siempre", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: hojaDeEstilos.ruta });

    assert.equal(respuesta.statusCode, 200);
    assert.match(String(respuesta.headers["content-type"]), /text\/css/u);
    assert.equal(respuesta.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(respuesta.headers["etag"], `"${hojaDeEstilos.hash}"`);
  });

  /**
   * Las tipografías viajan con la plataforma: la política declara `font-src
   * 'self'`, y una familia que no se sirve desde aquí se dibujaba distinta en
   * cada computadora, según lo que cada una tuviera instalado.
   */
  it("sirve sus propias tipografías, bajo su hash y con caché eterna", async () => {
    const app = await servidor();
    const hoja = (await app.inject({ method: "GET", url: hojaDeEstilos.ruta })).body;

    const fuentes = [
      ...hoja.matchAll(/url\("(\/assets\/fuentes\/[a-z-]+-[a-z]{12}\.woff2)"\)/gu),
    ].map((m) => m[1] ?? "");
    assert.equal(fuentes.length, 4, "faltan caras tipográficas en la hoja");
    assert.match(hoja, /font-family: "Manrope"/u);
    assert.match(hoja, /font-family: "IBM Plex Mono"/u);
    for (const ruta of fuentes) {
      const archivo = await app.inject({ method: "GET", url: ruta });
      assert.equal(archivo.statusCode, 200, ruta);
      assert.equal(archivo.headers["content-type"], "font/woff2");
      assert.equal(archivo.headers["cache-control"], "public, max-age=31536000, immutable");
      assert.equal(archivo.rawPayload.subarray(0, 4).toString("latin1"), "wOF2");
    }
  });

  it("trae los tokens de marca", async () => {
    const app = await servidor();
    const cuerpo = (await app.inject({ method: "GET", url: hojaDeEstilos.ruta })).body;

    assert.ok(cuerpo.includes("#224c9f"), "falta el azul de marca");
    assert.ok(cuerpo.includes('"Avenir Next"'), "falta la tipografía");
    assert.ok(cuerpo.includes('"Segoe UI"'), "falta el respaldo de tipografía");
    assert.match(cuerpo, /--kcm-radius:\s*20px/u);
    assert.match(cuerpo, /--kcm-radius-lg:\s*24px/u);
  });

  /**
   * El azul de marca se declara una vez y se usa por variable. Un literal
   * suelto en `base.css` es la forma en que un rediseño se queda a medias: la
   * pantalla que lo lleva se queda con el color viejo y nadie lo nota hasta
   * verla al lado de otra.
   */
  it("el color vive en los tokens y no suelto en la hoja de componentes", async () => {
    const app = await servidor();
    const cuerpo = (await app.inject({ method: "GET", url: hojaDeEstilos.ruta })).body;
    const componentes = cuerpo.slice(cuerpo.indexOf("Hoja de la consola central"));

    assert.doesNotMatch(componentes, /#224c9f/iu, "el azul de marca está escrito a mano");
  });

  it("una versión que ya no existe responde 404, no la hoja vigente", async () => {
    const app = await servidor();
    const respuesta = await app.inject({ method: "GET", url: "/assets/kcm-000000000000.css" });
    assert.equal(respuesta.statusCode, 404);
  });
});
