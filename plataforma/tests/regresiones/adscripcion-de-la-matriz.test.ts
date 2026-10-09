import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SupabaseMatrixRepository, type SqlExecutor } from "../../src/adapters/postgres/matriz.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { ImportBatch, WorkerCatalogEntry } from "../../src/domain/importacion-matriz/tipos.ts";

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
    });

    const altas = consultas.filter((c) => c.sql.includes("INSERT INTO organizacion.trabajador"));
    assert.equal(altas.length, 2);
    assert.match(altas[0]?.sql ?? "", /puesto_id = EXCLUDED\.puesto_id/u);
    assert.match(altas[0]?.sql ?? "", /area_id = EXCLUDED\.area_id/u);
    assert.deepEqual(altas[0]?.params.slice(7), ["p-0", "d-0", "a-0"]);
    assert.deepEqual(altas[1]?.params.slice(7), [null, null, null]);
  });
});
