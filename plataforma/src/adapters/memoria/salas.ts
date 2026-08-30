import { randomUUID } from "node:crypto";

import type { AuditEventRecord } from "../../domain/quiosco/tipos.ts";
import type { RoomId, RoomReservation, RoomReservationRepository } from "../../domain/salas/tipos.ts";

export class MemoryRoomReservationRepository implements RoomReservationRepository {
  readonly #reservations = new Map<string, RoomReservation>();
  readonly #audits: AuditEventRecord[] = [];
  readonly #locks = new Map<string, Promise<void>>();

  async withRoomDateLock<T>(roomId: RoomId, date: string, work: () => Promise<T>): Promise<T> {
    const key = `${roomId}|${date}`;
    while (this.#locks.has(key)) await this.#locks.get(key);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#locks.set(key, gate);
    try {
      return await work();
    } finally {
      this.#locks.delete(key);
      release();
    }
  }

  findByRequestId(requestId: string): Promise<RoomReservation | null> {
    const row = [...this.#reservations.values()].find((item) => item.requestId === requestId);
    return Promise.resolve(row ? { ...row } : null);
  }

  findById(reservationId: string): Promise<RoomReservation | null> {
    const row = this.#reservations.get(reservationId);
    return Promise.resolve(row ? { ...row } : null);
  }

  list(dateFrom?: string, dateTo?: string): Promise<readonly RoomReservation[]> {
    return Promise.resolve(
      [...this.#reservations.values()]
        .filter((row) => (!dateFrom || row.date >= dateFrom) && (!dateTo || row.date <= dateTo))
        .sort((a, b) =>
          `${a.date}|${a.startTime}|${a.roomId}`.localeCompare(
            `${b.date}|${b.startTime}|${b.roomId}`,
          ),
        )
        .map((row) => ({ ...row })),
    );
  }

  insert(reservation: RoomReservation): Promise<void> {
    if (this.#reservations.has(reservation.reservationId)) throw new Error("Reservación duplicada");
    this.#reservations.set(reservation.reservationId, { ...reservation });
    return Promise.resolve();
  }

  replace(reservation: RoomReservation): Promise<void> {
    if (!this.#reservations.has(reservation.reservationId))
      throw new Error("Reservación inexistente");
    this.#reservations.set(reservation.reservationId, { ...reservation });
    return Promise.resolve();
  }

  appendAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord> {
    const stored: AuditEventRecord = {
      ...event,
      eventId: randomUUID(),
      sequence: this.#audits.length + 1,
      occurredAt: new Date().toISOString(),
    };
    this.#audits.push(stored);
    return Promise.resolve({ ...stored });
  }

  listAudit(): Promise<readonly AuditEventRecord[]> {
    return Promise.resolve(this.#audits.map((row) => ({ ...row })).reverse());
  }
}
