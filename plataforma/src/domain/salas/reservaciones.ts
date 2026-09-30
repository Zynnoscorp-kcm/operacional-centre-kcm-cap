import { createHash, randomUUID } from "node:crypto";

import type { Clock } from "../../ports/reloj.port.ts";
import { DomainError } from "../comun/errores.ts";
import { isWorkerNumber } from "../comun/numero-trabajador.ts";
import type {
  CancelReservationInput,
  CreateReservationInput,
  PublicRoomOccupancy,
  ReservationReceipt,
  RoomActor,
  RoomId,
  RoomReservation,
  RoomReservationRepository,
} from "./tipos.ts";
import { ROOMS } from "./tipos.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const ROOM_IDS = new Set<string>(ROOMS.map((room) => room.roomId));

function required(value: string, label: string, maximum = 300): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new DomainError("INVALID_ROOM_RESERVATION", `${label} no es válido.`);
  }
  return normalized;
}

function canonicalDate(value: string): string {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainError("INVALID_ROOM_RESERVATION", "La fecha debe usar YYYY-MM-DD.");
  }
  return value;
}

function canonicalTime(value: string): string {
  if (!TIME.test(value)) {
    throw new DomainError(
      "INVALID_ROOM_RESERVATION",
      "La hora debe usar HH:mm en bloques de treinta minutos.",
    );
  }
  return value;
}

function minutes(value: string): number {
  const [hours = "0", mins = "0"] = value.split(":");
  return Number(hours) * 60 + Number(mins);
}

/**
 * Quien reserva tiene que quedar identificado. No es una preferencia de la
 * pantalla: la base lo exige en la restricción `reserva_solicitante_identificado`
 * (migración 0021), que pide nómina o dato de contacto. Comprobarlo aquí
 * convierte lo que era un 500 sin explicación —la restricción saltando en el
 * INSERT— en un error de captura con nombre, y vale igual para la persistencia
 * en memoria, que no tiene restricciones que lo delaten.
 *
 * El adaptador reparte este valor en dos columnas según su forma: cinco dígitos
 * son la nómina; cualquier otra cosa, el contacto de quien no la tiene.
 */
function identificarSolicitante(input: CreateReservationInput): string {
  const nomina = (input.requesterWorkerNumber ?? "").trim();
  if (nomina) {
    if (!isWorkerNumber(nomina)) {
      throw new DomainError(
        "INVALID_ROOM_RESERVATION",
        "La nómina de quien reserva debe ser de cinco dígitos.",
      );
    }
    return nomina;
  }

  // La agenda ya no pide nómina: sin nómina ni contacto, el nombre de quien
  // reserva cumple el dato de contacto que exige la base.
  const contacto = (input.requesterContact ?? "").trim() || (input.requesterName ?? "").trim();
  if (!contacto) {
    throw new DomainError("INVALID_ROOM_RESERVATION", "Falta el nombre de quien reserva.");
  }
  return contacto.slice(0, 160);
}

function overlaps(left: RoomReservation, startTime: string, endTime: string): boolean {
  return (
    left.status === "ACTIVA" &&
    minutes(left.startTime) < minutes(endTime) &&
    minutes(startTime) < minutes(left.endTime)
  );
}

export class RoomReservationService {
  readonly #repository: RoomReservationRepository;
  readonly #clock: Clock;

  constructor(repository: RoomReservationRepository, clock: Clock) {
    this.#repository = repository;
    this.#clock = clock;
  }

