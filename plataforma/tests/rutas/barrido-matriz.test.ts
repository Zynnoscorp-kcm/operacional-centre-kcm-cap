/**
 * Barrido de la matriz: la revisión, el puente y las rutas.
 *
 * Lo que se vigila aquí es la regla que hace segura la pantalla: barrer no
 * escribe. Todo lo demás —los conteos, la clasificación de columnas, la
 * revisión de un solo uso, la sesión obligatoria— existe para sostener esa
 * regla, y el conteo que la revisión anuncia tiene que ser el que la aplicación
 * produce: si divergen, la pantalla estaría mintiendo justo donde se decide.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryExcelRepository } from "../../src/adapters/memoria/excel.ts";
import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { ExcelIntegrationService } from "../../src/domain/excel/integracion.ts";
import type { BridgeAction } from "../../src/domain/excel/tipos.ts";
import { MatrixImportService } from "../../src/domain/importacion-matriz/servicio.ts";
import {
  generateTrainingId,
  normalizeText,
} from "../../src/domain/importacion-matriz/reconciliador.ts";
import type {
  CourseCatalogEntry,
  HcRecord,
  MatrixSnapshot,
  SnapshotCompletion,
  SnapshotCourse,
  SnapshotEmployee,
  WorkerCatalogEntry,
} from "../../src/domain/importacion-matriz/tipos.ts";
import { MatrixScanService } from "../../src/domain/barrido-matriz/servicio.ts";
import { parseWorkerNumber } from "../../src/domain/numero-trabajador.ts";
import type {
  AtomicBatchOperations,
  MatrixRepositoryPort,
} from "../../src/ports/importacion-matriz.port.ts";
import type { Clock } from "../../src/ports/reloj.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { renderMatrixScanPage } from "../../src/web/pages/barrido-matriz.ts";

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
} as const;

/** Reloj movible: la caducidad de la orden y de la revisión se prueban con él. */
class RelojFalso implements Clock {
  #ahora: Date;
  constructor(inicio = "2026-08-12T12:00:00.000Z") {
    this.#ahora = new Date(inicio);
  }
  now(): Date {
    return new Date(this.#ahora);
  }
  nowIso(): string {
    return this.#ahora.toISOString();
  }
  avanzarMinutos(minutos: number): void {
    this.#ahora = new Date(this.#ahora.getTime() + minutos * 60_000);
  }
}

// ------------------------------------------------------------- constructores

function empleado(id: string, extra: Partial<SnapshotEmployee> = {}): SnapshotEmployee {
  return {
    employeeId: parseWorkerNumber(id),
    displayName: `TRABAJADOR SINTETICO ${id}`,
    hireDate: "2020-01-15",
    payrollType: "NS",
    position: "OPERADOR",
    department: "PRODUCCION",
    area: "CONVERTIDORA",
    plant: "ECATEPEC",
    ...extra,
  };
}

function curso(nombre: string, columna: string): SnapshotCourse {
  return {
    sourceKey: `hc-course:${nombre.toLowerCase().replaceAll(" ", "-")}`,
    sourceColumn: columna,
    displayName: nombre,
    normalizedName: normalizeText(nombre),
  };
}

function fecha(id: string, nombreCurso: string, dia: string): SnapshotCompletion {
  return {
    employeeId: parseWorkerNumber(id),
    sourceKey: `hc-course:${nombreCurso.toLowerCase().replaceAll(" ", "-")}`,
    completionDate: dia,
  };
}

function matriz(input: {
  empleados: readonly SnapshotEmployee[];
  cursos: readonly SnapshotCourse[];
  fechas: readonly SnapshotCompletion[];
  extraidoEn: string;
  sha?: string;
}): MatrixSnapshot {
  return {
    schemaVersion: "HC_SNAPSHOT_V1",
    source: {
      fileName: "Matriz_Sintetica.xlsb",
      sha256: (input.sha ?? "a").repeat(64).slice(0, 64),
      byteSize: 4096,
      sheetName: "HC",
    },
    extractedAt: input.extraidoEn,
    employees: input.empleados,
    courses: input.cursos,
    completions: input.fechas,
    diagnostics: {
      counts: {
        employeeCount: input.empleados.length,
        courseCount: input.cursos.length,
        completionCount: input.fechas.length,
        skippedEmployeeCount: 0,
        skippedCourseCount: 0,
        skippedCompletionCount: 0,
        formulaCellCount: 0,
        formulaCachedValueCount: 0,
        formulaErrorCount: 0,
        externalLinkCount: 0,
        mergedCellCount: 0,
      },
      issues: [],
    },
  };
}

const INDUCCION = "INDUCCION A LA EMPRESA";
const SEGURIDAD = "SEGURIDAD INDUSTRIAL";
const ALTURAS = "TRABAJO EN ALTURAS";

/** La matriz que la base ya conoce: tres trabajadores y dos columnas. */
const ANTERIOR = matriz({
  empleados: [empleado("00001"), empleado("00002"), empleado("00003")],
  cursos: [curso(INDUCCION, "K"), curso(SEGURIDAD, "L")],
  fechas: [
    fecha("00001", INDUCCION, "2026-01-10"),
    fecha("00002", INDUCCION, "2026-01-10"),
    fecha("00002", SEGURIDAD, "2026-02-01"),
    fecha("00003", INDUCCION, "2026-01-20"),
  ],
  extraidoEn: "2026-08-01T10:00:00.000Z",
  sha: "a",
});

/**
 * La matriz recién barrida. Cambia una cosa de cada clase que la pantalla
 * promete detectar: un trabajador nuevo, uno que ya no viene, un cambio de
 * puesto y de área, una columna nueva, una fecha corregida y una retirada.
 */
const BARRIDA = matriz({
  empleados: [
    empleado("00001"),
    empleado("00002", { position: "SUPERVISOR", area: "EMPAQUE" }),
    empleado("00004"),
  ],
  cursos: [curso(INDUCCION, "K"), curso(SEGURIDAD, "L"), curso(ALTURAS, "M")],
  fechas: [
    fecha("00001", INDUCCION, "2026-01-10"),
    fecha("00002", INDUCCION, "2026-03-01"),
    fecha("00004", ALTURAS, "2026-05-05"),
  ],
  extraidoEn: "2026-08-10T10:00:00.000Z",
  sha: "b",
});

/** Deja la base como la dejaría una carga real de `ANTERIOR`. */
async function baseCargada(): Promise<MemoryMatrixRepository> {
  const repositorio = new MemoryMatrixRepository();
  await new MatrixImportService(repositorio).importSnapshot({
    requestId: "vba-hc-siembra",
    snapshot: ANTERIOR,
    actorId: "prueba@kcm.invalid",
  });
  return repositorio;
}

// ------------------------------------------------------------------ el doble

/**
 * Repositorio de matriz con estado puesto a mano. Se usa donde hace falta un
 * registro que ninguna carga produce —una fecha liberada por la plataforma— y
 * para contar si el barrido escribió: `aplicaciones` debe seguir en cero.
 */
class MatrizFalsa implements MatrixRepositoryPort {
  aplicaciones = 0;
  readonly trabajadores: WorkerCatalogEntry[];
  readonly cursos: CourseCatalogEntry[];
  readonly registros: HcRecord[];

