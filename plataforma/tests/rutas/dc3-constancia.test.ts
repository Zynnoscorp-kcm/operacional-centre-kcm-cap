/**
 * El módulo DC-3 de la consola.
 *
 * Lo que se fija aquí son las pantallas, los flujos y las compuertas, no el
 * trazo del PDF: el formato ya está cubierto por el banco del compositor.
 *
 * Las compuertas de siempre siguen aquí —nada sale sin fecha si no se declara,
 * mirar no asienta, el CSV no lleva CURP, el orden de reparto vive en la
 * consulta— y se suman las del módulo: la bandeja de lo que falta emitir desde
 * el corte, con los años anteriores aparte; la emisión que vuelve a la lista con
 * el acuse; varias constancias en un solo PDF, o la lista entera con sus
 * filtros; la descarga por número de solicitud; la reimpresión que sólo compone
 * lo ya asentado; el expediente por persona; la firma de cada emisión con la
 * cuenta de quien la hizo, y la emisión en cualquier instancia, local o en la
 * nube, con sus topes.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { LEYENDAS_DC3 } from "../../../packages/dc3/pdf/leyendas-oficiales.js";
import { SupabaseDc3CertificateRepository } from "../../src/adapters/postgres/dc3-constancia.ts";
import type { SqlExecutor } from "../../src/adapters/postgres/matriz.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { Dc3CertificateService, areaTematica } from "../../src/domain/dc3/constancia.ts";
import { DomainError } from "../../src/domain/comun/errores.ts";
import type {
  Dc3AreaCoverage,
  Dc3Candidate,
  Dc3CandidateDetail,
  Dc3CandidateFilter,
  Dc3CandidateOrder,
  Dc3CertificatePort,
  Dc3CourseCoverage,
  Dc3CourseMetadata,
  Dc3DataGaps,
  Dc3EmissionEntry,
  Dc3EmissionFilter,
  Dc3EmissionRecord,
  Dc3EmissionSummary,
  Dc3EmissionTotals,
  Dc3Key,
  Dc3OccupationGap,
  Dc3PlanSummary,
  Dc3WorkerWithoutOccupation,
} from "../../src/ports/dc3-constancia.port.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { TOPES_EN_LA_NUBE, TOPES_LOCALES } from "../../src/routes/dc3.ts";
import { buildServer } from "../../src/server/build-server.ts";

const now = "2026-08-06T12:00:00.000Z";
const clock: Clock = { now: () => new Date(now), nowIso: () => now };
/** El día de la planta con ese reloj: a las seis de la mañana en la Ciudad de México. */
const HOY = "2026-08-06";

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
  completionDate: "2026-07-30",
  periodDays: 0,
  beforeCutoff: false,
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

function detalle(base: Dc3Candidate): Dc3CandidateDetail {
  return {
    ...base,
    curp: base.hasCurp ? "SINT800101HDFXXX01" : "",
    occupation: base.missing.includes("ocupación específica") ? "" : "8121 — OPERADOR SINTETICO",
    durationHours: 1,
    thematicAreaKey: "3131",
    thematicAreaName: "Apoyo a la calidad",
    trainingAgent: "AGENTE SINTETICO",
  };
}

/** Otro curso de la misma persona, tomado antes del corte: se consulta, no está pendiente. */
const ANTERIOR: Dc3Candidate = {
  ...CON_FECHA,
  courseKey: "LOTO",
  courseName: "LOTO",
  completionDate: "2025-06-10",
  beforeCutoff: true,
};

const TODOS = [CON_FECHA, SIN_FECHA, INCOMPLETO];

/** El número de solicitud que la emisión deja en la dirección de regreso. */
const SOLICITUD = /solicitud=([0-9a-f-]{36})/u;

class PadronFalso implements Dc3CertificatePort {
  /** Cada filtro con que se preguntó algo: es lo que manda la pantalla. */
  readonly filtros: Dc3CandidateFilter[] = [];
  /** El orden con que se pidió cada listado. */
  readonly ordenes: (Dc3CandidateOrder | undefined)[] = [];
  /** El salto que pidió cada listado: es lo que pagina de verdad. */
  readonly saltos: number[] = [];
  /** Cada asiento, en el orden en que llegó. */
  readonly emisiones: Dc3EmissionEntry[] = [];
  /** Cuántas veces se asentó de golpe: una tanda es un solo viaje. */
  readonly viajesDeAsiento: number[] = [];
  readonly filtrosDeHistorial: Dc3EmissionFilter[] = [];
  /** Claves `nomina:curso` que el falso da por ya emitidas. */
  readonly emitidas = new Set<string>();
  /** Los números de solicitud por los que se preguntó. */
  readonly solicitudes: string[] = [];

  listDc3Courses() {
    return Promise.resolve([{ courseKey: "QMS", courseName: "QMS" }]);
  }

