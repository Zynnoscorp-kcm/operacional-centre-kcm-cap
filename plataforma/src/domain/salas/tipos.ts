import type { ActorIdentity, AuditEventRecord } from "../quiosco/tipos.ts";

export const ROOMS = [
  { roomId: "VOGUE", name: "Vogue" },
  { roomId: "KLEENEX", name: "Kleenex" },
  { roomId: "MARLI", name: "Marli" },
  { roomId: "PETALO", name: "Pétalo" },
  { roomId: "DELSEY", name: "Delsey" },
  { roomId: "SALA_GERENCIA", name: "Gerencia" },
  { roomId: "SALA_DRAGONES", name: "Dragones" },
] as const;

export type RoomId = (typeof ROOMS)[number]["roomId"];
export type ReservationStatus = "ACTIVA" | "CANCELADA";

export interface RoomReservation {
  readonly reservationId: string;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly roomId: RoomId;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly requesterName: string;
  readonly requesterPosition: string;
  readonly requesterArea: string;
  readonly requesterContact: string;
  readonly reason: string;
  readonly estimatedAttendees: number;
  readonly origin: "AUTOSERVICIO" | "ADMINISTRACION";
  readonly status: ReservationStatus;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly cancelledAt?: string;
  readonly cancelledBy?: string;
  readonly cancellationReason?: string;
  readonly version: number;
}

export interface CreateReservationInput {
  readonly requestId: string;
  readonly roomId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly requesterName: string;
  readonly requesterPosition?: string;
  readonly requesterArea?: string;
  readonly requesterWorkerNumber?: string;
  readonly requesterContact?: string;
  readonly reason: string;
  readonly estimatedAttendees: number;
  readonly origin?: "AUTOSERVICIO" | "ADMINISTRACION";
}

export interface PublicRoomOccupancy {
  readonly roomId: RoomId;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: "RESERVADA";
}

export interface RoomReservationRepository {
  withRoomDateLock<T>(roomId: RoomId, date: string, work: () => Promise<T>): Promise<T>;
  findByRequestId(requestId: string): Promise<RoomReservation | null>;
  findById(reservationId: string): Promise<RoomReservation | null>;
  list(dateFrom?: string, dateTo?: string): Promise<readonly RoomReservation[]>;
  insert(reservation: RoomReservation): Promise<void>;
  replace(reservation: RoomReservation): Promise<void>;
  appendAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord>;
  listAudit(): Promise<readonly AuditEventRecord[]>;
}

export interface CancelReservationInput {
  readonly reservationId: string;
  readonly requestId: string;
  readonly reason: string;
}

export interface ReservationReceipt {
  readonly reservation: RoomReservation;
  readonly repeated: boolean;
}

export type RoomActor = ActorIdentity;