  constructor(
    trabajadores: WorkerCatalogEntry[] = [],
    cursos: CourseCatalogEntry[] = [],
    registros: HcRecord[] = [],
  ) {
    this.trabajadores = trabajadores;
    this.cursos = cursos;
    this.registros = registros;
  }

  findBatchByRequestId(): Promise<null> {
    return Promise.resolve(null);
  }
  findBatchById(): Promise<null> {
    return Promise.resolve(null);
  }
  getLatestCompletedBatch(): Promise<null> {
    return Promise.resolve(null);
  }
  saveBatch(): Promise<void> {
    return Promise.resolve();
  }
  updateBatch(): Promise<void> {
    return Promise.resolve();
  }
  getWorkers(): Promise<WorkerCatalogEntry[]> {
    return Promise.resolve(this.trabajadores.map((fila) => ({ ...fila })));
  }
  getCourses(): Promise<CourseCatalogEntry[]> {
    return Promise.resolve(this.cursos.map((fila) => ({ ...fila })));
  }
  getHcRecords(): Promise<HcRecord[]> {
    return Promise.resolve(this.registros.map((fila) => ({ ...fila })));
  }
  getHcRecordHistory(): Promise<[]> {
    return Promise.resolve([]);
  }
  applyBatchAtomic(_batch: unknown, _ops: AtomicBatchOperations): Promise<void> {
    this.aplicaciones += 1;
    return Promise.resolve();
  }
  recordCandidateCourse(): Promise<void> {
    return Promise.resolve();
  }
  recordCandidateWorker(): Promise<void> {
    return Promise.resolve();
  }
}

// ------------------------------------------------------------- la revisión

describe("Barrido de matriz · revisión", () => {
  it("clasifica cada columna contra SQL y nombra la que trae un curso nuevo", async () => {
    const repositorio = await baseCargada();
    const servicio = new MatrixScanService({ repository: repositorio, clock: new RelojFalso() });

    const informe = await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });

    assert.equal(informe.columnas.length, 3);
    const porNombre = new Map(informe.columnas.map((columna) => [columna.nombre, columna]));
    assert.equal(porNombre.get(INDUCCION)?.estado, "COINCIDE");
    assert.equal(porNombre.get(SEGURIDAD)?.estado, "COINCIDE");
    assert.equal(porNombre.get(ALTURAS)?.estado, "NUEVA");

    // La letra y el conteo de fechas de cada columna salen del propio barrido:
    // son lo que permite ir a la hoja a mirar sin buscar la columna a ojo.
    assert.equal(porNombre.get(ALTURAS)?.columna, "M");
    assert.equal(porNombre.get(INDUCCION)?.fechas, 2);
    assert.equal(porNombre.get(SEGURIDAD)?.fechas, 0);

    assert.equal(informe.cuadre.columnasEnMatriz, 3);
    assert.equal(informe.cuadre.columnasEnBase, 2);
    assert.equal(informe.cuadre.columnasNuevas, 1);
    assert.equal(informe.cuadre.columnasRenombradas, 0);
    assert.equal(informe.cuadre.columnasRetiradas, 0);
    assert.deepEqual(informe.muestras.columnasNuevas, [ALTURAS]);
  });

