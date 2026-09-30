import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SupabaseReleaseRepository } from "../../src/adapters/postgres/liberacion.ts";
import type { SqlExecutor } from "../../src/adapters/postgres/matriz.ts";

function baseCon(fila: Record<string, unknown>): SqlExecutor {
  const db: SqlExecutor = {
    query: <T>() => Promise.resolve({ rows: [fila] as T[] }),
    transaction: (fn) => fn(db),
  };
  return db;
}

describe("Regresión · lote en conflicto", () => {
  it("un lote guardado con fase PENDIENTE y estado CONFLICTO se lee como CONFLICTO", async () => {
    const repositorio = new SupabaseReleaseRepository(
      baseCon({
        lote_id: "11111111-1111-1111-1111-111111111111",
        sesion_id: "22222222-2222-2222-2222-222222222222",
        solicitud_id: "req-1",
        version_mapeo: "v1",
        sha256_plan: "a".repeat(64),
        firma_hmac: "b".repeat(64),
        resultados: { plan: "", results: "" },
        fase: "PENDIENTE",
        estado: "CONFLICTO",
        resultado_sesion: null,
        motivo_sobrescritura: null,
        total_candidatos: 6,
        total_escritos: 0,
        total_conflictos: 2,
        creado_en: "2026-09-30T08:31:14.110Z",
        actualizado_en: "2026-09-30T08:31:14.132Z",
        completado_en: "2026-09-30T08:31:14.132Z",
        contrato_version: "1.0.0",
        creador: "USUARIO",
      }),
    );

    const lote = await repositorio.findBatchById("11111111-1111-1111-1111-111111111111");

    assert.equal(lote?.phase, "CONFLICTO");
  });
});
