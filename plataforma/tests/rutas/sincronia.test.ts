import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import { SincroniaService } from "../../src/domain/sincronia/servicio.ts";
import { MUESTRA_DE_SINCRONIA } from "../../src/domain/sincronia/tipos.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import type {
  ConteoDeCampo,
  CotejoCrudo,
  MuestraDeCotejo,
  SincroniaPort,
} from "../../src/ports/sincronia.port.ts";
import { buildServer } from "../../src/server/build-server.ts";

const AHORA = "2026-09-05T12:00:00.000Z";
const reloj: Clock = { now: () => new Date(AHORA), nowIso: () => AHORA };

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
} as const;

const CAMPOS = [
  "nombre",
  "fechaAlta",
  "tipoNomina",
  "puesto",
  "area",
  "departamento",
  "planta",
] as const;

function campo(nombre: (typeof CAMPOS)[number], extra: Partial<ConteoDeCampo> = {}): ConteoDeCampo {
  const base = {
    campo: nombre,
    iguales: 100,
    equivalentes: 0,
    discrepantes: 0,
    soloMatriz: 0,
    soloPadron: 0,
  };
  const conteo = { ...base, ...extra };
  return {
    ...conteo,
    iguales:
      100 - conteo.equivalentes - conteo.discrepantes - conteo.soloMatriz - conteo.soloPadron,
  };
}

function cotejo(
  campos: readonly ConteoDeCampo[],
  extra: Partial<CotejoCrudo> = {},
  muestras: readonly MuestraDeCotejo[] = [],
): CotejoCrudo {
  return {
    fuente: {
      archivo: "Matriz de Competencias 03 Agosto.xlsb",
      hoja: "HC",
      sha256: "785978b2f083c7856afab6dc389e226af34ca487702160252691ec4532db43bb",
      extraidoEn: "2026-08-20T21:31:37.535Z",
      estado: "CONFIRMADO",
      empleados: 100,
    },
    universo: {
      enMatriz: 100,
      enPadron: 100,
      enAmbos: 100,
      soloMatriz: 0,
      soloPadron: 0,
      muestraSoloMatriz: [],
      muestraSoloPadron: [],
    },
    campos,
    muestras,
    ...extra,
  };
}

class PuertoFalso implements SincroniaPort {
  llamadas = 0;
  muestraPedida = 0;
  readonly #respuesta: CotejoCrudo | null;

  constructor(respuesta: CotejoCrudo | null) {
    this.#respuesta = respuesta;
  }