  it("cuenta trabajadores nuevos, ausentes y cambios de puesto y de área", async () => {
    const repositorio = await baseCargada();
    const servicio = new MatrixScanService({ repository: repositorio, clock: new RelojFalso() });

    const informe = await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });

    assert.equal(informe.cuadre.trabajadoresEnMatriz, 3);
    assert.equal(informe.cuadre.trabajadoresEnBase, 3);
    assert.equal(informe.cuadre.trabajadoresNuevos, 1);
    assert.deepEqual(informe.muestras.trabajadoresNuevos, ["00004"]);
    assert.equal(informe.cuadre.trabajadoresAusentes, 1);
    assert.deepEqual(informe.muestras.trabajadoresAusentes, ["00003"]);

    assert.equal(informe.cuadre.cambiosDePuesto, 1);
    assert.equal(informe.cuadre.cambiosDeArea, 1);
    assert.equal(informe.cuadre.cambiosDeDepartamento, 0);
    assert.deepEqual(
      informe.muestras.cambiosDeAdscripcion.map((cambio) => [
        cambio.numeroTrabajador,
        cambio.campo,
        cambio.antes,
        cambio.ahora,
      ]),
      [
        ["00002", "PUESTO", "OPERADOR", "SUPERVISOR"],
        ["00002", "AREA", "CONVERTIDORA", "EMPAQUE"],
      ],
    );
  });

  it("anuncia exactamente las fechas que la aplicación después escribe", async () => {
    const repositorio = await baseCargada();
    const servicio = new MatrixScanService({ repository: repositorio, clock: new RelojFalso() });

    const informe = await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });

    assert.equal(informe.cuadre.fechasNuevas, 1);
    assert.equal(informe.cuadre.fechasCorregidas, 1);
    // La de 00002 en SEGURIDAD: el trabajador viene y la columna también, pero
    // la celda quedó vacía. La de 00003 no se retira, porque el trabajador no
    // viene en el barrido y ausencia no es baja.
    assert.equal(informe.cuadre.fechasRetiradas, 1);
    assert.equal(informe.cuadre.conflictos, 0);
    assert.equal(informe.bloqueado, false);
    assert.equal(informe.sinCambios, false);

    const resultado = await servicio.aplicar(informe.barridoId, "Maricela0000");
    assert.equal(resultado.conteos.insertedCount, informe.cuadre.fechasNuevas);
    assert.equal(resultado.conteos.correctedCount, informe.cuadre.fechasCorregidas);
    assert.equal(resultado.conteos.retiredCount, informe.cuadre.fechasRetiradas);

    // Y quedó escrito de verdad: el trabajador nuevo y el curso nuevo existen.
    const estado = repositorio.getState();
    assert.ok(estado.workers.some((fila) => fila.workerNumber === "00004"));
    assert.ok(estado.courses.some((fila) => fila.sourceName === ALTURAS));
    assert.ok(
      estado.records.some((fila) => fila.workerNumber === "00002" && fila.status === "RETIRADO"),
    );
  });

  it("barrer no escribe: el repositorio no recibe ninguna aplicación", async () => {
    const falsa = new MatrizFalsa();
    const servicio = new MatrixScanService({ repository: falsa, clock: new RelojFalso() });

    await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });

    assert.equal(falsa.aplicaciones, 0);
  });

  it("un barrido sin cambios lo dice y no ofrece nada que aplicar", async () => {
    const repositorio = await baseCargada();
    const servicio = new MatrixScanService({ repository: repositorio, clock: new RelojFalso() });

    const informe = await servicio.registrar({
      snapshot: { ...ANTERIOR, extractedAt: "2026-08-11T10:00:00.000Z" },
      requestId: "vba-scan-igual",
      cliente: "KCM-OFFICE-01",
    });

    assert.equal(informe.sinCambios, true);
    assert.equal(informe.cuadre.fechasNuevas, 0);
    assert.equal(informe.cuadre.fechasCorregidas, 0);
    assert.equal(informe.cuadre.fechasRetiradas, 0);
    assert.equal(informe.cuadre.trabajadoresNuevos, 0);
    assert.equal(informe.cuadre.columnasNuevas, 0);
  });

  it("una fecha liberada por la plataforma bloquea el barrido en vez de pisarse", async () => {
    const identidad = generateTrainingId(
      `hc-course:${INDUCCION.toLowerCase().replaceAll(" ", "-")}`,
    );
    const falsa = new MatrizFalsa(
      [
        {
          workerNumber: parseWorkerNumber("00001"),
          displayName: "TRABAJADOR SINTETICO 00001",
          hireDate: "2020-01-15",
          payrollType: "NS",
          position: "OPERADOR",
          department: "PRODUCCION",
          area: "CONVERTIDORA",
          plant: "ECATEPEC",
          active: true,
          sourceHash: null,
          updatedAt: "2026-08-01T10:00:00.000Z",
        },
      ],
      [
        {
          trainingId: identidad,
          sourceKey: `hc-course:${INDUCCION.toLowerCase().replaceAll(" ", "-")}`,
          sourceName: INDUCCION,
          normalizedName: normalizeText(INDUCCION),
          aliases: [],
          active: true,
          firstSeenImportId: "imp-1",
          lastSeenImportId: "imp-1",
          updatedAt: "2026-08-01T10:00:00.000Z",
        },
      ],
      [
        {
          recordId: "hc-1",
          idempotencyKey: "sesion|00001|induccion",
          workerNumber: parseWorkerNumber("00001"),
          trainingId: identidad,
          completionDate: "2026-07-01",
          provenance: "SESSION_RELEASE",
          status: "VIGENTE",
          sessionId: "sesion-1",
          releaseId: "lib-1",
          mappingVersion: "operational-hc-v1",
          batchId: null,
          marker: null,
          importId: null,
          requestId: "req-1",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
          version: 1,
        },
      ],
    );

    const servicio = new MatrixScanService({ repository: falsa, clock: new RelojFalso() });
    const informe = await servicio.registrar({
      snapshot: matriz({
        empleados: [empleado("00001")],
        cursos: [curso(INDUCCION, "K")],
        fechas: [fecha("00001", INDUCCION, "2026-01-10")],
        extraidoEn: "2026-08-10T10:00:00.000Z",
      }),
      requestId: "vba-scan-conflicto",
      cliente: "KCM-OFFICE-01",
    });

    assert.equal(informe.cuadre.conflictos, 1);
    assert.equal(informe.bloqueado, true);
    assert.match(informe.muestras.conflictos[0] ?? "", /00001/u);

    await assert.rejects(
      () => servicio.aplicar(informe.barridoId, "Maricela0000"),
      /contradice fechas que la plataforma liberó/u,
    );
    assert.equal(falsa.aplicaciones, 0);
  });

  it("una revisión se aplica una sola vez y caduca a la media hora", async () => {
    const reloj = new RelojFalso();
    const repositorio = await baseCargada();
    const servicio = new MatrixScanService({ repository: repositorio, clock: reloj });

    const informe = await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });
    await servicio.aplicar(informe.barridoId, "Maricela0000");
    await assert.rejects(
      () => servicio.aplicar(informe.barridoId, "Maricela0000"),
      /ya no está disponible/u,
    );

    const otro = await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-2",
      cliente: "KCM-OFFICE-01",
    });
    assert.ok(servicio.ultimoBarrido());
    reloj.avanzarMinutos(31);
    assert.equal(servicio.ultimoBarrido(), undefined);
    await assert.rejects(
      () => servicio.aplicar(otro.barridoId, "Maricela0000"),
      /ya no está disponible/u,
    );
  });
});

