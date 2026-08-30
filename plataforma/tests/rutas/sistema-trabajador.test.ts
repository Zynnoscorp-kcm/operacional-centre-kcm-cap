import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config/environment.ts";
import { buildServer } from "../../src/server/build-server.ts";

const sumidero = (): Writable =>
  new Writable({
    write(_chunk, _encoding, callback): void {
      callback();
    },
  });

describe("Función 8: Sistema General por Trabajador (Integración Web)", () => {
  const config = loadConfig({
    PORT: "3000",
    HOST: "127.0.0.1",
    ENVIRONMENT: "development",
    KCM_PILOT_OPEN_ACCESS: "true",
  });

  const abiertos: FastifyInstance[] = [];

  afterEach(async () => {
    while (abiertos.length > 0) {
      await abiertos.pop()?.close();
    }
  });

  async function crearServidor(): Promise<FastifyInstance> {
    const app = await buildServer({ config, logDestination: sumidero() });
    abiertos.push(app);
    return app;
  }

  it("GET /trabajadores responde 200 con la lista de trabajadores y filtros", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] ?? "", /text\/html/);
    assert.match(res.payload, /Directorio de trabajadores/);
    assert.match(res.payload, /01234/);
    assert.match(res.payload, /JUAN PÉREZ GARCÍA/);
    assert.match(res.payload, /GERENCIA DE MANTTO\./);
  });

  it("GET /trabajadores filtra por término de búsqueda", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores?q=01234",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /JUAN PÉREZ GARCÍA/);
    assert.doesNotMatch(res.payload, /MARÍA LÓPEZ SÁNCHEZ/);
  });

  it("GET /trabajadores filtra por departamento", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores?department=CALIDAD",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /ROBERTO SOTO HERNÁNDEZ/);
    assert.doesNotMatch(res.payload, /JUAN PÉREZ GARCÍA/);
  });

  it("GET /trabajadores combina área, tipo de nómina y rango de ingreso", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores?area=ASEGURAMIENTO&payrollType=NS&hireDateFrom=2015-01-01&hireDateTo=2016-12-31",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /ROBERTO SOTO HERNÁNDEZ/);
    assert.doesNotMatch(res.payload, /JUAN PÉREZ GARCÍA/);
    assert.match(res.payload, /Sindicalizados \(NS\)/);
  });

  it("GET /trabajadores/departamentos responde 200 con el resumen departamental y aviso", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/departamentos",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /Detalle por departamento/);
    assert.match(res.payload, /GERENCIA DE MANTTO\./);
    assert.match(res.payload, /OPERACION CONVERTIDORA/);
    assert.match(res.payload, /Porcentajes pendientes de autorización/);
  });

  it("GET /trabajadores/cursos responde 200 con el catálogo de cursos unificados y reglas", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/cursos",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /Cobertura por curso/);
    assert.match(res.payload, /BUENAS PRACTICAS DE MANUFACTURA/);
    assert.match(res.payload, /kcm-course:bpm/);
    assert.match(res.payload, /cursos<\/span>/);
  });

  it("GET /trabajadores/comparativa responde 200 con la comparativa de planta", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/comparativa",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    // El título vive una sola vez, en la barra de la envoltura: la pantalla ya
    // no lo repite arriba del contenido.
    assert.match(res.payload, /<h1 class="barra-titulo">Comparativa de planta<\/h1>/u);
    assert.match(res.payload, /GERENCIA DE MANTTO\./);
  });

  it("GET /trabajadores/01234 responde 200 con la ficha completa del trabajador", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/01234",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /JUAN PÉREZ GARCÍA/);
    assert.match(res.payload, /Nómina: 01234/);
    assert.match(res.payload, /TECNICO/);
    assert.match(res.payload, /Cursos exigibles/);
    assert.match(res.payload, /Cursos acreditados vigentes/);
    assert.match(res.payload, /Cursos por realizar o actualizar/);
    assert.match(res.payload, /Trayectoria de capacitación/);
    assert.match(res.payload, /Constancias DC-3/);
    assert.match(res.payload, /XLSB_IMPORT/);
    assert.match(res.payload, /SESSION_RELEASE/);
  });

  /**
   * El plan del trimestre se retiró de la ficha y del dominio: era la tabla de
   * cursos por atender con una prioridad y un trimestre que la plataforma
   * inventaba, sin respaldo en la base y sin quien los aprobara.
   */
  it("la ficha ya no promete un plan del trimestre", async () => {
    const app = await crearServidor();
    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/01234",
      headers: { accept: "text/html" },
    });

    assert.doesNotMatch(res.payload, /Plan de Capacitación del Trimestre/u);
    assert.doesNotMatch(res.payload, /Periodo Sugerido/u);
    assert.doesNotMatch(res.payload, /insignia-prioridad/u);
  });

  /**
   * La clave del curso no le dice nada a quien consulta una ficha y ocupaba la
   * primera columna. Sigue en el modelo; lo que se fue es la columna.
   */
  it("las tablas de cursos de la ficha no llevan columna de código", async () => {
    const app = await crearServidor();
    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/01234",
      headers: { accept: "text/html" },
    });

    const seccion = res.payload.slice(
      res.payload.indexOf("Cursos exigibles"),
      res.payload.indexOf("Trayectoria de capacitación"),
    );
    assert.ok(seccion.length > 0, "no se encontró la sección de cursos exigibles");
    assert.doesNotMatch(seccion, /<th scope="col">Código<\/th>/u);
    assert.match(seccion, /<th scope="col">Nombre del curso<\/th>/u);
  });

  it("GET /trabajadores/99999 devuelve 404 para un trabajador inexistente", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/99999",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 404);
    assert.match(res.payload, /NO_ENCONTRADO|No se encontró/i);
  });

  it("GET /trabajadores/1234 devuelve 404 para número de 4 dígitos (no es WorkerNumber)", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/1234",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 404);
  });

  it("GET /api/v1/trabajadores/01234/dnc devuelve 200 con JSON estructurado", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trabajadores/01234/dnc",
    });

    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.payload);
    assert.equal(json.data.worker.employeeId, "01234");
    assert.equal(json.data.category.category, "TECNICO");
    assert.equal(json.data.category.ruleId, "REG-CAT-2026-V1");
    assert.equal(json.data.metrics.publicacionAutorizada, false);
    assert.ok(Array.isArray(json.data.courseEvaluations));
    assert.ok(json.data.courseEvaluations.length > 0);
  });

  it("GET /api/v1/trabajadores/abcde/dnc devuelve 400 por número mal formado", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trabajadores/abcde/dnc",
    });

    assert.equal(res.statusCode, 400);
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, "NUMERO_TRABAJADOR_INVALIDO");
  });

  it("GET / lleva al directorio de trabajadores desde el menú lateral", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /href="\/trabajadores"/);
    assert.match(res.payload, /<span class="lateral-nombre">Trabajadores<\/span>/);
  });

  it("las cuatro vistas de la Función 8 son sub-pestañas de Trabajadores", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/comparativa",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    // La sección activa en el lateral es Trabajadores, no la vista concreta.
    assert.match(res.payload, /href="\/trabajadores"\s+aria-current="page"/u);
    for (const vista of [
      "/trabajadores/cursos",
      "/trabajadores/cobertura",
      "/trabajadores/departamentos",
      "/trabajadores/comparativa",
    ]) {
      assert.match(
        res.payload,
        new RegExp(`class="subpestana"\\s+href="${vista}"`, "u"),
        `falta la sub-pestaña ${vista}`,
      );
    }
  });
});
