/**
 * Padrón semanal: lector de multipart, cuadre contra la base y las tres rutas.
 *
 * Lo que se vigila aquí es la regla que hace segura la pantalla: subir el
 * archivo no escribe. Todo lo demás —los conteos del cuadre, el plan de un
 * solo uso, la sesión obligatoria— existe para sostener esa regla.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import { RosterIngestService } from "../../src/domain/padron/ingesta.ts";
import type { PadronLeido, RosterExtractorPort } from "../../src/domain/padron/tipos.ts";
import type {
  EscriturasDePadron,
  FilaDePadronBase,
  InduccionPropuesta,
  PuestoDelCatalogo,
  RosterRepositoryPort,
} from "../../src/ports/padron.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { MultipartError, parseMultipart } from "../../src/server/multipart.ts";

const FECHA_FIJA = new Date("2026-08-06T12:00:00.000Z");
const clock = { now: () => FECHA_FIJA, nowIso: () => FECHA_FIJA.toISOString() };

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
} as const;

// ---------------------------------------------------------------- dobles

function empleado(
  employeeId: string,
  extra: Partial<{
    curp: string;
    hireDate: string;
    position: string;
    cnoKey: string;
    payrollType: string;
    plant: string;
  }> = {},
) {
  return {
    employeeId,
    displayName: `TRABAJADOR ${employeeId}`,
    position: extra.position ?? "OPERADOR",
    curp: extra.curp ?? "",
    hireDate: extra.hireDate ?? "",
    cnoKey: extra.cnoKey ?? "",
    payrollType: extra.payrollType ?? "",
    plant: extra.plant ?? "",
    issues: [],
  };
}

function padron(employees: ReturnType<typeof empleado>[]): PadronLeido {
  return {
    source: { sha256: "f".repeat(64), byteSize: 1024 },
    employees,
    diagnostics: {
      employeeCount: employees.length,
      readyEmployeeCount: employees.filter((e) => e.curp && e.hireDate).length,
      issues: { INVALID_OR_MISSING_CURP: employees.filter((e) => !e.curp).length },
    },
  };
}

class ExtractorFalso implements RosterExtractorPort {
  readonly #resultado: PadronLeido | Error;

  constructor(resultado: PadronLeido | Error) {
    this.#resultado = resultado;
  }

  extraer(): PadronLeido {
    if (this.#resultado instanceof Error) throw this.#resultado;
    return this.#resultado;
  }
}

class RepositorioFalso implements RosterRepositoryPort {
  aplicaciones: EscriturasDePadron[] = [];
  lecturas = 0;
  /** `trabajadorId → fecha` de la inducción vigente que la base ya tiene. */
  induccionesVigentes = new Map<string, string>();
  readonly #filas: FilaDePadronBase[];
  readonly #puestos: PuestoDelCatalogo[];

  constructor(
    filas: FilaDePadronBase[],
    puestos: PuestoDelCatalogo[] = [
      { nombre: "OPERADOR", claveCno: null },
      { nombre: "TECNICO", claveCno: null },
    ],
  ) {
    this.#filas = filas;
    this.#puestos = puestos;
  }

  leerPadronBase(): Promise<readonly FilaDePadronBase[]> {
    this.lecturas += 1;
    return Promise.resolve(this.#filas);
  }
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    return Promise.resolve(this.#puestos);
  }
  revisarInducciones(propuestas: readonly InduccionPropuesta[]) {
    let nuevas = 0;
    let divergentes = 0;
    for (const propuesta of propuestas) {
      const vigente = this.induccionesVigentes.get(propuesta.trabajadorId);
      if (vigente === undefined) nuevas += 1;
      else if (vigente !== propuesta.fecha) divergentes += 1;
    }
    return Promise.resolve({ nuevas, divergentes });
  }
  aplicar(escrituras: EscriturasDePadron) {
    this.aplicaciones.push(escrituras);
    return Promise.resolve({
      curp: escrituras.curp.length,
      altas: escrituras.altas.length,
      inducciones: escrituras.inducciones.length,
      ocupaciones: escrituras.ocupaciones.length,
    });
  }
}

