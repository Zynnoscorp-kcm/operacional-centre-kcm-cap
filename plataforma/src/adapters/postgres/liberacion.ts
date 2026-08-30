/**
 * Adaptador PostgreSQL de Liberación (Función 5).
 *
 * Implementa los dos puertos: el journal durable y el destino. Es la pieza que
 * hace que liberar en la plataforma aparezca en `RELEASE_PULL_V1`, porque el
 * efecto queda en `kcm.liberacion` y el pull lo lee desde ahí.
 *
 * Tres invariantes que aquí no son estilo sino contrato:
 *
 * 1. El historial va antes que el valor. En `applyWrites`, la fila de
 *    `historial_sobrescritura_fecha` se escribe primero y en la misma
 *    transacción. Si algo revienta, lo que puede faltar es el valor nuevo,
 *    nunca el rastro del anterior.
 * 2. Un registro vigente por par. El índice parcial de `registro_hc` lo
 *    impone; la sobrescritura cierra el vigente y agrega otro, no lo edita.
 * 3. El bloqueo es del servidor. `withLock` usa `pg_advisory_xact_lock`, así
 *    que dos procesos de Node liberando la misma sesión se serializan de verdad;
 *    un candado en memoria sólo protegería dentro de un proceso.
 */

import { createHash, randomUUID } from "node:crypto";

import type { WorkerNumber } from "../../domain/numero-trabajador.ts";
import { parseWorkerNumber } from "../../domain/numero-trabajador.ts";
import type { HcRecord } from "../../domain/importacion-matriz/tipos.ts";
import type {
  AttendanceRecord,
  AuditEventRecord,
  SessionRecord,
} from "../../domain/quiosco/tipos.ts";
import type {
  MatrixMapping,
  OverwriteHistoryEntry,
  ReleaseBatch,
  ReleaseEffect,
} from "../../domain/liberacion/tipos.ts";
import type {
  MatrixWriteOperation,
  MatrixWritePort,
  ReleaseRepositoryPort,
} from "../../ports/liberacion.port.ts";
import type { SqlExecutor } from "./matriz.ts";
import { SupabaseKioskSessionRepository } from "./quiosco.ts";

function iso(valor: string | Date): string {
  return new Date(valor).toISOString();
}
/** `String()` sobre `unknown` puede rendir `[object Object]`; esto acota el valor. */
function texto(valor: unknown, porOmision = ""): string {
  if (valor === null || valor === undefined) return porOmision;
  return typeof valor === "string" ? valor : String(valor as string | number | boolean);
}
function fecha(valor: string | Date): string {
  return typeof valor === "string" ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);
}

export class SupabaseReleaseRepository implements ReleaseRepositoryPort, MatrixWritePort {
  readonly #db: SqlExecutor;
  /** Sesiones y asistencias ya tienen adaptador; se reutiliza en vez de duplicar su mapeo. */
  readonly #kiosk: SupabaseKioskSessionRepository;

  constructor(db: SqlExecutor) {
    this.#db = db;
    this.#kiosk = new SupabaseKioskSessionRepository(db);
  }

