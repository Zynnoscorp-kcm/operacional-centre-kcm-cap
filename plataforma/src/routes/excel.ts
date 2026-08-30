import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { ExcelIntegrationService } from "../domain/excel/integracion.ts";
import type { BridgeAction, ExcelCredentialScope } from "../domain/excel/tipos.ts";
import type { MatrixSnapshot } from "../domain/importacion-matriz/tipos.ts";
import type { Clock } from "../ports/reloj.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { renderExcelPage, type DatosDeExcel } from "../web/pages/excel.ts";

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function bearer(request: FastifyRequest): string {
  const value = text(request.headers.authorization);
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export function registerExcelRoutes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    readonly service: ExcelIntegrationService;
    /**
     * Estado que la pantalla enseña arriba. Es opcional para que una prueba
     * pueda construir el servidor sin repositorio de acuses; sin él los
     * contadores salen en cero en lugar de romper la pantalla.
     */
    readonly estado?: () => Promise<{
      readonly pendientesDeExcel: number;
      readonly fechasEscritas: number;
    }>;
    /** Sesión de consola. La conserva el guardia; aquí sólo se declara. */
    readonly sessions?: ConsoleSessionCodec;
    readonly clock?: Clock;
  },
): void {
  /**
   * Origen público de la petición.
   *
   * Detrás de un túnel el proceso escucha en claro sobre loopback pero el
   * cliente llegó por TLS. Sin mirar `x-forwarded-proto`, la página dictaba un
   * `ENDPOINT` con `http://` que el módulo VBA rechaza. La cabecera sólo decide
   * el texto que se muestra; no relaja ninguna comprobación.
   */
  const origenDe = (request: FastifyRequest): string => {
    const host = text(request.headers.host) || `${deps.config.host}:${String(deps.config.port)}`;
    const reenviado = text(request.headers["x-forwarded-proto"]).split(",")[0]?.trim();
    const protocolo =
      reenviado === "https" || reenviado === "http"
        ? reenviado
        : deps.config.environment === "production"
          ? "https"
          : "http";
    return `${protocolo}://${host}`;
  };

  /** La pantalla completa. La comparten el `GET` y la emisión del código. */
  const pantalla = async (
    request: FastifyRequest,
    extra: Partial<DatosDeExcel> = {},
  ): Promise<string> => {
    const origen = origenDe(request);
    const estado = (await deps.estado?.()) ?? { pendientesDeExcel: 0, fechasEscritas: 0 };
    return renderExcelPage({
      config: deps.config,
      endpoint: `${origen}/api/v1/vba-bridge`,
      origen,
      ...estado,
      ...extra,
    });
  };

  app.get("/excel", async (request, reply) => {
    const query = request.query as { notice?: string };
    return reply
      .type("text/html; charset=utf-8")
      .send(await pantalla(request, query.notice ? { notice: query.notice } : {}));
  });

  app.post("/api/excel/credentials", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const permanent = text(body.permanent) === "true" || text(body.permanent) === "on";
    const expiresRaw = text(body.expiresAt);
    let expiresAt: string | null = null;
    if (!permanent) {
      const parsed = new Date(expiresRaw);
      if (!expiresRaw || !Number.isFinite(parsed.getTime())) {
        return reply.code(400).send({
          code: "INVALID_EXCEL_CREDENTIAL",
          message: "Indique una fecha futura o seleccione Sin vencimiento.",
        });
      }
      expiresAt = expiresRaw.endsWith("Z") ? expiresRaw : parsed.toISOString();
    }
    const result = await deps.service.issueCredential({
      clientId: text(body.clientId),
      principal: text(body.principal),
      windowsProfile: text(body.windowsProfile),
      equipment: text(body.equipment),
      scope: text(body.scope) as ExcelCredentialScope,
      resource: text(body.resource),
      expiresAt,
    });
    return reply.code(201).send({
      clientId: result.credential.clientId,
      scope: result.credential.scope,
      expiresAt: result.credential.expiresAt,
      credential: result.secret,
      warning: "Copie la credencial ahora; no vuelve a mostrarse.",
    });
  });

  app.post("/api/excel/credentials/:clientId/revoke", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    await deps.service.revokeCredential(
      clientId,
      text(body.scope) as ExcelCredentialScope,
      text(body.reason),
    );
    return reply.code(204).send();
  });

  app.post("/api/v1/vba-bridge", { bodyLimit: 25_165_824 }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await deps.service.handleBridge({
      action: text(body.action) as BridgeAction,
      clientId: text(body.clientId),
      requestId: text(body.requestId),
      sentAt: text(body.sentAt),
      nonce: text(body.nonce),
      credential: text(body.token),
      payload: text(body.payload),
    });
    return reply.type("text/plain; charset=utf-8").send(result);
  });

  app.get("/api/excel/power-query/workers.csv", async (request, reply) => {
    const clientId = text(request.headers["x-kcm-client-id"]);
    const csv = await deps.service.workersCsv(clientId, "workers.csv", bearer(request));
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="kcm-workers.csv"')
      .send(csv);
  });

  app.post("/api/excel/imports", async (request, reply) => {
    const body = (request.body ?? {}) as { requestId?: string; snapshot?: MatrixSnapshot };
    if (!body.snapshot) throw new Error("Falta el snapshot de matriz");
    const preview = await deps.service.receiveImport(
      body.requestId ?? randomUUID(),
      body.snapshot,
      "USUARIO_CAPACITACION",
    );
    return reply.code(202).send(preview);
  });
  app.post("/api/excel/imports/:importId/approve", async (request, reply) => {
    const { importId } = request.params as { importId: string };
    return reply.send(await deps.service.approveImport(importId, "USUARIO_CAPACITACION"));
  });
}
