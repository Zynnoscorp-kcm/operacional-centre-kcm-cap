/**
 * Rutas de Liberación a la matriz (Función 5).
 *
 * El `requestId` lo genera el servidor y viaja al cliente en la vista previa:
 * aceptarlo por petición dejaría que quien llama escoja con qué identificador
 * queda su lote, y con eso la reanudación por `requestId` dejaría de proteger
 * nada. Reanudar es volver a mandar el que ya se entregó.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import type { ReleaseService } from "../domain/liberacion/servicio.ts";
import type { ActorIdentity } from "../domain/quiosco/tipos.ts";
import { DomainError } from "../domain/errores.ts";
import { badRequest } from "../server/errors.ts";
import { renderReleasePage } from "../web/pages/liberacion.ts";

export interface ReleaseRouteDeps {
  readonly config: AppConfig;
  readonly releaseService: ReleaseService;
  readonly workbenchService: WorkbenchService;
}

export function registerReleaseRoutes(app: FastifyInstance, deps: ReleaseRouteDeps): void {
  const { config, releaseService, workbenchService } = deps;

  // Control de acceso: hasta que E3 entregue sesión de usuario, la identidad es
  // fija y declarada. Queda explícito para que sustituirla sea un cambio de una
  // línea y no una arqueología.
  const identidadPorOmision: ActorIdentity = {
    actor: "USUARIO_CAPACITACION",
    role: "CAPACITACION",
  };

  // GET /liberacion — pantalla de preflight
  app.get("/liberacion", async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId, aviso } = (req.query ?? {}) as { sessionId?: string; aviso?: string };

    if (!sessionId) {
      const sessions = await workbenchService.listReleaseQueue(identidadPorOmision);
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderReleasePage({ entorno: config.environment, sessions, ...(aviso ? { aviso } : {}) }),
        );
    }

    try {
      const resolvedSessionId = await releaseService.resolveSessionReference(sessionId);
      const preview = await releaseService.preview(resolvedSessionId);
      return reply.type("text/html; charset=utf-8").send(
        renderReleasePage({
          entorno: config.environment,
          preview,
          requestId: randomUUID(),
          ...(aviso ? { aviso } : {}),
        }),
      );
    } catch (error) {
      // Una sesión que no existe o no está lista no es una falla del servidor:
      // se responde la misma pantalla con el motivo, sin filtrar nada interno.
      if (error instanceof DomainError) {
        return reply.type("text/html; charset=utf-8").send(
          renderReleasePage({
            entorno: config.environment,
            mensaje: error.message,
            ...(aviso ? { aviso } : {}),
          }),
        );
      }
      throw error;
    }
  });

  // GET /api/release/preview/:sessionId — preflight sin ningún efecto
  app.get("/api/release/preview/:sessionId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { overwriteReason } = (req.query ?? {}) as { overwriteReason?: string };

    const preview = await releaseService.preview(sessionId, overwriteReason ?? "");

    // Se entrega el `requestId` con el que habría que confirmar y, si hiciera
    // falta, reanudar.
    return reply.send({ ...preview, requestId: randomUUID() });
  });

  // POST /api/release/execute — aplica el lote
  app.post("/api/release/execute", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      sessionId?: string;
      requestId?: string;
      overwriteReason?: string;
    };

    if (!body.sessionId) {
      throw badRequest("Falta el identificador de sesión.");
    }

    const outcome = await releaseService.release(
      {
        sessionId: body.sessionId,
        requestId: body.requestId || randomUUID(),
        ...(body.overwriteReason === undefined ? {} : { overwriteReason: body.overwriteReason }),
      },
      identidadPorOmision,
    );

    // Un lote en conflicto no es un error del servidor ni de la petición: es un
    // resultado del negocio, y se responde como tal para que la interfaz pueda
    // mostrar por qué se detuvo.
    return reply.code(outcome.status === "CONFLICTO" ? 409 : 200).send(outcome);
  });

  // GET /api/release/batch/:batchId — consulta del journal
  app.get("/api/release/batch/:batchId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { batchId } = req.params as { batchId: string };
    const batch = await releaseService.getBatch(batchId);

    if (!batch) {
      return reply
        .code(404)
        .send({ error: { code: "NO_ENCONTRADO", message: "El lote no existe." } });
    }

    // El plan y su firma no salen: son el mecanismo de integridad, no
    // información operativa, y publicarlos sólo ayudaría a falsificarlos.
    const { plan: _plan, journalMac: _mac, results, ...publico } = batch;
    return reply.send({ ...publico, results: JSON.parse(results || "[]") as unknown });
  });

  // GET /api/release/session/:sessionId/batches — lotes de una sesión
  app.get(
    "/api/release/session/:sessionId/batches",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = req.params as { sessionId: string };
      const batches = await releaseService.listBatchesBySession(sessionId);

      return reply.send(
        batches.map((batch) => ({
          batchId: batch.batchId,
          requestId: batch.requestId,
          phase: batch.phase,
          status: batch.status,
          sessionOutcome: batch.sessionOutcome,
          totalCandidates: batch.totalCandidates,
          totalWritten: batch.totalWritten,
          totalConflicts: batch.totalConflicts,
          createdAt: batch.createdAt,
          completedAt: batch.completedAt,
        })),
      );
    },
  );
}
