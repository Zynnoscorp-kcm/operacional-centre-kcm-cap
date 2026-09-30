/**
 * Rutas de Sesiones de Capacitación (Funciones 2 y 3).
 *
 * ── Crear una sesión aparta la sala ───────────────────────────────────────
 *
 * La sala dejó de ser un campo de texto libre: es el catálogo de siete salas,
 * el mismo de `/salas` y de la agenda pública. Al elegir una, la creación de la
 * sesión también levanta una reservación, de modo que el horario aparece
 * ocupado para todos y nadie agenda encima.
 *
 * El orden importa y no es el intuitivo: primero la sala y después la
 * sesión. La reservación es lo único de los dos que tiene garantía física de
 * exclusión —candado por sala y fecha, y una restricción de traslape en
 * PostgreSQL—; si se creara antes la sesión y la sala resultara tomada,
 * quedaría una sesión apuntando a un aula que es de alguien más, que es
 * exactamente lo que esto viene a evitar. Al revés el peor caso es una
 * reservación huérfana, y esa se compensa: si la sesión no llega a crearse, la
 * reservación se cancela con su motivo y queda el rastro en auditoría.
 */

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

/** Quien agenda desde aquí es la administración, no un capacitador externo. */
const ACTOR_DE_SALA = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" } as const;

/** La agenda se lleva en bloques de media hora y no admite otra cosa. */
const BLOQUE_EN_MINUTOS = 30;
/** El último inicio de bloque del día: `23:30`. La reserva no cruza medianoche. */
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

/**
 * El tramo que la sala queda apartada.
 *
 * La sesión se captura al minuto y la agenda se lleva en bloques de treinta,
 * así que el inicio baja al bloque en curso y el final sube al
 * siguiente: una sesión de 09:10 a 09:55 aparta la sala de 09:00 a 10:00.
 * Redondear hacia afuera y no hacia el más cercano es deliberado: reservar de
 * menos deja a dos grupos compartiendo aula, y reservar de más sólo cuesta
 * media hora de agenda.
 */
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

/** Vuelve a la pantalla con el acuse ya redactado; el HTML no lo interpreta. */
function volverASesiones(respuesta: FastifyReply, mensaje: string, esError: boolean): FastifyReply {
  const parametros = new URLSearchParams({ [esError ? "error" : "aviso"]: mensaje });
  return respuesta.redirect(`/sesiones?${parametros.toString()}`, 303);
}

export interface SessionRouteDeps {
  readonly config: AppConfig;
  readonly sessionService: SessionService;
  readonly kioskService: KioskService;
  readonly repository: KioskSessionRepositoryPort;
  /** La agenda de salas, para apartar el aula al crear la sesión. */
  readonly roomService: RoomReservationService;
  /** La cookie de la consola: de ahí sale quién da de alta la sesión. */
  readonly sessions?: ConsoleSessionCodec;
}

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  const { config, sessionService, kioskService, repository, roomService } = deps;
  // Sólo es una compuerta temporal del piloto. Se reutiliza el PIN de apertura
  // si no se declaró uno específico, pero nunca se abre cuando ambos faltan.
  // Con el acceso abierto de prueba no se pide nada.
  const pinDeAutorizacion = config.pilot.sessionLaunchPin ?? config.pilot.kioskPin;
  const accesoAbierto = config.pilot.openAccess;

  // GET /sesiones (Vista HTML)
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

  // GET /api/sessions (Listado JSON)
  app.get("/api/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { cutoffDate?: string };
    const sessions = await sessionService.listOperativeSessions(query.cutoffDate);
    return reply.send({ sessions });
  });

  // POST /api/sessions (Creación de sesión)
  app.post("/api/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as {
      trainingId?: string;
      instructor?: string;
      date?: string;
      durationMinutes?: number | string;
      /** Clave del catálogo. Es lo que la pantalla envía desde el desplegable. */
      roomId?: string;
      /** Texto libre heredado. Se conserva para quien llame la API como antes. */
      room?: string;
      startTime?: string;
      /** Hora de fin `HH:mm`: la duración se calcula contra el inicio. */
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

    /** Un rechazo de captura: en pantalla vuelve al formulario, en API es 400. */
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
      // La hora es opcional en una sesión suelta, pero no se puede apartar un
      // aula sin decir desde cuándo.
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

    /*
     * El curso se comprueba antes de tocar la agenda. `createSession` lo
     * valida igual, pero para entonces la sala ya estaría apartada y habría que
     * deshacerla por un dato que se podía revisar de entrada.
     */
    const training = sala ? await repository.getTrainingById(trainingId) : undefined;
    if (sala && (!training || !training.active)) {
      return rechazar("El curso seleccionado no está disponible o no existe.");
    }

    // 1. La sala. Ver el encabezado del archivo para por qué va primero.
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
            // Identifica a quien reserva sin inventarle una nómina: es la misma
            // persona del encabezado de la sesión. La base pide nómina o
            // contacto, y el nombre del instructor cumple lo segundo.
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

    // 2. La sesión. Si falla, la reservación se deshace: no se deja un aula
    //    bloqueada por una sesión que no existe.
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

  // GET /api/sessions/:id (Detalle de sesión)
  app.get(
    "/api/sessions/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await sessionService.getSessionById(req.params.id);
      return reply.send({ session });
    },
  );

  // POST /api/sessions/:id/open (Abrir sesión)
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

  // POST /api/sessions/:id/close (Cerrar sesión y reconciliar)
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

  // POST /api/sessions/:id/authorize (Autorizar sesión)
  app.post(
    "/api/sessions/:id/authorize",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = (req.body || {}) as { pin?: string; reason?: string; requestId?: string };
      const pin = typeof body.pin === "string" ? body.pin.trim() : "";
      if (!accesoAbierto) {
        // El secreto de operación de la base manda. Es el mecanismo definitivo:
        // vive en `seguridad.secreto` con alcance APERTURA_SESION, guardado
        // como hash, rotable y auditable. El PIN del piloto queda sólo como
        // respaldo para las corridas de prueba, donde no hay base que consultar.
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
