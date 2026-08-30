/**
 * Emisión individual de constancias DC-3 desde `/dc3`.
 *
 * Lo que se fija aquí es la pantalla y las compuertas, no el trazo del PDF: el
 * formato ya está cubierto por el banco del generador, y componerlo exige la
 * plantilla oficial firmada y la configuración privada, que no viven en el
 * repositorio. Lo que sí se comprueba es que nada salga sin fecha, que un
 * trabajador inexistente no produzca un documento, y que los filtros de la
 * pantalla sean los mismos del directorio.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, type TestContext } from "node:test";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config/environment.ts";
import { Dc3CertificateService } from "../../src/domain/dc3/constancia.ts";
import { DomainError } from "../../src/domain/errores.ts";
import type {
  Dc3Candidate,
  Dc3CandidateDetail,
  Dc3CandidateFilter,
  Dc3CertificatePort,
  Dc3PlanSummary,
} from "../../src/ports/dc3-constancia.port.ts";
import type { Clock } from "../../src/ports/reloj.ts";
import { buildServer } from "../../src/server/build-server.ts";

const now = "2026-08-06T12:00:00.000Z";
const clock: Clock = { now: () => new Date(now), nowIso: () => now };

const abiertos: FastifyInstance[] = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()?.close();
});

const CON_FECHA: Dc3Candidate = {
  workerNumber: "10001",
  workerName: "TRABAJADOR SINTETICO",
  area: "AREA SINTETICA",
  department: "DEPARTAMENTO SINTETICO",
  position: "PUESTO SINTETICO",
  payrollType: "NQ",
  courseKey: "QMS",
  courseName: "QMS",
  completionDate: "2026-07-02",
  hasCurp: true,
  missing: [],
};

const SIN_FECHA: Dc3Candidate = {
  ...CON_FECHA,
  workerNumber: "10002",
  workerName: "OTRO SINTETICO",
  payrollType: "NS",
  completionDate: null,
  hasCurp: false,
  missing: ["CURP", "ocupación específica"],
};

const INCOMPLETO: Dc3Candidate = {
  ...CON_FECHA,
  workerNumber: "10003",
  workerName: "TERCERO SINTETICO",
  missing: ["ocupación específica"],
};

class PadronFalso implements Dc3CertificatePort {
  readonly filtros: Dc3CandidateFilter[] = [];
  readonly emisiones: unknown[] = [];

  listDc3Courses() {
    return Promise.resolve([{ courseKey: "QMS", courseName: "QMS" }]);
  }

  /** Claves `nomina:curso` que el falso da por ya emitidas. */
  readonly emitidas = new Set<string>();

  listCandidates(filter: Dc3CandidateFilter, limit: number): Promise<readonly Dc3Candidate[]> {
    this.filtros.push(filter);
    const porPestana: Record<string, Dc3Candidate[]> = {
      listos: [CON_FECHA],
      incompletos: [INCOMPLETO],
      "sin-curso": [SIN_FECHA],
    };
    const todos = filter.status ? porPestana[filter.status] : [CON_FECHA, SIN_FECHA];
    return Promise.resolve((todos ?? []).slice(0, limit));
  }

  summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary> {
    this.filtros.push(filter);
    return Promise.resolve({ ready: 1, incomplete: 1, withoutDate: 1, withoutOccupation: 1 });
  }

  listEmittedKeys(): Promise<readonly string[]> {
    return Promise.resolve([...this.emitidas]);
  }

  findCandidate(workerNumber: string): Promise<Dc3CandidateDetail | null> {
    const base = workerNumber === "10001" ? CON_FECHA : workerNumber === "10002" ? SIN_FECHA : null;
    if (!base) return Promise.resolve(null);
    return Promise.resolve({
      ...base,
      curp: "SINT800101HDFXXX01",
      occupation: "8121 — OPERADOR SINTETICO",
      durationHours: 1,
      thematicAreaKey: "3131",
      thematicAreaName: "Apoyo a la calidad",
      trainingAgent: "AGENTE SINTETICO",
    });
  }

  recordEmission(input: unknown): Promise<void> {
    this.emisiones.push(input);
    return Promise.resolve();
  }
}

/**
 * Raíz sintética con la configuración privada del DC-3.
 *
 * `referencias/privado/dc3-config.json` está ignorado por Git y no existe en un
 * clon. Leer la raíz del proceso haría que estas pruebas pasaran sólo en una
 * máquina que ya tenga el material real, que es justo lo contrario de lo que
 * debe ocurrir.
 */