  #deLaPestana(filter: Dc3CandidateFilter): Dc3Candidate[] {
    const porPestana: Record<string, Dc3Candidate[]> = {
      listos: [CON_FECHA],
      incompletos: [INCOMPLETO],
      "sin-curso": [SIN_FECHA],
    };
    return filter.status ? (porPestana[filter.status] ?? []) : [CON_FECHA, SIN_FECHA];
  }

  listCandidates(
    filter: Dc3CandidateFilter,
    limit: number,
    order?: Dc3CandidateOrder,
    offset = 0,
  ): Promise<readonly Dc3Candidate[]> {
    this.filtros.push(filter);
    this.ordenes.push(order);
    this.saltos.push(offset);
    const q = (filter.query ?? "").toUpperCase();
    const filas = filter.query
      ? TODOS.filter((c) => c.workerNumber.includes(q) || c.workerName.includes(q))
      : this.#deLaPestana(filter);
    return Promise.resolve(filas.slice(0, limit));
  }

  countCandidates(filter: Dc3CandidateFilter): Promise<number> {
    this.filtros.push(filter);
    return Promise.resolve(filter.status ? 1 : 2);
  }

  countByCourse(filter: Dc3CandidateFilter) {
    this.filtros.push(filter);
    return Promise.resolve([{ courseKey: "QMS", total: 1 }]);
  }

  summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary> {
    this.filtros.push(filter);
    return Promise.resolve({
      ready: 1,
      incomplete: 1,
      withoutDate: 1,
      withoutOccupation: 1,
      fromCutoff: 2,
      beforeCutoff: 4,
    });
  }

  coverage(filter: Dc3CandidateFilter): Promise<readonly Dc3CourseCoverage[]> {
    this.filtros.push(filter);
    return Promise.resolve([
      {
        courseKey: "QMS",
        courseName: "QMS",
        total: 3,
        ready: 1,
        incomplete: 1,
        withoutDate: 1,
        emitted: this.emitidas.size,
        pending: 2 - this.emitidas.size,
        beforeCutoff: 4,
      },
    ]);
  }

  coverageByArea(filter: Dc3CandidateFilter): Promise<readonly Dc3AreaCoverage[]> {
    this.filtros.push(filter);
    return Promise.resolve([
      {
        area: "AREA SINTETICA",
        courseKey: "QMS",
        courseName: "QMS",
        total: 3,
        ready: 1,
        incomplete: 1,
        withoutDate: 1,
        emitted: 0,
        pending: 2,
        beforeCutoff: 0,
      },
    ]);
  }

  #historial(): Dc3EmissionRecord[] {
    return [...this.emitidas].map((clave) => {
      const [numero = "", curso = ""] = clave.split(":");
      return {
        at: "2026-08-05T17:30:00.000Z",
        actor: "Pablo0000",
        workerNumber: numero,
        workerName: "UNO SINTETICO",
        courseKey: curso,
        courseName: "QMS",
        partial: false,
      };
    });
  }

  listEmissions(
    filter: Dc3EmissionFilter,
    limit: number,
    offset = 0,
  ): Promise<readonly Dc3EmissionRecord[]> {
    this.filtrosDeHistorial.push(filter);
    return Promise.resolve(this.#historial().slice(offset, offset + limit));
  }

  countEmissions(filter: Dc3EmissionFilter): Promise<number> {
    this.filtrosDeHistorial.push(filter);
    return Promise.resolve(this.emitidas.size);
  }

  summarizeEmissions(): Promise<Dc3EmissionTotals> {
    const total = this.emitidas.size;
    return Promise.resolve({ today: 0, week: total, month: total, total, partial: 0 });
  }

  listEmissionActors(): Promise<readonly string[]> {
    return Promise.resolve(["Pablo0000"]);
  }

  listEmissionSummaries(): Promise<readonly Dc3EmissionSummary[]> {
    return Promise.resolve(
      [...this.emitidas].map((key) => ({
        key,
        count: 1,
        lastAt: "2026-08-05T17:30:00.000Z",
        lastActor: "Pablo0000",
        lastPartial: false,
        anyComplete: true,
      })),
    );
  }

  findCandidate(workerNumber: string): Promise<Dc3CandidateDetail | null> {
    const base = TODOS.find((c) => c.workerNumber === workerNumber);
    return Promise.resolve(base ? detalle(base) : null);
  }

  findCandidates(keys: readonly Dc3Key[]): Promise<readonly Dc3CandidateDetail[]> {
    return Promise.resolve(
      TODOS.filter((c) =>
        keys.some((k) => k.workerNumber === c.workerNumber && k.courseKey === c.courseKey),
      ).map(detalle),
    );
  }

  listWorkerCandidates(workerNumber: string): Promise<readonly Dc3CandidateDetail[]> {
    return Promise.resolve(
      [...TODOS, ANTERIOR].filter((c) => c.workerNumber === workerNumber).map(detalle),
    );
  }

  listCourseMetadata(): Promise<readonly Dc3CourseMetadata[]> {
    return Promise.resolve([
      {
        courseKey: "QMS",
        courseName: "QMS",
        durationHours: 1,
        durationDays: null,
        thematicAreaKey: "3131",
        thematicAreaName: "Apoyo a la calidad",
        trainingAgent: "AGENTE SINTETICO",
        dateRule: "FECHA_MATRIZ",
        periodDays: 0,
        approved: false,
      },
    ]);
  }

  dataGaps(): Promise<Dc3DataGaps> {
    return Promise.resolve({
      activeWorkers: 3,
      withoutCurp: 1,
      withoutOccupation: 2,
      withoutPosition: 0,
    });
  }

  listOccupationGaps(): Promise<readonly Dc3OccupationGap[]> {
    return Promise.resolve([{ area: "AREA SINTETICA", position: "PUESTO SINTETICO", workers: 2 }]);
  }

  listWorkersWithoutOccupation(): Promise<readonly Dc3WorkerWithoutOccupation[]> {
    return Promise.resolve([
      {
        workerNumber: "10003",
        workerName: "TERCERO SINTETICO",
        area: "AREA SINTETICA",
        position: "PUESTO SINTETICO",
        payrollType: "NQ",
      },
    ]);
  }

  listRequestEmissionKeys(requestId: string): Promise<readonly string[]> {
    this.solicitudes.push(requestId);
    return Promise.resolve(
      this.emisiones
        .filter((e) => e.requestId === requestId || e.requestId.startsWith(`${requestId}-`))
        .map((e) => `${e.workerNumber}:${e.courseKey}`),
    );
  }

  recordEmission(input: Dc3EmissionEntry): Promise<void> {
    return this.recordEmissions([input]);
  }

  recordEmissions(inputs: readonly Dc3EmissionEntry[]): Promise<void> {
    if (inputs.length === 0) return Promise.resolve();
    this.viajesDeAsiento.push(inputs.length);
    for (const entrada of inputs) {
      this.emisiones.push(entrada);
      this.emitidas.add(`${entrada.workerNumber}:${entrada.courseKey}`);
    }
    return Promise.resolve();
  }
}

/**
 * Un padrón con más constancias que el tope de una emisión: cuenta y lista
 * tantas como se le pidan.
 */
class PadronLargo extends PadronFalso {
  readonly #total: number;

  constructor(total: number) {
    super();
    this.#total = total;
  }

  override listCandidates(
    filter: Dc3CandidateFilter,
    limit: number,
    order?: Dc3CandidateOrder,
    offset = 0,
  ): Promise<readonly Dc3Candidate[]> {
    this.filtros.push(filter);
    this.ordenes.push(order);
    this.saltos.push(offset);
    const cuantas = Math.max(0, Math.min(limit, this.#total - offset));
    return Promise.resolve(
      Array.from({ length: cuantas }, (_, i) => ({
        ...CON_FECHA,
        workerNumber: String(20000 + offset + i),
      })),
    );
  }

  override countCandidates(filter: Dc3CandidateFilter): Promise<number> {
    this.filtros.push(filter);
    return Promise.resolve(this.#total);
  }

  override findCandidates(keys: readonly Dc3Key[]): Promise<readonly Dc3CandidateDetail[]> {
    return Promise.resolve(
      keys.map((k) => detalle({ ...CON_FECHA, workerNumber: k.workerNumber })),
    );
  }
}

async function servidor(
  padron?: Dc3CertificatePort,
  opciones: { entorno?: Record<string, string> } = {},
): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig(
      opciones.entorno ?? { KCM_ENV: "development", KCM_PILOT_OPEN_ACCESS: "true" },
    ),
    clock,
    ...(padron ? { dc3CertificateRepository: padron } : {}),
  });
  abiertos.push(app);
  return app;
}

/** La consola publicada: mismo módulo, otros topes. */
const EN_LA_NUBE = {
  KCM_ENV: "development",
  KCM_ROLE: "nube",
  KCM_PILOT_OPEN_ACCESS: "true",
  KCM_ROOM_PASSWORD: "clave-sintetica-de-agenda",
};

const FORMULARIO = { "content-type": "application/x-www-form-urlencoded" } as const;

function formulario(campos: readonly (readonly [string, string])[]): string {
  return new URLSearchParams(campos.map(([k, v]): [string, string] => [k, v])).toString();
}