  async #actorId(identificador: string): Promise<string> {
    const { rows } = await this.#db.query<{ actor_id: string }>(
      `INSERT INTO kcm.actor (identificador, nombre_visible)
       VALUES ($1, $1)
       ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
       RETURNING actor_id;`,
      [identificador || "SISTEMA"],
    );
    const id = rows[0]?.actor_id;
    if (!id) throw new Error(`No fue posible resolver el actor ${identificador}`);
    return id;
  }

  // ----------------------------------------------------------- sesión y asistencias

  getSessionById(sessionId: string): Promise<SessionRecord | null> {
    return this.#kiosk.getSessionById(sessionId);
  }

  getSessionByCode(sessionCode: string): Promise<SessionRecord | null> {
    return this.#kiosk.getSessionByCode(sessionCode);
  }

  updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord> {
    return this.#kiosk.updateSession(sessionId, { status } as Partial<SessionRecord>);
  }

  listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]> {
    return this.#kiosk.listAttendancesBySession(sessionId);
  }

  async updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.#db.transaction(async (tx) => {
      for (const { attendanceId, updates: cambios } of updates) {
        const campos: string[] = [];
        const valores: unknown[] = [attendanceId];
        const agregar = (columna: string, valor: unknown) => {
          valores.push(valor);
          campos.push(`${columna} = $${String(valores.length)}`);
        };
        if (cambios.status !== undefined) agregar("estado", cambios.status);
        if (cambios.examStatus !== undefined) agregar("estado_examen", cambios.examStatus);
        if (cambios.released !== undefined) agregar("liberada", cambios.released);
        if (cambios.releasedAt !== undefined) agregar("liberada_en", cambios.releasedAt ?? null);
        if (cambios.identityValidated !== undefined) {
          agregar("identidad_validada", cambios.identityValidated);
        }
        if (cambios.attendanceProven !== undefined) {
          agregar("asistencia_comprobada", cambios.attendanceProven);
        }
        if (cambios.excludedFromRelease !== undefined) {
          agregar("excluida_de_liberacion", cambios.excludedFromRelease);
        }
        if (campos.length === 0) continue;
        valores.push();
        await tx.query(
          `UPDATE kcm.asistencia SET ${campos.join(", ")}, version = version + 1
            WHERE asistencia_id = $1;`,
          valores,
        );
      }
    });
  }

  // ------------------------------------------------------------- destino declarado

  async findActiveMapping(trainingId: string): Promise<readonly MatrixMapping[]> {
    const { rows } = await this.#db.query<{
      clave_curso: string;
      nombre_destino: string;
      hoja: string;
      columna: string;
      encabezado_esperado: string;
      fila_encabezado: number;
      version_mapeo: string;
      politica_sobrescritura: "NO_OVERWRITE" | "OVERWRITE_WITH_HISTORY";
      activo: boolean;
    }>(
      `SELECT c.clave_curso, d.nombre_destino, m.hoja, m.columna, m.encabezado_esperado,
              m.fila_encabezado, m.version_mapeo, m.politica_sobrescritura, d.activo
         FROM kcm.mapeo_matriz m
         JOIN kcm.capacitacion c ON c.capacitacion_id = m.capacitacion_id
         JOIN kcm.destino_matriz d ON d.destino_id = m.destino_id
        WHERE c.clave_curso = $1 AND m.vigente_hasta IS NULL AND d.activo = true;`,
      [trainingId],
    );
    return rows.map((r) => ({
      trainingId: r.clave_curso,
      destinationName: r.nombre_destino,
      destinationSheet: r.hoja,
      destinationColumn: r.columna,
      destinationHeader: r.encabezado_esperado,
      headerRow: Number(r.fila_encabezado),
      mappingVersion: r.version_mapeo,
      overwritePolicy: r.politica_sobrescritura,
      active: Boolean(r.activo),
    }));
  }

  // -------------------------------------------------------------------- journal

  #mapBatch(r: Record<string, unknown>): ReleaseBatch {
    const resultados = r["resultados"] as { plan?: string; results?: string } | null;
    return {
      batchId: texto(r["lote_id"]),
      sessionId: texto(r["sesion_id"]),
      requestId: texto(r["solicitud_id"]),
      mappingVersion: texto(r["version_mapeo"]),
      planHash: texto(r["sha256_plan"]),
      plan: resultados?.plan ?? "",
      journalMac: texto(r["journal_mac"]),
      results: resultados?.results ?? "",
      phase: r["fase"] as ReleaseBatch["phase"],
      status: r["estado"] as ReleaseBatch["status"],
      sessionOutcome: (r["resultado_sesion"] ?? null) as ReleaseBatch["sessionOutcome"],
      overwriteReason: texto(r["motivo_sobrescritura"], ""), // columna propia desde 0028
      totalCandidates: Number(r["total_candidatos"]),
      totalWritten: Number(r["total_escritos"]),
      totalConflicts: Number(r["total_conflictos"]),
      createdBy: texto(r["creador"], "SISTEMA"),
      createdAt: iso(r["creado_en"] as string | Date),
      updatedAt: iso(r["actualizado_en"] as string | Date),
      completedAt: r["completado_en"] ? iso(r["completado_en"] as string | Date) : null,
      contractVersion: texto(r["contrato_version"], "1.0.0"),
    };
  }

  readonly #seleccionLote = `
    SELECT l.*, a.identificador AS creador
      FROM kcm.lote_liberacion l
      LEFT JOIN kcm.actor a ON a.actor_id = l.creado_por`;

  async findBatchByRequestId(requestId: string): Promise<ReleaseBatch | null> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `${this.#seleccionLote} WHERE l.solicitud_id = $1;`,
      [requestId],
    );
    return rows[0] ? this.#mapBatch(rows[0]) : null;
  }

  async findBatchById(batchId: string): Promise<ReleaseBatch | null> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `${this.#seleccionLote} WHERE l.lote_id = $1;`,
      [batchId],
    );
    return rows[0] ? this.#mapBatch(rows[0]) : null;
  }

  async listBatchesBySession(sessionId: string): Promise<readonly ReleaseBatch[]> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `${this.#seleccionLote} WHERE l.sesion_id = $1 ORDER BY l.creado_en ASC;`,
      [sessionId],
    );
    return rows.map((r) => this.#mapBatch(r));
  }

  /**
   * `plan` y `results` son documentos del dominio y viajan juntos en la columna
   * `resultados`. Separarlos en columnas propias obligaría a migrar el esquema
   * cada vez que el plan gane un campo, y el journal ya está autenticado por
   * `journal_mac`: lo que protege su contenido es el HMAC, no la forma.
   */
  async insertBatch(batch: ReleaseBatch): Promise<ReleaseBatch> {
    const creador = await this.#actorId(batch.createdBy);
    await this.#db.query(
      `INSERT INTO kcm.lote_liberacion (
         lote_id, sesion_id, solicitud_id, version_mapeo, sha256_plan, journal_mac,
         fase, estado, total_candidatos, total_escritos, total_conflictos,
         resultados, creado_por, creado_en, actualizado_en, completado_en,
         resultado_sesion, motivo_sobrescritura, contrato_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19);`,
      [
        batch.batchId,
        batch.sessionId,
        batch.requestId,
        batch.mappingVersion,
        batch.planHash,
        batch.journalMac,
        batch.phase === "CONFLICTO" ? "PENDIENTE" : batch.phase,
        batch.status,
        batch.totalCandidates,
        batch.totalWritten,
        batch.totalConflicts,
        JSON.stringify({ plan: batch.plan, results: batch.results }),
        creador,
        batch.createdAt,
        batch.updatedAt,
        batch.completedAt,
        batch.sessionOutcome,
        batch.overwriteReason || null,
        batch.contractVersion,
      ],
    );
    return batch;
  }

  async replaceBatch(batch: ReleaseBatch): Promise<ReleaseBatch> {
    const { rows } = await this.#db.query<{ lote_id: string }>(
      `UPDATE kcm.lote_liberacion
          SET version_mapeo = $2, sha256_plan = $3, journal_mac = $4,
              fase = $5, estado = $6, total_candidatos = $7, total_escritos = $8,
              total_conflictos = $9, resultados = $10, actualizado_en = $11,
              completado_en = $12, resultado_sesion = $13,
              motivo_sobrescritura = $14, contrato_version = $15
        WHERE lote_id = $1
        RETURNING lote_id;`,
      [
        batch.batchId,
        batch.mappingVersion,
        batch.planHash,
        batch.journalMac,
        batch.phase === "CONFLICTO" ? "PENDIENTE" : batch.phase,
        batch.status,
        batch.totalCandidates,
        batch.totalWritten,
        batch.totalConflicts,
        JSON.stringify({ plan: batch.plan, results: batch.results }),
        batch.updatedAt,
        batch.completedAt,
        batch.sessionOutcome,
        batch.overwriteReason || null,
        batch.contractVersion,
      ],
    );
    if (rows.length === 0) throw new Error(`El lote durable desapareció: ${batch.batchId}`);
    return batch;
  }

  // --------------------------------------------------------------------- efectos

  #mapEffect(r: Record<string, unknown>): ReleaseEffect {
    return {
      releaseId: texto(r["liberacion_id"]),
      idempotencyKey: texto(r["clave_idempotencia"]),
      batchId: texto(r["lote_id"]),
      sessionId: texto(r["sesion_id"]),
      requestId: texto(r["solicitud_lote"], ""),
      attendanceId: texto(r["asistencia_id"], ""),
      employeeId: texto(r["numero_trabajador"]),
      trainingId: texto(r["clave_curso"]),
      effectiveDate: fecha(r["fecha_efectiva"] as string | Date),
      mappingVersion: texto(r["version_mapeo"]),
      result: r["resultado"] as ReleaseEffect["result"],
      marker: texto(r["marcador"]),
      xlsbAckStatus: (r["estado_acuse"] ?? "PENDIENTE_ACUSE") as ReleaseEffect["xlsbAckStatus"],
      createdBy: texto(r["creador"], "SISTEMA"),
      createdAt: iso(r["creada_en"] as string | Date),
    };
  }

  /**
   * El acuse del puente no vive en `kcm.liberacion` —es un ledger append-only—
   * sino en `acuse_liberacion_vba`. El estado se deriva al leer: si hay acuse
   * efectivo, ése manda; si no, el efecto sigue pendiente de Excel.
   */
  readonly #seleccionEfecto = `
    SELECT l.*, t.numero_trabajador, c.clave_curso, lote.solicitud_id AS solicitud_lote,
           COALESCE(
             (SELECT a.estado::text FROM kcm.acuse_liberacion_vba a
               WHERE a.clave_idempotencia = l.clave_idempotencia
                 AND a.estado IN ('APPLIED','RECOVERED')
               LIMIT 1),
             'PENDIENTE_ACUSE'
           ) AS estado_acuse
      FROM kcm.liberacion l
      JOIN kcm.trabajador t ON t.trabajador_id = l.trabajador_id
      JOIN kcm.capacitacion c ON c.capacitacion_id = l.capacitacion_id
      JOIN kcm.lote_liberacion lote ON lote.lote_id = l.lote_id`;

  async findEffectByIdempotencyKey(idempotencyKey: string): Promise<ReleaseEffect | null> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `${this.#seleccionEfecto} WHERE l.clave_idempotencia = $1;`,
      [idempotencyKey],
    );
    return rows[0] ? this.#mapEffect(rows[0]) : null;
  }

  async insertEffects(effects: readonly ReleaseEffect[]): Promise<void> {
    if (effects.length === 0) return;
    await this.#db.transaction(async (tx) => {
      for (const e of effects) {
        await tx.query(
          `INSERT INTO kcm.liberacion (
             liberacion_id, clave_idempotencia, lote_id, sesion_id,
             trabajador_id, capacitacion_id, fecha_efectiva, version_mapeo,
             resultado, marcador, creada_en, asistencia_id
           ) VALUES (
             $1, $2, $3, $4,
             (SELECT trabajador_id FROM kcm.trabajador WHERE numero_trabajador = $5),
             (SELECT capacitacion_id FROM kcm.capacitacion WHERE clave_curso = $6),
             $7, $8, $9, $10, $11, $12
           );`,
          [
            e.releaseId,
            e.idempotencyKey,
            e.batchId,
            e.sessionId,
            e.employeeId,
            e.trainingId,
            e.effectiveDate,
            e.mappingVersion,
            e.result,
            e.marker,
            e.createdAt,
            e.attendanceId || null,
          ],
        );
      }
    });
  }

  async listEffectsByBatch(batchId: string): Promise<readonly ReleaseEffect[]> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `${this.#seleccionEfecto} WHERE l.lote_id = $1 ORDER BY l.creada_en ASC;`,
      [batchId],
    );
    return rows.map((r) => this.#mapEffect(r));
  }

  // ------------------------------------------------------------------- auditoría

  recordAudit(event: Omit<AuditEventRecord, "eventId" | "occurredAt">): Promise<AuditEventRecord> {
    return this.#kiosk.recordAudit(event);
  }

  async findAuditEvent(filter: {
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null> {
    const eventos = await this.#kiosk.listAuditEvents(filter);
    return eventos[0] ?? null;
  }

  // ------------------------------------------------- destino: réplica consultable

  async getHcRecord(workerNumber: WorkerNumber, trainingId: string): Promise<HcRecord | null> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `SELECT r.*, t.numero_trabajador, c.clave_curso
         FROM kcm.registro_hc r
         JOIN kcm.trabajador t ON t.trabajador_id = r.trabajador_id
         JOIN kcm.capacitacion c ON c.capacitacion_id = r.capacitacion_id
        WHERE t.numero_trabajador = $1 AND c.clave_curso = $2
          AND r.estado_registro = 'VIGENTE';`,
      [String(workerNumber), trainingId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      recordId: texto(r["registro_id"]),
      idempotencyKey: texto(r["clave_idempotencia"]),
      workerNumber: parseWorkerNumber(texto(r["numero_trabajador"])),
      trainingId: texto(r["clave_curso"]),
      completionDate: fecha(r["fecha_capacitacion"] as string | Date),
      provenance: r["procedencia"] as HcRecord["provenance"],
      status: r["estado_registro"] as HcRecord["status"],
      sessionId: (r["sesion_id"] as string | null) ?? null,
      releaseId: (r["liberacion_id"] as string | null) ?? null,
      mappingVersion: texto(r["version_mapeo"]),
      batchId: (r["lote_id"] as string | null) ?? null,
      marker: (r["marcador"] as string | null) ?? null,
      importId: (r["importacion_id"] as string | null) ?? null,
      requestId: (r["solicitud_id"] as string | null) ?? null,
      createdAt: iso(r["creado_en"] as string | Date),
      updatedAt: iso(r["actualizado_en"] as string | Date),
      version: Number(r["version"]),
    };
  }

  async workerExists(workerNumber: WorkerNumber): Promise<boolean> {
    const { rows } = await this.#db.query<{ existe: boolean }>(
      `SELECT true AS existe FROM kcm.trabajador WHERE numero_trabajador = $1 LIMIT 1;`,
      [String(workerNumber)],
    );
    return rows.length > 0;
  }

  async trainingExists(trainingId: string): Promise<boolean> {
    const { rows } = await this.#db.query<{ existe: boolean }>(
      `SELECT true AS existe FROM kcm.capacitacion WHERE clave_curso = $1 LIMIT 1;`,
      [trainingId],
    );
    return rows.length > 0;
  }

  /**
   * Todo el lote en una transacción, y dentro de cada operación el historial
   * antes del valor. La sobrescritura retira el registro vigente y agrega otro:
   * el índice parcial de `registro_hc` no admite dos vigentes del mismo par, y
   * editar la fila borraría el hecho anterior.
   */
  async applyWrites(operations: readonly MatrixWriteOperation[]): Promise<void> {
    if (operations.length === 0) return;
    await this.#db.transaction(async (tx) => {
      for (const op of operations) {
        if (op.history) {
          const actor = await this.#actorId(op.history.actorId);
          await tx.query(
            `INSERT INTO kcm.historial_sobrescritura_fecha (
               historial_id, registro_id, trabajador_id, capacitacion_id,
               tipo_cambio, fecha_anterior, fecha_nueva, estado_anterior,
               estado_nuevo, procedencia, actor_id, motivo, solicitud_id, registrado_en
             ) VALUES (
               $1, $2,
               (SELECT trabajador_id FROM kcm.trabajador WHERE numero_trabajador = $3),
               (SELECT capacitacion_id FROM kcm.capacitacion WHERE clave_curso = $4),
               'SOBRESCRITA', $5, $6, 'VIGENTE', 'VIGENTE', 'SESSION_RELEASE',
               $7, $8, $9, $10
             );`,
            [
              op.history.historyId,
              op.history.recordId,
              String(op.history.workerNumber),
              op.history.trainingId,
              op.history.previousCompletionDate,
              op.history.completionDate,
              actor,
              op.history.reason,
              op.history.requestId,
              op.history.recordedAt,
            ],
          );

          await tx.query(
            `UPDATE kcm.registro_hc
                SET estado_registro = 'RETIRADO'
              WHERE registro_id = $1 AND estado_registro = 'VIGENTE';`,
            [op.history.recordId],
          );
        }

        const rec = op.record;
        await tx.query(
          `INSERT INTO kcm.registro_hc (
             registro_id, clave_idempotencia, trabajador_id, capacitacion_id,
             fecha_capacitacion, procedencia, estado_registro, sesion_id,
             liberacion_id, version_mapeo, lote_id, marcador, solicitud_id,
             creado_en, actualizado_en, version
           ) VALUES (
             $1, $2,
             (SELECT trabajador_id FROM kcm.trabajador WHERE numero_trabajador = $3),
             (SELECT capacitacion_id FROM kcm.capacitacion WHERE clave_curso = $4),
             $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
           )
           ON CONFLICT (clave_idempotencia) DO UPDATE
             SET fecha_capacitacion = EXCLUDED.fecha_capacitacion,
                 estado_registro = EXCLUDED.estado_registro,
                 marcador = EXCLUDED.marcador,
                 actualizado_en = EXCLUDED.actualizado_en,
                 version = kcm.registro_hc.version + 1;`,
          [
            rec.recordId,
            rec.idempotencyKey,
            String(rec.workerNumber),
            rec.trainingId,
            rec.completionDate,
            rec.provenance,
            rec.status,
            rec.sessionId,
            rec.releaseId,
            rec.mappingVersion,
            rec.batchId,
            rec.marker,
            rec.requestId,
            rec.createdAt,
            rec.updatedAt,
            rec.version,
          ],
        );
      }
    });
  }

  async listOverwriteHistory(
    workerNumber: WorkerNumber,
    trainingId: string,
  ): Promise<readonly OverwriteHistoryEntry[]> {
    const { rows } = await this.#db.query<Record<string, unknown>>(
      `SELECT h.*, t.numero_trabajador, c.clave_curso, a.identificador AS actor
         FROM kcm.historial_sobrescritura_fecha h
         JOIN kcm.trabajador t ON t.trabajador_id = h.trabajador_id
         JOIN kcm.capacitacion c ON c.capacitacion_id = h.capacitacion_id
         LEFT JOIN kcm.actor a ON a.actor_id = h.actor_id
        WHERE t.numero_trabajador = $1 AND c.clave_curso = $2
        ORDER BY h.secuencia DESC;`,
      [String(workerNumber), trainingId],
    );
    return rows.map((r) => ({
      historyId: texto(r["historial_id"]),
      recordId: texto(r["registro_id"]),
      workerNumber: parseWorkerNumber(texto(r["numero_trabajador"])),
      trainingId: texto(r["clave_curso"]),
      changeType: "SOBRESCRITA" as const,
      previousCompletionDate: fecha(r["fecha_anterior"] as string | Date),
      completionDate: fecha(r["fecha_nueva"] as string | Date),
      previousProvenance: r["procedencia"] as OverwriteHistoryEntry["previousProvenance"],
      provenance: "SESSION_RELEASE" as const,
      actorId: texto(r["actor"], "SISTEMA"),
      reason: texto(r["motivo"]),
      requestId: texto(r["solicitud_id"], ""),
      batchId: "",
      sessionId: "",
      recordedAt: iso(r["registrado_en"] as string | Date),
    }));
  }

  // --------------------------------------------------------------------- bloqueo

  /**
   * Candado consultivo del servidor, tomado dentro de la transacción y liberado
   * con ella. La clave se reduce a 64 bits con SHA-256 porque
   * `pg_advisory_xact_lock` recibe un entero, no texto.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const digest = createHash("sha256").update(key).digest();
    const clave = digest.readBigInt64BE(0);
    return this.#db.transaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock($1::bigint);`, [clave.toString()]);
      return fn();
    });
  }

  /** Identidad para efectos nuevos cuando el servicio no la trae. */
  static nuevoId(): string {
    return randomUUID();
  }
}
