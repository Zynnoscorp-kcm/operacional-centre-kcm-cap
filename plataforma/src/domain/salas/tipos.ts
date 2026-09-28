import type { ActorIdentity, AuditEventRecord } from "../quiosco/tipos.ts";

/**
 * Las siete salas.
 *
 * `roomId` es la clave estable —es lo que viaja en formularios, en la
 * disponibilidad pública y en `catalogo.sala.clave_sala`— y `name` es sólo lo que se
 * lee en pantalla. Por eso renombrar una sala se hace aquí y en ningún otro
 * lado: la clave no se mueve, así que ninguna reservación existente pierde su
 * vínculo.
 *
 * Los nombres son los de las marcas, escritos como la empresa las escribe:
 * «Marli» sin acento, y Gerencia y Dragones sin el prefijo «Sala», que sobraba
 * al ir dentro de una lista que ya se llama salas.
 *
 * Esta constante es la única fuente de los nombres visibles. `catalogo.sala`
 * conserva los suyos en `nombre_visible` para lo que se consulte directo contra
 * la base, y donde la plataforma los muestra resuelve por `clave_sala` contra
 * esta lista.
 */
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
  /**
   * Nómina de quien reserva. Es lo que el formulario pide para identificarla:
   * dentro de planta el número basta y evita guardar un dato de contacto más.
   */
  readonly requesterWorkerNumber?: string;
  /**
   * Ya no se pide en ningún formulario; se conserva para lo ya capturado y para
   * quien reserva sin nómina —un proveedor o un visitante—.
   */
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
