import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryLoadLog } from "../../src/adapters/memoria/bitacora-cargas.ts";
import { SupabaseLoadLog } from "../../src/adapters/postgres/bitacora-cargas.ts";
import { BitacoraDeCargas } from "../../src/domain/cargas/bitacora.ts";
import type { AsientoDeCarga, CargaRegistrada } from "../../src/domain/cargas/tipos.ts";
import { RosterIngestService } from "../../src/domain/padron/ingesta.ts";
import type { PadronLeido, RosterExtractorPort } from "../../src/domain/padron/tipos.ts";
import type { LoadLogPort } from "../../src/ports/bitacora-cargas.port.ts";
import type {
  EscriturasDePadron,
  FilaDePadronBase,
  InduccionPropuesta,
  PuestoDelCatalogo,
  RosterRepositoryPort,
} from "../../src/ports/padron.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { loadConfig } from "../../src/config/environment.ts";

const FECHA_FIJA = new Date("2026-08-18T12:00:00.000Z");
const clock = { now: () => FECHA_FIJA, nowIso: () => FECHA_FIJA.toISOString() };

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
} as const;

function padron(sha256: string): PadronLeido {
  return {
    source: { sha256, byteSize: 1024 },
    employees: [
      {
        employeeId: "00001",
        displayName: "TRABAJADOR 00001",
        position: "OPERADOR",
        curp: "AAAA800101HDFXXX01",
        hireDate: "2020-01-15",
        cnoKey: "",
        payrollType: "NS",
        plant: "ECATEPEC I",
        issues: [],
      },
    ],
    diagnostics: { employeeCount: 1, readyEmployeeCount: 1, issues: {} },
  };
}

class ExtractorFalso implements RosterExtractorPort {
  readonly #resultado: PadronLeido;

  constructor(resultado: PadronLeido) {
    this.#resultado = resultado;
  }

  extraer(): PadronLeido {
    return this.#resultado;
  }
}

class RepositorioFalso implements RosterRepositoryPort {
  aplicaciones = 0;
  leerPadronBase(): Promise<readonly FilaDePadronBase[]> {
    return Promise.resolve([
      {
        trabajadorId: "00000000-0000-4000-8000-000000000001",
        numeroTrabajador: "00001",
        curp: null,
        fechaAlta: null,
        puesto: "OPERADOR",
        area: "CONVERTIDORA",
        claveOcupacion: null,
        tipoNomina: null,
        planta: null,
        activo: true,
      },
    ]);
  }
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    return Promise.resolve([{ nombre: "OPERADOR", claveCno: null }]);
  }
  revisarInducciones(propuestas: readonly InduccionPropuesta[]) {
    return Promise.resolve({ nuevas: propuestas.length, divergentes: 0 });
  }
  aplicar(escrituras: EscriturasDePadron) {
    this.aplicaciones += 1;
    return Promise.resolve({
      curp: escrituras.curp.length,
      altas: escrituras.altas.length,
      inducciones: escrituras.inducciones.length,
      ocupaciones: escrituras.ocupaciones.length,
    });
  }
}

class RepositorioDivergente implements RosterRepositoryPort {
  ultimasEscrituras: EscriturasDePadron | undefined;
  readonly #base: { tipoNomina: string | null; planta: string | null };

  constructor(base: { tipoNomina: string | null; planta: string | null }) {
    this.#base = base;
  }

  leerPadronBase(): Promise<readonly FilaDePadronBase[]> {
    return Promise.resolve([
      {
        trabajadorId: "00000000-0000-4000-8000-000000000001",
        numeroTrabajador: "00001",
        curp: null,
        fechaAlta: null,
        puesto: "OPERADOR",
        area: "CONVERTIDORA",
        claveOcupacion: null,
        tipoNomina: this.#base.tipoNomina,
        planta: this.#base.planta,
        activo: true,
      },
    ]);
  }
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    return Promise.resolve([{ nombre: "OPERADOR", claveCno: null }]);
  }
  revisarInducciones(propuestas: readonly InduccionPropuesta[]) {
    return Promise.resolve({ nuevas: propuestas.length, divergentes: 0 });
  }
  aplicar(escrituras: EscriturasDePadron) {
    this.ultimasEscrituras = escrituras;
    return Promise.resolve({
      curp: escrituras.curp.length,
      altas: escrituras.altas.length,
      inducciones: escrituras.inducciones.length,
      ocupaciones: escrituras.ocupaciones.length,
    });
  }
}

class BitacoraRota implements LoadLogPort {
  registrar(): Promise<CargaRegistrada | undefined> {
    return Promise.reject(new Error("la base no responde"));
  }
  listar(): Promise<readonly CargaRegistrada[]> {
    return Promise.reject(new Error("la base no responde"));
  }
  ultimaAplicada(): Promise<CargaRegistrada | undefined> {
    return Promise.reject(new Error("la base no responde"));
  }
}

