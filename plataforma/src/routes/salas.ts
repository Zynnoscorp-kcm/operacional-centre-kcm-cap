import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/errores.ts";
import type { RoomReservationService } from "../domain/salas/reservaciones.ts";
import type { CreateReservationInput } from "../domain/salas/tipos.ts";
import { igualEnTiempoConstante } from "../server/sesion-consola.ts";
import { renderAuditPage, renderRoomsPage } from "../web/pages/salas.ts";

const ACTOR = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" } as const;

const POLITICA_DE_SALAS = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CLAVE_INCORRECTA = "La contraseña de agenda no es correcta. Nada se modificó.";

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function wantsHtml(request: FastifyRequest): boolean {
  return String(request.headers.accept ?? "").includes("text/html");
}

export function registerRoomRoutes(
  app: FastifyInstance,
  deps: { readonly config: AppConfig; readonly service: RoomReservationService },
): void {
  /**
   * La contraseña de la agenda. Declarada, agendar y cancelar la exigen; ausente,
   * la pantalla se comporta como antes del piloto y no pide nada. Cancelar
   * también la pide porque borra el horario de alguien más desde una pantalla
   * que está abierta a quien pase enfrente.
   */
  const claveDeSala = deps.config.pilot.openAccess ? undefined : deps.config.pilot.roomPassword;

  function claveValida(body: Record<string, unknown>): boolean {
    if (claveDeSala === undefined) return true;
    return igualEnTiempoConstante(text(body.clave), claveDeSala);
  }

  /** Vuelve a `/salas` con el aviso ya redactado; el HTML no lo interpreta. */
  function volverASalas(reply: FastifyReply, date: string, aviso: string, esError: boolean) {
    const parametros = new URLSearchParams({ date, [esError ? "error" : "notice"]: aviso });
    return reply.redirect(`/salas?${parametros.toString()}`, 303);
  }

  app.get("/salas", async (request, reply) => {
    const query = request.query as { date?: string; notice?: string; error?: string };
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const reservations = await deps.service.list(date, date);
    return reply
      .type("text/html; charset=utf-8")
      .header("content-security-policy", POLITICA_DE_SALAS)
      .send(
        renderRoomsPage({
          config: deps.config,
          date,
          reservations,
          requiereClave: claveDeSala !== undefined,
          ...(query.notice ? { notice: query.notice } : {}),
          ...(query.error ? { error: query.error } : {}),
        }),
      );
  });

  app.get("/api/rooms/availability", async (request, reply) => {
    const { date } = request.query as { date?: string };
    return reply.send({ rooms: await deps.service.publicAvailability(text(date)) });
  });

  app.get("/api/rooms/reservations", async (request, reply) => {
    const query = request.query as { from?: string; to?: string };
    return reply.send({ reservations: await deps.service.list(query.from, query.to) });
  });

  app.post("/api/rooms/reservations", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (!claveValida(body)) {
      request.log.warn("reserva rechazada por contraseña de agenda incorrecta");
      if (wantsHtml(request)) return volverASalas(reply, text(body.date), CLAVE_INCORRECTA, true);
      return reply.code(401).send({ error: { code: "CLAVE_INVALIDA", message: CLAVE_INCORRECTA } });
    }

    const input: CreateReservationInput = {
      requestId: text(body.requestId) || randomUUID(),
      roomId: text(body.roomId),
      date: text(body.date),
      startTime: text(body.startTime),
      endTime: text(body.endTime),
      requesterName: text(body.requesterName),
      requesterPosition: text(body.requesterPosition),
      requesterArea: text(body.requesterArea),
      requesterWorkerNumber: text(body.requesterWorkerNumber),
      requesterContact: text(body.requesterContact),
      reason: text(body.reason),
      estimatedAttendees: Number(body.estimatedAttendees),
      origin: "AUTOSERVICIO",
    };

    // Desde la pantalla, un dato mal capturado vuelve a la pantalla con el
    // motivo escrito. Devolver el JSON del error dejaría a quien reserva ante
    // una página de texto crudo, sin el formulario ni forma de corregir.
    let result;
    try {
      result = await deps.service.create(input, ACTOR);
    } catch (error) {
      if (!wantsHtml(request) || !(error instanceof DomainError)) throw error;
      request.log.warn({ codigo: error.code }, "reserva rechazada por el dominio");
      return volverASalas(reply, input.date, error.message, true);
    }

    if (wantsHtml(request))
      return reply.redirect(
        `/salas?date=${encodeURIComponent(result.reservation.date)}&notice=${encodeURIComponent(`Reservación ${result.reservation.reservationId} confirmada.`)}`,
        303,
      );
    return reply.code(result.repeated ? 200 : 201).send(result);
  });

  app.post("/api/rooms/reservations/:reservationId/cancel", async (request, reply) => {
    const { reservationId } = request.params as { reservationId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const html = wantsHtml(request);

    if (!claveValida(body)) {
      request.log.warn("cancelación rechazada por contraseña de agenda incorrecta");
      if (html) return volverASalas(reply, text(body.date), CLAVE_INCORRECTA, true);
      return reply.code(401).send({ error: { code: "CLAVE_INVALIDA", message: CLAVE_INCORRECTA } });
    }

    // El motivo es obligatorio en el dominio; el formulario ofrece uno por
    // omisión para que cancelar desde la pantalla no falle por un campo vacío.
    const reason = text(body.reason) || (html ? "Cancelada desde la agenda" : "");
    const result = await deps.service.cancel(
      { reservationId, requestId: text(body.requestId) || randomUUID(), reason },
      ACTOR,
    );

    if (html) {
      const aviso = result.repeated
        ? `La reservación ${result.reservation.reservationId} ya estaba cancelada.`
        : `Reservación ${result.reservation.reservationId} cancelada.`;
      return volverASalas(reply, result.reservation.date, aviso, false);
    }
    return reply.send(result);
  });

  app.get("/auditoria", async (_request, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(renderAuditPage({ config: deps.config, events: await deps.service.listAudit() })),
  );
  app.get("/api/audit", async (_request, reply) =>
    reply.send({ events: await deps.service.listAudit() }),
  );
}
