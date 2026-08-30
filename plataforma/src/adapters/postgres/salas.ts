/**
 * Adaptador PostgreSQL de la agenda de salas (Funciones 6 y 7).
 *
 * Lo que aquí importa no es el mapeo sino dónde vive el invariante: el traslape
 * lo impide `reserva_sala_sin_traslape_activo`, un `EXCLUDE USING gist` del
 * esquema. Dos solicitudes simultáneas para la misma sala y horario no se
 * resuelven por orden de llegada ni por un candado de aplicación: la segunda
 * viola la restricción y el servidor la rechaza.
 *
 * `withRoomDateLock` toma además un candado consultivo por sala y fecha para que
 * el conflicto se detecte al validar y no como una excepción de integridad en
 * mitad de la escritura.
 */

import { createHash } from "node:crypto";

import type { AuditEventRecord } from "../../domain/quiosco/tipos.ts";
import type {
  RoomId,
  RoomReservation,
  RoomReservationRepository,
  ReservationStatus,
} from "../../domain/salas/tipos.ts";
import type { SqlExecutor } from "./matriz.ts";
import { SupabaseKioskSessionRepository } from "./quiosco.ts";

function iso(valor: string | Date): string {
  return new Date(valor).toISOString();
}
function soloFecha(valor: string | Date): string {
  return typeof valor === "string" ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);
}
/** `time` de PostgreSQL llega como `HH:MM:SS`; el dominio trabaja en `HH:MM`. */
function soloHora(valor: string): string {
  return String(valor).slice(0, 5);
}

interface FilaReserva {
  reserva_id: string;
  solicitud_id: string;
  sha256_payload: string;
  clave_sala: string;
  fecha: string | Date;
  hora_inicio: string;
  hora_fin: string;
  solicitante_nombre: string;
  solicitante_puesto: string | null;
  solicitante_area: string | null;
  solicitante_contacto: string | null;
  solicitante_numero_trabajador: string | null;
  motivo: string;
  asistentes_estimados: number;
  origen: string;
  estado: ReservationStatus;
  creada_en: string | Date;
  cancelada_en: string | Date | null;
  cancelador: string | null;
  motivo_cancelacion: string | null;
  version: number;
}

export class SupabaseRoomReservationRepository implements RoomReservationRepository {
  readonly #db: SqlExecutor;
  readonly #kiosk: SupabaseKioskSessionRepository;

  constructor(db: SqlExecutor) {
    this.#db = db;
    this.#kiosk = new SupabaseKioskSessionRepository(db);
  }