// -------------------------------------------------------------- la orden

describe("Barrido de matriz · orden", () => {
  it("dos clics no encargan dos barridos y la orden caduca sola", () => {
    const reloj = new RelojFalso();
    const servicio = new MatrixScanService({ repository: new MatrizFalsa(), clock: reloj });

    const primera = servicio.solicitar("Maricela0000");
    const segunda = servicio.solicitar("Maricela0000");
    assert.equal(primera.ordenId, segunda.ordenId);
    assert.equal(servicio.ordenVigente()?.solicitadaPor, "Maricela0000");

    reloj.avanzarMinutos(31);
    assert.equal(servicio.ordenVigente(), undefined);
  });

  it("recibir un barrido da la orden por atendida", async () => {
    const servicio = new MatrixScanService({
      repository: new MatrizFalsa(),
      clock: new RelojFalso(),
    });
    servicio.solicitar("Maricela0000");
    assert.ok(servicio.ordenVigente());

    await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });
    assert.equal(servicio.ordenVigente(), undefined);
  });
});

// -------------------------------------------------------------- el puente

describe("Barrido de matriz · MATRIX_SCAN_V1", () => {
  const instante = "2026-08-12T12:00:00.000Z";

  async function puente() {
    const reloj = new RelojFalso(instante);
    const matrixRepository = await baseCargada();
    const scans = new MatrixScanService({ repository: matrixRepository, clock: reloj });
    const service = new ExcelIntegrationService({
      repository: new MemoryExcelRepository({ clock: reloj }),
      matrixRepository,
      clock: reloj,
      scans,
    });
    const emitida = await service.issueCredential({
      clientId: "KCM-OFFICE-01",
      principal: "usuario.sintetico",
      windowsProfile: "perfil-sintetico",
      equipment: "equipo-sintetico",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
    return { service, scans, secreto: emitida.secret };
  }

  function llamar(
    service: ExcelIntegrationService,
    secreto: string,
    payload: string,
    nonce: string,
    action: BridgeAction = "MATRIX_SCAN_V1",
  ) {
    return service.handleBridge({
      action,
      clientId: "KCM-OFFICE-01",
      requestId: `vba-scan-${nonce}`,
      sentAt: instante,
      nonce,
      credential: secreto,
      payload: Buffer.from(payload).toString("base64url"),
    });
  }

  /** Los pares `clave=valor` de una respuesta del protocolo. */
  function campos(respuesta: string): Record<string, string> {
    const [, estado, ...pares] = respuesta.split("\n");
    const salida: Record<string, string> = { estado: estado ?? "" };
    for (const par of pares) {
      const corte = par.indexOf("=");
      salida[par.slice(0, corte)] = decodeURIComponent(par.slice(corte + 1));
    }
    return salida;
  }

  it("una sola consulta contesta por los dos barridos", async () => {
    const { service, scans, secreto } = await puente();

    const sinOrden = campos(await llamar(service, secreto, "", "nonce-1", "SCAN_ORDERS_V1"));
    assert.equal(sinOrden.estado, "OK");
    assert.equal(sinOrden.matrixPending, "false");
    assert.equal(sinOrden.rosterPending, "false");

    const orden = scans.solicitar("Maricela0000");
    const conOrden = campos(await llamar(service, secreto, "", "nonce-2", "SCAN_ORDERS_V1"));
    assert.equal(conOrden.matrixPending, "true");
    assert.equal(conOrden.matrixOrderId, orden.ordenId);
    // Sin padrón cableado, la mitad de la respuesta sigue siendo válida y dice
    // que no hay nada encargado, en vez de fallar la consulta entera.
    assert.equal(conOrden.rosterPending, "false");
  });

  it("con snapshot deja la revisión sin aplicar nada", async () => {
    const { service, scans, secreto } = await puente();
    scans.solicitar("Maricela0000");

    const respuesta = campos(await llamar(service, secreto, JSON.stringify(BARRIDA), "nonce-3"));
    assert.equal(respuesta.estado, "OK");
    assert.equal(respuesta.applied, "false");
    assert.equal(respuesta.newWorkers, "1");
    assert.equal(respuesta.missingWorkers, "1");
    assert.equal(respuesta.newColumns, "1");
    assert.equal(respuesta.attributionChanges, "2");
    assert.equal(respuesta.newDates, "1");
    assert.equal(respuesta.correctedDates, "1");
    assert.equal(respuesta.retiredDates, "1");
    assert.equal(respuesta.blocked, "false");

    const informe = scans.ultimoBarrido();
    assert.equal(informe?.barridoId, respuesta.scanId);
    assert.equal(informe?.fuente.cliente, "KCM-OFFICE-01");
    assert.equal(scans.ordenVigente(), undefined);
  });

  it("un cuerpo que no es JSON se rechaza sin reintento", async () => {
    const { service, secreto } = await puente();
    const respuesta = campos(await llamar(service, secreto, "esto no es json", "nonce-4"));
    assert.equal(respuesta.estado, "ERROR");
    assert.equal(respuesta.code, "INVALID_EXCEL_REQUEST");
    assert.equal(respuesta.retryable, "false");
  });

  it("sin barrido habilitado la acción lo dice en vez de fallar por dentro", async () => {
    const service = new ExcelIntegrationService({
      repository: new MemoryExcelRepository({ clock: new RelojFalso(instante) }),
      matrixRepository: new MemoryMatrixRepository(),
      clock: new RelojFalso(instante),
    });
    const emitida = await service.issueCredential({
      clientId: "KCM-OFFICE-01",
      principal: "usuario.sintetico",
      windowsProfile: "perfil-sintetico",
      equipment: "equipo-sintetico",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
    const respuesta = campos(
      await llamar(service, emitida.secret, JSON.stringify(BARRIDA), "nonce-5"),
    );
    assert.equal(respuesta.estado, "ERROR");
    assert.equal(respuesta.code, "EXCEL_SCAN_UNAVAILABLE");
  });
});

// --------------------------------------------------------------- la pantalla

describe("Barrido de matriz · pantalla", () => {
  it("enseña las columnas con nombre y sólo los cambios", async () => {
    const repositorio = await baseCargada();
    const servicio = new MatrixScanService({ repository: repositorio, clock: new RelojFalso() });
    const informe = await servicio.registrar({
      snapshot: BARRIDA,
      requestId: "vba-scan-1",
      cliente: "KCM-OFFICE-01",
    });

    const html = renderMatrixScanPage({ entorno: "development", informe });

    for (const nombre of [INDUCCION, SEGURIDAD, ALTURAS])
      assert.match(html, new RegExp(nombre, "u"));
    assert.match(html, /Columnas detectadas/u);
    assert.match(html, /Cambios contra la matriz anterior/u);
    assert.match(html, /Aplicar a la base/u);
    assert.match(html, /Revisión sin aplicar/u);
    // El barrido nombra al trabajador por su nómina y nunca por su nombre.
    assert.match(html, /00002/u);
    assert.doesNotMatch(html, /TRABAJADOR SINTETICO/u);
  });

  it("con conflictos no ofrece aplicar", () => {
    const html = renderMatrixScanPage({
      entorno: "development",
      informe: {
        barridoId: "b-1",
        recibidoEn: "2026-08-12T12:00:00.000Z",
        venceEn: "2026-08-12T12:30:00.000Z",
        fuente: {
          nombreArchivo: "Matriz_Sintetica.xlsb",
          hoja: "HC",
          sha256: "a".repeat(64),
          extraidoEn: "2026-08-12T11:00:00.000Z",
          cliente: "KCM-OFFICE-01",
        },
        columnas: [],
        cuadre: {
          trabajadoresEnMatriz: 1,
          trabajadoresEnBase: 1,
          trabajadoresNuevos: 0,
          trabajadoresAusentes: 0,
          cambiosDePuesto: 0,
          cambiosDeArea: 0,
          cambiosDeDepartamento: 0,
          columnasEnMatriz: 1,
          columnasEnBase: 1,
          columnasNuevas: 0,
          columnasRenombradas: 0,
          columnasRetiradas: 0,
          fechasEnMatriz: 1,
          fechasNuevas: 0,
          fechasCorregidas: 0,
          fechasRetiradas: 0,
          fechasReactivadas: 0,
          conflictos: 1,
          pendientesEnMaestro: 0,
        },
        muestras: {
          trabajadoresNuevos: [],
          trabajadoresAusentes: [],
          cambiosDeAdscripcion: [],
          columnasNuevas: [],
          columnasRetiradas: [],
          conflictos: ["00001 · HC-X: la matriz trae 2026-01-10 y la plataforma liberó 2026-07-01"],
        },
        sinCambios: false,
        bloqueado: true,
        incidencias: [],
      },
    });

    assert.match(html, /no puede aplicarse/u);
    assert.match(html, /Bloqueado por conflictos/u);
    assert.match(html, /disabled/u);
  });
});

// ----------------------------------------------------------------- las rutas

describe("Barrido de matriz · rutas", () => {
  async function servidor(conBase = true) {
    return buildServer({
      config: loadConfig({ ...ENTORNO }),
      clock: new RelojFalso(),
      ...(conBase ? { excelMatrixRepository: await baseCargada() } : {}),
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
    const app = await servidor();
    for (const [method, url] of [
      ["GET", "/matriz"],
      ["POST", "/matriz/barrido"],
      ["POST", "/matriz/aplicar"],
      ["POST", "/matriz/descartar"],
      ["POST", "/matriz/cancelar"],
    ] as const) {
      const res = await app.inject({ method, url });
      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, "/acceso?destino=%2Fmatriz");
    }
  });

  it("con sesión ofrece encargar el barrido y encargarlo no escribe", async () => {
    const app = await servidor();
    const cookie = await sesion(app);

    const inicial = await app.inject({ method: "GET", url: "/matriz", headers: { cookie } });
    assert.equal(inicial.statusCode, 200);
    assert.match(inicial.body, /Solicitar barrido/u);

    const encargo = await app.inject({
      method: "POST",
      url: "/matriz/barrido",
      headers: { cookie },
    });
    assert.equal(encargo.statusCode, 303);
    assert.equal(encargo.headers.location, "/matriz");

    const conOrden = await app.inject({ method: "GET", url: "/matriz", headers: { cookie } });
    assert.match(conOrden.body, /Barrido encargado/u);
    assert.match(conOrden.body, /Maricela0000/u);

    const cancelado = await app.inject({
      method: "POST",
      url: "/matriz/cancelar",
      headers: { cookie },
    });
    assert.equal(cancelado.statusCode, 303);
    const limpio = await app.inject({ method: "GET", url: "/matriz", headers: { cookie } });
    assert.match(limpio.body, /Solicitar barrido/u);
  });

  it("una revisión que ya no existe no escribe: responde 409", async () => {
    const app = await servidor();
    const cookie = await sesion(app);
    const res = await app.inject({
      method: "POST",
      url: "/matriz/aplicar",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ barridoId: "no-existe" }).toString(),
    });
    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Solicite otro barrido/u);
  });

  it("sin base la pantalla lo explica y no ofrece barrer", async () => {
    const app = await servidor(false);
    const cookie = await sesion(app);
    const res = await app.inject({ method: "GET", url: "/matriz", headers: { cookie } });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Sin base de datos conectada/u);
    assert.doesNotMatch(res.body, /Solicitar barrido/u);
  });
});