describe("DC-3 · la bandeja", () => {
  it("abre con lo que falta emitir desde el corte, en orden alfabético", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.equal(pantalla.statusCode, 200);
    assert.match(pantalla.body, /TRABAJADOR SINTETICO/u);
    // La bandeja es de pendientes y de cursos desde el corte, sin pedirlo.
    const listado = padron.filtros.find((f) => f.status === "listos" && f.emission);
    assert.equal(listado?.emission, "pendientes");
    assert.equal(listado?.period, "desde-corte");
    assert.deepEqual(padron.ordenes, ["nombre"]);
  });

  it("cada renglón dice la fecha del curso y su estado, sin plazo", async () => {
    const app = await servidor(new PadronFalso());
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.match(pantalla.body, /30 jul 2026/u);
    assert.match(pantalla.body, /<span class="insignia">Por emitir<\/span>/u);
    assert.doesNotMatch(pantalla.body, /plazo|vencid|días hábiles/iu);
  });

  it("los filtros son opciones con su cifra, y el formulario lleva área y personal", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    for (const campo of ['name="q"', 'name="area"', 'name="payrollType"']) {
      assert.ok(pantalla.body.includes(campo), campo);
    }
    assert.match(pantalla.body, /Sindicalizados \(NS\)/u);
    assert.match(pantalla.body, /Empleados de confianza \(NQ\)/u);
    // El curso es una opción de un clic, con su cuenta al lado.
    assert.match(pantalla.body, /href="\/dc3\?curso=QMS#plan"/u);
    assert.match(pantalla.body, /class="faceta-cuenta">1</u);
    // Las cuentas por curso se piden sin el filtro de curso: si no, la opción
    // elegida dejaría a las demás en cero.
    assert.ok(padron.filtros.some((f) => f.status === "listos" && f.courseKey === undefined));
  });

  it("el periodo se elige como opción: desde 2026, o años anteriores", async () => {
    const app = await servidor(new PadronFalso());
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.match(pantalla.body, /Desde 2026<\/span\s*><span class="faceta-cuenta">2</u);
    assert.match(pantalla.body, /href="\/dc3\?periodo=anteriores#plan"/u);
    assert.match(pantalla.body, /Años anteriores<\/span\s*><span class="faceta-cuenta">4</u);
  });

  it("los años anteriores se revisan aparte, con la misma lista", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const anteriores = await app.inject({ method: "GET", url: "/dc3?periodo=anteriores" });

    assert.equal(anteriores.statusCode, 200);
    assert.ok(padron.filtros.some((f) => f.status === "listos" && f.period === "anteriores"));
    assert.match(anteriores.body, /Listas para emitir · años anteriores/u);
    // El periodo viaja con el formulario de área y personal, y con la emisión.
    assert.match(anteriores.body, /name="periodo" value="anteriores"/u);

    // Un periodo que la pantalla no conoce es el de siempre.
    const padronDos = new PadronFalso();
    const appDos = await servidor(padronDos);
    await appDos.inject({ method: "GET", url: "/dc3?periodo=1999" });
    assert.ok(padronDos.filtros.every((f) => f.period === undefined || f.period === "desde-corte"));
  });

  it("el filtro acota la lista y llega al padrón con los nombres de /trabajadores", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    await app.inject({ method: "GET", url: "/dc3?q=juan&curso=QMS&area=AREA&payrollType=NS" });

    const listado = padron.filtros.find((f) => f.courseKey === "QMS" && f.status === "listos");
    assert.equal(listado?.query, "juan");
    assert.equal(listado?.area, "AREA");
    assert.equal(listado?.payrollType, "NS");
  });

  it("quien no tiene fecha del curso no se mezcla con los listos", async () => {
    const app = await servidor(new PadronFalso());

    const listos = await app.inject({ method: "GET", url: "/dc3" });
    assert.doesNotMatch(listos.body, /OTRO SINTETICO/u);

    const sinCurso = await app.inject({ method: "GET", url: "/dc3?pestana=sin-curso" });
    assert.match(sinCurso.body, /OTRO SINTETICO/u);
    assert.match(sinCurso.body, /Sin fecha registrada/u);
    assert.match(sinCurso.body, /\/dc3\/constancia\/10002\/QMS\?enBlanco=1/u);
    // Sin fecha no hay periodo que elegir.
    assert.doesNotMatch(sinCurso.body, /Años anteriores/u);
  });

  it("las situaciones con blancos emiten en rojo y lo declaran", async () => {
    const app = await servidor(new PadronFalso());

    const incompletos = await app.inject({ method: "GET", url: "/dc3?pestana=incompletos" });
    assert.match(incompletos.body, /TERCERO SINTETICO/u);
    assert.match(incompletos.body, /boton-peligro/u);
    assert.match(incompletos.body, /\/dc3\/constancia\/10003\/QMS\?enBlanco=1/u);
    // A todos les falta la ocupación: se dice una vez arriba, no en cada renglón.
    assert.match(
      incompletos.body,
      /El recuadro de <strong>ocupación específica<\/strong> sale en blanco/u,
    );
  });

  it("emitir pregunta encima del renglón, sin cambiar de pantalla", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const pantalla = await app.inject({ method: "GET", url: "/dc3?area=AREA+SINTETICA" });

    // El botón abre un popover declarativo; el formulario del «sí» vive fuera
    // del de la selección y se lleva la dirección de la lista para volver a ella.
    assert.match(pantalla.body, /popovertarget="emitir-10001-QMS"/u);
    assert.match(pantalla.body, /<div popover id="emitir-10001-QMS" class="confirmacion"/u);
    assert.match(pantalla.body, /action="\/dc3\/constancia\/10001\/QMS"/u);
    assert.match(pantalla.body, /name="volver" value="\/dc3\?area=AREA\+SINTETICA"/u);
    // Y el respaldo para el navegador que no entiende `popover`.
    assert.match(pantalla.body, /class="boton-pequeno boton-emitir sin-popover/u);
    assert.equal(padron.emisiones.length, 0);
  });

  it("la lista entera se emite con un botón que dice cuántas son", async () => {
    const app = await servidor(new PadronLargo(3));
    const pantalla = await app.inject({ method: "GET", url: "/dc3?curso=QMS" });

    assert.match(pantalla.body, /Emitir todas \(3\)/u);
    assert.match(pantalla.body, /<div\s+popover\s+id="emitir-lista"/u);
    assert.match(pantalla.body, /¿Emitir las 3 constancias de esta\s+lista\?/u);
    assert.match(pantalla.body, /name="todo" value="1"/u);
    assert.match(pantalla.body, /name="curso" value="QMS"/u);
  });

  it("marca a quien ya tiene su constancia cuando se piden todas", async () => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    const app = await servidor(padron);

    const todas = await app.inject({ method: "GET", url: "/dc3?emision=todas" });

    assert.match(todas.body, /Emitida 5 ago 2026/u);
    // «Todas» no filtra por la bitácora: el padrón recibe el listado sin emisión.
    assert.ok(padron.filtros.some((f) => f.status === "listos" && f.emission === undefined));
  });

  it("pagina: pide el salto a la consulta y dice dónde está", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const segunda = await app.inject({ method: "GET", url: "/dc3?pagina=-4" });

    assert.equal(segunda.statusCode, 200);
    assert.deepEqual(padron.saltos.at(-1), 0);
    assert.match(segunda.body, /Página 1 de 1/u);
  });

  it("sin base, la pantalla explica que no hay padrón", async () => {
    const app = await servidor();
    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.match(pantalla.body, /Sin conexión con la base de datos: no hay padrón del que emitir/u);
    assert.doesNotMatch(pantalla.body, /lote/iu);
  });
});

