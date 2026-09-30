import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import { InvalidPreReleaseStateError } from "../domain/preliberacion/errores.ts";
import type { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import type { PreReleaseReportService } from "../domain/preliberacion/reporte.ts";
import type { ActorIdentity } from "../domain/quiosco/tipos.ts";
import type { ExamOutcome, SaveReviewInput } from "../domain/preliberacion/tipos.ts";
import type { ReleaseService } from "../domain/liberacion/servicio.ts";
import { badRequest } from "../server/errors.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import {
  renderPreReleaseInboxPage,
  renderPreReleaseWorkbenchPage,
} from "../web/pages/preliberacion.ts";

export interface PreReleaseRouteDeps {
  readonly config: AppConfig;
  readonly workbenchService: WorkbenchService;
  readonly reportService: PreReleaseReportService;
  readonly releaseService?: ReleaseService;
  readonly sessions?: ConsoleSessionCodec;
}

const IDENTIDAD_REVISION: ActorIdentity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" };

interface CuerpoFormulario {
  readonly [clave: string]: string | string[] | undefined;
}

export function registerPreReleaseRoutes(app: FastifyInstance, deps: PreReleaseRouteDeps): void {
  const { config, workbenchService, reportService, releaseService } = deps;

  const identidadDe = (req: FastifyRequest): ActorIdentity => {
    const cuenta = deps.sessions?.leer(req.headers.cookie, new Date())?.usuario;
    return cuenta ? { ...IDENTIDAD_REVISION, actor: cuenta } : IDENTIDAD_REVISION;
  };

  const prefiereHtml = (req: FastifyRequest): boolean => {
    const accept = req.headers.accept;
    return typeof accept === "string" && accept.includes("text/html");
  };

  app.get("/preliberacion", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { aviso?: string };
    const revisables = await workbenchService.listEditableSessions(identidadDe(req));

    const html = renderPreReleaseInboxPage({
      entorno: config.environment,
      revisables,
      ...(query.aviso ? { aviso: String(query.aviso) } : {}),
    });

    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get(
    "/preliberacion/:sessionId",
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const query = req.query as { aviso?: string };
      let estado;
      try {
        estado = await workbenchService.openForStage(req.params.sessionId);
      } catch (error) {
        if (!(error instanceof InvalidPreReleaseStateError) || !prefiereHtml(req)) throw error;
        const aviso = query.aviso ?? "La sesión ya no está en revisión.";
        return reply.redirect(`/preliberacion?aviso=${encodeURIComponent(aviso)}`, 303);
      }
      const reportes = await reportService.bySession(req.params.sessionId);
      const fechasPrevias = releaseService
        ? await releaseService.existingDates(req.params.sessionId).catch(() => [])
        : [];

      const html = renderPreReleaseWorkbenchPage({
        entorno: config.environment,
        estado,
        reportes,
        fechasPrevias,
        requestId: randomUUID(),
        ...(query.aviso ? { aviso: String(query.aviso) } : {}),
      });

      return reply.type("text/html; charset=utf-8").send(html);
    },
  );

  app.get(
    "/preliberacion/:sessionId/reporte",
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const reporte = await reportService.generate(
        { sessionId: req.params.sessionId, mode: "VISTA_PREVIA" },
        identidadDe(req),
      );
      return reply
        .type("application/pdf")
        .header("content-disposition", `inline; filename="${reporte.fileName}"`)
        .send(Buffer.from(reporte.content));
    },
  );

  app.get(
    "/preliberacion/reporte/:evidenceId",
    async (req: FastifyRequest<{ Params: { evidenceId: string } }>, reply: FastifyReply) => {
      const archivado = await reportService.content(req.params.evidenceId);
      if (!archivado) {
        return reply.callNotFound();
      }
      return reply
        .type(archivado.record.mimeType)
        .header("content-disposition", `inline; filename="${archivado.record.fileName}"`)
        .send(Buffer.from(archivado.content));
    },
  );

  app.get("/api/pre-release/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    const revisables = await workbenchService.listEditableSessions(identidadDe(req));
    const releaseQueue = await workbenchService.listReleaseQueue(identidadDe(req));
    return reply.send({ revisables, releaseQueue });
  });

  app.get(
    "/api/pre-release/session/:sessionId",
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const state = await workbenchService.openForStage(req.params.sessionId);
      return reply.send(state);
    },
  );

  app.post("/api/pre-release/save", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as CuerpoFormulario;
    const sessionId = texto(body["sessionId"]);
    const entrada = esFormulario(body)
      ? revisionDesdeFormulario(body, sessionId)
      : revisionDesdeJson(req.body, sessionId);

    const state = await workbenchService.save(entrada, identidadDe(req));

    if (prefiereHtml(req)) {
      return redirigirAlBanco(
        reply,
        sessionId,
        "Revisión guardada. El estado de la sesión no cambió.",
      );
    }
    return reply.send(state);
  });

  app.post("/api/pre-release/add-worker", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as CuerpoFormulario;
    const sessionId = texto(body["sessionId"]);

    const state = await workbenchService.addWorker(
      {
        sessionId,
        employeeId: texto(body["employeeId"]),
        requestId: texto(body["requestId"]) || randomUUID(),
      },
      identidadDe(req),
    );

    if (prefiereHtml(req)) {
      return redirigirAlBanco(reply, sessionId, "Trabajador agregado al padrón.");
    }
    return reply.send(state);
  });

  app.post("/api/pre-release/enter", async (req: FastifyRequest, reply: FastifyReply) =>
    ejecutarTransicion(req, reply, "La sesión entró a preliberación.", (sessionId) =>
      workbenchService.enterPreRelease(sessionId, identidadDe(req)),
    ),
  );

  app.post("/api/pre-release/submit", async (req: FastifyRequest, reply: FastifyReply) =>
    ejecutarTransicion(
      req,
      reply,
      "La sesión está lista para liberarse.",
      (sessionId) => workbenchService.submit(sessionId, identidadDe(req)),
      redirigirALiberacion,
    ),
  );

  app.post("/api/pre-release/liberar", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as CuerpoFormulario;
    const sessionId = texto(body["sessionId"]);
    const esHtml = prefiereHtml(req);

    if (!releaseService) throw badRequest("Esta instalación no tiene liberación conectada.");

    try {
      const estado = await workbenchService.open(sessionId);
      if (estado.findings.length > 0 || estado.derivedFindings.length > 0) {
        throw badRequest(
          "La sesión tiene hallazgos: se libera desde la pantalla de liberación, no desde aquí.",
        );
      }

      await workbenchService.submit(sessionId, identidadDe(req));
      const resultado = await releaseService.release(
        { sessionId, requestId: randomUUID() },
        identidadDe(req),
      );

      if (!esHtml) return reply.code(resultado.status === "CONFLICTO" ? 409 : 200).send(resultado);
      if (resultado.status === "CONFLICTO") {
        return redirigirALiberacion(
          reply,
          sessionId,
          "La liberación se detuvo por conflicto con la matriz.",
        );
      }
      return reply.redirect(
        `/preliberacion?aviso=${encodeURIComponent("Sesión revisada y liberada.")}`,
        303,
      );
    } catch (error) {
      if (!esHtml || !(error instanceof DomainError)) throw error;
      req.log.warn({ codigo: error.code }, "liberación directa rechazada");
      return redirigirAlBanco(reply, sessionId, error.message);
    }
  });

  app.post("/api/pre-release/return", async (req: FastifyRequest, reply: FastifyReply) =>
    ejecutarTransicion(req, reply, "La sesión regresó a preliberación.", (sessionId) =>
      workbenchService.returnToPreRelease(sessionId, identidadDe(req)),
    ),
  );

  app.post("/api/pre-release/report", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as CuerpoFormulario;
    const sessionId = texto(body["sessionId"]);
    const reporte = await reportService.generate({ sessionId, mode: "ARCHIVO" }, identidadDe(req));

    if (prefiereHtml(req)) {
      return redirigirAlBanco(reply, sessionId, `Reporte archivado como ${reporte.fileName}.`);
    }

    const { content: _content, ...resumen } = reporte;
    return reply.send(resumen);
  });

  app.get(
    "/api/pre-release/report/:sessionId",
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const reports = await reportService.bySession(req.params.sessionId);
      return reply.send({ reports });
    },
  );

  function redirigirAlBanco(reply: FastifyReply, sessionId: string, aviso: string): FastifyReply {
    const destino = `/preliberacion/${encodeURIComponent(sessionId)}?aviso=${encodeURIComponent(aviso)}`;
    return reply.redirect(destino, 303);
  }

  function redirigirALiberacion(
    reply: FastifyReply,
    sessionId: string,
    aviso: string,
  ): FastifyReply {
    return reply.redirect(
      `/liberacion?sessionId=${encodeURIComponent(sessionId)}&aviso=${encodeURIComponent(aviso)}`,
      303,
    );
  }

  async function ejecutarTransicion(
    req: FastifyRequest,
    reply: FastifyReply,
    avisoDeExito: string,
    cambio: (sessionId: string) => Promise<unknown>,
    redirigirExito: (
      reply: FastifyReply,
      sessionId: string,
      aviso: string,
    ) => FastifyReply = redirigirAlBanco,
  ): Promise<unknown> {
    const body = (req.body ?? {}) as CuerpoFormulario;
    const sessionId = texto(body["sessionId"]);
    const esHtml = prefiereHtml(req);

    let state: unknown;
    try {
      state = await cambio(sessionId);
    } catch (error) {
      if (!esHtml || !(error instanceof DomainError)) throw error;
      req.log.warn({ codigo: error.code }, "transición de preliberación rechazada");
      return redirigirAlBanco(reply, sessionId, error.message);
    }

    if (esHtml) return redirigirExito(reply, sessionId, avisoDeExito);
    return reply.send(state);
  }
}

