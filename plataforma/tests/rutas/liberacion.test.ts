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
    assert.match(respuesta.body, /Validación previa/);
    assert.match(respuesta.body, /No sobrescribe fechas/);
    assert.doesNotMatch(respuesta.body, /NO_OVERWRITE/);
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
    assert.match(respuesta.body, /Validación previa/);
    await app.close();
  });

  it("GET /liberacion acepta el código nuevo, también tecleado sin ceros", async () => {
    const app = await buildServer({
      config: config(),
      clock: fixedClock(),
      releaseRepository: new MemoryReleaseRepository({
        sessions: [buildSession({ sessionCode: "KC-0007" })],
        attendances: [buildAttendance("10001")],
        mappings: [buildMapping("NO_OVERWRITE")],
        trainings: [TRAINING_ID],
      }),
      releaseIntegritySecret: "secreto-de-integridad-de-pruebas-32-bytes",
    });
    for (const tecleado of ["KC-0007", "kc-7"]) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/liberacion?sessionId=${tecleado}`,
      });
      assert.equal(respuesta.statusCode, 200, tecleado);
      assert.match(respuesta.body, /Validación previa/, tecleado);
    }
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

  it("con una fecha previa, la validación avisa en un cuadro y deja liberar o no", async () => {
    const { app } = await server([buildHcRecord("10001", "2026-01-20")], "OVERWRITE_WITH_HISTORY");
    const pantalla = await app.inject({
      method: "GET",
      url: `/liberacion?sessionId=${SESSION_ID}`,
    });

    assert.match(
      pantalla.body,
      /popovertarget="confirmar-liberacion"[^>]*>\s*Liberar 2 registro\(s\)/u,
    );
    assert.match(pantalla.body, /Ya tiene una fecha anterior \(2026-01-20\)/u);
    assert.match(pantalla.body, /Liberar de todos modos/u);
    assert.match(pantalla.body, /No liberar/u);
    assert.match(pantalla.body, /action="\/api\/pre-release\/return"/u);
    await app.close();
  });

  it("confirmar el cuadro libera sin escribir motivo", async () => {
    const { app, releaseRepository } = await server(
      [buildHcRecord("10001", "2026-01-20")],
      "OVERWRITE_WITH_HISTORY",
    );
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/release/execute",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      payload: new URLSearchParams({
        sessionId: SESSION_ID,
        requestId: "req-ruta-confirmada",
        confirmar: "1",
      }).toString(),
    });

    assert.equal(respuesta.statusCode, 303);
    assert.match(String(respuesta.headers.location), /^\/liberacion\?entregas=1/u);
    assert.equal(releaseRepository.getAllEffects().length, 2);
    await app.close();
  });

  it("desde la pantalla, liberar sin motivo vuelve a la validación con el aviso", async () => {
    const { app, releaseRepository } = await server(
      [buildHcRecord("10001", "2026-01-20")],
      "OVERWRITE_WITH_HISTORY",
    );
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/release/execute",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      payload: new URLSearchParams({
        sessionId: SESSION_ID,
        requestId: "req-ruta-html",
      }).toString(),
    });

    assert.equal(respuesta.statusCode, 303);
    assert.match(
      String(respuesta.headers.location),
      new RegExp(`^/liberacion\\?sessionId=${SESSION_ID}&aviso=Hay`, "u"),
    );
    assert.equal(releaseRepository.getAllEffects().length, 0);

    const conMotivo = await app.inject({
      method: "POST",
      url: "/api/release/execute",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      payload: new URLSearchParams({
        sessionId: SESSION_ID,
        requestId: "req-ruta-html-2",
        overwriteReason: "Corrección de la fecha anterior",
      }).toString(),
    });
    assert.equal(conMotivo.statusCode, 303);
    assert.match(String(conMotivo.headers.location), /^\/liberacion\?entregas=1/u);
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

    assert.ok(respuesta.headers["x-request-id"]);
    assert.equal(respuesta.headers["cache-control"], "no-store");
    await app.close();
  });
});