  cotejar(muestra: number): Promise<CotejoCrudo | null> {
    this.llamadas += 1;
    this.muestraPedida = muestra;
    return Promise.resolve(this.#respuesta);
  }
}

const TODO_IGUAL = CAMPOS.map((nombre) => campo(nombre));

describe("análisis de sincronía · servicio", () => {
  it("sin matriz guardada devuelve nulo en vez de un informe de ceros", async () => {
    const puerto = new PuertoFalso(null);
    const servicio = new SincroniaService({ port: puerto, clock: reloj });

    assert.equal(await servicio.cotejar(), null);
    assert.equal(puerto.muestraPedida, MUESTRA_DE_SINCRONIA);
  });

  it("con todo idéntico dicta sincronizados y no inventa diferencias", async () => {
    const servicio = new SincroniaService({
      port: new PuertoFalso(cotejo(TODO_IGUAL)),
      clock: reloj,
    });

    const informe = await servicio.cotejar();
    assert.ok(informe);
    assert.equal(informe.veredicto, "IDENTICOS");
    assert.equal(informe.diferenciasTotales, 0);
    assert.equal(informe.similitudGlobal, 1);
    assert.equal(informe.corridoEn, AHORA);
  });

  it("un acento de más no es una discrepancia, pero tampoco pasa inadvertido", async () => {
    const campos = [campo("nombre", { equivalentes: 4 }), ...CAMPOS.slice(1).map((n) => campo(n))];
    const servicio = new SincroniaService({ port: new PuertoFalso(cotejo(campos)), clock: reloj });

    const informe = await servicio.cotejar();
    assert.ok(informe);
    assert.equal(informe.veredicto, "EQUIVALENTES");
    assert.equal(informe.diferenciasTotales, 0);
    assert.equal(informe.equivalentesTotales, 4);
    assert.equal(informe.similitudGlobal, 1);

    const nombre = informe.campos.find((c) => c.campo === "nombre");
    assert.equal(nombre?.diferencias, 0);
    assert.equal(nombre?.similitud, 1);
  });

  it("las ausencias cuentan como diferencia y bajan la similitud del campo", async () => {
    const campos = [
      campo("nombre"),
      campo("fechaAlta", { discrepantes: 2 }),
      campo("tipoNomina", { soloMatriz: 1, soloPadron: 3 }),
      ...CAMPOS.slice(3).map((n) => campo(n)),
    ];
    const servicio = new SincroniaService({ port: new PuertoFalso(cotejo(campos)), clock: reloj });

    const informe = await servicio.cotejar();
    assert.ok(informe);
    assert.equal(informe.veredicto, "CON_DISCREPANCIAS");
    assert.equal(informe.diferenciasTotales, 6);

    const fecha = informe.campos.find((c) => c.campo === "fechaAlta");
    assert.equal(fecha?.comparados, 100);
    assert.equal(fecha?.diferencias, 2);
    assert.equal(fecha?.similitud, 0.98);

    const nomina = informe.campos.find((c) => c.campo === "tipoNomina");
    assert.equal(nomina?.diferencias, 4);
    assert.equal(nomina?.similitud, 0.96);
  });

  it("quien está en una sola fuente rompe el veredicto aunque los campos cuadren", async () => {
    const servicio = new SincroniaService({
      port: new PuertoFalso(
        cotejo(TODO_IGUAL, {
          universo: {
            enMatriz: 100,
            enPadron: 101,
            enAmbos: 100,
            soloMatriz: 0,
            soloPadron: 1,
            muestraSoloMatriz: [],
            muestraSoloPadron: ["90001"],
          },
        }),
      ),
      clock: reloj,
    });

    const informe = await servicio.cotejar();
    assert.ok(informe);
    assert.equal(informe.similitudGlobal, 1);
    assert.equal(informe.veredicto, "CON_DISCREPANCIAS");
    assert.equal(informe.diferenciasTotales, 1);
  });

  it("cada campo se queda sólo con sus propias muestras", async () => {
    const muestras: MuestraDeCotejo[] = [
      {
        campo: "puesto",
        numeroTrabajador: "28392",
        clase: "DISCREPANTE",
        enMatriz: "*OPERADOR",
        enPadron: "TECNICO",
      },
      {
        campo: "planta",
        numeroTrabajador: "17981",
        clase: "SOLO_MATRIZ",
        enMatriz: "ECATEPEC I",
        enPadron: null,
      },
    ];
    const campos = [
      ...CAMPOS.slice(0, 3).map((n) => campo(n)),
      campo("puesto", { discrepantes: 1 }),
      campo("area"),
      campo("departamento"),
      campo("planta", { soloMatriz: 1 }),
    ];
    const servicio = new SincroniaService({
      port: new PuertoFalso(cotejo(campos, {}, muestras)),
      clock: reloj,
    });

    const informe = await servicio.cotejar();
    assert.equal(informe?.campos.find((c) => c.campo === "puesto")?.muestras.length, 1);
    assert.equal(informe?.campos.find((c) => c.campo === "planta")?.muestras.length, 1);
    assert.equal(informe?.campos.find((c) => c.campo === "nombre")?.muestras.length, 0);
  });
});

describe("análisis de sincronía · pantalla y ruta", () => {
  async function servidor(repositorio?: SincroniaPort) {
    return buildServer({
      config: loadConfig(ENTORNO),
      clock: reloj,
      ...(repositorio ? { sincroniaRepository: repositorio } : {}),
    });
  }

  async function sesion(app: Awaited<ReturnType<typeof servidor>>): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    });
    return String(res.headers["set-cookie"]).split(";")[0] ?? "";
  }

  it("sin sesión manda al acceso con el destino puesto", async () => {
    const app = await servidor(new PuertoFalso(cotejo(TODO_IGUAL)));
    const res = await app.inject({ method: "GET", url: "/sincronia" });
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, "/acceso?destino=%2Fsincronia");
  });

  it("la pestaña está en la sección de Cargas junto a las otras tres", async () => {
    const app = await servidor(new PuertoFalso(cotejo(TODO_IGUAL)));
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });
    for (const href of ["/matriz", "/padron", "/sincronia", "/cargas"]) {
      assert.match(res.body, new RegExp(`href="${href}"`, "u"));
    }
    assert.match(res.body, /aria-current="page"[^>]*>Sincronía|Sincronía<\/a>/u);
  });

  it("sin base lo explica en vez de enseñar ceros que se leerían como cuadre", async () => {
    const app = await servidor();
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Sin conexión con la base de datos/u);
    assert.doesNotMatch(res.body, /Sincronizados/u);
  });

  it("sin matriz guardada dice qué falta y a dónde ir", async () => {
    const app = await servidor(new PuertoFalso(null));
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Todavía no hay matriz que cotejar/u);
    assert.match(res.body, /href="\/matriz"/u);
  });

  it("abrir la pestaña corre el cotejo, y sólo una vez", async () => {
    const puerto = new PuertoFalso(cotejo(TODO_IGUAL));
    const app = await servidor(puerto);
    const cookie = await sesion(app);

    const res = await app.inject({ method: "GET", url: "/sincronia", headers: { cookie } });
    assert.equal(res.statusCode, 200);
    assert.equal(puerto.llamadas, 1);
    assert.match(res.body, /Sincronizados/u);
    assert.doesNotMatch(res.body, /Qué significa|Lectura|ausencia no es baja|Idéntico en las dos/u);

    await app.inject({ method: "GET", url: "/sincronia", headers: { cookie } });
    assert.equal(puerto.llamadas, 2);
  });

  it("enseña las discrepancias con su número de nómina y los dos valores", async () => {
    const muestras: MuestraDeCotejo[] = [
      {
        campo: "puesto",
        numeroTrabajador: "28392",
        clase: "DISCREPANTE",
        enMatriz: "*OPERADOR",
        enPadron: "TECNICO",
      },
    ];
    const campos = [
      ...CAMPOS.slice(0, 3).map((n) => campo(n)),
      campo("puesto", { discrepantes: 1 }),
      ...CAMPOS.slice(4).map((n) => campo(n)),
    ];
    const app = await servidor(new PuertoFalso(cotejo(campos, {}, muestras)));
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });

    assert.match(res.body, /Con diferencias/u);
    assert.match(res.body, /28392/u);
    assert.match(res.body, /\*OPERADOR/u);
    assert.match(res.body, /TECNICO/u);
    assert.match(res.body, /99 %/u);
  });

  it("una diferencia entre diez mil no se redondea hasta desaparecer", async () => {
    const campos = [
      {
        campo: "nombre" as const,
        iguales: 9999,
        equivalentes: 0,
        discrepantes: 1,
        soloMatriz: 0,
        soloPadron: 0,
      },
      ...CAMPOS.slice(1).map((n) => campo(n)),
    ];
    const app = await servidor(new PuertoFalso(cotejo(campos)));
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });

    assert.match(res.body, /99\.9 %/u);
    assert.doesNotMatch(res.body, /100\.0 %/u);
  });

  it("una discrepancia de nombre se enseña sin el nombre", async () => {
    const muestras: MuestraDeCotejo[] = [
      {
        campo: "nombre",
        numeroTrabajador: "28392",
        clase: "DISCREPANTE",
        enMatriz: null,
        enPadron: null,
      },
    ];
    const campos = [campo("nombre", { discrepantes: 1 }), ...CAMPOS.slice(1).map((n) => campo(n))];
    const app = await servidor(new PuertoFalso(cotejo(campos, {}, muestras)));
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });

    assert.match(res.body, /28392/u);
    assert.match(res.body, /no se muestra/u);
  });

  it("la falla de la consulta deja la pestaña usable en vez de la pantalla de error", async () => {
    const puerto: SincroniaPort = {
      cotejar: () => Promise.reject(new Error("la base no respondió")),
    };
    const app = await servidor(puerto);
    const res = await app.inject({
      method: "GET",
      url: "/sincronia",
      headers: { cookie: await sesion(app) },
    });

    assert.equal(res.statusCode, 503);
    assert.match(res.body, /El cotejo no pudo completarse/u);
    assert.match(res.body, /href="\/matriz"/u);
  });
});