async function raizSintetica(contexto: TestContext): Promise<string> {
  const raiz = await mkdtemp(join(tmpdir(), "kcm-dc3-"));
  contexto.after(() => rm(raiz, { recursive: true, force: true }));
  await mkdir(join(raiz, "referencias/privado"), { recursive: true });
  await writeFile(
    join(raiz, "referencias/privado/dc3-config.json"),
    JSON.stringify({ employer: { legalName: "PATRON SINTETICO" }, courses: [] }),
  );
  return raiz;
}

async function servidor(
  contexto: TestContext,
  padron?: Dc3CertificatePort,
): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig({ KCM_ENV: "development", KCM_PILOT_OPEN_ACCESS: "true" }),
    clock,
    projectRoot: await raizSintetica(contexto),
    ...(padron ? { dc3CertificateRepository: padron } : {}),
  });
  abiertos.push(app);
  return app;
}

describe("DC-3 · emisión individual", () => {
  it("la pantalla ofrece los mismos filtros del directorio, acotados a los cursos DC-3", async (contexto) => {
    const app = await servidor(contexto, new PadronFalso());
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.equal(pantalla.statusCode, 200);
    for (const campo of ['name="q"', 'name="curso"', 'name="area"', 'name="payrollType"']) {
      assert.match(pantalla.body, new RegExp(campo.replace(/["]/gu, '"'), "u"));
    }
    assert.match(pantalla.body, /Sindicalizados \(NS\)/u);
    assert.match(pantalla.body, /Empleados de confianza \(NQ\)/u);
  });

  it("sin filtros no lista a nadie; con filtro lista y ofrece emitir", async (contexto) => {
    const padron = new PadronFalso();
    const app = await servidor(contexto, padron);

    const vacia = await app.inject({ method: "GET", url: "/dc3" });
    assert.equal(padron.filtros.length, 0);
    assert.match(vacia.body, /Seleccione curso, área o tipo de personal/u);

    const filtrada = await app.inject({ method: "GET", url: "/dc3?area=AREA+SINTETICA" });
    assert.deepEqual(padron.filtros, [{ area: "AREA SINTETICA" }]);
    assert.match(filtrada.body, /TRABAJADOR SINTETICO/u);
    assert.match(filtrada.body, /\/dc3\/constancia\/10001\/QMS/u);
  });

  it("quien no tiene fecha de curso no ofrece botón: no hay nada que certificar", async (contexto) => {
    const app = await servidor(contexto, new PadronFalso());
    const pantalla = await app.inject({ method: "GET", url: "/dc3?q=1000" });

    assert.match(pantalla.body, /OTRO SINTETICO/u);
    assert.doesNotMatch(pantalla.body, /\/dc3\/constancia\/10002\/QMS/u);
    assert.match(pantalla.body, /Sin fecha/u);
  });

  it("los filtros viajan con los nombres que ya usa /trabajadores", async (contexto) => {
    const padron = new PadronFalso();
    const app = await servidor(contexto, padron);

    await app.inject({ method: "GET", url: "/dc3?q=juan&curso=QMS&area=AREA&payrollType=NS" });

    assert.deepEqual(padron.filtros.at(-1), {
      query: "juan",
      courseKey: "QMS",
      area: "AREA",
      payrollType: "NS",
    });
  });

  it("el plan enumera con identidad y un botón por renglón, sin emitir nada", async (contexto) => {
    const padron = new PadronFalso();
    const app = await servidor(contexto, padron);

    const plan = await app.inject({ method: "GET", url: "/dc3?plan=1" });

    // Pide una pestaña concreta, y sin exigir filtro previo.
    assert.equal(padron.filtros.at(0)?.status, "listos");

    // Los cinco datos que el plan tiene que enseñar de cada quien.
    assert.match(plan.body, /10001/u);
    assert.match(plan.body, /TRABAJADOR SINTETICO/u);
    assert.match(plan.body, /AREA SINTETICA/u);
    assert.match(plan.body, /PUESTO SINTETICO/u);
    assert.match(plan.body, /QMS/u);

    // Un botón por renglón: nada se emite por abrir la pantalla.
    assert.match(plan.body, /\/dc3\/constancia\/10001\/QMS/u);
    assert.doesNotMatch(plan.body, /OTRO SINTETICO/u);
    assert.equal(padron.emisiones.length, 0);
  });

  it("el plan marca a quien ya tiene su constancia emitida", async (contexto) => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    const app = await servidor(contexto, padron);

    const plan = await app.inject({ method: "GET", url: "/dc3?plan=1" });

    assert.match(plan.body, /Ya emitida/u);
    // Marcarla no la cierra: se puede volver a emitir, ahora sabiendo que ya salió.
    assert.match(plan.body, /\/dc3\/constancia\/10001\/QMS/u);
  });

  it("revisar el plan es una pantalla, no un lote encolado", async (contexto) => {
    const app = await servidor(contexto, new PadronFalso());
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.match(pantalla.body, /href="\/dc3\?plan=1&amp;pestana=listos#plan"/u);
    assert.doesNotMatch(pantalla.body, /name="mode" value="plan"/u);
  });

  it("el plan parte en tres pestañas y sólo el lote de las completas sigue en los pasos", async (contexto) => {
    const app = await servidor(contexto, new PadronFalso());
    const pantalla = await app.inject({ method: "GET", url: "/dc3?plan=1" });

    for (const titulo of [/Listos/u, /Incompletos/u, /Sin el curso/u]) {
      assert.match(pantalla.body, titulo);
    }
    // El tercer paso del lote, el que emitía todas las incompletas de golpe, ya no existe.
    assert.doesNotMatch(pantalla.body, /Emitir con blancos/u);
  });

  it("las pestañas de incompletos y sin curso emiten con recuadros en blanco, en rojo", async (contexto) => {
    const app = await servidor(contexto, new PadronFalso());

    const incompletos = await app.inject({ method: "GET", url: "/dc3?plan=1&pestana=incompletos" });
    assert.match(incompletos.body, /TERCERO SINTETICO/u);
    assert.match(incompletos.body, /ocupación específica/u);
    assert.match(incompletos.body, /boton-peligro/u);
    assert.match(incompletos.body, /\/dc3\/constancia\/10003\/QMS\?enBlanco=1/u);

    const sinCurso = await app.inject({ method: "GET", url: "/dc3?plan=1&pestana=sin-curso" });
    assert.match(sinCurso.body, /OTRO SINTETICO/u);
    assert.match(sinCurso.body, /No lo ha cursado/u);
    assert.match(sinCurso.body, /\/dc3\/constancia\/10002\/QMS\?enBlanco=1/u);
  });

  it("sin fecha sólo se emite si se declara: el enlace del plan lo declara", async (contexto) => {
    const padron = new PadronFalso();
    const app = await servidor(contexto, padron);

    const negada = await app.inject({ method: "GET", url: "/dc3/constancia/10002/QMS" });
    assert.match(negada.body, /Sin fecha no se emite/u);
    assert.equal(padron.emisiones.length, 0);
  });

  it("filtrar dentro del plan no echa a nadie del plan", async (contexto) => {
    const padron = new PadronFalso();
    const app = await servidor(contexto, padron);

    const conFiltro = await app.inject({
      method: "GET",
      url: "/dc3?plan=1&pestana=incompletos&area=FLEXOGRAFICA&payrollType=NS",
    });

    // El formulario de arriba se lleva consigo el plan y la pestaña abierta.
    assert.match(conFiltro.body, /name="plan" value="1"/u);
    assert.match(conFiltro.body, /name="pestana" value="incompletos"/u);
    // Y las pestañas conservan el filtro al saltar entre ellas.
    assert.match(conFiltro.body, /pestana=sin-curso&amp;q=|area=FLEXOGRAFICA/u);
    // La lista de la pestaña se pide con el filtro puesto; el resumen, con el
    // mismo filtro pero sin pestaña, porque cuenta las tres a la vez.
    assert.ok(
      padron.filtros.some(
        (f) => f.status === "incompletos" && f.area === "FLEXOGRAFICA" && f.payrollType === "NS",
      ),
    );
  });

  it("sin base, la pantalla conserva el lote y explica que no hay padrón", async (contexto) => {
    const app = await servidor(contexto);
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.match(pantalla.body, /Sin base de datos conectada no hay padrón/u);
    assert.match(pantalla.body, /Emisión por lote/u);
  });
});

describe("DC-3 · compuertas del servicio", () => {
  const servicio = async (contexto: TestContext, padron: Dc3CertificatePort) =>
    new Dc3CertificateService({ repository: padron, projectRoot: await raizSintetica(contexto) });

  it("un trabajador que no existe no produce documento", async (contexto) => {
    await assert.rejects(
      (await servicio(contexto, new PadronFalso())).emitir({
        workerNumber: "99999",
        courseKey: "QMS",
        actor: "PRUEBA",
        requestId: "req-1",
      }),
      (error: unknown) =>
        error instanceof DomainError && error.code === "CANDIDATO_DC3_NO_ENCONTRADO",
    );
  });

  it("sin fecha del curso se rechaza antes de componer nada", async (contexto) => {
    const padron = new PadronFalso();
    await assert.rejects(
      (await servicio(contexto, padron)).emitir({
        workerNumber: "10002",
        courseKey: "QMS",
        actor: "PRUEBA",
        requestId: "req-2",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "SIN_FECHA_DE_CURSO",
    );
    // Y no queda registrada una emisión que no ocurrió.
    assert.equal(padron.emisiones.length, 0);
  });
});

/**
 * El ojo de vista previa.
 *
 * Lo que hay que fijar es la diferencia entre mirar y emitir: mirar compone el
 * mismo documento pero no lo asienta en la bitácora. Si eso se rompiera, «ya
 * emitida» dejaría de significar nada, porque bastaría con haber echado un
 * vistazo para que un renglón apareciera emitido.
 *
 * La composición se ejercita contra el servicio y no contra la ruta porque
 * necesita la configuración privada del patrón, que no vive en el repositorio:
 * aquí se le da una mínima y escrita al vuelo.
 */
describe("DC-3 · vista previa", () => {
  it("la pantalla ofrece el ojo junto a los botones de emitir", async (contexto) => {
    const app = await servidor(contexto, new PadronFalso());

    const busqueda = await app.inject({ method: "GET", url: "/dc3?area=AREA+SINTETICA" });
    assert.match(busqueda.body, /\/dc3\/vista-previa\/10001\/QMS/u);

    const plan = await app.inject({ method: "GET", url: "/dc3?plan=1&pestana=sin-curso" });
    assert.match(plan.body, /\/dc3\/vista-previa\/10002\/QMS\?enBlanco=1/u);
  });

  it("previsualizar compone la constancia y no la registra; emitir sí la registra", async (contexto) => {
    const padron = new PadronFalso();
    const servicio = new Dc3CertificateService({
      repository: padron,
      projectRoot: await raizSintetica(contexto),
    });
    const peticion = {
      workerNumber: "10001",
      courseKey: "QMS",
      actor: "PRUEBA",
      requestId: "req-1",
    } as const;

    const mirada = await servicio.emitir({ ...peticion, preview: true });
    assert.equal(padron.emisiones.length, 0);
    assert.equal(mirada.workerName, "TRABAJADOR SINTETICO");
    assert.ok(mirada.pdf.byteLength > 0);

    const emitida = await servicio.emitir(peticion);
    assert.equal(padron.emisiones.length, 1);
    // Mismo generador, mismos datos: el documento que se miró es el que se emitió.
    assert.deepEqual([...emitida.pdf], [...mirada.pdf]);
  });
});

/**
 * La advertencia previa a emitir.
 *
 * Emitir marca el renglón para siempre, así que el botón pregunta antes. Lo que
 * se fija aquí es que preguntar no sea ya emitir: quien abre la advertencia y se
 * arrepiente tiene que poder irse sin haber dejado nada en la bitácora.
 */
describe("DC-3 · confirmación antes de emitir", () => {
  it("el botón lleva a la advertencia y no registra nada por preguntar", async (contexto) => {
    const padron = new PadronFalso();
    const app = await servidor(contexto, padron);

    const advertencia = await app.inject({
      method: "GET",
      url: "/dc3/constancia/10001/QMS?pestana=listos",
    });

    assert.equal(advertencia.statusCode, 200);
    assert.match(advertencia.headers["content-type"] ?? "", /text\/html/u);
    assert.match(advertencia.body, /¿Emitir y descargar el DC-3\?/u);
    assert.match(advertencia.body, /TRABAJADOR SINTETICO/u);
    // El «sí» va por POST, que es lo que deja huella; el «no» sólo vuelve al plan.
    assert.match(advertencia.body, /method="post" action="\/dc3\/constancia\/10001\/QMS"/u);
    assert.match(advertencia.body, /No, cancelar/u);
    assert.equal(padron.emisiones.length, 0);
  });
});