describe("DC-3 · el orden", () => {
  it("ofrece el orden de reparto con el símbolo de dos círculos", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const pantalla = await app.inject({ method: "GET", url: "/dc3" });

    assert.match(pantalla.body, /<circle cx="7\.6"[^>]*\/><circle cx="12\.4"/u);
    assert.match(pantalla.body, /Por tipo de personal/u);
    assert.match(pantalla.body, /href="\/dc3\?orden=personal#plan"/u);
  });

  it("pulsado, el orden de reparto llega al padrón y se puede volver al alfabético", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const pantalla = await app.inject({ method: "GET", url: "/dc3?orden=personal" });

    assert.deepEqual(padron.ordenes, ["personal"]);
    assert.match(pantalla.body, /href="\/dc3#plan"/u);
    // Y la pantalla dice en qué orden está, que un icono solo no lo explica.
    assert.match(pantalla.body, /confianza primero, después sindicalizados/u);
  });

  it("el orden no se pierde al cambiar de situación ni al filtrar", async () => {
    const app = await servidor(new PadronFalso());

    const pantalla = await app.inject({ method: "GET", url: "/dc3?orden=personal" });

    assert.match(pantalla.body, /pestana=sin-curso&amp;orden=personal/u);
    assert.match(pantalla.body, /name="orden" value="personal"/u);
  });

  it("un orden que la pantalla no conoce cae al alfabético", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    await app.inject({ method: "GET", url: "/dc3?orden=b.nombre_completo%3B%20DROP" });
    await app.inject({ method: "GET", url: "/dc3?orden=plazo" });

    assert.deepEqual(padron.ordenes, ["nombre", "nombre"]);
  });

  it("filtrar conserva la situación abierta y llega hasta el padrón", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const conFiltro = await app.inject({
      method: "GET",
      url: "/dc3?pestana=incompletos&area=FLEXOGRAFICA&payrollType=NS",
    });

    assert.match(conFiltro.body, /name="pestana" value="incompletos"/u);
    assert.match(conFiltro.body, /area=FLEXOGRAFICA/u);
    assert.ok(
      padron.filtros.some(
        (f) => f.status === "incompletos" && f.area === "FLEXOGRAFICA" && f.payrollType === "NS",
      ),
    );
  });
});

describe("DC-3 · emitir y volver", () => {
  it("la emisión asienta, vuelve a la misma lista y deja la descarga lista", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const emision = await app.inject({
      method: "POST",
      url: "/dc3/constancia/10001/QMS",
      headers: FORMULARIO,
      payload: formulario([["volver", "/dc3?area=AREA+SINTETICA&pagina=2&marcar=1"]]),
    });

    assert.equal(emision.statusCode, 303);
    const destino = String(emision.headers.location);
    // Vuelve a la lista con sus filtros, sin las marcas y con el acuse.
    assert.match(destino, /^\/dc3\?area=AREA\+SINTETICA&pagina=2&emitidas=1&solicitud=/u);
    assert.match(destino, /clave=10001%3AQMS/u);
    assert.doesNotMatch(destino, /marcar=/u);
    assert.equal(padron.emisiones.length, 1);
    const solicitud = SOLICITUD.exec(destino)?.[1] ?? "";
    assert.equal(padron.emisiones[0]?.requestId, solicitud);

    const acuse = await app.inject({ method: "GET", url: destino });
    assert.match(acuse.body, /Constancia emitida: TRABAJADOR SINTETICO ·\s+QMS/u);
    // El documento baja solo: una recarga a una respuesta adjunta, sin guiones.
    assert.ok(
      acuse.body.includes(
        `<meta http-equiv="refresh" content="1;url=/dc3/documentos?solicitud=${solicitud}" />`,
      ),
    );

    const documento = await app.inject({
      method: "GET",
      url: `/dc3/documentos?solicitud=${solicitud}`,
    });
    assert.equal(documento.statusCode, 200);
    assert.match(String(documento.headers["content-type"]), /application\/pdf/u);
    assert.match(String(documento.headers["content-disposition"]), /DC3-10001-QMS\.pdf/u);
  });

  it("una dirección de regreso ajena al módulo no se sigue", async () => {
    const app = await servidor(new PadronFalso());

    const emision = await app.inject({
      method: "POST",
      url: "/dc3/constancia/10001/QMS",
      headers: FORMULARIO,
      payload: formulario([["volver", "https://otro.sitio/robar"]]),
    });

    assert.equal(emision.statusCode, 303);
    assert.match(String(emision.headers.location), /^\/dc3\?emitidas=1&solicitud=/u);
  });

  it("cada emisión se firma con la cuenta de quien la hizo", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron, {
      entorno: {
        KCM_ENV: "development",
        KCM_PILOT_CONSOLE_USER: "Maricela0000",
        KCM_PILOT_CONSOLE_PASSWORD: "0000",
      },
    });

    const entrada = await app.inject({
      method: "POST",
      url: "/acceso",
      headers: FORMULARIO,
      payload: formulario([
        ["usuario", "Maricela0000"],
        ["clave", "0000"],
      ]),
    });
    const cookie = String(entrada.headers["set-cookie"] ?? "").split(";")[0] ?? "";

    await app.inject({
      method: "POST",
      url: "/dc3/constancia/10001/QMS",
      headers: { ...FORMULARIO, cookie },
      payload: formulario([["volver", "/dc3"]]),
    });

    assert.equal(padron.emisiones[0]?.actor, "Maricela0000");
  });

  it("sin fecha sólo se emite si se declara", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const negada = await app.inject({ method: "GET", url: "/dc3/constancia/10002/QMS" });
    assert.match(negada.body, /Sin fecha no se emite/u);

    const tambien = await app.inject({
      method: "POST",
      url: "/dc3/constancia/10002/QMS",
      headers: FORMULARIO,
      payload: formulario([["volver", "/dc3"]]),
    });
    assert.match(tambien.body, /Sin fecha no se emite/u);
    assert.equal(padron.emisiones.length, 0);
  });

  it("la pantalla de confirmación de respaldo no asienta y vuelve a la lista de donde vino", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const advertencia = await app.inject({
      method: "GET",
      url: "/dc3/constancia/10001/QMS?pestana=listos&volver=%2Fdc3%3Fcurso%3DQMS",
    });

    assert.equal(advertencia.statusCode, 200);
    assert.match(advertencia.body, /¿Emitir y descargar el DC-3\?/u);
    assert.match(advertencia.body, /method="post" action="\/dc3\/constancia\/10001\/QMS"/u);
    assert.match(advertencia.body, /href="\/dc3\?curso=QMS">No, cancelar/u);
    assert.equal(padron.emisiones.length, 0);
  });
});