function servicio(input: { puerto?: LoadLogPort; sha256?: string }): {
  servicio: RosterIngestService;
  repositorio: RepositorioFalso;
  puerto: LoadLogPort;
} {
  const puerto = input.puerto ?? new MemoryLoadLog(clock);
  const repositorio = new RepositorioFalso();
  return {
    puerto,
    repositorio,
    servicio: new RosterIngestService({
      repository: repositorio,
      extractor: new ExtractorFalso(padron(input.sha256 ?? "a".repeat(64))),
      clock,
      bitacora: new BitacoraDeCargas(puerto, clock),
    }),
  };
}

describe("Bitácora de cargas · qué queda asentado", () => {
  it("el padrón asienta revisión y aplicación, en ese orden", async () => {
    const { servicio: padronService, puerto } = servicio({});

    const plan = await padronService.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    await padronService.aplicar(plan.planId, "Maricela0000");

    const asientos = await puerto.listar(10);
    assert.deepEqual(
      asientos.map((asiento) => asiento.hecho),
      ["APLICADA", "REVISADA"],
    );
    assert.ok(asientos.every((asiento) => asiento.tipo === "PADRON"));
  });

  it("la carga aplicada conserva quién la aplicó, qué archivo y qué escribió", async () => {
    const { servicio: padronService, puerto } = servicio({});

    const plan = await padronService.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    await padronService.aplicar(plan.planId, "Antonio0000");

    const [aplicada] = await puerto.listar(1);
    assert.equal(aplicada?.actor, "Antonio0000");
    assert.equal(aplicada?.archivo, "sem 33 CAP.xlsx");
    assert.equal(aplicada?.sha256, "a".repeat(64));
    assert.equal(aplicada?.resumen["curp"], 1);
    assert.equal(aplicada?.resumen["inducciones"], 1);
  });

  it("una revisión vencida queda asentada como rechazo, no desaparece", async () => {
    const { servicio: padronService, puerto } = servicio({});

    await assert.rejects(
      () => padronService.aplicar("plan-que-no-existe", "Maricela0000"),
      /ya no está disponible/u,
    );

    const [rechazo] = await puerto.listar(1);
    assert.equal(rechazo?.hecho, "RECHAZADA");
    assert.equal(rechazo?.resumen["motivo"], "ROSTER_PLAN_NOT_FOUND");
  });
});

describe("Bitácora de cargas · comparación con la carga anterior", () => {
  it("sin carga previa no hay comparación, y eso no es «sin cambios»", async () => {
    const { servicio: padronService } = servicio({});
    await padronService.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    assert.equal(padronService.comparacion(), undefined);
  });

  it("reconoce el mismo archivo por su huella, aunque cambie de nombre", async () => {
    const puerto = new MemoryLoadLog(clock);
    const primero = servicio({ puerto, sha256: "b".repeat(64) });
    const plan = await primero.servicio.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    await primero.servicio.aplicar(plan.planId, "Maricela0000");

    const segundo = servicio({ puerto, sha256: "b".repeat(64) });
    await segundo.servicio.previsualizar(Buffer.from("x"), "sem 33 CAP (copia).xlsx");

    const comparacion = segundo.servicio.comparacion();
    assert.equal(comparacion?.mismoArchivo, true);
    assert.equal(comparacion?.cambioDeNombre, true);
    assert.equal(comparacion?.anterior.archivo, "sem 33 CAP.xlsx");
  });

  it("un archivo distinto con el mismo nombre no se confunde con el anterior", async () => {
    const puerto = new MemoryLoadLog(clock);
    const primero = servicio({ puerto, sha256: "c".repeat(64) });
    const plan = await primero.servicio.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    await primero.servicio.aplicar(plan.planId, "Maricela0000");

    const segundo = servicio({ puerto, sha256: "d".repeat(64) });
    await segundo.servicio.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");

    const comparacion = segundo.servicio.comparacion();
    assert.equal(comparacion?.mismoArchivo, false);
    assert.equal(comparacion?.cambioDeNombre, false);
  });

  it("sólo compara contra cargas aplicadas: una revisión no es una carga", async () => {
    const puerto = new MemoryLoadLog(clock);
    const primero = servicio({ puerto, sha256: "e".repeat(64) });
    await primero.servicio.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");

    const segundo = servicio({ puerto, sha256: "e".repeat(64) });
    await segundo.servicio.previsualizar(Buffer.from("x"), "sem 34 CAP.xlsx");
    assert.equal(segundo.servicio.comparacion(), undefined);
  });
});