function fila(numeroTrabajador: string, extra: Partial<FilaDePadronBase> = {}): FilaDePadronBase {
  return {
    trabajadorId: `00000000-0000-4000-8000-${numeroTrabajador.padStart(12, "0")}`,
    numeroTrabajador,
    curp: null,
    fechaAlta: null,
    puesto: "OPERADOR",
    area: "CONVERTIDORA",
    claveOcupacion: null,
    tipoNomina: null,
    planta: null,
    activo: true,
    ...extra,
  };
}

// ---------------------------------------------------------------- multipart

describe("Padrón · lector de multipart", () => {
  function cuerpo(limite: string, partes: string[]): Buffer {
    return Buffer.concat([
      ...partes.map((parte) => Buffer.from(`--${limite}\r\n${parte}\r\n`, "utf8")),
      Buffer.from(`--${limite}--\r\n`, "utf8"),
    ]);
  }

  it("separa campos de archivos y entrega los bytes intactos", () => {
    // Un ZIP empieza con PK\x03\x04 y contiene CRLF y bytes nulos: si el lector
    // pasara por texto, esto sería exactamente lo que se corrompe.
    const binario = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0d, 0x0a, 0x00, 0xff, 0x0d, 0x0a]);
    const limite = "----KCM";
    const partes = Buffer.concat([
      Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="planId"\r\n\r\nabc\r\n`),
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="C:\\ruta\\sem 29 CAP.xlsx"\r\n` +
          `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
      ),
      binario,
      Buffer.from(`\r\n--${limite}--\r\n`),
    ]);

    const leido = parseMultipart(partes, `multipart/form-data; boundary=${limite}`);

    assert.equal(leido.campos.planId, "abc");
    assert.equal(leido.archivos.length, 1);
    const archivo = leido.archivos[0];
    assert.ok(archivo);
    assert.equal(archivo.campo, "archivo");
    // La ruta de Windows no viaja: sólo el nombre.
    assert.equal(archivo.nombre, "sem 29 CAP.xlsx");
    assert.deepEqual([...archivo.contenido], [...binario]);
  });

  it("rechaza un cuerpo sin límite declarado o sin partes", () => {
    assert.throws(() => parseMultipart(Buffer.from("x"), "text/plain"), MultipartError);
    assert.throws(
      () => parseMultipart(Buffer.from("nada"), "multipart/form-data; boundary=abc"),
      MultipartError,
    );
  });

  it("acepta el límite entrecomillado y un formulario vacío", () => {
    const leido = parseMultipart(cuerpo("l1", []), 'multipart/form-data; boundary="l1"');
    assert.deepEqual(leido.campos, {});
    assert.equal(leido.archivos.length, 0);
  });
});

// ---------------------------------------------------------------- servicio

describe("Padrón · cuadre contra la base", () => {
  function servicio(repositorio: RepositorioFalso, leido: PadronLeido | Error) {
    return new RosterIngestService({
      repository: repositorio,
      extractor: new ExtractorFalso(leido),
      clock,
    });
  }

  it("cuenta reconocidos, desconocidos, ausentes y lo que hay que escribir", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001"),
      fila("00002", { curp: "AAAA800101HDFXXX01", fechaAlta: "2020-01-15" }),
      fila("00003"),
    ]);
    const plan = await servicio(
      repositorio,
      padron([
        empleado("00001", { curp: "BBBB800101HDFXXX02", hireDate: "2021-03-01" }),
        empleado("00002", { curp: "AAAA800101HDFXXX01", hireDate: "2020-01-15" }),
        empleado("99999", { curp: "CCCC800101HDFXXX03", hireDate: "2022-05-05" }),
      ]),
    ).previsualizar(Buffer.from("x"), "sem 30 CAP.xlsx");

    assert.equal(plan.cuadre.activosEnArchivo, 3);
    assert.equal(plan.cuadre.reconocidos, 2);
    assert.equal(plan.cuadre.desconocidos, 1); // 99999 no está en la base
    assert.equal(plan.cuadre.ausentes, 1); // 00003 está activo y no viene
    assert.equal(plan.cuadre.curpPorEscribir, 1); // sólo 00001
    assert.equal(plan.cuadre.altasPorCorregir, 1);
    assert.equal(plan.cuadre.altasQueCoinciden, 1);
    assert.equal(plan.cuadre.induccionesNuevas, 2);
    assert.equal(plan.sinCambios, false);
    assert.deepEqual(plan.muestras.desconocidos, ["99999"]);
    assert.deepEqual(plan.muestras.ausentes, ["00003"]);

    // Lo esencial: revisar no escribe, y la base se lee una sola vez.
    assert.equal(repositorio.aplicaciones.length, 0);
    assert.equal(repositorio.lecturas, 1);
  });

  it("un archivo ya aplicado no propone nada", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001", { curp: "AAAA800101HDFXXX01", fechaAlta: "2020-01-15" }),
    ]);
    // La inducción de esa alta ya está en el ledger: no vuelve a contarse.
    repositorio.induccionesVigentes.set(fila("00001").trabajadorId, "2020-01-15");

    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { curp: "AAAA800101HDFXXX01", hireDate: "2020-01-15" })]),
    ).previsualizar(Buffer.from("x"), "sem 29 CAP.xlsx");

    assert.equal(plan.cuadre.curpPorEscribir, 0);
    assert.equal(plan.cuadre.altasPorCorregir, 0);
    assert.equal(plan.cuadre.induccionesNuevas, 0);
    assert.equal(plan.sinCambios, true);
  });

  it("una inducción que falta se cuenta aunque el CURP y el alta ya cuadren", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001", { curp: "AAAA800101HDFXXX01", fechaAlta: "2020-01-15" }),
    ]);
    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { curp: "AAAA800101HDFXXX01", hireDate: "2020-01-15" })]),
    ).previsualizar(Buffer.from("x"), "sem 29 CAP.xlsx");

    assert.equal(plan.cuadre.induccionesNuevas, 1);
    assert.equal(plan.sinCambios, false);
  });

  /**
   * El caso que tumbaba la carga: `registro_hc` tiene un índice único por
   * trabajador y curso mientras el registro está vigente, así que una fecha
   * corregida no se absorbe sola. Se cuenta aparte y no se escribe.
   */
  it("una fecha de inducción distinta se informa y no se cuenta como nueva", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001", { curp: "AAAA800101HDFXXX01", fechaAlta: "2020-01-15" }),
    ]);
    repositorio.induccionesVigentes.set(fila("00001").trabajadorId, "2019-11-04");

    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { curp: "AAAA800101HDFXXX01", hireDate: "2020-01-15" })]),
    ).previsualizar(Buffer.from("x"), "sem 30 CAP.xlsx");

    assert.equal(plan.cuadre.induccionesNuevas, 0);
    assert.equal(plan.cuadre.induccionesDivergentes, 1);
    assert.equal(plan.sinCambios, true);
  });

  it("delata los puestos que el catálogo no tiene y los que cambiaron", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001", { puesto: "OPERADOR" }),
      fila("00002", { puesto: "OPERADOR" }),
    ]);
    const plan = await servicio(
      repositorio,
      padron([
        empleado("00001", { position: "SUPERVISOR DE LINEA" }),
        empleado("00002", { position: "TECNICO" }),
      ]),
    ).previsualizar(Buffer.from("x"), "sem 30 CAP.xlsx");

    assert.equal(plan.cuadre.puestosNuevos, 1);
    assert.deepEqual(plan.muestras.puestosNuevos, ["SUPERVISOR DE LINEA"]);

    // Los dos se movieron, y el que fue a dar a un puesto sin declarar también
    // cuenta como movimiento: antes no, porque la rama colgaba de un `else` de
    // «puesto nuevo» y el destino sin catálogo tapaba la mudanza.
    assert.equal(plan.cuadre.puestosCambiados, 2);
    assert.deepEqual(
      plan.muestras.cambiosDePuesto.map((cambio) => [
        cambio.numeroTrabajador,
        cambio.antes,
        cambio.ahora,
        cambio.fueraDeCatalogo,
      ]),
      [
        ["00001", "OPERADOR", "SUPERVISOR DE LINEA", true],
        ["00002", "OPERADOR", "TECNICO", false],
      ],
    );
  });

  it("un plan se aplica una sola vez y escribe lo que prometió", async () => {
    const repositorio = new RepositorioFalso([fila("00001")]);
    const servicioDePadron = servicio(
      repositorio,
      padron([empleado("00001", { curp: "AAAA800101HDFXXX01", hireDate: "2020-01-15" })]),
    );
    const plan = await servicioDePadron.previsualizar(Buffer.from("x"), "sem 30 CAP.xlsx");

    const resultado = await servicioDePadron.aplicar(plan.planId, "prueba");
    assert.equal(resultado.curp, 1);
    assert.equal(resultado.altas, 1);
    assert.equal(resultado.inducciones, 1);
    assert.equal(repositorio.aplicaciones.length, 1);
    assert.equal(repositorio.aplicaciones[0]?.inducciones[0]?.[0], "roster-alta:00001:2020-01-15");

    await assert.rejects(
      () => servicioDePadron.aplicar(plan.planId, "prueba"),
      /ya no está disponible/u,
    );
    assert.equal(repositorio.aplicaciones.length, 1);
  });

  it("un libro con otra forma falla cerrado y dice qué no resolvió", async () => {
    const servicioDePadron = servicio(
      new RepositorioFalso([]),
      new Error("La hoja SND ACTIVOS no resuelve un encabezado unico para curp"),
    );
    await assert.rejects(
      () => servicioDePadron.previsualizar(Buffer.from("x"), "otro.xlsx"),
      /no resuelve un encabezado unico para curp/u,
    );
  });

  // --------------------------------------------------- clave de ocupación

  /**
   * La regla cambió el 2026-08-12. Hasta entonces la clave se consolidaba por
   * puesto —se creía que la ocupación describía al puesto— y el puesto con dos
   * claves se rechazaba entero. El departamento corrigió la premisa: la clave
   * varía según el puesto y el área de cada trabajador, así que un mismo
   * puesto en dos áreas trae legítimamente dos claves. Estas pruebas fijan la
   * regla nueva, y la primera es exactamente el caso que la anterior perdía.
   */
  it("un mismo puesto en dos áreas conserva sus dos claves", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001", { area: "CONVERTIDORA" }),
      fila("00002", { area: "EMPAQUE" }),
    ]);
    const plan = await servicio(
      repositorio,
      padron([
        empleado("00001", { position: "OPERADOR", cnoKey: "8121" }),
        empleado("00002", { position: "OPERADOR", cnoKey: "7231" }),
      ]),
    ).previsualizar(Buffer.from("x"), "sem 31 CAP.xlsx");

    assert.equal(plan.cuadre.traeColumnaCno, true);
    assert.equal(plan.cuadre.cnoPorEscribir, 2);
    // Ya no es conflicto: es la regla. Antes esto escribía cero claves.
    assert.equal(plan.cuadre.cnoEnConflicto, 0);
    assert.equal(plan.sinCambios, false);
  });

  it("dos claves dentro del mismo puesto y área se denuncian, pero se escriben", async () => {
    const repositorio = new RepositorioFalso([
      fila("00001", { area: "CONVERTIDORA" }),
      fila("00002", { area: "CONVERTIDORA" }),
    ]);
    const plan = await servicio(
      repositorio,
      padron([
        empleado("00001", { position: "OPERADOR", cnoKey: "8121" }),
        empleado("00002", { position: "OPERADOR", cnoKey: "7231" }),
      ]),
    ).previsualizar(Buffer.from("x"), "sem 31 CAP.xlsx");

    assert.equal(plan.cuadre.cnoEnConflicto, 1);
    // El archivo es la autoridad: se escriben las dos y se avisa del choque,
    // en lugar de dejar a los dos sin ocupación como hacía la regla anterior.
    assert.equal(plan.cuadre.cnoPorEscribir, 2);
    assert.match(plan.muestras.cnoEnConflicto[0] ?? "", /OPERADOR · CONVERTIDORA/u);
    assert.match(plan.muestras.cnoEnConflicto[0] ?? "", /8121 \/ 7231/u);
  });

  it("una clave que el trabajador ya tiene no vuelve a escribirse", async () => {
    const repositorio = new RepositorioFalso([fila("00001", { claveOcupacion: "8121" })]);
    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { position: "OPERADOR", cnoKey: "8121" })]),
    ).previsualizar(Buffer.from("x"), "sem 31 CAP.xlsx");

    assert.equal(plan.cuadre.cnoQueCoinciden, 1);
    assert.equal(plan.cuadre.cnoPorEscribir, 0);
    assert.equal(plan.sinCambios, true);
  });

  it("un puesto fuera del catálogo ya no impide clasificar a quien lo ocupa", async () => {
    const repositorio = new RepositorioFalso([fila("00001")]);
    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { position: "PUESTO INEXISTENTE", cnoKey: "8121" })]),
    ).previsualizar(Buffer.from("x"), "sem 31 CAP.xlsx");

    assert.equal(plan.cuadre.puestosNuevos, 1);
    // La clave va al trabajador, así que no necesita que su puesto exista en el
    // catálogo. El puesto sin declarar sigue teniendo su propio aviso.
    assert.equal(plan.cuadre.cnoPorEscribir, 1);
  });

  it("un libro sin la columna se sigue leyendo y no propone ocupaciones", async () => {
    const repositorio = new RepositorioFalso([fila("00001")]);
    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { curp: "AAAA800101HDFXXX01" })]),
    ).previsualizar(Buffer.from("x"), "sem 29 CAP.xlsx");

    assert.equal(plan.cuadre.traeColumnaCno, false);
    assert.equal(plan.cuadre.cnoPorEscribir, 0);
    assert.equal(plan.cuadre.curpPorEscribir, 1);
  });

  it("una celda vacía no borra la clave que el trabajador ya tenía", async () => {
    const repositorio = new RepositorioFalso([fila("00001", { claveOcupacion: "8121" })]);
    const plan = await servicio(
      repositorio,
      padron([empleado("00001", { position: "OPERADOR", curp: "AAAA800101HDFXXX01" })]),
    ).previsualizar(Buffer.from("x"), "sem 31 CAP.xlsx");

    // La columna puede llegar vacía y llenarse después: sólo se escribe lo que
    // el archivo traiga, y el hueco nunca es una instrucción de borrar.
    assert.equal(plan.cuadre.cnoPorEscribir, 0);
    assert.equal(plan.cuadre.cnoQueCoinciden, 0);
  });

  it("aplicar lleva las ocupaciones por trabajador, no por puesto", async () => {
    const repositorio = new RepositorioFalso([fila("00001")]);
    const servicioDePadron = servicio(
      repositorio,
      padron([
        empleado("00001", {
          position: "OPERADOR",
          cnoKey: "8121",
          curp: "AAAA800101HDFXXX01",
        }),
      ]),
    );
    const plan = await servicioDePadron.previsualizar(Buffer.from("x"), "sem 31 CAP.xlsx");
    const resultado = await servicioDePadron.aplicar(plan.planId, "prueba");

    assert.deepEqual(repositorio.aplicaciones.at(-1)?.ocupaciones, [
      [fila("00001").trabajadorId, "8121"],
    ]);
    assert.equal(resultado.ocupaciones, 1);
  });
});

// ---------------------------------------------------------------- rutas

describe("Padrón · rutas", () => {
  async function servidor(conBase = true) {
    return buildServer({
      config: loadConfig({ ...ENTORNO }),
      clock,
      ...(conBase
        ? {
            rosterRepository: new RepositorioFalso([fila("00001")]),
            rosterExtractor: new ExtractorFalso(
              padron([empleado("00001", { curp: "AAAA800101HDFXXX01", hireDate: "2020-01-15" })]),
            ),
          }
        : {}),
    });
  }

  /** La cookie sale de la puerta real: no hay forma de forjarla desde fuera. */
  async function sesion(app: Awaited<ReturnType<typeof servidor>>): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    });
    return String(res.headers["set-cookie"]).split(";")[0] ?? "";
  }

  function subida(nombre: string): { headers: Record<string, string>; payload: Buffer } {
    const limite = "----KCMprueba";
    return {
      headers: { "content-type": `multipart/form-data; boundary=${limite}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\n\r\n`,
        ),
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from(`\r\n--${limite}--\r\n`),
      ]),
    };
  }

  it("sin sesión manda al acceso con el destino puesto", async () => {
    const app = await servidor();
    for (const [method, url] of [
      ["GET", "/padron"],
      ["POST", "/padron"],
      ["POST", "/padron/aplicar"],
    ] as const) {
      const res = await app.inject({ method, url });
      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, "/acceso?destino=%2Fpadron");
    }
  });

  it("con sesión muestra el formulario y no escribe nada al revisar", async () => {
    const app = await servidor();
    const cookie = await sesion(app);

    const formulario = await app.inject({ method: "GET", url: "/padron", headers: { cookie } });
    assert.equal(formulario.statusCode, 200);
    // El barrido se dispara desde Excel; la carga manual sigue siendo la otra
    // puerta y no desapareció al retirar el encargo desde la consola.
    assert.doesNotMatch(formulario.body, /Leer no cambia nada/u);
    assert.match(formulario.body, /Carga manual del archivo/u);
    assert.match(formulario.body, /enctype="multipart\/form-data"/u);

    const revision = await app.inject({
      method: "POST",
      url: "/padron",
      headers: { cookie, ...subida("sem 30 CAP.xlsx").headers },
      payload: subida("sem 30 CAP.xlsx").payload,
    });
    assert.equal(revision.statusCode, 200);
    assert.match(revision.body, /sem 30 CAP\.xlsx · /u);
    assert.match(revision.body, /Aplicar los cambios/u);
    assert.match(revision.body, /Revisión sin aplicar/u);
  });

  it("una revisión que ya no existe no escribe: responde 409", async () => {
    const app = await servidor();
    const cookie = await sesion(app);
    const res = await app.inject({
      method: "POST",
      url: "/padron/aplicar",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ planId: "no-existe" }).toString(),
    });
    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Vuelva a subir el archivo/u);
  });

  it("un POST sin archivo se rechaza con 400", async () => {
    const app = await servidor();
    const cookie = await sesion(app);
    const limite = "----vacio";
    const res = await app.inject({
      method: "POST",
      url: "/padron",
      headers: { cookie, "content-type": `multipart/form-data; boundary=${limite}` },
      payload: Buffer.from(`--${limite}--\r\n`),
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /No se recibió ningún archivo/u);
  });

  it("sin base la pantalla lo dice y el POST responde 503", async () => {
    const app = await servidor(false);
    const cookie = await sesion(app);

    const pantalla = await app.inject({ method: "GET", url: "/padron", headers: { cookie } });
    assert.match(pantalla.body, /Sin conexión con la base de datos/u);

    const res = await app.inject({
      method: "POST",
      url: "/padron",
      headers: { cookie, ...subida("sem 30 CAP.xlsx").headers },
      payload: subida("sem 30 CAP.xlsx").payload,
    });
    assert.equal(res.statusCode, 503);
  });
});