  #mapear(r: FilaReserva): RoomReservation {
    return {
      reservationId: r.reserva_id,
      requestId: r.solicitud_id,
      payloadHash: r.sha256_payload,
      roomId: r.clave_sala as RoomId,
      date: soloFecha(r.fecha),
      startTime: soloHora(r.hora_inicio),
      endTime: soloHora(r.hora_fin),
      requesterName: r.solicitante_nombre,
      requesterPosition: r.solicitante_puesto ?? "",
      requesterArea: r.solicitante_area ?? "",
      // El número de nómina identifica a quien reserva; el contacto es opcional
      // desde 0021 y se expone en el mismo campo cuando existe.
      requesterContact: r.solicitante_contacto ?? r.solicitante_numero_trabajador ?? "",
      reason: r.motivo,
      estimatedAttendees: Number(r.asistentes_estimados),
      origin: r.origen === "CONTROL" ? "ADMINISTRACION" : "AUTOSERVICIO",
      status: r.estado,
      createdAt: iso(r.creada_en),
      createdBy: "",
      ...(r.cancelada_en ? { cancelledAt: iso(r.cancelada_en) } : {}),
      ...(r.cancelador ? { cancelledBy: r.cancelador } : {}),
      ...(r.motivo_cancelacion ? { cancellationReason: r.motivo_cancelacion } : {}),
      version: Number(r.version),
    };
  }

  readonly #seleccion = `
    SELECT r.reserva_id, r.solicitud_id, r.sha256_payload, s.clave_sala, r.fecha,
           r.hora_inicio::text, r.hora_fin::text, r.solicitante_nombre, r.solicitante_puesto,
           r.solicitante_area, r.solicitante_contacto, r.solicitante_numero_trabajador,
           r.motivo, r.asistentes_estimados, r.origen, r.estado, r.creada_en,
           r.cancelada_en, a.identificador AS cancelador, r.motivo_cancelacion, r.version
      FROM kcm.reserva_sala r
      JOIN kcm.sala s ON s.sala_id = r.sala_id
      LEFT JOIN kcm.actor a ON a.actor_id = r.cancelada_por`;

  async withRoomDateLock<T>(roomId: RoomId, date: string, work: () => Promise<T>): Promise<T> {
    const digest = createHash("sha256").update(`${roomId}|${date}`).digest();
    const clave = digest.readBigInt64BE(0);
    return this.#db.transaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock($1::bigint);`, [clave.toString()]);
      return work();
    });
  }

  async findByRequestId(requestId: string): Promise<RoomReservation | null> {
    const { rows } = await this.#db.query<FilaReserva>(
      `${this.#seleccion} WHERE r.solicitud_id = $1;`,
      [requestId],
    );
    return rows[0] ? this.#mapear(rows[0]) : null;
  }

  async findById(reservationId: string): Promise<RoomReservation | null> {
    const { rows } = await this.#db.query<FilaReserva>(
      `${this.#seleccion} WHERE r.reserva_id = $1;`,
      [reservationId],
    );
    return rows[0] ? this.#mapear(rows[0]) : null;
  }

  async list(dateFrom?: string, dateTo?: string): Promise<readonly RoomReservation[]> {
    const condiciones: string[] = [];
    const valores: unknown[] = [];
    if (dateFrom) {
      valores.push(dateFrom);
      condiciones.push(`r.fecha >= $${String(valores.length)}`);
    }
    if (dateTo) {
      valores.push(dateTo);
      condiciones.push(`r.fecha <= $${String(valores.length)}`);
    }
    const where = condiciones.length ? ` WHERE ${condiciones.join(" AND ")}` : "";
    const { rows } = await this.#db.query<FilaReserva>(
      `${this.#seleccion}${where} ORDER BY r.fecha, r.hora_inicio;`,
      valores,
    );
    return rows.map((r) => this.#mapear(r));
  }

  /**
   * `horario` es la columna que sostiene la exclusión de traslapes. Se calcula
   * aquí a partir de fecha y horas para que no pueda quedar desalineada con
   * ellas: si se aceptara desde fuera, un cliente podría declarar un rango que
   * no corresponde al horario que muestra la agenda.
   */
  async insert(reservation: RoomReservation): Promise<void> {
    await this.#db.query(
      `INSERT INTO kcm.reserva_sala (
         reserva_id, sala_id, fecha, hora_inicio, hora_fin, horario,
         solicitante_nombre, solicitante_puesto, solicitante_area,
         solicitante_contacto, solicitante_numero_trabajador,
         motivo, asistentes_estimados, estado, origen, solicitud_id,
         sha256_payload, creada_en, version
       ) VALUES (
         $1,
         (SELECT sala_id FROM kcm.sala WHERE clave_sala = $2),
         $3::date, $4::time, $5::time,
         tstzrange(($3::date + $4::time), ($3::date + $5::time), '[)'),
         $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
       );`,
      [
        reservation.reservationId,
        reservation.roomId,
        reservation.date,
        reservation.startTime,
        reservation.endTime,
        reservation.requesterName,
        reservation.requesterPosition || null,
        reservation.requesterArea || null,
        /^\d{5}$/u.test(reservation.requesterContact) ? null : reservation.requesterContact || null,
        /^\d{5}$/u.test(reservation.requesterContact) ? reservation.requesterContact : null,
        reservation.reason,
        reservation.estimatedAttendees,
        reservation.status,
        reservation.origin === "ADMINISTRACION" ? "CONTROL" : "AUTOSERVICIO",
        reservation.requestId,
        reservation.payloadHash,
        reservation.createdAt,
        reservation.version,
      ],
    );
  }

  /**
   * Cancelar es una transición, no un borrado: la fila se conserva y libera su
   * horario porque la exclusión sólo aplica a las reservas `ACTIVA`.
   */
  async replace(reservation: RoomReservation): Promise<void> {
    const cancelador = reservation.cancelledBy
      ? (
          await this.#db.query<{ actor_id: string }>(
            `INSERT INTO kcm.actor (identificador, nombre_visible)
             VALUES ($1, $1)
             ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
             RETURNING actor_id;`,
            [reservation.cancelledBy],
          )
        ).rows[0]?.actor_id
      : null;

    await this.#db.query(
      `UPDATE kcm.reserva_sala
          SET estado = $2, cancelada_en = $3, cancelada_por = $4,
              motivo_cancelacion = $5, version = $6
        WHERE reserva_id = $1;`,
      [
        reservation.reservationId,
        reservation.status,
        reservation.cancelledAt ?? null,
        cancelador,
        reservation.cancellationReason ?? null,
        reservation.version,
      ],
    );
  }

  appendAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord> {
    return this.#kiosk.recordAudit(event);
  }

  listAudit(): Promise<readonly AuditEventRecord[]> {
    return this.#kiosk.listAuditEvents({ entityType: "RESERVA_SALA" });
  }
}