function texto(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return String(valor[0] ?? "").trim();
  return String(valor ?? "").trim();
}

function lista(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor.map((v) => String(v)) : [String(valor)];
}

function esFormulario(body: CuerpoFormulario): boolean {
  return Object.keys(body).some((clave) => clave.startsWith("examen__"));
}

function revisionDesdeFormulario(body: CuerpoFormulario, sessionId: string): SaveReviewInput {
  const examOutcomes: { employeeId: string; examStatus: ExamOutcome }[] = [];
  const exclusions: { employeeId: string; excluded: boolean; reason?: string }[] = [];

  for (const [clave, valor] of Object.entries(body)) {
    if (!clave.startsWith("examen__")) continue;
    const employeeId = clave.slice("examen__".length);
    const examStatus = texto(valor) as ExamOutcome;
    if (examStatus) examOutcomes.push({ employeeId, examStatus });

    const excluded = texto(body[`excluir__${employeeId}`]) !== "";
    const reason = texto(body[`motivo__${employeeId}`]);
    exclusions.push({ employeeId, excluded, ...(reason ? { reason } : {}) });
  }

  return {
    sessionId,
    requestId: texto(body["requestId"]) || randomUUID(),
    examOutcomes,
    exclusions,
    findings: lista(body["hallazgo"]),
    comments: texto(body["comments"]),
  };
}

function revisionDesdeJson(cuerpo: unknown, sessionId: string): SaveReviewInput {
  const body = (cuerpo ?? {}) as Partial<SaveReviewInput>;
  return {
    sessionId,
    requestId: body.requestId ?? randomUUID(),
    examOutcomes: body.examOutcomes ?? [],
    exclusions: body.exclusions ?? [],
    findings: body.findings ?? [],
    comments: body.comments ?? "",
  };
}
