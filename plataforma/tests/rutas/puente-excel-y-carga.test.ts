import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { MemoryExcelRepository } from "../../src/adapters/memoria/excel.ts";
import { loadConfig } from "../../src/config/environment.ts";
import type { MatrixSnapshot } from "../../src/domain/importacion-matriz/tipos.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";

const now = "2026-08-03T12:00:00.000Z";
const clock: Clock = { now: () => new Date(now), nowIso: () => now };
const open: FastifyInstance[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function server(): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig({ KCM_ENV: "development", KCM_PILOT_OPEN_ACCESS: "true" }),
    clock,
    excelRepository: new MemoryExcelRepository({
      workers: [
        {
          employeeId: "10001",
          department: "DEPARTAMENTO SINTETICO",
          area: "AREA SINTETICA",
          position: "PUESTO SINTETICO",
          active: true,
        },
      ],
    }),
  });
  open.push(app);
  return app;
}

const snapshot: MatrixSnapshot = {
  schemaVersion: "HC_SNAPSHOT_V1",
  source: {
    fileName: "Matriz_Sintetica.xlsb",
    sha256: "a".repeat(64),
    byteSize: 100,
    sheetName: "HC",
  },
  extractedAt: "2026-08-03T10:00:00.000Z",
  employees: [
    {
      employeeId: parseWorkerNumber("10001"),
      displayName: "TRABAJADOR SINTETICO",
      hireDate: "2020-01-01",
      payrollType: "SINTETICA",
      position: "PUESTO SINTETICO",
      department: "DEPARTAMENTO SINTETICO",
      area: "AREA SINTETICA",
      plant: "PLANTA SINTETICA",
    },
  ],
  courses: [
    {
      sourceKey: "curso-sintetico",
      sourceColumn: "H",
      displayName: "CURSO SINTETICO",
      normalizedName: "CURSO SINTETICO",
    },
  ],
  completions: [],
  diagnostics: {
    counts: {
      employeeCount: 1,
      courseCount: 1,
      completionCount: 0,
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

describe("rutas integradas E11–E14", () => {
  it("sirve los tres frentes SSR y toda respuesta queda no-store", async () => {
    const app = await server();
    for (const url of ["/salas?date=2026-08-10", "/auditoria", "/dc3", "/excel"]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 200, url);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(response.body, /<html/u);
    }
  });

  it("emite credencial Power Query y la revalida en el endpoint CSV", async () => {
    const app = await server();
    const issued = await app.inject({
      method: "POST",
      url: "/api/excel/credentials",
      payload: {
        clientId: "client-pq",
        principal: "usuario-sintetico",
        windowsProfile: "perfil-sintetico",
        equipment: "equipo-sintetico",
        scope: "POWER_QUERY_LECTURA",
        resource: "workers.csv",
        expiresAt: "2026-08-04T12:00:00.000Z",
      },
    });
    assert.equal(issued.statusCode, 201);
    const credential = issued.json<{ credential: string }>().credential;
    const csv = await app.inject({
      method: "GET",
      url: "/api/excel/power-query/workers.csv",
      headers: { authorization: `Bearer ${credential}`, "x-kcm-client-id": "client-pq" },
    });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.body, /"10001"/u);
    assert.equal(csv.headers["cache-control"], "no-store");
    const denied = await app.inject({
      method: "GET",
      url: "/api/excel/power-query/workers.csv",
      headers: { authorization: "Bearer incorrecta", "x-kcm-client-id": "client-pq" },
    });
    assert.equal(denied.statusCode, 401);
  });

  it("acepta el protocolo POST del cliente VBA sin cambiar su forma", async () => {
    const app = await server();
    const issued = await app.inject({
      method: "POST",
      url: "/api/excel/credentials",
      payload: {
        clientId: "client-vba",
        principal: "usuario-sintetico",
        windowsProfile: "perfil-sintetico",
        equipment: "equipo-sintetico",
        scope: "PUENTE_VBA",
        resource: "bridge",
        expiresAt: "2026-08-04T12:00:00.000Z",
      },
    });
    const credential = issued.json<{ credential: string }>().credential;
    const body = new URLSearchParams({
      action: "STATUS_V1",
      clientId: "client-vba",
      requestId: "request-status",
      sentAt: now,
      nonce: "nonce-status",
      token: credential,
      payload: "",
    }).toString();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vba-bridge",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: body,
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /^KCM_VBA_BRIDGE_V1\nOK/mu);
  });

  it("emite una credencial permanente cuando se solicita explícitamente", async () => {
    const app = await server();
    const issued = await app.inject({
      method: "POST",
      url: "/api/excel/credentials",
      payload: {
        clientId: "client-permanente",
        principal: "usuario-sintetico",
        windowsProfile: "perfil-sintetico",
        equipment: "equipo-sintetico",
        scope: "PUENTE_VBA",
        resource: "bridge",
        permanent: "true",
      },
    });
    assert.equal(issued.statusCode, 201);
    assert.equal(issued.json<{ expiresAt: string | null }>().expiresAt, null);
  });

  it("muestra diff del staging antes de aprobar la carga", async () => {
    const app = await server();
    const staged = await app.inject({
      method: "POST",
      url: "/api/excel/imports",
      payload: { requestId: "excel-import-1", snapshot },
    });
    assert.equal(staged.statusCode, 202);
    const preview = staged.json<{
      importId: string;
      phase: string;
      unknownCourses: number;
      unknownWorkers: number;
    }>();
    assert.equal(preview.phase, "VALIDADO");
    assert.equal(preview.unknownCourses, 1);
    assert.equal(preview.unknownWorkers, 1);
    const approved = await app.inject({
      method: "POST",
      url: `/api/excel/imports/${preview.importId}/approve`,
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json<{ phase: string }>().phase, "COMPLETADO");
  });
});