describe("DC-3 · varias a la vez", () => {
  it("las marcadas se asientan en un solo viaje y vuelven con el acuse", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const envio = await app.inject({
      method: "POST",
      url: "/dc3/emitir-tanda",
      headers: FORMULARIO,
      payload: formulario([
        ["pestana", "incompletos"],
        ["volver", "/dc3?pestana=incompletos"],
        ["formato", "pdf"],
        ["entrega", "1"],
        ["clave", "10001:QMS"],
        ["clave", "10003:QMS"],
        ["clave", "99999:QMS"],
      ]),
    });

    assert.equal(envio.statusCode, 303);
    const destino = String(envio.headers.location);
    // La dirección no lleva las claves: lleva cuántas y el número de la solicitud.
    assert.match(destino, /emitidas=2&solicitud=[0-9a-f-]{36}/u);
    assert.doesNotMatch(destino, /10001%3AQMS/u);
    assert.match(destino, /fallidas=99999%3AQMS%7ECANDIDATO_DC3_NO_ENCONTRADO/u);
    assert.match(destino, /entrega=1/u);
    assert.deepEqual(padron.viajesDeAsiento, [2]);

    const acuse = await app.inject({ method: "GET", url: destino });
    assert.match(acuse.body, /2\s+constancias emitidas/u);
    assert.match(acuse.body, /no está activo con ese curso/u);

    // La descarga encuentra lo emitido por el número de la solicitud, en su orden.
    const solicitud = SOLICITUD.exec(destino)?.[1] ?? "";
    const documento = await app.inject({
      method: "GET",
      url: `/dc3/documentos?solicitud=${solicitud}&entrega=1`,
    });
    assert.equal(documento.statusCode, 200);
    assert.match(documento.rawPayload.toString("latin1"), /\/Type \/Pages \/Count 3 /u);
    assert.deepEqual(padron.solicitudes, [solicitud]);
  });

  it("lo emitido baja en un solo PDF, con la hoja de entrega delante", async () => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    padron.emitidas.add("10003:QMS");
    const app = await servidor(padron);

    const documento = await app.inject({
      method: "GET",
      url: "/dc3/documentos?claves=10001%3AQMS%2C10003%3AQMS&entrega=1",
    });

    assert.equal(documento.statusCode, 200);
    assert.match(String(documento.headers["content-type"]), /application\/pdf/u);
    assert.match(String(documento.headers["content-disposition"]), /attachment/u);
    const bytes = documento.rawPayload.toString("latin1");
    // Hoja de entrega más dos constancias: tres páginas en un solo archivo.
    assert.match(bytes, /\/Type \/Pages \/Count 3 /u);
    assert.match(bytes, /RELACI\\323N DE CONSTANCIAS DC-3/u);
  });

  it("en ZIP, cada constancia es su propio archivo", async () => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    const app = await servidor(padron);

    const zip = await app.inject({
      method: "GET",
      url: "/dc3/documentos?claves=10001%3AQMS&formato=zip&entrega=1",
    });

    assert.equal(zip.statusCode, 200);
    assert.equal(zip.rawPayload.subarray(0, 2).toString("latin1"), "PK");
    assert.match(zip.rawPayload.toString("latin1"), /DC3-10001-QMS\.pdf/u);
    assert.match(zip.rawPayload.toString("latin1"), /00-HOJA-DE-ENTREGA\.pdf/u);
  });

  it("reimprimir sólo compone lo ya asentado", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const nunca = await app.inject({ method: "GET", url: "/dc3/documentos?claves=10001%3AQMS" });

    assert.match(nunca.headers["content-type"] ?? "", /text\/html/u);
    assert.match(nunca.body, /sólo se reimprime lo ya emitido/u);
    assert.equal(padron.emisiones.length, 0);
  });

  it("un número de solicitud inventado no llega a la base", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const inventada = await app.inject({
      method: "GET",
      url: "/dc3/documentos?solicitud=%27%20OR%201%3D1%20--",
    });

    assert.match(inventada.body, /No se encontraron constancias emitidas en esa solicitud/u);
    assert.deepEqual(padron.solicitudes, []);
  });

  it("sin marcar, o con más que el tope, no emite nada", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const vacia = await app.inject({
      method: "POST",
      url: "/dc3/emitir-tanda",
      headers: FORMULARIO,
      payload: "pestana=listos",
    });
    assert.match(vacia.body, /No se marcó ninguna constancia/u);

    const demasiadas = TOPES_LOCALES.tanda + 1;
    const larga = await app.inject({
      method: "POST",
      url: "/dc3/emitir-tanda",
      headers: FORMULARIO,
      payload: formulario([
        ["pestana", "listos"],
        ...Array.from(
          { length: demasiadas },
          (_, i) => ["clave", `${String(20000 + i)}:QMS`] as const,
        ),
      ]),
    });
    assert.match(
      larga.body,
      new RegExp(`Se emiten hasta ${String(TOPES_LOCALES.tanda)} constancias de una vez`, "u"),
    );
    assert.equal(padron.emisiones.length, 0);
  });

  it("emitir la lista entera toma los renglones del filtro, en el orden de la lista", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const envio = await app.inject({
      method: "POST",
      url: "/dc3/emitir-tanda",
      headers: FORMULARIO,
      payload: formulario([
        ["todo", "1"],
        ["pestana", "listos"],
        ["orden", "personal"],
        ["curso", "QMS"],
        ["volver", "/dc3?curso=QMS"],
      ]),
    });

    assert.equal(envio.statusCode, 303);
    assert.ok(
      padron.filtros.some(
        (f) => f.status === "listos" && f.courseKey === "QMS" && f.period === "desde-corte",
      ),
    );
    assert.equal(padron.ordenes.at(-1), "personal");
    assert.deepEqual(
      padron.emisiones.map((e) => `${e.workerNumber}:${e.courseKey}`),
      ["10001:QMS"],
    );
    // La hoja de entrega sabe de qué va la lista.
    assert.match(String(envio.headers.location), /contexto=QMS/u);
  });

  it("la lista entera de mil quinientas sale en una sola emisión", async () => {
    const padron = new PadronLargo(1500);
    const app = await servidor(padron);

    const envio = await app.inject({
      method: "POST",
      url: "/dc3/emitir-tanda",
      headers: FORMULARIO,
      payload: formulario([
        ["todo", "1"],
        ["pestana", "listos"],
        ["volver", "/dc3"],
      ]),
    });

    assert.equal(envio.statusCode, 303);
    assert.deepEqual(padron.viajesDeAsiento, [1500]);
    // Mil quinientas claves no caben en una dirección; el número de solicitud sí.
    assert.ok(String(envio.headers.location).length < 300);
  });

  it("una lista más larga que el tope no se emite a medias", async () => {
    const padron = new PadronLargo(TOPES_LOCALES.tanda + 500);
    const app = await servidor(padron);

    const pantalla = await app.inject({ method: "GET", url: "/dc3" });
    assert.doesNotMatch(pantalla.body, /Emitir todas/u);
    assert.match(pantalla.body, /filtrada por curso o por área/u);

    const envio = await app.inject({
      method: "POST",
      url: "/dc3/emitir-tanda",
      headers: FORMULARIO,
      payload: formulario([
        ["todo", "1"],
        ["pestana", "listos"],
      ]),
    });
    assert.match(envio.body, /la lista tiene más/u);
    assert.equal(padron.emisiones.length, 0);
  });
});

describe("DC-3 · cualquier instancia emite", () => {
  it("la consola publicada emite y registra en la misma bitácora", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron, { entorno: EN_LA_NUBE });

    const pantalla = await app.inject({ method: "GET", url: "/dc3" });
    assert.match(pantalla.body, /popovertarget="emitir-10001-QMS"/u);
    assert.doesNotMatch(pantalla.body, /configuración|aquí no se emite/iu);

    const emision = await app.inject({
      method: "POST",
      url: "/dc3/constancia/10001/QMS",
      headers: FORMULARIO,
      payload: formulario([["volver", "/dc3"]]),
    });
    assert.equal(emision.statusCode, 303);
    assert.equal(padron.emisiones.length, 1);
  });

  it("en la nube, los topes caben en la respuesta del alojamiento", async () => {
    const padron = new PadronLargo(TOPES_EN_LA_NUBE.tanda + 1);
    const app = await servidor(padron, { entorno: EN_LA_NUBE });

    const pantalla = await app.inject({ method: "GET", url: "/dc3" });
    assert.doesNotMatch(pantalla.body, /Emitir todas/u);
    assert.match(
      pantalla.body,
      new RegExp(`Se emiten hasta ${String(TOPES_EN_LA_NUBE.tanda)} constancias`, "u"),
    );
    assert.ok(TOPES_EN_LA_NUBE.tanda < TOPES_LOCALES.tanda);
    assert.ok(TOPES_EN_LA_NUBE.zip < TOPES_LOCALES.zip);
  });
});

