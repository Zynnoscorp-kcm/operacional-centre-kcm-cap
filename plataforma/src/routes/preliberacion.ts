/**
 * Rutas de Preliberación (Función 4).
 *
 * Sirve dos pantallas y una API. Las pantallas mandan formularios; por eso cada
 * mutación acepta tanto JSON como `application/x-www-form-urlencoded`, y cuando
 * el que llama pidió HTML responde con redirección en vez de con el estado.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/errores.ts";
import type { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import type { PreReleaseReportService } from "../domain/preliberacion/reporte.ts";
import type { ActorIdentity } from "../domain/quiosco/tipos.ts";
import type { ExamOutcome, SaveReviewInput } from "../domain/preliberacion/tipos.ts";
import {
  renderPreReleaseInboxPage,
  renderPreReleaseWorkbenchPage,
} from "../web/pages/preliberacion.ts";

export interface PreReleaseRouteDeps {
  readonly config: AppConfig;
  readonly workbenchService: WorkbenchService;
  readonly reportService: PreReleaseReportService;
}

/**
 * Identidad de servicio mientras la plataforma no tiene sesión de usuario. Es la
 * misma convención que ya usan las rutas de las funciones 1, 2 y 3, y el punto
 * donde entrará el control de acceso por rol cuando exista.
 */
const IDENTIDAD_REVISION: ActorIdentity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" };

interface CuerpoFormulario {
  readonly [clave: string]: string | string[] | undefined;
}

export function registerPreReleaseRoutes(app: FastifyInstance, deps: PreReleaseRouteDeps): void {
  const { config, workbenchService, reportService } = deps;

  const prefiereHtml = (req: FastifyRequest): boolean => {
    const accept = req.headers.accept;
    return typeof accept === "string" && accept.includes("text/html");
  };

  // -----------------------------------------------------------------------
  // Pantallas
  // -----------------------------------------------------------------------

  app.get("/preliberacion", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { aviso?: string };
    const revisables = await workbenchService.listEditableSessions(IDENTIDAD_REVISION);

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
      const estado = await workbenchService.openForStage(req.params.sessionId);
      const reportes = await reportService.bySession(req.params.sessionId);

      const html = renderPreReleaseWorkbenchPage({
        entorno: config.environment,
        estado,
        reportes,
        requestId: randomUUID(),
        ...(query.aviso ? { aviso: String(query.aviso) } : {}),
      });

      return reply.type("text/html; charset=utf-8").send(html);
    },
  );

  /** Vista previa del PDF. No archiva, no audita, no cambia estado. */
  app.get(
    "/preliberacion/:sessionId/reporte",
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const reporte = await reportService.generate(
        { sessionId: req.params.sessionId, mode: "VISTA_PREVIA" },
        IDENTIDAD_REVISION,
      );
      return reply
        .type("application/pdf")
        .header("content-disposition", `inline; filename="${reporte.fileName}"`)
        .send(Buffer.from(reporte.content));
    },
  );

  /** Descarga de un reporte ya archivado, por su evidencia. */
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

  // -----------------------------------------------------------------------
  // API
  // -----------------------------------------------------------------------

  app.get("/api/pre-release/sessions", async (_req: FastifyRequest, reply: FastifyReply) => {
    const revisables = await workbenchService.listEditableSessions(IDENTIDAD_REVISION);
    const releaseQueue = await workbenchService.listReleaseQueue(IDENTIDAD_REVISION);
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

    const state = await workbenchService.save(entrada, IDENTIDAD_REVISION);

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
      IDENTIDAD_REVISION,
    );

    if (prefiereHtml(req)) {
      return redirigirAlBanco(reply, sessionId, "Trabajador agregado al padrón.");
    }
    return reply.send(state);
  });

  app.post("/api/pre-release/enter", async (req: FastifyRequest, reply: FastifyReply) =>
    ejecutarTransicion(req, reply, "La sesión entró a preliberación.", (sessionId) =>
      workbenchService.enterPreRelease(sessionId, IDENTIDAD_REVISION),
    ),
  );

  app.post("/api/pre-release/submit", async (req: FastifyRequest, reply: FastifyReply) =>
    ejecutarTransicion(
      req,
      reply,
      "La sesión está lista para liberarse.",
      (sessionId) => workbenchService.submit(sessionId, IDENTIDAD_REVISION),
      redirigirALiberacion,
    ),
  );

  app.post("/api/pre-release/return", async (req: FastifyRequest, reply: FastifyReply) =>
    ejecutarTransicion(req, reply, "La sesión regresó a preliberación.", (sessionId) =>
      workbenchService.returnToPreRelease(sessionId, IDENTIDAD_REVISION),
    ),
  );

  /** Archiva el reporte como evidencia inmutable y lo deja asentado en auditoría. */
  app.post("/api/pre-release/report", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as CuerpoFormulario;
    const sessionId = texto(body["sessionId"]);
    const reporte = await reportService.generate(
      { sessionId, mode: "ARCHIVO" },
      IDENTIDAD_REVISION,
    );

    if (prefiereHtml(req)) {
      return redirigirAlBanco(reply, sessionId, `Reporte archivado como ${reporte.fileName}.`);
    }

    // El JSON no lleva los bytes: quien los quiera los pide por su evidencia.
    const { content: _content, ...resumen } = reporte;
    return reply.send(resumen);
  });

  /** Reportes archivados de una sesión: es la búsqueda por sesión en auditoría. */
  app.get(
    "/api/pre-release/report/:sessionId",
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const reports = await reportService.bySession(req.params.sessionId);
      return reply.send({ reports });
    },
  );

  // -----------------------------------------------------------------------
  // Apoyos
  // -----------------------------------------------------------------------

  function redirigirAlBanco(reply: FastifyReply, sessionId: string, aviso: string): FastifyReply {
    const destino = `/preliberacion/${encodeURIComponent(sessionId)}?aviso=${encodeURIComponent(aviso)}`;
    return reply.redirect(destino, 303);
  }

  function redirigirALiberacion(
    reply: FastifyReply,
    _sessionId: string,
    aviso: string,
  ): FastifyReply {
    return reply.redirect(`/liberacion?aviso=${encodeURIComponent(aviso)}`, 303);
  }

  /**
   * Las tres transiciones de etapa comparten forma: leen `sessionId`, piden el
   * cambio y responden con el estado o con una redirección al banco.
   *
   * Comparten también el desenlace cuando el dominio las rechaza —entrar sin
   * revisión guardada, pasar a liberación con exámenes sin clasificar—, que es
   * un desacuerdo previsto sobre el estado y no una falla. Desde una pantalla
   * ahora vuelve al banco con el motivo escrito; antes salía como la página de
   * error en JSON, y el revisor perdía el padrón que estaba revisando junto con
   * el texto que le decía qué le faltaba.
   *
   * Sólo se traduce `DomainError`. Cualquier otra falla sube entera.
   */
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

// ---------------------------------------------------------------------------
// Traducción de cuerpos
// ---------------------------------------------------------------------------

function texto(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return String(valor[0] ?? "").trim();
  return String(valor ?? "").trim();
}

function lista(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor.map((v) => String(v)) : [String(valor)];
}

/** El formulario del padrón se reconoce por sus campos por renglón. */
function esFormulario(body: CuerpoFormulario): boolean {
  return Object.keys(body).some((clave) => clave.startsWith("examen__"));
}

/**
 * Traduce el formulario del banco de trabajo. Los campos van por renglón
 * (`examen__01234`), así que el número de nómina viaja en el nombre del campo y
 * no en un arreglo paralelo que pudiera desalinearse.
 */
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