describe("Bitácora de cargas · cuando la bitácora falla", () => {
  it("una carga se aplica aunque su asiento no se pueda escribir", async () => {
    const { servicio: padronService, repositorio } = servicio({ puerto: new BitacoraRota() });

    const plan = await padronService.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    const resultado = await padronService.aplicar(plan.planId, "Maricela0000");

    assert.equal(repositorio.aplicaciones, 1);
    assert.equal(resultado.curp, 1);
  });

  it("la comparación se omite en silencio en vez de tumbar la revisión", async () => {
    const { servicio: padronService } = servicio({ puerto: new BitacoraRota() });
    const plan = await padronService.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");

    assert.equal(plan.cuadre.activosEnArchivo, 1);
    assert.equal(padronService.comparacion(), undefined);
  });

  it("el historial devuelve vacío en vez de reventar la pantalla", async () => {
    const bitacora = new BitacoraDeCargas(new BitacoraRota(), clock);
    assert.deepEqual(await bitacora.listar(10), []);
    const asiento: AsientoDeCarga = {
      tipo: "MATRIZ",
      hecho: "APLICADA",
      actor: "x",
      archivo: "y",
      sha256: "z",
      resumen: {},
    };
    assert.equal(await bitacora.registrar(asiento), undefined);
  });
});