describe("DC-3 · el expediente y la búsqueda", () => {
  it("el expediente reúne los cursos de una persona, con lo que ya salió", async () => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    const app = await servidor(padron);

    const expediente = await app.inject({ method: "GET", url: "/dc3/trabajador/10001" });

    assert.equal(expediente.statusCode, 200);
    assert.match(expediente.body, /TRABAJADOR SINTETICO/u);
    assert.match(expediente.body, /Expediente 10001/u);
    assert.match(expediente.body, /por\s+<strong>Pablo0000<\/strong\s*>/u);
    assert.match(expediente.body, /href="\/dc3\/documentos\?claves=10001%3AQMS"/u);
    assert.match(expediente.body, /href="\/trabajadores\/10001"/u);
    assert.ok(padron.filtrosDeHistorial.some((f) => f.workerNumber === "10001"));
  });

  it("los cursos anteriores al corte se ven y se emiten, pero no cuentan como pendientes", async () => {
    const app = await servidor(new PadronFalso());

    const expediente = await app.inject({ method: "GET", url: "/dc3/trabajador/10001" });

    assert.match(expediente.body, /Anterior a 2026/u);
    assert.match(expediente.body, /10 jun 2025/u);
    assert.match(expediente.body, /popovertarget="emitir-10001-LOTO"/u);
    // Sólo QMS está pendiente: no se ofrece emitir «las pendientes» juntas.
    assert.doesNotMatch(expediente.body, /Emitir las \d+ pendientes/u);
  });

  it("el área temática del expediente es la que imprime la constancia", async () => {
    const app = await servidor(new PadronFalso());

    const expediente = await app.inject({ method: "GET", url: "/dc3/trabajador/10001" });

    assert.match(expediente.body, /3131-Apoyo a la calidad/u);
    assert.doesNotMatch(expediente.body, /plazo/iu);
  });

  it("emitir desde el expediente vuelve al expediente, con el acuse y la descarga", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const emision = await app.inject({
      method: "POST",
      url: "/dc3/constancia/10001/QMS",
      headers: FORMULARIO,
      payload: formulario([["volver", "/dc3/trabajador/10001"]]),
    });
    const destino = String(emision.headers.location);
    assert.match(destino, /^\/dc3\/trabajador\/10001\?emitidas=1&solicitud=/u);

    const expediente = await app.inject({ method: "GET", url: destino });
    assert.match(expediente.body, /Constancia emitida: TRABAJADOR SINTETICO ·\s+QMS/u);
    assert.match(
      expediente.body,
      /http-equiv="refresh" content="1;url=\/dc3\/documentos\?solicitud=/u,
    );
  });

  it("una nómina que no es de cinco dígitos no llega a la base", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const mala = await app.inject({ method: "GET", url: "/dc3/trabajador/1234" });
    const nadie = await app.inject({ method: "GET", url: "/dc3/trabajador/99999" });

    assert.equal(mala.statusCode, 404);
    assert.equal(nadie.statusCode, 404);
    assert.match(nadie.body, /No hay un trabajador activo/u);
  });

  it("buscar una nómina que existe lleva directo al expediente", async () => {
    const app = await servidor(new PadronFalso());

    const busqueda = await app.inject({ method: "GET", url: "/dc3/buscar?q=10001" });

    assert.equal(busqueda.statusCode, 303);
    assert.equal(busqueda.headers.location, "/dc3/trabajador/10001");
  });

  it("un nombre que coincide con varias personas las lista con sus cursos", async () => {
    const app = await servidor(new PadronFalso());

    const busqueda = await app.inject({ method: "GET", url: "/dc3/buscar?q=SINTETICO" });

    assert.equal(busqueda.statusCode, 200);
    assert.match(busqueda.body, /3\s+personas coinciden/u);
    assert.match(busqueda.body, /href="\/dc3\/trabajador\/10002"/u);
    assert.match(busqueda.body, /QMS · sin registro/u);
  });

  it("un nombre que coincide con una sola persona lleva a su expediente", async () => {
    const app = await servidor(new PadronFalso());

    const busqueda = await app.inject({ method: "GET", url: "/dc3/buscar?q=TERCERO" });

    assert.equal(busqueda.statusCode, 303);
    assert.equal(busqueda.headers.location, "/dc3/trabajador/10003");
  });
});

