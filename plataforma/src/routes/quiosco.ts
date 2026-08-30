/**
 * Rutas del Quiosco de Registro (Función 1).
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/environment.ts";
import type { KioskAuthService } from "../domain/quiosco/autenticacion.ts";
import type { KioskService } from "../domain/quiosco/registro.ts";
import type { SessionService } from "../domain/quiosco/sesiones.ts";
import { renderKioskPage } from "../web/pages/quiosco.ts";

/**
 * Con quién queda firmada una sesión levantada desde la sala. Es lo que permite
 * distinguirla de una creada en la consola: la del quiosco no abre el registro
 * hasta que Capacitación la autoriza, la de la consola ya nació ahí.
 */
const ACTOR_DEL_QUIOSCO = "SALA_QUIOSCO";

/**
 * La política de contenido del quiosco de sala, y sólo de él.
 *
 * Esa pantalla conserva la maquetación medida por medida, y ese
 * diseño necesita el fondo de haces de Three.js, las tipografías de Google
 * Fonts y los atributos `style="…"` en que vive todo el trazo. Se abren aquí,
 * para esta ruta, con los orígenes nombrados uno por uno.
 *
 * `default-src 'none'` sigue siendo la base y el resto de la consola no se
 * entera: la política general de `build-server.ts` no cambió.
 */
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

  // GET /quiosco (Vista HTML)
  app.get("/quiosco", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { token?: string; sessionCode?: string };
    let sessionCode = query.sessionCode;
    let trainingName: string | undefined;
    let instructor: string | undefined;

    if (query.token) {
      try {
        const payload = authService.verifyKioskToken(query.token);
        // `getSessionBrief` y no `getSessionById`: el nombre del curso se
        // resuelve en el servicio contra el catálogo, y `trainingId` es un
        // identificador que nadie reconoce en una pantalla. Con `getSessionById`
        // la variable quedaba declarada y nunca asignada, así que la sala veía
        // el código de sesión sin saber a qué curso quedó vinculado el quiosco
        // —que es justo lo que este dato existe para evitar cuando hay dos
        // cursos el mismo día—.
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

  // POST /api/kiosk/unlock (Desbloqueo de quiosco con PIN de quiosco - Secret 1)
  app.post("/api/kiosk/unlock", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as { pin?: string; stationLabel?: string };
    const pin = String(body.pin || "").trim();
    const stationLabel = body.stationLabel ? String(body.stationLabel).trim() : undefined;

    const result = await authService.unlockKiosk(pin, stationLabel);
    return reply.send({ success: true, ...result });
  });

  /**
   * POST /api/kiosk/token — emisión del vínculo de una sesión para esta sala.
   *
   * Exige la concesión que devuelve `/api/kiosk/unlock`, es decir la
   * contraseña del quiosco. Sin ella bastaba conocer el código de sesión
   * —que se dicta en voz alta en la sala— para abrir el registro desde
   * cualquier equipo. La pantalla pide la contraseña antes del número de
   * sesión; esta comprobación es la que lo hace cierto del lado del servidor.
   */
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
    // Ninguna sesión se registra desde la sala mientras Capacitación no la haya
    // autorizado en la consola. El quiosco puede crearla y anunciarla, pero abrir
    // el registro es una decisión de la plataforma central: sin esta compuerta,
    // cualquiera con la contraseña de sala levantaba una sesión que nadie revisó.
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
    // Autorizada y todavía en borrador: es la sala la que la pone en marcha, y
    // este es el momento. Antes se abría sola al crearla, que era justo lo que
    // saltaba la revisión de Capacitación.
    if (session.status === "BORRADOR" && session.authorized) {
      await sessionService.openSession(
        session.sessionId,
        { actor: ACTOR_DEL_QUIOSCO, role: "CAPACITADOR" },
        `${String(req.id)}:open`,
      );
    }

    const result = authService.createKioskToken(session.sessionId, body.stationLabel);
    // La ficha viaja con el vínculo para que la sala pueda confirmar que es la
    // sesión correcta ANTES de registrar a nadie. El vínculo ya está emitido en
    // este punto y no pasa nada: vincular no registra, y si quien capacita dice
    // que no es su sesión, la pantalla lo descarta y vuelve al código.
    const brief = await sessionService.getSessionBrief(session.sessionId);
    return reply.send({
      success: true,
      sessionCode: session.sessionCode,
      session: brief,
      ...result,
    });
  });

  // POST /api/kiosk/launch (Apertura de sesión desde quiosco con PIN de apertura - Secret 2)
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

    // Validar segunda contraseña (Secret 2)
    await authService.verifySessionLaunchSecret(pin, undefined, stationLabel);

    // Crear la sesión
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

    // La sesión queda creada y en espera. No se abre ni se entrega ficha: eso
    // era lo que dejaba a la sala levantando sesiones que nadie de Capacitación
    // había visto. Ahora aparece en la consola como pendiente y el registro se
    // habilita cuando alguien la autoriza ahí. Quien está en la sala vuelve a
    // pedir la ficha con el código de sesión y, si ya fue autorizada, entra.
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

  // GET /api/kiosk/bootstrap (Bootstrap de estado y auto-reparación)
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

  // POST /api/kiosk/register (Registro de participante con acuse genérico indistinguible)
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

  // POST /api/kiosk/close (Cierre de sesión desde quiosco y reconciliación)
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

    // Opcionalmente verificar PIN de cierre / lanzamiento si se envía
    if (body.pin) {
      await authService.verifySessionLaunchSecret(
        body.pin,
        payload.sessionId,
        payload.stationLabel,
      );
    }

    /*
     * El equipo de la sala cierra con el rol `KIOSK` y no con `CAPACITADOR`.
     *
     * No es cosmético: `closeSession` rechaza a un `CAPACITADOR` que no creó la
     * sesión, y las sesiones se crean desde la consola. Con el rol equivocado,
     * cerrar desde la sala fallaba siempre que la sesión no hubiera nacido en
     * el propio quiosco, y había que cerrarla otra vez desde la plataforma.
     *
     * La autoridad de la estación es el token: se firmó para `payload.sessionId`
     * después de un vale válido, y es esa misma sesión —y ninguna otra— la que
     * se cierra. El adaptador traduce `KIOSK` a `CAPACITADOR` al escribir la
     * bitácora, porque el enum `kcm.rol` no tiene un valor propio para la sala,
     * así que en la base la fila queda idéntica a como quedaba antes.
     */
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
