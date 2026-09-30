import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/environment.ts";
import type { KioskAuthService } from "../domain/quiosco/autenticacion.ts";
import type { KioskService } from "../domain/quiosco/registro.ts";
import type { SessionService } from "../domain/quiosco/sesiones.ts";
import { renderKioskPage } from "../web/pages/quiosco.ts";

const ACTOR_DEL_QUIOSCO = "SALA_QUIOSCO";

const POLITICA_DEL_QUIOSCO = [
  "default-src 'none'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export interface KioskRouteDeps {
  readonly config: AppConfig;
  readonly kioskService: KioskService;
  readonly sessionService: SessionService;
  readonly authService: KioskAuthService;
}

export function registerKioskRoutes(app: FastifyInstance, deps: KioskRouteDeps): void {
  const { config, kioskService, sessionService, authService } = deps;

  app.get("/quiosco", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { token?: string; sessionCode?: string };
    let sessionCode = query.sessionCode;
    let trainingName: string | undefined;
    let instructor: string | undefined;

    if (query.token) {
      try {
        const payload = authService.verifyKioskToken(query.token);
        const brief = await sessionService.getSessionBrief(payload.sessionId);
        sessionCode = brief.sessionCode;
        trainingName = brief.trainingName;
        instructor = brief.instructor;
      } catch {
        // Token inválido o expirado: la pantalla se dibuja sin vínculo de sesión.
      }
    }

    const html = renderKioskPage({
      entorno: config.environment,
      sessionCode,
      trainingName,
      instructor,
    });

    return reply
      .type("text/html; charset=utf-8")
      .header("content-security-policy", POLITICA_DEL_QUIOSCO)
      .send(html);
  });

  app.post("/api/kiosk/unlock", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as { pin?: string; stationLabel?: string };
    const pin = String(body.pin || "").trim();
    const stationLabel = body.stationLabel ? String(body.stationLabel).trim() : undefined;

    const result = await authService.unlockKiosk(pin, stationLabel);
    return reply.send({ success: true, ...result });
  });

  app.post("/api/kiosk/token", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as {
      sessionId?: string;
      sessionCode?: string;
      stationLabel?: string;
      grant?: string;
    };

    authService.verifyGrant(String(body.grant || ""));

    let sessionId = body.sessionId;

    if (!sessionId && body.sessionCode) {
      const session = await sessionService.getSessionByCode(body.sessionCode);
      sessionId = session.sessionId;
    }

    if (!sessionId) {
      return reply.code(400).send({
        error: { code: "SOLICITUD_INVALIDA", message: "sessionId o sessionCode es requerido" },
      });
    }

    const session = await sessionService.getSessionById(sessionId);
    if (session.createdBy === ACTOR_DEL_QUIOSCO && !session.authorized) {
      return reply.code(409).send({
        error: {
          code: "SESION_NO_AUTORIZADA",
          message:
            "La sesión existe pero todavía no está autorizada. Capacitación debe autorizarla " +
            "en la consola antes de que el quiosco pueda registrar asistencia.",
        },
      });
    }
    if (session.status === "BORRADOR" && session.authorized) {
      await sessionService.openSession(
        session.sessionId,
        { actor: ACTOR_DEL_QUIOSCO, role: "CAPACITADOR" },
        `${String(req.id)}:open`,
      );
    }

    const result = authService.createKioskToken(session.sessionId, body.stationLabel);
    const brief = await sessionService.getSessionBrief(session.sessionId);
    return reply.send({
      success: true,
      sessionCode: session.sessionCode,
      session: brief,
      ...result,
    });
  });

  app.post("/api/kiosk/launch", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as {
      pin?: string;
      trainingId?: string;
      instructor?: string;
      date?: string;
      durationMinutes?: number;
      stationLabel?: string;
      requestId?: string;
    };

    const pin = String(body.pin || "").trim();
    const stationLabel = body.stationLabel ? String(body.stationLabel).trim() : undefined;
    const opRequestId = String(body.requestId || randomUUID());

    await authService.verifySessionLaunchSecret(pin, undefined, stationLabel);

    const session = await sessionService.createSession(
      {
        trainingId: String(body.trainingId || ""),
        instructor: String(body.instructor || ""),
        date: String(body.date || new Date().toISOString().slice(0, 10)),
        durationMinutes: Number(body.durationMinutes || 60),
      },
      { actor: ACTOR_DEL_QUIOSCO, role: "CAPACITADOR" },
      opRequestId,
    );

    const brief = await sessionService.getSessionBrief(session.sessionId);

    return reply.send({
      success: true,
      pendingAuthorization: true,
      sessionCode: session.sessionCode,
      session: brief,
      message:
        "La sesión quedó registrada y espera autorización de Capacitación. En cuanto la " +
        "autoricen en la consola, escriba el código de sesión para abrir el registro.",
    });
  });

  app.get("/api/kiosk/bootstrap", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { token?: string };
    const authHeader = req.headers.authorization;
    const token = query.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "");

    if (!token) {
      return reply
        .code(401)
        .send({ error: { code: "NO_AUTENTICADO", message: "Token de quiosco requerido" } });
    }

    const state = await kioskService.bootstrap(token);
    return reply.send(state);
  });

  app.post("/api/kiosk/register", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as { token?: string; employeeId?: string; requestId?: string };
    const authHeader = req.headers.authorization;
    const token = body.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "");
    const employeeId = String(body.employeeId || "").trim();
    const requestId = String(body.requestId || randomUUID());

    if (!token) {
      return reply
        .code(401)
        .send({ error: { code: "NO_AUTENTICADO", message: "Token de quiosco requerido" } });
    }

    const receipt = await kioskService.register({
      token,
      employeeId,
      requestId,
    });

    return reply.send(receipt);
  });

  app.post("/api/kiosk/close", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as { token?: string; pin?: string; requestId?: string };
    const authHeader = req.headers.authorization;
    const token = body.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "");
    const opRequestId = String(body.requestId || randomUUID());

    if (!token) {
      return reply
        .code(401)
        .send({ error: { code: "NO_AUTENTICADO", message: "Token de quiosco requerido" } });
    }

    const payload = authService.verifyKioskToken(token);

    if (body.pin) {
      await authService.verifySessionLaunchSecret(
        body.pin,
        payload.sessionId,
        payload.stationLabel,
      );
    }

    const identidadDeSala = { actor: "SALA_QUIOSCO", role: "KIOSK" } as const;
    const closed = await sessionService.closeSession(
      payload.sessionId,
      identidadDeSala,
      opRequestId,
      (sid) => kioskService.reconcileSession(identidadDeSala, sid),
    );

    return reply.send({ success: true, session: closed });
  });
}