describe("DC-3 · emitidas, cobertura y datos del formato", () => {
  it("el historial filtra por periodo en días de la planta y ofrece reimprimir", async () => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    const app = await servidor(padron);

    const historial = await app.inject({ method: "GET", url: "/dc3/historial?periodo=hoy" });

    assert.equal(historial.statusCode, 200);
    assert.match(historial.body, /Constancias emitidas/u);
    assert.match(historial.body, /Completa/u);
    assert.ok(padron.filtrosDeHistorial.some((f) => f.from === HOY));
    assert.match(historial.body, /href="\/dc3\/documentos\?claves=10001%3AQMS"/u);
    // La hora es la de la planta: 17:30 UTC son las 11:30 en la Ciudad de México.
    assert.match(historial.body, /11:30/u);
    assert.doesNotMatch(historial.body, /asiento|bitácora/iu);
  });

  it("el historial se lleva a Excel con las mismas columnas y los mismos filtros", async () => {
    const padron = new PadronFalso();
    padron.emitidas.add("10001:QMS");
    const app = await servidor(padron);

    const csv = await app.inject({ method: "GET", url: "/dc3/historial.csv?actor=Pablo0000" });

    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers["content-disposition"]), /dc3-historial\.csv/u);
    assert.match(csv.body, /cuando,numero_trabajador,nombre,curso,como_salio,actor/u);
    assert.match(csv.body, /"2026-08-05 11:30"/u);
    assert.ok(padron.filtrosDeHistorial.some((f) => f.actor === "Pablo0000"));
  });

  it("el CSV de pendientes lleva los filtros y no lleva CURP", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const csv = await app.inject({
      method: "GET",
      url: "/dc3/pendientes.csv?pestana=incompletos&area=FLEXOGRAFICA&periodo=anteriores",
    });

    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers["content-disposition"]), /dc3-pendientes-incompletos\.csv/u);
    assert.ok(
      padron.filtros.some(
        (f) => f.status === "incompletos" && f.area === "FLEXOGRAFICA" && f.period === "anteriores",
      ),
    );
    assert.doesNotMatch(csv.body, /curp/iu);
    assert.doesNotMatch(csv.body, /vence/iu);
    assert.match(csv.body, /10003/u);
  });

  it("la cobertura mide el avance de entrega por curso y por área", async () => {
    const padron = new PadronFalso();
    const app = await servidor(padron);

    const panel = await app.inject({ method: "GET", url: "/dc3/panel" });

    assert.equal(panel.statusCode, 200);
    assert.match(panel.body, /Cobertura por curso/u);
    assert.match(panel.body, /Avance por área/u);
    // El medidor es un elemento nativo: sin `style`, con el valor en atributos.
    assert.match(
      panel.body,
      /<progress[^>]*class="cobertura-barra cobertura-entrega"[^>]*value="0"[^>]*max="2"/u,
    );
    // Cada celda con pendientes lleva a la bandeja filtrada por área y curso.
    assert.match(panel.body, /href="\/dc3\?curso=QMS&amp;area=AREA\+SINTETICA#plan"/u);
    // Los años anteriores se cuentan aparte y llevan a su lista.
    assert.match(panel.body, /href="\/dc3\?curso=QMS&amp;periodo=anteriores#plan"/u);
    assert.ok(padron.filtros.some((f) => f.period === "desde-corte"));
    assert.doesNotMatch(panel.body, /vencid|lote/iu);
  });

  it("los datos del formato dicen qué se imprime y qué sale en blanco", async () => {
    const app = await servidor(new PadronFalso());

    const datos = await app.inject({ method: "GET", url: "/dc3/datos" });

    assert.equal(datos.statusCode, 200);
    assert.match(datos.body, /Lo que imprime cada curso/u);
    assert.match(datos.body, /AGENTE SINTETICO/u);
    assert.ok(datos.body.includes(LEYENDAS_DC3.employerName));
    assert.match(datos.body, /Constancias desde<\/dt>\s*<dd>1 ene 2026/u);
    assert.match(datos.body, /1 <span class="hueco-de">de 3<\/span>/u);
    // Nada de nombres de tabla, archivos privados ni plazo.
    assert.doesNotMatch(
      datos.body,
      /\b(?:organizacion|catalogo|operacion|matriz|dnc|dc3|seguridad|sistema|comun|lectura)\.[a-z_]+\b|referencias\/privado|configuración privada|hábiles/u,
    );
  });

  it("la lista para completar la ocupación sale con la columna que espera el padrón", async () => {
    const app = await servidor(new PadronFalso());

    const csv = await app.inject({ method: "GET", url: "/dc3/sin-ocupacion.csv" });

    assert.equal(csv.statusCode, 200);
    assert.match(csv.body, /Clave de ocupación/u);
    assert.match(csv.body, /"10003"/u);
    assert.doesNotMatch(csv.body, /curp/iu);
  });

  it("las pantallas del módulo comparten la barra con sus secciones", async () => {
    const app = await servidor(new PadronFalso());

    for (const ruta of ["/dc3", "/dc3/panel", "/dc3/historial", "/dc3/datos"]) {
      const pantalla = await app.inject({ method: "GET", url: ruta });
      assert.equal(pantalla.statusCode, 200, ruta);
      assert.match(pantalla.body, /<nav class="modulo"/u, ruta);
      for (const seccion of ["/dc3/panel", "/dc3/historial", "/dc3/datos"]) {
        assert.match(pantalla.body, new RegExp(`href="${seccion}"`, "u"), `${ruta} → ${seccion}`);
      }
      assert.doesNotMatch(pantalla.body, /href="\/dc3\/lote"/u, ruta);
      assert.match(pantalla.body, /action="\/dc3\/buscar"/u, ruta);
    }
  });

  it("no hay emisión por lote: ni pantalla ni encargo", async () => {
    const app = await servidor(new PadronFalso());

    for (const [method, url] of [
      ["GET", "/dc3/lote"],
      ["GET", "/api/dc3/status"],
      ["POST", "/api/dc3/jobs"],
    ] as const) {
      const respuesta = await app.inject({ method, url });
      assert.equal(respuesta.statusCode, 404, `${method} ${url}`);
    }
  });
});

