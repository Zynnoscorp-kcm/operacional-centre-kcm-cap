import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SupabaseMatrixRepository, type SqlExecutor } from "../../src/adapters/postgres/matriz.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type {
  ImportBatch,
  MatrixSnapshot,
  WorkerCatalogEntry,
} from "../../src/domain/importacion-matriz/tipos.ts";

interface Consulta {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function baseFalsa(consultas: Consulta[]): SqlExecutor {
  const db: SqlExecutor = {
    query: <T>(sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes("INSERT INTO organizacion.puesto")) {
        const nombres = params[0] as string[];
        return Promise.resolve({
          rows: nombres.map((nombre, i) => ({ puesto_id: `p-${String(i)}`, nombre })) as T[],
        });
      }
      if (sql.includes("INSERT INTO organizacion.departamento")) {
        const nombres = params[0] as string[];
        return Promise.resolve({
          rows: nombres.map((nombre, i) => ({ departamento_id: `d-${String(i)}`, nombre })) as T[],
        });
      }
      if (sql.includes("INSERT INTO organizacion.area")) {
        const deptos = params[0] as string[];
        const nombres = params[1] as string[];
        return Promise.resolve({
          rows: nombres.map((nombre, i) => ({
            area_id: `a-${String(i)}`,
            departamento_id: deptos[i],
            nombre,
          })) as T[],
        });
      }
      if (sql.includes("INSERT INTO matriz.destino")) {
        return Promise.resolve({ rows: [{ destino_id: "destino" }] as T[] });
      }
      if (sql.includes("seguridad.actor")) {
        return Promise.resolve({ rows: [{ actor_id: "actor" }] as T[] });
      }
      return Promise.resolve({ rows: [] as T[] });
    },
    transaction: (fn) => fn(db),
  };
  return db;
}

function trabajador(numero: string, extra: Partial<WorkerCatalogEntry> = {}): WorkerCatalogEntry {
  return {
    workerNumber: parseWorkerNumber(numero),
    displayName: `TRABAJADOR ${numero}`,
    hireDate: "2020-01-15",
    payrollType: "NS",
    position: "OPERADOR",
    department: "CONVERTIDORA",
    area: "LINEA 1",
    plant: "ECATEPEC I",
    active: true,
    sourceHash: "abc",
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...extra,
  };
}

const lote = {
  importId: "00000000-0000-4000-8000-000000000001",
  requestId: "vba-scan-prueba",
  sourceSha256: "abc",
  snapshotSha256: "def",
  sourceFileName: "matriz.xlsb",
  sourceSheetName: "MATRIZ",
  sourceExtractedAt: "2026-10-08T00:00:00.000Z",
  phase: "COMPLETED",
  scope: "FULL",
  counts: {
    totalEmployees: 2,
    totalCourses: 0,
    totalCompletions: 0,
    insertedCount: 0,
    correctedCount: 0,
    retiredCount: 0,
    reactivatedCount: 0,
    conflictCount: 0,
    pendingMasterCount: 0,
  },
  diagnostics: { counts: {}, issues: [] },
  createdBy: "excel",
  createdAt: "2026-10-08T00:00:00.000Z",
  completedAt: null,
  rejectionReason: null,
  approvalActorId: null,
  approvalReason: null,
  version: 1,
} as unknown as ImportBatch;

describe("Regresión · la matriz escribe puesto, departamento y área del trabajador", () => {
  it("cada trabajador queda ligado al catálogo con lo que trae la matriz", async () => {
    const consultas: Consulta[] = [];
    const repo = new SupabaseMatrixRepository(baseFalsa(consultas));

    await repo.applyBatchAtomic(lote, {
      workersToUpsert: [
        trabajador("00001"),
        trabajador("00002", { position: "  ", department: null, area: "LINEA 1" }),
      ],
      coursesToUpsert: [],
      recordsToInsert: [],
      recordsToUpdate: [],
      historyEntriesToInsert: [],
      snapshot: {
        source: { fileName: "matriz.xlsb", sheetName: "HC", sha256: "abc", byteSize: 1 },
        employees: [],
        courses: [
          {
            sourceKey: "hc-course:qms",
            sourceColumn: "AB",
            displayName: "QMS",
            normalizedName: "QMS",
          },
        ],
      } as unknown as MatrixSnapshot,
    });

    assert.ok(
      consultas.some((c) => c.sql.includes("INSERT INTO matriz.importacion_contenido")),
      "la copia de la matriz queda guardada para la sincronía",
    );
    const mapeo = consultas.find((c) => c.sql.includes("INSERT INTO matriz.mapeo_columna"));
    assert.ok(mapeo, "el mapeo de columnas se mantiene con el barrido");
    assert.deepEqual(mapeo.params.slice(1, 5), [["hc-course:qms"], ["AB"], ["QMS"], "HC"]);

    const altas = consultas.filter((c) => c.sql.includes("INSERT INTO organizacion.trabajador"));
    assert.equal(altas.length, 1, "un solo INSERT para todos los trabajadores");
    assert.match(altas[0]?.sql ?? "", /puesto_id = EXCLUDED\.puesto_id/u);
    assert.match(altas[0]?.sql ?? "", /area_id = EXCLUDED\.area_id/u);
    assert.deepEqual(altas[0]?.params.slice(7), [
      ["p-0", null],
      ["d-0", null],
      ["a-0", null],
    ]);
    assert.ok(
      consultas.findIndex((c) => c.sql.includes("INSERT INTO matriz.importacion")) <
        consultas.findIndex((c) => c.sql.includes("INSERT INTO organizacion.trabajador")),
      "el lote se guarda dentro de la misma transacción, antes de los trabajadores",
    );
  });

  it("guarda miles de fechas con un número fijo de consultas", async () => {
    const consultas: Consulta[] = [];
    const repo = new SupabaseMatrixRepository(baseFalsa(consultas));
    const registro = (i: number) => ({
      recordId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      idempotencyKey: `k-${String(i)}`,
      workerNumber: parseWorkerNumber("00001"),
      trainingId: "LOTO",
      completionDate: "2026-01-01",
      provenance: "MATRIZ_XLSB",
      status: "VIGENTE",
      sessionId: null,
      releaseId: null,
      mappingVersion: "v1",
      batchId: null,
      marker: null,
      importId: null,
      requestId: null,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      version: 1,
    });
    const cambio = (i: number) => ({
      historyId: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
      recordId: registro(i).recordId,
      workerNumber: parseWorkerNumber("00001"),
      trainingId: "LOTO",
      changeType: "ALTA",
      previousCompletionDate: null,
      completionDate: "2026-01-01",
      previousStatus: null,
      status: "VIGENTE",
      provenance: "MATRIZ_XLSB",
      actorId: "excel",
      reason: "",
      requestId: null,
      importId: null,
      recordedAt: "2026-10-08T00:00:00.000Z",
    });
    const cuantos = 5000;
    await repo.applyBatchAtomic(lote, {
      workersToUpsert: [trabajador("00001")],
      coursesToUpsert: [],
      recordsToInsert: Array.from({ length: cuantos }, (_, i) => registro(i)),
      recordsToUpdate: [],
      historyEntriesToInsert: Array.from({ length: cuantos }, (_, i) => cambio(i)),
    } as unknown as Parameters<typeof repo.applyBatchAtomic>[1]);

    assert.ok(consultas.length < 20, `fueron ${String(consultas.length)} consultas`);
  });
});