async function conSesion(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
  const entrada = await app.inject({
    method: "POST",
    url: "/acceso",
    payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(entrada.statusCode, 303);
  return String(entrada.headers["set-cookie"] ?? "").split(";")[0] ?? "";
}

describe("Bitácora de cargas · la pantalla del historial", () => {
  it("sin sesión no se llega al historial: el guardia lo cierra", async () => {
    const app = await buildServer({ config: loadConfig(ENTORNO), clock });
    const respuesta = await app.inject({ method: "GET", url: "/cargas" });
    assert.equal(respuesta.statusCode, 303);
    assert.match(respuesta.headers["location"] as string, /\/acceso/u);
    await app.close();
  });

  it("con sesión enseña el historial y advierte cuando vive en memoria", async () => {
    const app = await buildServer({ config: loadConfig(ENTORNO), clock });
    const cookie = await conSesion(app);

    const respuesta = await app.inject({
      method: "GET",
      url: "/cargas",
      headers: { cookie },
    });
    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.body, /Historial de cargas/u);
    assert.match(respuesta.body, /se pierde al reiniciar\s+la plataforma/u);
    await app.close();
  });

  it("el historial es una sub-pestaña de Cargas, junto a matriz y padrón", async () => {
    const app = await buildServer({ config: loadConfig(ENTORNO), clock });
    const cookie = await conSesion(app);
    const respuesta = await app.inject({
      method: "GET",
      url: "/matriz",
      headers: { cookie },
    });
    assert.match(respuesta.body, /href="\/cargas"/u);
    await app.close();
  });
});

class EjecutorEspia {
  ultimosParametros: unknown[] = [];
  query<T>(_sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.ultimosParametros = params ?? [];
    return Promise.resolve({ rows: [] });
  }
  transaction<T>(fn: (client: EjecutorEspia) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe("Bitácora de cargas · el adaptador de PostgreSQL", () => {
  it("sanea el identificador de solicitud que no cumple el dominio del esquema", async () => {
    const espia = new EjecutorEspia();
    const bitacora = new SupabaseLoadLog(espia);

    await bitacora.registrar({
      tipo: "PADRON",
      hecho: "RECHAZADA",
      actor: "Maricela0000",
      archivo: "sem 33 CAP.xlsx",
      sha256: "",
      solicitudId: "no válido; con espacios",
      resumen: {},
    });

    assert.equal(espia.ultimosParametros[5], null);
  });

  it("conserva un identificador que sí cumple el dominio", async () => {
    const espia = new EjecutorEspia();
    const bitacora = new SupabaseLoadLog(espia);
    await bitacora.registrar({
      tipo: "MATRIZ",
      hecho: "APLICADA",
      actor: "Maricela0000",
      archivo: "Matriz.xlsb",
      sha256: "a".repeat(64),
      solicitudId: "8f14e45f-ceea-467a-9575-3f3a0f2b1a2c",
      resumen: {},
    });
    assert.equal(espia.ultimosParametros[5], "8f14e45f-ceea-467a-9575-3f3a0f2b1a2c");
  });

  it("un asiento sin huella no viola el NOT NULL de la entidad", async () => {
    const espia = new EjecutorEspia();
    const bitacora = new SupabaseLoadLog(espia);
    await bitacora.registrar({
      tipo: "PADRON",
      hecho: "RECHAZADA",
      actor: "Maricela0000",
      archivo: "(revisión vencida)",
      sha256: "",
      resumen: {},
    });
    assert.equal(espia.ultimosParametros[2], "-");
  });

  it("el nombre del archivo viaja en el resumen y vuelve a salir de él", async () => {
    const espia = new EjecutorEspia();
    const bitacora = new SupabaseLoadLog(espia);
    await bitacora.registrar({
      tipo: "PADRON",
      hecho: "APLICADA",
      actor: "Maricela0000",
      archivo: "sem 33 CAP.xlsx",
      sha256: "b".repeat(64),
      resumen: { curp: 3 },
    });
    const resumen = JSON.parse(String(espia.ultimosParametros[4])) as Record<string, unknown>;
    assert.equal(resumen["archivo"], "sem 33 CAP.xlsx");
    assert.equal(resumen["curp"], 3);
  });
});

describe("Padrón contra matriz · divergencias que no se escriben", () => {
  function servicioCon(
    empleado: { payrollType: string; plant: string },
    base: { tipoNomina: string | null; planta: string | null },
  ) {
    const repositorio = new RepositorioDivergente(base);
    return {
      repositorio,
      servicio: new RosterIngestService({
        repository: repositorio,
        extractor: new ExtractorFalso({
          source: { sha256: "c".repeat(64), byteSize: 10 },
          employees: [
            {
              employeeId: "00001",
              displayName: "TRABAJADOR 00001",
              position: "OPERADOR",
              curp: "AAAA800101HDFXXX01",
              hireDate: "2020-01-15",
              cnoKey: "",
              payrollType: empleado.payrollType,
              plant: empleado.plant,
              issues: [],
            },
          ],
          diagnostics: { employeeCount: 1, readyEmployeeCount: 1, issues: {} },
        }),
        clock,
      }),
    };
  }

  it("denuncia el tipo de nómina cuando el padrón dice otra cosa", async () => {
    const { servicio: s } = servicioCon(
      { payrollType: "NS", plant: "ECATEPEC I" },
      { tipoNomina: "NQ", planta: "ECATEPEC I" },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");

    assert.equal(plan.cuadre.nominasDivergentes, 1);
    assert.equal(plan.cuadre.plantasDivergentes, 0);
    assert.deepEqual(plan.muestras.nominasDivergentes, [
      { numeroTrabajador: "00001", enPadron: "NS", enBase: "NQ" },
    ]);
  });

  it("denuncia la planta, que en el libro se rotula AREA pero no es el área", async () => {
    const { servicio: s } = servicioCon(
      { payrollType: "NS", plant: "ECATEPEC II" },
      { tipoNomina: "NS", planta: "ECATEPEC I" },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");

    assert.equal(plan.cuadre.plantasDivergentes, 1);
    assert.equal(plan.muestras.plantasDivergentes[0]?.enBase, "ECATEPEC I");
  });

  it("una divergencia NO se escribe: la matriz sigue mandando", async () => {
    const { servicio: s, repositorio } = servicioCon(
      { payrollType: "NS", plant: "ECATEPEC II" },
      { tipoNomina: "NQ", planta: "ECATEPEC I" },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    await s.aplicar(plan.planId, "Maricela0000");

    const escrito = repositorio.ultimasEscrituras;
    assert.ok(escrito);
    assert.deepEqual(Object.keys(escrito).sort(), [
      "altas",
      "curp",
      "datos",
      "enArchivo",
      "fechasDeBaja",
      "inducciones",
      "ocupaciones",
      "reactivar",
    ]);
    for (const [, columna] of escrito.datos ?? []) {
      assert.ok(!["tipo_nomina", "planta"].includes(columna), `el padrón escribió ${columna}`);
    }
    const avisos = (plan.detalle?.movimientos ?? []).filter((m) => m.soloAviso);
    assert.ok(avisos.some((m) => m.campo === "Tipo de nómina"));
    assert.ok(avisos.some((m) => m.campo === "Planta"));
  });

  it("sin dato en la base no hay divergencia: es un hueco, no un desacuerdo", async () => {
    const { servicio: s } = servicioCon(
      { payrollType: "NS", plant: "ECATEPEC I" },
      { tipoNomina: null, planta: null },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    assert.equal(plan.cuadre.nominasDivergentes, 0);
    assert.equal(plan.cuadre.plantasDivergentes, 0);
  });

  it("un libro sin columna de planta lo declara en vez de callarlo", async () => {
    const { servicio: s } = servicioCon(
      { payrollType: "NS", plant: "" },
      { tipoNomina: "NS", planta: "ECATEPEC I" },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 33 CAP.xlsx");
    assert.equal(plan.cuadre.traeColumnaPlanta, false);
    assert.equal(plan.cuadre.plantasDivergentes, 0);
  });
});