  async create(input: CreateReservationInput, actor: RoomActor): Promise<ReservationReceipt> {
    const roomId = required(input.roomId, "La sala", 40);
    if (!ROOM_IDS.has(roomId)) {
      throw new DomainError(
        "INVALID_ROOM_RESERVATION",
        "La sala no pertenece al catálogo autorizado.",
      );
    }
    const date = canonicalDate(input.date);
    const startTime = canonicalTime(input.startTime);
    const endTime = canonicalTime(input.endTime);
    if (minutes(endTime) <= minutes(startTime)) {
      throw new DomainError(
        "INVALID_ROOM_RESERVATION",
        "La hora final debe ser posterior a la inicial.",
      );
    }
    if (!Number.isInteger(input.estimatedAttendees) || input.estimatedAttendees < 1) {
      throw new DomainError(
        "INVALID_ROOM_RESERVATION",
        "El número de asistentes debe ser positivo.",
      );
    }
    const normalized = {
      requestId: required(input.requestId, "La solicitud", 120),
      roomId: roomId as RoomId,
      date,
      startTime,
      endTime,
      requesterName: required(input.requesterName, "El nombre", 160),
      requesterPosition: (input.requesterPosition ?? "").trim(),
      requesterArea: (input.requesterArea ?? "").trim(),
      requesterContact: identificarSolicitante(input),
      reason: required(input.reason, "El motivo"),
      estimatedAttendees: input.estimatedAttendees,
      origin: input.origin ?? "AUTOSERVICIO",
    } as const;
    const payloadHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");

    return this.#repository.withRoomDateLock(normalized.roomId, date, async () => {
      const replay = await this.#repository.findByRequestId(normalized.requestId);
      if (replay) {
        if (replay.payloadHash !== payloadHash) {
          throw new DomainError(
            "ROOM_REQUEST_CONFLICT",
            "La solicitud ya identifica otra reservación.",
          );
        }
        return { reservation: replay, repeated: true };
      }
      const sameDate = await this.#repository.list(date, date);
      if (
        sameDate.some(
          (row) => row.roomId === normalized.roomId && overlaps(row, startTime, endTime),
        )
      ) {
        throw new DomainError("ROOM_OVERLAP", "El horario ya está reservado.");
      }
      const now = this.#clock.nowIso();
      const reservation: RoomReservation = {
        reservationId: randomUUID(),
        ...normalized,
        payloadHash,
        status: "ACTIVA",
        createdAt: now,
        createdBy: actor.actor,
        version: 1,
      };
      await this.#repository.appendAudit({
        actor: actor.actor,
        role: actor.role,
        entityType: "RoomReservation",
        entityId: reservation.reservationId,
        action: "ROOM_RESERVATION_CREATED",
        newState: "ACTIVA",
        reason: reservation.reason,
        requestId: reservation.requestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });
      await this.#repository.insert(reservation);
      return { reservation, repeated: false };
    });
  }

  async cancel(input: CancelReservationInput, actor: RoomActor): Promise<ReservationReceipt> {
    const existing = await this.#repository.findById(
      required(input.reservationId, "La reservación", 120),
    );
    if (!existing) throw new DomainError("ROOM_NOT_FOUND", "La reservación no existe.");
    const reason = required(input.reason, "El motivo de cancelación");
    return this.#repository.withRoomDateLock(existing.roomId, existing.date, async () => {
      const current = await this.#repository.findById(existing.reservationId);
      if (!current) throw new DomainError("ROOM_NOT_FOUND", "La reservación no existe.");
      if (current.status === "CANCELADA") return { reservation: current, repeated: true };
      const cancelled: RoomReservation = {
        ...current,
        status: "CANCELADA",
        cancelledAt: this.#clock.nowIso(),
        cancelledBy: actor.actor,
        cancellationReason: reason,
        version: current.version + 1,
      };
      await this.#repository.appendAudit({
        actor: actor.actor,
        role: actor.role,
        entityType: "RoomReservation",
        entityId: current.reservationId,
        action: "ROOM_RESERVATION_CANCELLED",
        previousState: "ACTIVA",
        newState: "CANCELADA",
        reason,
        requestId: required(input.requestId, "La solicitud", 120),
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });
      await this.#repository.replace(cancelled);
      return { reservation: cancelled, repeated: false };
    });
  }

  async publicAvailability(date: string): Promise<readonly PublicRoomOccupancy[]> {
    const canonical = canonicalDate(date);
    return (await this.#repository.list(canonical, canonical))
      .filter((row) => row.status === "ACTIVA")
      .map(({ roomId, date: rowDate, startTime, endTime }) => ({
        roomId,
        date: rowDate,
        startTime,
        endTime,
        status: "RESERVADA" as const,
      }));
  }

  list(dateFrom?: string, dateTo?: string): Promise<readonly RoomReservation[]> {
    return this.#repository.list(dateFrom, dateTo);
  }

  listAudit() {
    return this.#repository.listAudit();
  }
}
