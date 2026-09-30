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
import { DomainError } from "../domain/comun/errores.ts";
import { InvalidPreReleaseStateError } from "../domain/preliberacion/errores.ts";
import type { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import type { PreReleaseReportService } from "../domain/preliberacion/reporte.ts";
import type { ActorIdentity } from "../domain/quiosco/tipos.ts";
import type { ExamOutcome, SaveReviewInput } from "../domain/preliberacion/tipos.ts";
import type { ReleaseService } from "../domain/liberacion/servicio.ts";
import { badRequest } from "../server/errors.ts";
import {
  renderPreReleaseInboxPage,
  renderPreReleaseWorkbenchPage,
} from "../web/pages/preliberacion.ts";

export interface PreReleaseRouteDeps {
  readonly config: AppConfig;
  readonly workbenchService: WorkbenchService;
  readonly reportService: PreReleaseReportService;
  /**
   * Liberación, para el atajo de la sesión limpia. Opcional: sin ella la
   * pantalla no ofrece el botón y el camino de dos pasos sigue intacto.
   */
  readonly releaseService?: ReleaseService;
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
  const { config, workbenchService, reportService, releaseService } = deps;

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
      let estado;
      try {
        estado = await workbenchService.openForStage(req.params.sessionId);
      } catch (error) {
        // Una sesión que ya salió de revisión —liberada, o abierta todavía— no
        // tiene banco: desde una recarga o el botón «atrás» se vuelve a la
        // bandeja con el motivo, en lugar de una página de error 409.
        if (!(error instanceof InvalidPreReleaseStateError) || !prefiereHtml(req)) throw error;
        const aviso = query.aviso ?? "La sesión ya no está en revisión.";
        return reply.redirect(`/preliberacion?aviso=${encodeURIComponent(aviso)}`, 303);
      }
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

  /**
   * El atajo de la sesión limpia: envía y libera en un solo acto.
   *
   * Existe porque la segunda revisión de una sesión sin hallazgos no es un
   * control, es una ceremonia. Nada en el código exige que preliberación y
   * liberación las firme gente distinta, así que revisar dos veces lo mismo, la
   * misma persona, con treinta segundos de diferencia, cuesta dos pantallas y no
   * compra nada.
   *
   * Y sólo sirve para la sesión limpia. En cuanto hay un hallazgo —derivado o
   * declarado— el atajo desaparece de la pantalla y el camino vuelve a ser el de
   * dos pasos, que es donde la segunda mirada sí tiene algo que mirar. El
   * servicio lo vuelve a comprobar aquí y no confía en que el botón no se haya
   * dibujado: una sesión puede ensuciarse entre que se pinta la pantalla y se
   * pulsa.
   */
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

      await workbenchService.submit(sessionId, IDENTIDAD_REVISION);
      const resultado = await releaseService.release(
        { sessionId, requestId: randomUUID() },
        IDENTIDAD_REVISION,
      );

      if (!esHtml) return reply.code(resultado.status === "CONFLICTO" ? 409 : 200).send(resultado);
      if (resultado.status === "CONFLICTO") {
        // Un conflicto no se resuelve aquí: se manda a la pantalla que sabe
        // enseñarlo fila por fila.
        return redirigirALiberacion(
          reply,
          sessionId,
          "La liberación se detuvo por conflicto con la matriz.",
        );
      }
      // Liberada, la sesión ya no es revisable: su pantalla respondería 409.
      // Se vuelve a la bandeja con el acuse.
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
