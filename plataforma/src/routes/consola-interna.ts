import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { InternalAuditService } from "../domain/consola-interna/auditoria.ts";
import type { DataPreviewService } from "../domain/consola-interna/vista-de-datos.ts";
import type { DeclaredFieldService } from "../domain/consola-interna/campos-declarados.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import {
  renderReleaseAuditPage,
  renderRoomAuditPage,
  renderSessionAuditPage,
} from "../web/pages/consola-auditoria.ts";
import {
  renderDeclaredFieldsPage,
  renderTableCatalogPage,
  renderTablePreviewPage,
} from "../web/pages/consola-datos.ts";

const ACTOR_POR_OMISION = "CONSOLA_INTERNA";

const SESION_REQUERIDA = "Declarar o aprobar un campo requiere sesión iniciada en /acceso.";

export interface InternalConsoleDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
  readonly auditService: InternalAuditService;
  readonly fieldService: DeclaredFieldService;
  readonly previewService: DataPreviewService;
}

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function quiereHtml(peticion: FastifyRequest): boolean {
  return String(peticion.headers.accept ?? "").includes("text/html");
}

export function registerInternalConsoleRoutes(
  app: FastifyInstance,
  deps: InternalConsoleDeps,
): void {
  const { config, clock, sessions, auditService, fieldService, previewService } = deps;

  const sinBase = config.databaseUrl === undefined || config.databaseUrl === "";

  const exigeSesion = config.pilot.consoleUser !== undefined && !config.pilot.openAccess;

  function actorDe(peticion: FastifyRequest): string | undefined {
    const sesion = sessions.leer(peticion.headers.cookie, clock.now());
    if (sesion !== undefined) return sesion.usuario;
    return exigeSesion ? undefined : ACTOR_POR_OMISION;
  }

  const html = (respuesta: FastifyReply, cuerpo: string): FastifyReply =>
    respuesta.type("text/html; charset=utf-8").send(cuerpo);

  const volverACampos = (respuesta: FastifyReply, aviso: string, esError: boolean): FastifyReply =>
    respuesta.redirect(
      `/campos?${new URLSearchParams({ [esError ? "error" : "notice"]: aviso }).toString()}`,
      303,
    );

  app.get("/auditoria/sesiones", async (_peticion, respuesta) =>
    html(
      respuesta,
      renderSessionAuditPage({
        config,
        window: auditService.window(),
        rows: await auditService.sessions(),
        sinBase,
      }),
    ),
  );

  app.get("/auditoria/salas", async (_peticion, respuesta) =>
    html(
      respuesta,
      renderRoomAuditPage({
        config,
        window: auditService.window(),
        rows: await auditService.rooms(),
        sinBase,
      }),
    ),
  );

  app.get("/auditoria/liberaciones", async (_peticion, respuesta) =>
    html(
      respuesta,
      renderReleaseAuditPage({ config, rows: await auditService.releases(), sinBase }),
    ),
  );

  app.get("/api/auditoria/sesiones", async (_peticion, respuesta) =>
    respuesta.send({ window: auditService.window(), sessions: await auditService.sessions() }),
  );

  app.get("/api/auditoria/salas", async (_peticion, respuesta) =>
    respuesta.send({ window: auditService.window(), reservations: await auditService.rooms() }),
  );

  app.get("/api/auditoria/liberaciones", async (_peticion, respuesta) =>
    respuesta.send({ releases: await auditService.releases() }),
  );

  app.get("/campos", async (peticion, respuesta) => {
    const consulta = peticion.query as { notice?: string; error?: string };
    return html(
      respuesta,
      renderDeclaredFieldsPage({
        config,
        fields: await fieldService.list(),
        requiereSesion: exigeSesion,
        ...(consulta.notice ? { notice: consulta.notice } : {}),
        ...(consulta.error ? { error: consulta.error } : {}),
      }),
    );
  });

  app.get("/api/campos", async (_peticion, respuesta) =>
    respuesta.send({ fields: await fieldService.list() }),
  );

  app.post("/campos", async (peticion, respuesta) => {
    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
    const esHtml = quiereHtml(peticion);
    const actor = actorDe(peticion);

    if (actor === undefined) {
      peticion.log.warn("alta de campo rechazada por falta de sesión de consola");
      if (esHtml) return volverACampos(respuesta, SESION_REQUERIDA, true);
      return respuesta
        .code(401)
        .send({ error: { code: "SESION_REQUERIDA", message: SESION_REQUERIDA } });
    }

    const descripcion = texto(cuerpo.descripcion);
    try {
      const campo = await fieldService.declare(
        {
          name: texto(cuerpo.nombre),
          dataType: texto(cuerpo.tipo),
          source: texto(cuerpo.origen),
          ...(descripcion ? { description: descripcion } : {}),
        },
        actor,
      );
      peticion.log.info({ campo: campo.name }, "campo declarado");

      if (esHtml) {
        return volverACampos(
          respuesta,
          `Campo «${campo.name}» declarado. Todavía no alimenta ninguna regla.`,
          false,
        );
      }
      return respuesta.code(201).send({ field: campo });
    } catch (error) {
      if (!esHtml || !(error instanceof DomainError)) throw error;
      peticion.log.warn({ codigo: error.code }, "alta de campo rechazada");
      return volverACampos(respuesta, error.message, true);
    }
  });

  app.post("/campos/:campoId/aprobar", async (peticion, respuesta) => {
    const { campoId } = peticion.params as { campoId: string };
    const esHtml = quiereHtml(peticion);
    const actor = actorDe(peticion);

    if (actor === undefined) {
      peticion.log.warn("aprobación de campo rechazada por falta de sesión de consola");
      if (esHtml) return volverACampos(respuesta, SESION_REQUERIDA, true);
      return respuesta
        .code(401)
        .send({ error: { code: "SESION_REQUERIDA", message: SESION_REQUERIDA } });
    }

    try {
      const campo = await fieldService.approve(campoId, actor);
      peticion.log.info({ campo: campo.name }, "campo aprobado para reglas");

      if (esHtml) {
        return volverACampos(
          respuesta,
          `Campo «${campo.name}» aprobado: a partir de ahora puede alimentar reglas.`,
          false,
        );
      }
      return respuesta.send({ field: campo });
    } catch (error) {
      if (!esHtml || !(error instanceof DomainError)) throw error;
      peticion.log.warn({ codigo: error.code }, "aprobación de campo rechazada");
      return volverACampos(respuesta, error.message, true);
    }
  });

  app.get("/base", async (_peticion, respuesta) =>
    html(
      respuesta,
      renderTableCatalogPage({ config, tables: await previewService.tables(), sinBase }),
    ),
  );

  app.get("/base/:tabla", async (peticion, respuesta) => {
    const { tabla } = peticion.params as { tabla: string };
    const consulta = peticion.query as { limite?: string; desde?: string };
    const vista = await previewService.preview(tabla, consulta.limite, consulta.desde);
    return html(respuesta, renderTablePreviewPage({ config, preview: vista }));
  });

  app.get("/api/base/tablas", async (_peticion, respuesta) =>
    respuesta.send({ tables: await previewService.tables() }),
  );

  app.get("/api/base/:tabla", async (peticion, respuesta) => {
    const { tabla } = peticion.params as { tabla: string };
    const consulta = peticion.query as { limite?: string; desde?: string };
    return respuesta.send(await previewService.preview(tabla, consulta.limite, consulta.desde));
  });
}
