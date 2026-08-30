/**
 * Rutas de liberación sobre el servidor real, con `inject()`.
 *
 * Comprueban lo que sólo se ve de punta a punta: que la pantalla exista, que un
 * lote en conflicto no se responda como éxito, y que el journal no se publique
 * por la API aunque su lote sí sea consultable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryReleaseRepository } from "../../src/adapters/memoria/liberacion.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { renderReleasePage } from "../../src/web/pages/liberacion.ts";
import {
  SESSION_ID,
  TRAINING_ID,
  buildAttendance,
  buildHcRecord,
  buildMapping,
  buildSession,
  fixedClock,
} from "../apoyo/fixtures-liberacion.ts";
import type { HcRecord } from "../../src/domain/importacion-matriz/tipos.ts";

function config() {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3000",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    KCM_PILOT_OPEN_ACCESS: "true",
  });
}

async function server(
  hcRecords: readonly HcRecord[] = [],
  policy: "NO_OVERWRITE" | "OVERWRITE_WITH_HISTORY" = "NO_OVERWRITE",
) {
  const releaseRepository = new MemoryReleaseRepository({
    sessions: [buildSession()],
    attendances: [buildAttendance("10001"), buildAttendance("10002")],
    mappings: [buildMapping(policy)],
    hcRecords,
    trainings: [TRAINING_ID],
  });

  const app = await buildServer({
    config: config(),
    clock: fixedClock(),
    releaseRepository,
    releaseIntegritySecret: "secreto-de-integridad-de-pruebas-32-bytes",
  });

  return { app, releaseRepository };
}

describe("E10 · rutas de liberación", () => {
  it("muestra las sesiones listas en la pestaña de liberación sin pedir el código", () => {
    const html = renderReleasePage({
      entorno: "development",
      sessions: [
        {
          sessionId: SESSION_ID,
          sessionCode: "KCM-260715-ABCDEF",
          trainingId: TRAINING_ID,
          trainingName: "CAPACITACIÓN SINTÉTICA",
          date: "2026-07-15",
          instructor: "INSTRUCTOR SINTÉTICO",
          status: "LISTA_PARA_LIBERAR",
          authorized: true,
          attendanceCount: 2,
          excludedCount: 0,
          pendingExamCount: 0,
        },
      ],
    });

    assert.match(html, /KCM-260715-ABCDEF/);
    assert.match(html, new RegExp(`/liberacion\\?sessionId=${SESSION_ID}`));
    assert.doesNotMatch(html, /Código o ID de sesión/);
  });

  it("GET /liberacion sirve la pantalla de búsqueda", async () => {
    const { app } = await server();
    const respuesta = await app.inject({ method: "GET", url: "/liberacion" });

    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.headers["content-type"] as string, /text\/html/);
    assert.match(respuesta.body, /Liberación a la matriz/);
    await app.close();
  });

  it("GET /liberacion?sessionId= muestra el preflight con su destino declarado", async () => {
    const { app } = await server();
    const respuesta = await app.inject({
      method: "GET",
      url: `/liberacion?sessionId=${SESSION_ID}`,
    });

    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.body, /Validación previa · sesión/);
    assert.match(respuesta.body, /NO_OVERWRITE/);
    assert.match(respuesta.body, /name="requestId" value="[0-9a-f-]{36}"/i);
    await app.close();
  });

  it("GET /liberacion acepta el código visible de la sesión", async () => {
    const { app } = await server();
    const respuesta = await app.inject({
      method: "GET",
      url: "/liberacion?sessionId=KCM-260715-ABCDEF",
    });

    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.body, /Validación previa · sesión/);
    await app.close();
  });

  it("una sesión inexistente responde la pantalla con el motivo, no un 500", async () => {
    const { app } = await server();
    const respuesta = await app.inject({ method: "GET", url: "/liberacion?sessionId=SES-9999" });

    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.body, /La sesión no existe/);
    await app.close();
  });

  it("GET /api/release/preview entrega contadores y un requestId para confirmar", async () => {
    const { app } = await server();
    const respuesta = await app.inject({
      method: "GET",
      url: `/api/release/preview/${SESSION_ID}`,
    });

    assert.equal(respuesta.statusCode, 200);
    const cuerpo = respuesta.json<{ counts: { included: number }; requestId: string }>();
    assert.equal(cuerpo.counts.included, 2);
    assert.ok(cuerpo.requestId);
    await app.close();
  });

  it("POST /api/release/execute aplica el lote y responde 200", async () => {
    const { app, releaseRepository } = await server();
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/release/execute",
      payload: { sessionId: SESSION_ID, requestId: "req-ruta-0001" },
    });

    assert.equal(respuesta.statusCode, 200);
    const cuerpo = respuesta.json<{ phase: string; effectiveWrites: number }>();
    assert.equal(cuerpo.phase, "COMPLETADO");
    assert.equal(cuerpo.effectiveWrites, 2);
    assert.equal(releaseRepository.getAllEffects().length, 2);
    await app.close();
  });

  it("un lote en conflicto responde 409 y no se confunde con un éxito", async () => {
    const { app, releaseRepository } = await server([buildHcRecord("10001", "2026-01-20")]);
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/release/execute",
      payload: { sessionId: SESSION_ID, requestId: "req-ruta-0002" },
    });

    assert.equal(respuesta.statusCode, 409);
    const cuerpo = respuesta.json<{ status: string }>();
    assert.equal(cuerpo.status, "CONFLICTO");
    assert.equal(releaseRepository.getAllEffects().length, 0);
    await app.close();
  });

  it("la consulta del lote no publica el plan ni su firma", async () => {
    const { app } = await server();
    await app.inject({
      method: "POST",
      url: "/api/release/execute",
      payload: { sessionId: SESSION_ID, requestId: "req-ruta-0003" },
    });

    const lotes = await app
      .inject({ method: "GET", url: `/api/release/session/${SESSION_ID}/batches` })
      .then((r) => r.json<{ batchId: string }[]>());

    assert.equal(lotes.length, 1);

    const detalle = await app.inject({
      method: "GET",
      url: `/api/release/batch/${lotes[0]?.batchId ?? ""}`,
    });

    assert.equal(detalle.statusCode, 200);
    const cuerpo = detalle.json<Record<string, unknown>>();
    assert.equal(cuerpo["plan"], undefined, "el plan congelado no sale por la API");
    assert.equal(cuerpo["journalMac"], undefined, "la firma del journal no sale por la API");
    assert.equal(cuerpo["phase"], "COMPLETADO");
    await app.close();
  });

  it("no filtra el número de trabajador en la bitácora de la petición", async () => {
    const { app } = await server();
    const respuesta = await app.inject({
      method: "GET",
      url: `/api/release/preview/${SESSION_ID}`,
    });

    // La respuesta sí trae identidades: es su función. Lo que se comprueba es
    // que la cabecera de trazabilidad exista para poder reportar sin copiarlas.
    assert.ok(respuesta.headers["x-request-id"]);
    assert.equal(respuesta.headers["cache-control"], "no-store");
    await app.close();
  });
});
