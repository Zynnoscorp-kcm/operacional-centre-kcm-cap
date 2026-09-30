import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { KioskService } from "../domain/quiosco/registro.ts";
import type { SessionService } from "../domain/quiosco/sesiones.ts";
import type { RoomReservationService } from "../domain/salas/reservaciones.ts";
import { ROOMS, type RoomReservation } from "../domain/salas/tipos.ts";
import type { KioskSessionRepositoryPort } from "../ports/quiosco.port.ts";
import { igualEnTiempoConstante, type ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { renderSessionsPage } from "../web/pages/sesiones.ts";

const ACTOR_DE_SALA = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" } as const;

const BLOQUE_EN_MINUTOS = 30;
const ULTIMO_BLOQUE = 23 * 60 + 30;

const HORA_LIBRE = /^([01]\d|2[0-3]):([0-5]\d)$/u;

function minutosDeHora(valor: string): number | undefined {
  const partes = HORA_LIBRE.exec(valor);
  if (!partes) return undefined;
  return Number(partes[1]) * 60 + Number(partes[2]);
}

function horaDeMinutos(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function tramoDeSala(
  startTime: string,
  durationMinutes: number,
): { readonly desde: string; readonly hasta: string } | undefined {
  const inicio = minutosDeHora(startTime);
  if (inicio === undefined) return undefined;

  const desde = Math.floor(inicio / BLOQUE_EN_MINUTOS) * BLOQUE_EN_MINUTOS;
  const hasta = Math.ceil((inicio + durationMinutes) / BLOQUE_EN_MINUTOS) * BLOQUE_EN_MINUTOS;
  if (hasta <= desde || hasta > ULTIMO_BLOQUE) return undefined;

  return { desde: horaDeMinutos(desde), hasta: horaDeMinutos(hasta) };
}

function prefiereHtml(peticion: FastifyRequest): boolean {
  return String(peticion.headers.accept ?? "").includes("text/html");
}

function volverASesiones(respuesta: FastifyReply, mensaje: string, esError: boolean): FastifyReply {
  const parametros = new URLSearchParams({ [esError ? "error" : "aviso"]: mensaje });
  return respuesta.redirect(`/sesiones?${parametros.toString()}`, 303);
}

export interface SessionRouteDeps {
  readonly config: AppConfig;
  readonly sessionService: SessionService;
  readonly kioskService: KioskService;
  readonly repository: KioskSessionRepositoryPort;
  readonly roomService: RoomReservationService;
  readonly sessions?: ConsoleSessionCodec;
}

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  const { config, sessionService, kioskService, repository, roomService } = deps;
  const pinDeAutorizacion = config.pilot.sessionLaunchPin ?? config.pilot.kioskPin;
  const accesoAbierto = config.pilot.openAccess;

  app.get("/sesiones", async (req: FastifyRequest, reply: FastifyReply) => {
    const consulta = req.query as { aviso?: string; error?: string };
    const cutoffDate = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const sessions = await sessionService.listOperativeSessions(cutoffDate);
    const trainings = await repository.listActiveTrainings();

    const html = renderSessionsPage({
      entorno: config.environment,
      sessions,
      trainings,
      cutoffDate,
      pidePin: !accesoAbierto,
      ...(consulta.aviso ? { aviso: consulta.aviso } : {}),
      ...(consulta.error ? { error: consulta.error } : {}),
    });

    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/api/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { cutoffDate?: string };
    const sessions = await sessionService.listOperativeSessions(query.cutoffDate);
    return reply.send({ sessions });
  });

  app.post("/api/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as {
      trainingId?: string;
      instructor?: string;
      date?: string;
      durationMinutes?: number | string;
      roomId?: string;
      room?: string;
      startTime?: string;
      endTime?: string;
      eventType?: string;
      estimatedAttendees?: number | string;
      requestId?: string;
    };

    const opRequestId = String(body.requestId || randomUUID());
    const cuenta = deps.sessions?.leer(req.headers.cookie, new Date())?.usuario;
    const identity = { actor: cuenta || "USUARIO_CAPACITACION", role: "CAPACITACION" as const };
    const enHtml = prefiereHtml(req);

    const trainingId = String(body.trainingId || "");
    const instructor = String(body.instructor || "");
    const date = String(body.date || new Date().toISOString().slice(0, 10));
    const startTime = String(body.startTime ?? "").trim();
    const endTime = String(body.endTime ?? "").trim();
    const inicioEnMinutos = minutosDeHora(startTime);
    const finEnMinutos = minutosDeHora(endTime);
    if (endTime && (inicioEnMinutos === undefined || finEnMinutos === undefined)) {
      if (!enHtml)
        throw new DomainError("INVALID_INPUT", "La hora de fin necesita hora de inicio.");
      return volverASesiones(reply, "La hora de fin necesita una hora de inicio.", true);
    }
    if (
      inicioEnMinutos !== undefined &&
      finEnMinutos !== undefined &&
      finEnMinutos <= inicioEnMinutos
    ) {
      if (!enHtml)
        throw new DomainError("INVALID_INPUT", "La hora de fin debe ser posterior al inicio.");
      return volverASesiones(reply, "La hora de fin debe ser posterior a la de inicio.", true);
    }
    const durationMinutes =
      inicioEnMinutos !== undefined && finEnMinutos !== undefined
        ? finEnMinutos - inicioEnMinutos
        : Number(body.durationMinutes || 60);

    const claveDeSala = String(body.roomId ?? "").trim();
    const sala = claveDeSala ? ROOMS.find((row) => row.roomId === claveDeSala) : undefined;

    const rechazar = (mensaje: string): FastifyReply | never => {
      if (!enHtml) throw new DomainError("INVALID_ROOM_RESERVATION", mensaje);
      req.log.warn("creación de sesión rechazada por captura de sala");
      return volverASesiones(reply, mensaje, true);
    };

    if (claveDeSala && !sala) {
      return rechazar("La sala elegida no pertenece al catálogo de la plataforma.");
    }

    let tramo: { readonly desde: string; readonly hasta: string } | undefined;
    if (sala) {
      if (!startTime) {
        return rechazar("Para apartar una sala hace falta la hora de inicio de la sesión.");
      }
      tramo = tramoDeSala(startTime, durationMinutes);
      if (!tramo) {
        return rechazar(
          "El horario no cabe en la jornada: la reservación no puede pasar de 23:30.",
        );
      }
    }

    const training = sala ? await repository.getTrainingById(trainingId) : undefined;
    if (sala && (!training || !training.active)) {
      return rechazar("El curso seleccionado no está disponible o no existe.");
    }

    let reservacion: RoomReservation | undefined;
    if (sala && tramo && training) {
      try {
        const recibo = await roomService.create(
          {
            requestId: `sesion:${opRequestId}`,
            roomId: sala.roomId,
            date,
            startTime: tramo.desde,
            endTime: tramo.hasta,
            requesterName: instructor,
            requesterPosition: "Instructor",
            requesterArea: "Capacitación",
            requesterContact: instructor,
            reason: `Sesión de capacitación: ${training.name}`,
            estimatedAttendees: Number(body.estimatedAttendees || 1),
            origin: "ADMINISTRACION",
          },
          ACTOR_DE_SALA,
        );
        reservacion = recibo.reservation;
      } catch (error) {
        if (!enHtml || !(error instanceof DomainError)) throw error;
        req.log.warn({ codigo: error.code }, "la sala de la sesión no pudo apartarse");
        return volverASesiones(reply, error.message, true);
      }
    }

    let session;
    try {
      session = await sessionService.createSession(
        {
          trainingId,
          instructor,
          date,
          durationMinutes,
          room: sala ? sala.name : body.room,
          startTime: body.startTime,
          eventType: body.eventType,
        },
        identity,
        opRequestId,
      );
    } catch (error) {
      if (reservacion) {
        await roomService.cancel(
          {
            reservationId: reservacion.reservationId,
            requestId: `sesion-cancela:${opRequestId}`,
            reason: "La sesión no llegó a crearse.",
          },
          ACTOR_DE_SALA,
        );
        req.log.warn("reservación deshecha porque la sesión no se creó");
      }
      throw error;
    }

    if (enHtml) {
      return volverASesiones(
        reply,
        reservacion
          ? `Sesión ${session.sessionCode} creada. ${sala?.name ?? ""} apartada de ${reservacion.startTime} a ${reservacion.endTime}.`
          : `Sesión ${session.sessionCode} creada.`,
        false,
      );
    }

    return reply.code(201).send({
      success: true,
      session,
      ...(reservacion ? { reservation: reservacion } : {}),
    });
  });

  app.get(
    "/api/sessions/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await sessionService.getSessionById(req.params.id);
      return reply.send({ session });
    },
  );

  app.post(
    "/api/sessions/:id/open",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = (req.body || {}) as { requestId?: string };
      const opRequestId = String(body.requestId || randomUUID());
      const identity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" as const };

      const session = await sessionService.openSession(req.params.id, identity, opRequestId);

      const accept = req.headers.accept;
      if (typeof accept === "string" && accept.includes("text/html")) {
        return reply.redirect("/sesiones");
      }

      return reply.send({ success: true, session });
    },
  );

  app.post(
    "/api/sessions/:id/close",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = (req.body || {}) as { requestId?: string };
      const opRequestId = String(body.requestId || randomUUID());
      const identity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" as const };

      const session = await sessionService.closeSession(
        req.params.id,
        identity,
        opRequestId,
        (sid) => kioskService.reconcileSession(identity, sid),
      );

      const accept = req.headers.accept;
      if (typeof accept === "string" && accept.includes("text/html")) {
        return reply.redirect("/sesiones");
      }

      return reply.send({ success: true, session });
    },
  );

  app.post(
    "/api/sessions/:id/authorize",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = (req.body || {}) as { pin?: string; reason?: string; requestId?: string };
      const pin = typeof body.pin === "string" ? body.pin.trim() : "";
      if (!accesoAbierto) {
        const aceptadoPorLaBase = pin
          ? await repository.verifySecret("APERTURA_SESION", pin)
          : false;

        if (!aceptadoPorLaBase) {
          if (pinDeAutorizacion === undefined) {
            return reply.code(503).send({
              error: {
                code: "PIN_NO_CONFIGURADO",
                message:
                  "No hay secreto de autorización de sesiones registrado. Se da de alta en la " +
                  "base con alcance APERTURA_SESION.",
              },
            });
          }
          if (!igualEnTiempoConstante(pin, pinDeAutorizacion)) {
            req.log.warn("autorización de sesión rechazada por PIN incorrecto");
            return reply.code(401).send({
              error: { code: "PIN_INVALIDO", message: "El PIN de autorización no es correcto." },
            });
          }
        }
      }
      const opRequestId = String(body.requestId || randomUUID());
      const identity = { actor: "ADMIN_CAPACITACION", role: "CAPACITACION" as const };

      const session = await sessionService.authorizeSession(
        req.params.id,
        identity,
        String(body.reason || "Autorización administrativa"),
        opRequestId,
      );

      const accept = req.headers.accept;
      if (typeof accept === "string" && accept.includes("text/html")) {
        return reply.redirect("/sesiones", 303);
      }
      return reply.send({ success: true, session });
    },
  );
}
