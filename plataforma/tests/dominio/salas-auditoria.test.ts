import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRoomReservationRepository } from "../../src/adapters/memoria/salas.ts";
import { RoomReservationService } from "../../src/domain/salas/reservaciones.ts";
import type { Clock } from "../../src/ports/reloj.ts";

const clock: Clock = {
  now: () => new Date("2026-08-03T12:00:00.000Z"),
  nowIso: () => "2026-08-03T12:00:00.000Z",
};
const actor = { actor: "OPERADOR_SINTETICO", role: "CAPACITACION" } as const;
const input = {
  requestId: "room-request-1",
  roomId: "VOGUE",
  date: "2026-08-10",
  startTime: "09:00",
  endTime: "10:00",
  requesterName: "SOLICITANTE SINTETICO",
  requesterContact: "EXT-000",
  reason: "CAPACITACION SINTETICA",
  estimatedAttendees: 10,
} as const;

describe("E12 · salas y auditoría", () => {
  it("serializa dos solicitudes simultáneas y sólo una ocupa el bloque", async () => {
    const service = new RoomReservationService(new MemoryRoomReservationRepository(), clock);
    const results = await Promise.allSettled([
      service.create(input, actor),
      service.create({ ...input, requestId: "room-request-2" }, actor),
    ]);
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(results.filter((row) => row.status === "rejected").length, 1);
  });

  it("es idempotente por requestId y rechaza reutilizarlo con otro payload", async () => {
    const service = new RoomReservationService(new MemoryRoomReservationRepository(), clock);
    const first = await service.create(input, actor);
    const replay = await service.create(input, actor);
    assert.equal(first.reservation.reservationId, replay.reservation.reservationId);
    assert.equal(replay.repeated, true);
    await assert.rejects(
      service.create({ ...input, endTime: "10:30" }, actor),
      /otra reservación/u,
    );
  });

  it("cancela como transición, libera el horario y conserva auditoría append-only", async () => {
    const repository = new MemoryRoomReservationRepository();
    const service = new RoomReservationService(repository, clock);
    const created = await service.create(input, actor);
    await service.cancel(
      {
        reservationId: created.reservation.reservationId,
        requestId: "cancel-request-1",
        reason: "CAMBIO OPERATIVO",
      },
      actor,
    );
    const next = await service.create({ ...input, requestId: "room-request-3" }, actor);
    assert.equal(next.reservation.status, "ACTIVA");
    const rows = await service.list();
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.status === "CANCELADA").length, 1);
    assert.deepEqual((await service.listAudit()).map((event) => event.action).sort(), [
      "ROOM_RESERVATION_CANCELLED",
      "ROOM_RESERVATION_CREATED",
      "ROOM_RESERVATION_CREATED",
    ]);
  });

  it("la disponibilidad pública no expone ningún dato del solicitante", async () => {
    const service = new RoomReservationService(new MemoryRoomReservationRepository(), clock);
    await service.create(input, actor);
    const publicRow = (await service.publicAvailability(input.date))[0];
    assert.deepEqual(Object.keys(publicRow ?? {}).sort(), [
      "date",
      "endTime",
      "roomId",
      "startTime",
      "status",
    ]);
    assert.equal(JSON.stringify(publicRow).includes("SOLICITANTE"), false);
  });
});
