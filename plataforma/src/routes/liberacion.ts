import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import type { MatrixDeliveryService } from "../domain/liberacion/entregas.ts";
import type { ReleaseService } from "../domain/liberacion/servicio.ts";
import type { ActorIdentity } from "../domain/quiosco/tipos.ts";
import { DomainError } from "../domain/comun/errores.ts";
import { badRequest } from "../server/errors.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { renderReleasePage, type AdvertenciaDeLiberacion } from "../web/pages/liberacion.ts";
import type { ReleasePreview } from "../domain/liberacion/tipos.ts";

export interface ReleaseRouteDeps {
  readonly config: AppConfig;
  readonly releaseService: ReleaseService;
  readonly workbenchService: WorkbenchService;
  readonly deliveries?: MatrixDeliveryService;
  readonly sessions?: ConsoleSessionCodec;
}

export function registerReleaseRoutes(app: FastifyInstance, deps: ReleaseRouteDeps): void {
  const { config, releaseService, workbenchService } = deps;

  const deVueltaAlTablero = (aviso: string): string =>
    `/liberacion?entregas=1&aviso=${encodeURIComponent(aviso)}#entregas`;

  const identidadPorOmision: ActorIdentity = {
    actor: "USUARIO_CAPACITACION",
    role: "CAPACITACION",
  };
  const identidadDe = (req: FastifyRequest): ActorIdentity => {
    const cuenta = deps.sessions?.leer(req.headers.cookie, new Date())?.usuario;
    return cuenta ? { ...identidadPorOmision, actor: cuenta } : identidadPorOmision;
  };

  const advertenciasDe = async (preview: ReleasePreview): Promise<AdvertenciaDeLiberacion[]> => {
    const conFecha = preview.included.filter(
      (fila) => fila.status === "ALREADY_APPLIED" || Boolean(fila.previousDate),
    );
    if (conFecha.length === 0) return [];
    const nombres = await workbenchService.employeeNames(conFecha.map((fila) => fila.employeeId));
    return conFecha.map((fila) => {
      const previa = fila.previousDate ?? "";
      const texto =
        fila.status === "ALREADY_APPLIED"
          ? `Ya tiene esta misma fecha (${preview.completionDate}): no cambia nada.`
          : previa > preview.completionDate
            ? `Ya tiene una fecha más reciente (${previa}): se reemplazaría por ${preview.completionDate}.`
            : `Ya tiene una fecha anterior (${previa}): se reemplaza por ${preview.completionDate}.`;
      return { employeeId: fila.employeeId, nombre: nombres.get(fila.employeeId) ?? "", texto };
    });
  };

  app.get("/liberacion", async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId, aviso } = (req.query ?? {}) as { sessionId?: string; aviso?: string };

    if (!sessionId) {
      const [sessions, deliveries] = await Promise.all([
        workbenchService.listReleaseQueue(identidadDe(req)),
        deps.deliveries?.list(),
      ]);
      const { entregas } = (req.query ?? {}) as { entregas?: string };
      return reply.type("text/html; charset=utf-8").send(
        renderReleasePage({
          entorno: config.environment,
          sessions,
          ...(deliveries ? { deliveries } : {}),
          entregasAbiertas: entregas === "1",
          ...(aviso ? { aviso } : {}),
        }),
      );
    }

    try {
      const resolvedSessionId = await releaseService.resolveSessionReference(sessionId);
      const preview = await releaseService.preview(resolvedSessionId);
      const advertencias = await advertenciasDe(preview);
      return reply.type("text/html; charset=utf-8").send(
        renderReleasePage({
          entorno: config.environment,
          preview,
          advertencias,
          requestId: randomUUID(),
          ...(aviso ? { aviso } : {}),
        }),
      );
    } catch (error) {
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

  app.post(
    "/liberacion/entregas/:batchId/ocultar",
    async (req: FastifyRequest<{ Params: { batchId: string } }>, reply: FastifyReply) => {
      if (!deps.deliveries) {
        return reply.redirect(
          deVueltaAlTablero("Sin conexión con la base de datos: no hay tablero que modificar."),
          303,
        );
      }

      try {
        const entrega = await deps.deliveries.hide({
          batchId: req.params.batchId,
          actor: identidadDe(req).actor,
          requestId: String(req.id),
        });
        req.log.info({ lote: entrega.batchId }, "entrega retirada del tablero");
        return reply.redirect(
          deVueltaAlTablero(
            `La entrega de ${entrega.sessionCode} salió del tablero. Sigue en auditoría.`,
          ),
          303,
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        return reply.redirect(deVueltaAlTablero(error.message), 303);
      }
    },
  );

  app.get("/api/release/preview/:sessionId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { overwriteReason } = (req.query ?? {}) as { overwriteReason?: string };

    const preview = await releaseService.preview(sessionId, overwriteReason ?? "");

    return reply.send({ ...preview, requestId: randomUUID() });
  });

  app.post("/api/release/execute", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      sessionId?: string;
      requestId?: string;
      overwriteReason?: string;
      confirmar?: string;
    };

    const confirmado = body.confirmar === "1";
    const motivo =
      (body.overwriteReason ?? "").trim() ||
      (confirmado ? "Liberado tras confirmar las advertencias en la plataforma" : "");

    if (!body.sessionId) {
      throw badRequest("Falta el identificador de sesión.");
    }

    const enPantalla = String(req.headers.accept ?? "").includes("text/html");
    const aLaSesion = (aviso: string): string =>
      `/liberacion?sessionId=${encodeURIComponent(body.sessionId ?? "")}&aviso=${encodeURIComponent(aviso)}`;

    let outcome;
    try {
      outcome = await releaseService.release(
        {
          sessionId: body.sessionId,
          requestId: body.requestId || randomUUID(),
          ...(motivo ? { overwriteReason: motivo } : {}),
        },
        identidadDe(req),
      );
    } catch (error) {
      if (!enPantalla || !(error instanceof DomainError)) throw error;
      return reply.redirect(aLaSesion(error.message), 303);
    }

    if (enPantalla) {
      if (outcome.status === "CONFLICTO") {
        const motivoFaltante = outcome.results.some(
          (result) => result.status === "OVERWRITE_REASON_REQUIRED",
        );
        return reply.redirect(
          aLaSesion(
            motivoFaltante
              ? "Hay advertencias por confirmar: no se liberó nada todavía."
              : "La liberación se detuvo por conflicto: no se liberó nada. Los registros que la detienen están en «Registros que no se liberan».",
          ),
          303,
        );
      }
      return reply.redirect(
        `/liberacion?entregas=1&aviso=${encodeURIComponent("Sesión liberada. Las fechas se escriben en la matriz con «Actualizar el libro» en Excel.")}#entregas`,
        303,
      );
    }

    return reply.code(outcome.status === "CONFLICTO" ? 409 : 200).send(outcome);
  });

  app.get("/api/release/batch/:batchId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { batchId } = req.params as { batchId: string };
    const batch = await releaseService.getBatch(batchId);

    if (!batch) {
      return reply
        .code(404)
        .send({ error: { code: "NO_ENCONTRADO", message: "El lote no existe." } });
    }

    const { plan: _plan, journalMac: _mac, results, ...publico } = batch;
    return reply.send({ ...publico, results: JSON.parse(results || "[]") as unknown });
  });

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