describe("DC-3 · compuertas del servicio", () => {
  const servicio = (padron: Dc3CertificatePort) =>
    new Dc3CertificateService({ repository: padron });

  it("un trabajador que no existe no produce documento", async () => {
    await assert.rejects(
      servicio(new PadronFalso()).emitir({
        workerNumber: "99999",
        courseKey: "QMS",
        actor: "PRUEBA",
        requestId: "req-00001",
      }),
      (error: unknown) =>
        error instanceof DomainError && error.code === "CANDIDATO_DC3_NO_ENCONTRADO",
    );
  });

  it("sin fecha del curso se rechaza antes de componer nada", async () => {
    const padron = new PadronFalso();
    await assert.rejects(
      servicio(padron).emitir({
        workerNumber: "10002",
        courseKey: "QMS",
        actor: "PRUEBA",
        requestId: "req-00002",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "SIN_FECHA_DE_CURSO",
    );
    assert.equal(padron.emisiones.length, 0);
  });

  it("previsualizar compone la constancia y no la registra; emitir sí la registra", async () => {
    const padron = new PadronFalso();
    const servicioDc3 = servicio(padron);
    const peticion = {
      workerNumber: "10001",
      courseKey: "QMS",
      actor: "PRUEBA",
      requestId: "req-00001",
    } as const;

    const mirada = await servicioDc3.emitir({ ...peticion, preview: true });
    assert.equal(padron.emisiones.length, 0);
    assert.ok(mirada.pdf.byteLength > 0);

    const emitida = await servicioDc3.emitir(peticion);
    assert.equal(padron.emisiones.length, 1);
    // Mismo generador, mismos datos: el documento que se miró es el que se emitió.
    assert.deepEqual([...emitida.pdf], [...mirada.pdf]);
  });

  it("la constancia lleva el membrete de la plataforma, en cualquier equipo", () => {
    const formato = servicio(new PadronFalso()).formatoVisible();
    assert.deepEqual(formato.logotipos, { empresa: true, sindicato: true });
    assert.equal(formato.corte, "2026-01-01");

    const sinMembrete = new Dc3CertificateService({
      repository: new PadronFalso(),
      directorioDeLogotipos: "/no/existe/",
    }).formatoVisible();
    assert.deepEqual(sinMembrete.logotipos, { empresa: false, sindicato: false });
  });

  it("reimprimir una sola, sin hoja de entrega, da los mismos bytes que la emisión", async () => {
    const padron = new PadronFalso();
    const servicioDc3 = servicio(padron);

    const emitida = await servicioDc3.emitir({
      workerNumber: "10001",
      courseKey: "QMS",
      actor: "PRUEBA",
      requestId: "req-00003",
    });
    const reimpresa = await servicioDc3.componerDocumento({
      claves: ["10001:QMS"],
      formato: "pdf",
      entrega: false,
      editable: false,
      actor: "PRUEBA",
      fecha: HOY,
      soloEmitidas: true,
    });

    assert.deepEqual([...(reimpresa.pdf ?? [])], [...emitida.pdf]);
  });

  it("varias a la vez: compone antes de asentar y asienta de un golpe", async () => {
    const padron = new PadronFalso();
    const resultado = await servicio(padron).emitirVarias({
      claves: ["10001:QMS", "10001:QMS", "10002:QMS", "no-es-clave"],
      actor: "PRUEBA",
      requestId: "req-00004",
    });

    // La repetida no se asienta dos veces; la de sin fecha no sale sin declararlo.
    assert.deepEqual(
      resultado.emitidas.map((e) => e.clave),
      ["10001:QMS"],
    );
    assert.deepEqual(resultado.fallidas.map((f) => f.codigo).sort(), [
      "CLAVE_ILEGIBLE",
      "SIN_FECHA_DE_CURSO",
    ]);
    assert.deepEqual(padron.viajesDeAsiento, [1]);
  });

  it("lo emitido se busca por número de solicitud, y sólo con forma de número", async () => {
    const padron = new PadronFalso();
    const servicioDc3 = servicio(padron);
    const solicitud = "0f6b3c5e-8a1d-4c2b-9e7f-1a2b3c4d5e6f";
    await servicioDc3.emitirVarias({
      claves: ["10001:QMS", "10003:QMS"],
      actor: "PRUEBA",
      requestId: solicitud,
    });

    assert.deepEqual(await servicioDc3.clavesDeLaSolicitud(solicitud), ["10001:QMS", "10003:QMS"]);
    assert.deepEqual(await servicioDc3.clavesDeLaSolicitud("req-00004"), []);
    assert.deepEqual(padron.solicitudes, [solicitud]);
  });

  it("el área temática sin nombre en la base toma el del catálogo de la STPS", () => {
    const base = { ...detalle(CON_FECHA), thematicAreaName: null };
    assert.equal(areaTematica({ ...base, thematicAreaKey: "6000" }), "6000-Seguridad");
    assert.equal(areaTematica({ ...base, thematicAreaKey: "9999" }), "9999");
    assert.equal(areaTematica({ ...base, thematicAreaKey: null }), "");
  });
});

/**
 * La consulta, donde de verdad ocurren el orden y los filtros.
 *
 * No se resuelven sobre las filas ya traídas porque la lista viene recortada,
 * así que reordenar en la pantalla barajaría a los que ya llegaron y dejaría
 * fuera a los mismos de siempre. Aquí se lee el SQL con que se pidió: es lo
 * único que se puede comprobar sin una base delante.
 */
describe("DC-3 · la consulta", () => {
  async function sqlDe(
    pedir: (repositorio: SupabaseDc3CertificateRepository) => Promise<unknown>,
  ): Promise<{ sql: string; params: readonly unknown[] }> {
    let visto = { sql: "", params: [] as readonly unknown[] };
    const ejecutor: SqlExecutor = {
      query: (sql: string, params?: readonly unknown[]) => {
        visto = { sql, params: params ?? [] };
        return Promise.resolve({ rows: [] as never[] });
      },
      transaction: (fn) => fn(ejecutor),
    };
    await pedir(new SupabaseDc3CertificateRepository(ejecutor));
    return visto;
  }

  it("agrupa por tipo de personal y dentro de cada grupo por número de nómina", async () => {
    const { sql } = await sqlDe((r) => r.listCandidates({}, 300, "personal"));
    const orden = sql.slice(sql.indexOf("ORDER BY"));

    const confianza = orden.indexOf("'NQ' THEN 0");
    const sindicalizados = orden.indexOf("'NS' THEN 1");
    const numero = orden.indexOf("b.numero_trabajador");
    assert.ok(confianza >= 0 && sindicalizados >= 0 && numero >= 0, orden);
    assert.ok(confianza < sindicalizados);
    assert.ok(sindicalizados < numero);
  });

  it("ordena el número como el texto de cinco dígitos que es", async () => {
    const { sql } = await sqlDe((r) => r.listCandidates({}, 300, "personal"));
    assert.doesNotMatch(sql, /numero_trabajador::|to_number\s*\(|CAST\s*\(\s*b\.numero/iu);
  });

  it("ordena antes de recortar: con otro orden sale gente distinta", async () => {
    const { sql } = await sqlDe((r) => r.listCandidates({}, 300, "personal"));
    assert.ok(sql.indexOf("ORDER BY") < sql.indexOf("LIMIT"));
  });

  it("sin pedir orden, el listado sigue siendo el alfabético", async () => {
    const { sql } = await sqlDe((r) => r.listCandidates({}, 300));
    assert.match(sql, /ORDER BY b\.nombre_completo, b\.nombre_dc3/u);
  });

  it("la fecha de cada constancia es la primera desde el corte o, sin ella, la más reciente anterior", async () => {
    const { sql, params } = await sqlDe((r) => r.listCandidates({}, 50));
    assert.match(
      sql,
      /min\(h\.fecha_capacitacion\) FILTER \(WHERE h\.fecha_capacitacion >= \$1::date\)/u,
    );
    assert.match(
      sql,
      /max\(h\.fecha_capacitacion\) FILTER \(WHERE h\.fecha_capacitacion < \$1::date\)/u,
    );
    assert.match(sql, /coalesce\(hc\.desde_corte, hc\.antes_del_corte\)/u);
    assert.equal(params[0], "2026-01-01");
  });

  it("los años anteriores se separan con la fecha del corte, y quien no tiene fecha no se pierde", async () => {
    const { sql } = await sqlDe((r) => r.countCandidates({ period: "anteriores" }));
    assert.match(sql, /\(b\.fecha IS NULL OR \(b\.fecha IS NOT NULL AND b\.antes_del_corte\)\)/u);

    const desde = await sqlDe((r) => r.countCandidates({ period: "desde-corte" }));
    assert.match(desde.sql, /b\.fecha IS NOT NULL AND NOT b\.antes_del_corte/u);
  });

  it("un área temática del catálogo cuenta como dato completo", async () => {
    const { sql } = await sqlDe((r) => r.countCandidates({ status: "listos" }));
    assert.match(sql, /btrim\(b\.area_tematica_clave\) IN \('3131', '3132', '6000'\)/u);
  });

  it("las emitidas con blancos son las que nunca salieron completas", async () => {
    const { sql } = await sqlDe((r) => r.countCandidates({ emission: "parciales" }));
    assert.match(sql, /bool_or\(a\.estado_nuevo = 'EMITIDA'\) AS alguna_completa/u);
    assert.match(sql, /NOT e\.alguna_completa/u);
  });

  it("varias constancias se asientan con un solo INSERT", async () => {
    const { sql, params } = await sqlDe((r) =>
      r.recordEmissions([
        {
          actor: "A",
          workerNumber: "10001",
          courseKey: "QMS",
          requestId: "req-00001",
          partial: false,
        },
        {
          actor: "A",
          workerNumber: "10003",
          courseKey: "QMS",
          requestId: "req-00002",
          partial: true,
        },
      ]),
    );
    assert.match(sql, /INSERT INTO sistema\.bitacora_auditoria/u);
    assert.match(sql, /unnest\(\$1::text\[\], \$2::text\[\]/u);
    assert.deepEqual(params[1], ["10001:QMS", "10003:QMS"]);
    assert.deepEqual(params[2], ["EMITIDA", "EMITIDA_PARCIAL"]);
  });

  it("lo emitido en una solicitud se lee por su número, en el orden en que se asentó", async () => {
    const { sql, params } = await sqlDe((r) =>
      r.listRequestEmissionKeys("0f6b3c5e-8a1d-4c2b-9e7f-1a2b3c4d5e6f"),
    );
    assert.match(sql, /solicitud_id = \$1 OR solicitud_id LIKE \$1 \|\| '-%'/u);
    assert.match(sql, /ORDER BY secuencia/u);
    assert.deepEqual(params, ["0f6b3c5e-8a1d-4c2b-9e7f-1a2b3c4d5e6f"]);
  });

  it("el día del historial es el de la planta, no el del servidor", async () => {
    const { sql } = await sqlDe((r) => r.listEmissions({ from: "2026-08-06" }, 10));
    assert.match(sql, /AT TIME ZONE 'America\/Mexico_City'\)::date >= \$1::date/u);
  });
});
