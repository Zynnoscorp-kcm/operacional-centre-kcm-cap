import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { RoomReservationService } from "../domain/salas/reservaciones.ts";
import { igualEnTiempoConstante } from "../server/sesion-consola.ts";
import { renderAgendaPage } from "../web/pages/agenda.ts";

const ACTOR = { actor: "AGENDA_PUBLICA", role: "CAPACITADOR" } as const;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/u;
const HORA = /^(?:[01]\d|2[0-3]):(?:00|30)$/u;

const POLITICA_DE_LA_AGENDA = [
  "default-src 'none'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function ahoraEnPlanta(clock: Clock): { fecha: string; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(clock.now()));

  const buscar = (tipo: string): string => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const hora = Number(buscar("hour"));
  return {
    fecha: `${buscar("year")}-${buscar("month")}-${buscar("day")}`,
    minutos: (hora === 24 ? 0 : hora) * 60 + Number(buscar("minute")),
  };
}

export function registerAgendaRoutes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    readonly service: RoomReservationService;
    readonly clock: Clock;
  },
): void {
  const claveDeSala = deps.config.pilot.openAccess
    ? undefined
    : (deps.config.roomPassword ?? deps.config.pilot.roomPassword);
  const requiereClave = claveDeSala !== undefined;

  const pintar = async (
    respuesta: FastifyReply,
    consulta: Record<string, unknown>,
    extra: { aviso?: string; error?: string; previo?: Record<string, string> } = {},
  ): Promise<FastifyReply> => {
    const ahora = ahoraEnPlanta(deps.clock);
    const solicitada = texto(consulta.fecha);
    const fecha = FECHA_ISO.test(solicitada) ? solicitada : ahora.fecha;
    const inicio = texto(consulta.inicio);
    const fin = texto(consulta.fin);

    return respuesta
      .type("text/html; charset=utf-8")
      .header("content-security-policy", POLITICA_DE_LA_AGENDA)
      .send(
        renderAgendaPage({
          fecha,
          ocupacion: await deps.service.publicAvailability(fecha),
          ahora,
          requiereClave,
          ...(texto(consulta.sala) ? { salaElegida: texto(consulta.sala) } : {}),
          ...(HORA.test(inicio) ? { inicioElegido: inicio } : {}),
          ...(HORA.test(fin) ? { finElegido: fin } : {}),
          ...(extra.aviso ? { aviso: extra.aviso } : {}),
          ...(extra.error ? { error: extra.error } : {}),
          ...(extra.previo ? { previo: extra.previo } : {}),
        }),
      );
  };

  app.get("/agenda", (peticion: FastifyRequest, respuesta: FastifyReply) =>
    pintar(respuesta, (peticion.query ?? {}) as Record<string, unknown>),
  );

  app.post("/agenda", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;

    const previo: Record<string, string> = {
      requesterName: texto(cuerpo.requesterName),
      requesterWorkerNumber: texto(cuerpo.requesterWorkerNumber),
      requesterPosition: texto(cuerpo.requesterPosition),
      requesterArea: texto(cuerpo.requesterArea),
      reason: texto(cuerpo.reason),
      estimatedAttendees: texto(cuerpo.estimatedAttendees),
    };

    if (claveDeSala !== undefined && !igualEnTiempoConstante(texto(cuerpo.clave), claveDeSala)) {
      peticion.log.warn("reservación pública rechazada por contraseña de agenda incorrecta");
      return pintar(
        respuesta,
        { fecha: texto(cuerpo.date) },
        { error: "La contraseña de agenda no es correcta. Nada se modificó.", previo },
      );
    }

    try {
      const recibo = await deps.service.create(
        {
          requestId: randomUUID(),
          roomId: texto(cuerpo.roomId),
          date: texto(cuerpo.date),
          startTime: texto(cuerpo.startTime),
          endTime: texto(cuerpo.endTime),
          requesterName: texto(cuerpo.requesterName),
          requesterPosition: texto(cuerpo.requesterPosition),
          requesterArea: texto(cuerpo.requesterArea),
          requesterWorkerNumber: texto(cuerpo.requesterWorkerNumber),
          reason: texto(cuerpo.reason),
          estimatedAttendees: Number(cuerpo.estimatedAttendees),
          origin: "AUTOSERVICIO",
        },
        ACTOR,
      );

      const { date, startTime, endTime, roomId } = recibo.reservation;
      return await pintar(
        respuesta,
        { fecha: date },
        {
          aviso: `Reservación confirmada: ${roomId} · ${date} de ${startTime} a ${endTime}.`,
        },
      );
    } catch (error) {
      peticion.log.warn({ err: error }, "reservación pública rechazada");
      const mensaje =
        error instanceof Error ? error.message : "No fue posible registrar la reservación.";
      return await pintar(respuesta, { fecha: texto(cuerpo.date) }, { error: mensaje, previo });
    }
  });
}
