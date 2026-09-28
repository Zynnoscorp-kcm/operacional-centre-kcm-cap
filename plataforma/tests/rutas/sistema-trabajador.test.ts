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
    // El encabezado de cada columna coincide con lo que la columna trae: la
    // nómina va primero, y la fecha de ingreso se lee, no se descifra.
    const encabezados = [...res.payload.matchAll(/<th scope="col">([^<]+)<\/th>/gu)].map(
      (m) => m[1],
    );
    assert.deepEqual(encabezados, [
      "Nómina",
      "Trabajador",
      "Área",
      "Personal",
      "Ingreso",
      "Planta",
    ]);
    assert.match(res.payload, /15 mar 2018/u);
    assert.doesNotMatch(res.payload, /2018-03-15/u);
    // El nombre lleva a la ficha; no hace falta un botón aparte por renglón.
    assert.match(res.payload, /<a class="persona-nombre" href="\/trabajadores\/01234">/u);
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

  it("GET /trabajadores/departamentos responde 200 con el avance de cada departamento", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/departamentos",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /Avance por departamento/);
    assert.match(res.payload, /GERENCIA DE MANTTO\./);
    assert.match(res.payload, /OPERACION CONVERTIDORA/);
    // Quien no tiene departamento se dice en palabras, no con la clave de la base.
    assert.match(res.payload, /Sin departamento/);
    assert.doesNotMatch(res.payload, /SIN_DEPARTAMENTO/);
    // Cada departamento lleva su barra de avance y la cuenta escrita al lado.
    assert.match(res.payload, /class="avance-lienzo"/u);
    assert.match(res.payload, /<strong>0<\/strong>\/18/u);
  });

  it("GET /trabajadores/cursos responde 200 con el avance de cada curso exigible", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/cursos",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /Cobertura por curso/);
    assert.match(res.payload, /BUENAS PRACTICAS DE MANUFACTURA/);
    // Sin claves internas ni el nivel de la regla en inglés: son del catálogo, no
    // de quien consulta la cobertura.
    assert.doesNotMatch(res.payload, /kcm-course:/u);
    assert.doesNotMatch(res.payload, />\s*DEPARTMENT\s*</u);
    assert.match(res.payload, /Avance por curso/);
    assert.match(res.payload, /sin\s+trabajadores a los que aplique/u);
  });

  /**
   * La comparativa de planta repetía las cifras de Departamentos en tarjetas.
   * Las dos vistas son una; la dirección vieja lleva a la que quedó.
   */
  it("GET /trabajadores/comparativa lleva a Departamentos", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/comparativa",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.location, "/trabajadores/departamentos");
  });

  it("la cobertura DNC no enseña comandos ni jerga de la base", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/cobertura",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /Estado de los datos/u);
    assert.doesNotMatch(res.payload, /scripts\/|--aplicar|node /u);
    assert.doesNotMatch(res.payload, /\bHC\b|regla DNC/u);
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
    assert.match(res.payload, /Nómina 01234/);
    // Las cuatro cifras de la cabecera, con su palabra.
    for (const rotulo of ["Acreditados", "Por reforzar", "Programados", "Pendientes"]) {
      assert.match(res.payload, new RegExp(`${rotulo}\\s*</dt>`, "u"), rotulo);
    }
    assert.match(res.payload, /Cursos del puesto/);
    assert.match(res.payload, /Trayectoria/);
    assert.match(res.payload, /Constancias DC-3/);
    // Desde la ficha se llega al expediente DC-3, donde se emite y se reimprime.
    assert.match(res.payload, /href="\/dc3\/trabajador\/01234"/);
    // La procedencia de cada registro se dice en palabras.
    assert.match(res.payload, /Registro de la matriz de capacitación/);
    assert.match(res.payload, /Sesión liberada en la plataforma/);
  });

  /**
   * La ficha es para quien consulta a una persona: sin claves internas, sin
   * niveles de regla en inglés y sin estados en mayúsculas de sistema.
   */
  it("la ficha no enseña claves ni estados internos", async () => {
    const app = await crearServidor();
    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/01234",
      headers: { accept: "text/html" },
    });

    for (const interno of [
      "XLSB_IMPORT",
      "SESSION_RELEASE",
      "DEPARTMENT",
      ">PENDIENTE<",
      ">REFORZAR<",
      "TECNICO<",
      "HISTORIAL_MATRIZ",
      "Porcentajes en validación",
    ]) {
      assert.ok(!res.payload.includes(interno), `la ficha enseña ${interno}`);
    }
    // Las fechas se leen: «10 feb 2024», no «2024-02-10».
    assert.match(res.payload, /10 feb 2024/u);
  });

  it("la ficha pone a la persona en una línea de tiempo, hasta su ingreso", async () => {
    const app = await crearServidor();
    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/01234",
      headers: { accept: "text/html" },
    });

    assert.match(res.payload, /<ol class="dnc-linea">/u);
    assert.match(res.payload, /Ingreso a Kimberly-Clark de México/u);
    assert.match(
      res.payload,
      /<time class="dnc-hito-fecha" datetime="2018-03-15">15 mar 2018<\/time>/u,
    );
  });

  it("la telaraña compara con el área y no se viste de vidrio", async () => {
    const app = await crearServidor();
    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/01234",
      headers: { accept: "text/html" },
    });

    assert.match(res.payload, /<svg\s+class="dnc-radar-lienzo"/u);
    assert.match(res.payload, /class="dnc-radar-persona"/u);
    assert.doesNotMatch(res.payload, /radialGradient|feGaussianBlur|radar-lente/u);
    // Sin porcentaje de cumplimiento: se publica cuando el departamento apruebe las reglas.
    assert.doesNotMatch(res.payload, /Avance medio/u);
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

  it("las vistas de Trabajadores son sub-pestañas de la sección", async () => {
    const app = await crearServidor();

    const res = await app.inject({
      method: "GET",
      url: "/trabajadores/departamentos",
      headers: { accept: "text/html" },
    });

    assert.equal(res.statusCode, 200);
    // La sección activa en el lateral es Trabajadores, no la vista concreta.
    assert.match(res.payload, /href="\/trabajadores"\s+aria-current="page"/u);
    for (const vista of [
      "/trabajadores/cursos",
      "/trabajadores/cobertura",
      "/trabajadores/departamentos",
    ]) {
      assert.match(
        res.payload,
        new RegExp(`class="subpestana"\\s+href="${vista}"`, "u"),
        `falta la sub-pestaña ${vista}`,
      );
    }
    assert.doesNotMatch(res.payload, /href="\/trabajadores\/comparativa"/u);
  });
});
