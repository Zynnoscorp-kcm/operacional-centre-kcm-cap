/**
 * Adaptador PostgreSQL / Supabase para Preliberación (Función 4).
 *
 * Mapea a las tablas del esquema `kcm`:
 * - `kcm.sesion`, `kcm.asistencia`, `kcm.auditoria` (compartidas con quiosco)
 * - `kcm.revision_preliberacion` (una fila vigente por sesión)
 * - `kcm.evidencia` (reportes archivados, inmutables)
 * - `kcm.trabajador`, `kcm.puesto`, `kcm.area`, `kcm.capacitacion` (lectura)
 *
 * Los bytes del reporte no viven en la base: la fila de evidencia guarda la ruta
 * y el archivo va al almacén de objetos, que se inyecta. La razón es la de
 * siempre con archivos binarios en PostgreSQL, y además `kcm.evidencia` está
 * diseñada con `ruta_almacenamiento` y sin columna de contenido.
 */

import { parseWorkerNumber, type WorkerNumber } from "../../domain/numero-trabajador.ts";
import type {
  AttendanceRecord,
  AuditEventRecord,
  SessionRecord,
  SessionStatus,
  TrainingCatalogItem,
} from "../../domain/quiosco/tipos.ts";
import type {
  EmployeeInfo,
  PreReleaseReviewRecord,
  ReportEvidenceRecord,
} from "../../domain/preliberacion/tipos.ts";
import { REPORT_KIND, REPORT_MIME_TYPE } from "../../domain/preliberacion/tipos.ts";
import type { PreReleaseRepositoryPort } from "../../ports/preliberacion.port.ts";
import type { SqlExecutor } from "./matriz.ts";

/**
 * Almacén de objetos para los archivos de evidencia. Lo implementa Supabase
 * Storage cuando exista el bucket; hoy no existe ninguno en el proyecto.
 */
export interface ObjectStorePort {
  put(path: string, content: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
}

/**
 * Las filas del driver se describen aquí en lugar de dejarlas como `any`: es lo
 * único que hace verificable el mapeo entre columna y campo, que es donde de
 * verdad se rompe un adaptador. `unknown` en los campos que sólo se copian y
 * tipos concretos en los que se leen.
 */
interface FilaSesion {
  sesion_id: string;
  codigo_sesion: string;
  capacitacion_id: string;
  capacitador_nombre: string | null;
  fecha_sesion: string | Date;
  duracion_minutos: number;
  sala: string | null;
  turno: string | null;
  tipo_evento: string;
  cupo_maximo: number;
  estado: string;
  autorizada: boolean;
  creador_nombre: string | null;
  creada_en: string | Date;
  solicitud_creacion_id: string;
  version: number | null;
}

interface FilaAsistencia {
  asistencia_id: string;
  sesion_id: string;
  numero_trabajador_capturado: string;
  ruta: string;
  origen: string;
  identidad_validada: boolean;
  asistencia_comprobada: boolean;
  estado_examen: string;
  estado: string;
  excluida_de_liberacion: boolean;
  motivo_exclusion: string | null;
  actor_exclusion: string | null;
  excluida_en: string | Date | null;
  liberada: boolean;
  liberada_en: string | Date | null;
  solicitud_id: string | null;
  creada_en: string | Date;
  actualizada_en: string | Date | null;
  version: number | null;
}

interface FilaRevision {
  revision_id: string;
  sesion_id: string;
  total_padron: number;
  total_confirmados: number;
  total_reprobados: number;
  total_faltantes: number;
  total_excluidos: number;
  hallazgos: unknown;
  comentarios: string | null;
  evidencia_reporte_id: string | null;
  revisor_nombre: string | null;
  revisado_en: string | Date | null;
  actualizado_en: string | Date | null;
}

interface FilaEvidencia {
  evidencia_id: string;
  sesion_id: string;
  nombre_archivo: string;
  sha256: string;
  tamanio_bytes: number | string;
  ruta_almacenamiento: string;
  autor_nombre: string | null;
  creada_en: string | Date;
}

interface FilaAuditoria {
  evento_id: string;
  secuencia: number | string;
  ocurrido_en: string | Date;
  actor: string;
  rol: string;
  entidad_tipo: string;
  entidad_id: string;
  accion: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  motivo: string | null;
  sesion_id: string | null;
  solicitud_id: string | null;
  procedencia: string;
  contrato_version: string;
}

interface FilaTrabajador {
  numero_trabajador: string;
  nombre_completo: string;
  activo: boolean;
  area_nombre: string | null;
  puesto_nombre: string | null;
}

interface FilaCapacitacion {
  capacitacion_id: string;
  nombre: string;
  activa: boolean;
}

export class SupabasePreReleaseRepository implements PreReleaseRepositoryPort {
  private readonly db: SqlExecutor;
  private readonly store: ObjectStorePort;

  constructor(db: SqlExecutor, store: ObjectStorePort) {
    this.db = db;
    this.store = store;
  }

  // -----------------------------------------------------------------------
  // Sesiones
  // -----------------------------------------------------------------------

  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    const res = await this.db.query<FilaSesion>(`${SESSION_SELECT} WHERE s.sesion_id = $1;`, [
      sessionId,
    ]);
    const row = res.rows[0];
    return row ? this.mapSession(row) : null;
  }

  async updateSessionStatus(sessionId: string, status: string): Promise<SessionRecord> {
    const res = await this.db.query<{ sesion_id: string }>(
      `UPDATE kcm.sesion SET estado = $2 WHERE sesion_id = $1 RETURNING sesion_id;`,
      [sessionId, status],
    );
    if (res.rows.length === 0) {
      throw new Error(`La sesión ${sessionId} no existe`);
    }
    const session = await this.getSessionById(sessionId);
    if (!session) throw new Error(`La sesión ${sessionId} no existe`);
    return session;
  }

  async listSessionsByStatuses(statuses: readonly string[]): Promise<readonly SessionRecord[]> {
    const res = await this.db.query<FilaSesion>(
      `${SESSION_SELECT} WHERE s.estado = ANY($1) ORDER BY s.fecha_sesion DESC, s.codigo_sesion;`,
      [[...statuses]],
    );
    return res.rows.map((r) => this.mapSession(r));
  }

  // -----------------------------------------------------------------------
  // Asistencias
  // -----------------------------------------------------------------------

  async listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]> {
    const res = await this.db.query<FilaAsistencia>(
      `SELECT * FROM kcm.asistencia WHERE sesion_id = $1 ORDER BY numero_trabajador_capturado;`,
      [sessionId],
    );
    return res.rows.map((r) => this.mapAttendance(r));
  }

  async getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null> {
    const res = await this.db.query<FilaAsistencia>(
      `SELECT * FROM kcm.asistencia WHERE sesion_id = $1 AND numero_trabajador_capturado = $2;`,
      [sessionId, String(workerNumber)],
    );
    const row = res.rows[0];
    return row ? this.mapAttendance(row) : null;
  }

  async createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord> {
    await this.db.query(
      `INSERT INTO kcm.asistencia (
         asistencia_id, sesion_id, trabajador_id, numero_trabajador_capturado, ruta, origen,
         identidad_validada, asistencia_comprobada, estado_examen, estado,
         excluida_de_liberacion, motivo_exclusion, liberada, solicitud_id,
         creada_en, actualizada_en, version
       ) VALUES (
         $1, $2,
         (SELECT trabajador_id FROM kcm.trabajador WHERE numero_trabajador = $3 LIMIT 1),
         $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       );`,
      [
        attendance.attendanceId,
        attendance.sessionId,
        String(attendance.workerNumber),
        attendance.route,
        attendance.origin,
        attendance.identityValidated,
        attendance.attendanceProven,
        attendance.examStatus,
        attendance.status,
        attendance.excludedFromRelease,
        attendance.exclusionReason || null,
        attendance.released,
        attendance.requestId || null,
        attendance.createdAt,
        attendance.updatedAt,
        attendance.version,
      ],
    );
    return attendance;
  }

  async updateAttendance(
    attendanceId: string,
    updates: Partial<AttendanceRecord>,
  ): Promise<AttendanceRecord> {
    const columnas: Record<string, unknown> = {};
    if (updates.examStatus !== undefined) columnas["estado_examen"] = updates.examStatus;
    if (updates.status !== undefined) columnas["estado"] = updates.status;
    if (updates.attendanceProven !== undefined) {
      columnas["asistencia_comprobada"] = updates.attendanceProven;
    }
    if (updates.excludedFromRelease !== undefined) {
      columnas["excluida_de_liberacion"] = updates.excludedFromRelease;
    }
    if (updates.exclusionReason !== undefined) {
      columnas["motivo_exclusion"] = updates.exclusionReason || null;
    }
    if (updates.excludedBy !== undefined) columnas["actor_exclusion"] = updates.excludedBy || null;
    if (updates.excludedAt !== undefined) columnas["excluida_en"] = updates.excludedAt || null;
    if (updates.updatedAt !== undefined) columnas["actualizada_en"] = updates.updatedAt;

    const claves = Object.keys(columnas);
    if (claves.length === 0) {
      const actual = await this.db.query<FilaAsistencia>(
        `SELECT * FROM kcm.asistencia WHERE asistencia_id = $1;`,
        [attendanceId],
      );
      const row = actual.rows[0];
      if (!row) throw new Error(`La asistencia ${attendanceId} no existe`);
      return this.mapAttendance(row);
    }

    const asignaciones = claves.map((clave, indice) => `${clave} = $${indice + 2}`).join(", ");
    const res = await this.db.query<FilaAsistencia>(
      `UPDATE kcm.asistencia SET ${asignaciones} WHERE asistencia_id = $1 RETURNING *;`,
      [attendanceId, ...claves.map((clave) => columnas[clave])],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`La asistencia ${attendanceId} no existe`);
    return this.mapAttendance(row);
  }

  async updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void> {
    // Una sola transacción: el padrón de una revisión se mueve completo o no se
    // mueve. Media revisión aplicada es peor que ninguna.
    await this.db.transaction(async (client) => {
      const transaccional = new SupabasePreReleaseRepository(client, this.store);
      for (const { attendanceId, updates: parche } of updates) {
        await transaccional.updateAttendance(attendanceId, parche);
      }
    });
  }

  async countAttendancesBySession(sessionId: string): Promise<number> {
    const res = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM kcm.asistencia WHERE sesion_id = $1;`,
      [sessionId],
    );
    return Number(res.rows[0]?.total ?? 0);
  }

  // -----------------------------------------------------------------------
  // Revisión
  // -----------------------------------------------------------------------

  async getLatestReview(sessionId: string): Promise<PreReleaseReviewRecord | null> {
    const res = await this.db.query<FilaRevision>(
      `SELECT r.*, a.nombre_visible AS revisor_nombre
         FROM kcm.revision_preliberacion r
         LEFT JOIN kcm.actor a ON a.actor_id = r.revisado_por
        WHERE r.sesion_id = $1;`,
      [sessionId],
    );
    const row = res.rows[0];
    return row ? this.mapReview(row) : null;
  }

  async upsertReview(review: PreReleaseReviewRecord): Promise<PreReleaseReviewRecord> {
    // `sesion_id` es UNIQUE en el DDL: una sola revisión vigente por sesión, y
    // corregir una marca no acumula historial paralelo. El rastro va en auditoría.
    await this.db.query(
      `INSERT INTO kcm.revision_preliberacion (
         revision_id, sesion_id, total_padron, total_confirmados, total_reprobados,
         total_faltantes, total_excluidos, hallazgos, comentarios, estado,
         revisado_por, revisado_en
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
         (SELECT actor_id FROM kcm.actor WHERE identificador = $11 OR nombre_visible = $11 LIMIT 1),
         $12
       )
       ON CONFLICT (sesion_id) DO UPDATE SET
         total_padron = EXCLUDED.total_padron,
         total_confirmados = EXCLUDED.total_confirmados,
         total_reprobados = EXCLUDED.total_reprobados,
         total_faltantes = EXCLUDED.total_faltantes,
         total_excluidos = EXCLUDED.total_excluidos,
         hallazgos = EXCLUDED.hallazgos,
         comentarios = EXCLUDED.comentarios,
         estado = EXCLUDED.estado,
         revisado_por = EXCLUDED.revisado_por,
         revisado_en = EXCLUDED.revisado_en;`,
      [
        review.revisionId,
        review.sessionId,
        review.expectedExams,
        review.approvedExams,
        review.failedExams,
        review.missingExams,
        review.excludedCount,
        review.findings,
        review.comments || null,
        estadoDeRevision(review.status),
        review.reviewedBy,
        review.reviewedAt,
      ],
    );
    return review;
  }

  // -----------------------------------------------------------------------
  // Padrón
  // -----------------------------------------------------------------------

  async isWorkerActive(workerNumber: WorkerNumber): Promise<boolean> {
    const res = await this.db.query<{ activo: boolean }>(
      `SELECT activo FROM kcm.trabajador WHERE numero_trabajador = $1;`,
      [String(workerNumber)],
    );
    return Boolean(res.rows[0]?.activo);
  }

  async getEmployeeInfo(workerNumber: WorkerNumber): Promise<EmployeeInfo | null> {
    const res = await this.db.query<FilaTrabajador>(
      `SELECT t.numero_trabajador, t.nombre_completo, t.activo,
              COALESCE(ar.nombre, '') AS area_nombre,
              COALESCE(p.nombre, '') AS puesto_nombre
         FROM kcm.trabajador t
         LEFT JOIN kcm.area ar ON ar.area_id = t.area_id
         LEFT JOIN kcm.puesto p ON p.puesto_id = t.puesto_id
        WHERE t.numero_trabajador = $1;`,
      [String(workerNumber)],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      employeeId: String(row.numero_trabajador),
      displayName: String(row.nombre_completo ?? ""),
      area: String(row.area_nombre ?? ""),
      position: String(row.puesto_nombre ?? ""),
      active: Boolean(row.activo),
    };
  }

  async getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null> {
    const res = await this.db.query<FilaCapacitacion>(
      `SELECT capacitacion_id, nombre, activa FROM kcm.capacitacion WHERE capacitacion_id = $1;`,
      [trainingId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      trainingId: String(row.capacitacion_id),
      name: String(row.nombre),
      active: Boolean(row.activa),
    };
  }

  // -----------------------------------------------------------------------
  // Reportes archivados
  // -----------------------------------------------------------------------

  async archiveReport(
    record: ReportEvidenceRecord,
    content: Uint8Array,
  ): Promise<ReportEvidenceRecord> {
    // Primero el archivo, después la fila: una evidencia registrada cuyo archivo
    // no llegó a existir sería una promesa que la auditoría no puede cumplir.
    // Al revés, un archivo huérfano no engaña a nadie.
    await this.store.put(record.storagePath, content, record.mimeType);

    await this.db.query(
      `INSERT INTO kcm.evidencia (
         evidencia_id, sesion_id, tipo, nombre_archivo, mime_type, sha256,
         tamanio_bytes, ruta_almacenamiento, inmutable,
         creada_por, creada_en
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, true,
         (SELECT actor_id FROM kcm.actor WHERE identificador = $9 OR nombre_visible = $9 LIMIT 1),
         $10
       );`,
      [
        record.evidenceId,
        record.sessionId,
        record.kind,
        record.fileName,
        record.mimeType,
        record.sha256,
        record.byteSize,
        record.storagePath,
        record.createdBy,
        record.createdAt,
      ],
    );

    return record;
  }

  async listReportsBySession(sessionId: string): Promise<readonly ReportEvidenceRecord[]> {
    const res = await this.db.query<FilaEvidencia>(
      `SELECT e.*, a.nombre_visible AS autor_nombre
         FROM kcm.evidencia e
         LEFT JOIN kcm.actor a ON a.actor_id = e.creada_por
        WHERE e.sesion_id = $1 AND e.tipo = $2
        ORDER BY e.creada_en DESC;`,
      [sessionId, REPORT_KIND],
    );
    return res.rows.map((r) => this.mapReport(r));
  }

  async getReportById(evidenceId: string): Promise<ReportEvidenceRecord | null> {
    const res = await this.db.query<FilaEvidencia>(
      `SELECT e.*, a.nombre_visible AS autor_nombre
         FROM kcm.evidencia e
         LEFT JOIN kcm.actor a ON a.actor_id = e.creada_por
        WHERE e.evidencia_id = $1 AND e.tipo = $2;`,
      [evidenceId, REPORT_KIND],
    );
    const row = res.rows[0];
    return row ? this.mapReport(row) : null;
  }

  async getReportContent(evidenceId: string): Promise<Uint8Array | null> {
    const record = await this.getReportById(evidenceId);
    if (!record) return null;
    return this.store.get(record.storagePath);
  }

  // -----------------------------------------------------------------------
  // Auditoría
  // -----------------------------------------------------------------------

  async recordAudit(
    event: Omit<AuditEventRecord, "eventId" | "occurredAt">,
  ): Promise<AuditEventRecord> {
    const res = await this.db.query<FilaAuditoria>(
      `INSERT INTO kcm.auditoria (
         actor, rol, entidad_tipo, entidad_id, accion,
         estado_anterior, estado_nuevo, motivo, sesion_id,
         solicitud_id, procedencia, contrato_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *;`,
      [
        event.actor,
        event.role,
        event.entityType,
        event.entityId,
        event.action,
        event.previousState || null,
        event.newState || null,
        event.reason || null,
        event.sessionId || null,
        event.requestId || null,
        event.provenance,
        event.contractVersion,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("El asiento de auditoría no se pudo escribir");
    return this.mapAudit(row);
  }

  async recordManyAudits(
    events: readonly Omit<AuditEventRecord, "eventId" | "occurredAt">[],
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      const transaccional = new SupabasePreReleaseRepository(client, this.store);
      for (const event of events) {
        await transaccional.recordAudit(event);
      }
    });
  }

  async findAuditEvent(filter: {
    sessionId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    requestId?: string;
  }): Promise<AuditEventRecord | null> {
    const condiciones: string[] = [];
    const valores: unknown[] = [];
    const agregar = (columna: string, valor: string | undefined): void => {
      if (valor === undefined) return;
      valores.push(valor);
      condiciones.push(`${columna} = $${valores.length}`);
    };

    agregar("sesion_id", filter.sessionId);
    agregar("entidad_tipo", filter.entityType);
    agregar("entidad_id", filter.entityId);
    agregar("accion", filter.action);
    agregar("solicitud_id", filter.requestId);

    const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
    const res = await this.db.query<FilaAuditoria>(
      `SELECT * FROM kcm.auditoria ${donde} ORDER BY secuencia LIMIT 1;`,
      valores,
    );
    const row = res.rows[0];
    return row ? this.mapAudit(row) : null;
  }

  // -----------------------------------------------------------------------
  // Bloqueo
  // -----------------------------------------------------------------------

  /**
   * Bloqueo consultivo por clave. Es la sustitución de `LockService` del legado:
   * serializa por sesión sin bloquear filas, y se libera al terminar aunque la
   * operación falle.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1));`, [key]);
      return fn();
    });
  }

  // -----------------------------------------------------------------------
  // Mapeos
  // -----------------------------------------------------------------------

  private mapSession(r: FilaSesion): SessionRecord {
    return {
      sessionId: r.sesion_id,
      sessionCode: r.codigo_sesion,
      trainingId: r.capacitacion_id,
      instructor: r.capacitador_nombre || "",
      date:
        typeof r.fecha_sesion === "string"
          ? r.fecha_sesion
          : new Date(r.fecha_sesion).toISOString().slice(0, 10),
      durationMinutes: r.duracion_minutos,
      room: r.sala || "",
      startTime: r.turno || "",
      eventType: r.tipo_evento,
      maxCapacity: r.cupo_maximo,
      status: r.estado as SessionStatus,
      authorized: Boolean(r.autorizada),
      createdBy: r.creador_nombre || "",
      createdAt: new Date(r.creada_en).toISOString(),
      creationRequestId: r.solicitud_creacion_id,
      version: r.version || 1,
    };
  }

  private mapAttendance(r: FilaAsistencia): AttendanceRecord {
    return {
      attendanceId: r.asistencia_id,
      sessionId: r.sesion_id,
      workerNumber: parseWorkerNumber(r.numero_trabajador_capturado),
      route: r.ruta as AttendanceRecord["route"],
      origin: r.origen as AttendanceRecord["origin"],
      identityValidated: Boolean(r.identidad_validada),
      attendanceProven: Boolean(r.asistencia_comprobada),
      examStatus: r.estado_examen as AttendanceRecord["examStatus"],
      status: r.estado as AttendanceRecord["status"],
      excludedFromRelease: Boolean(r.excluida_de_liberacion),
      exclusionReason: r.motivo_exclusion ?? "",
      excludedBy: r.actor_exclusion ?? "",
      excludedAt: r.excluida_en ? new Date(r.excluida_en).toISOString() : "",
      released: Boolean(r.liberada),
      createdAt: new Date(r.creada_en).toISOString(),
      updatedAt: new Date(r.actualizada_en ?? r.creada_en).toISOString(),
      version: r.version || 1,
    };
  }

  private mapReview(r: FilaRevision): PreReleaseReviewRecord {
    const hallazgos = Array.isArray(r.hallazgos) ? r.hallazgos : [];
    return {
      revisionId: r.revision_id,
      sessionId: r.sesion_id,
      requestId: "",
      expectedExams: Number(r.total_padron ?? 0),
      // El DDL guarda los cinco conteos que la revisión necesita; los derivados
      // se recalculan al abrir el banco, así que no se persisten dos veces.
      receivedExams: Number(r.total_confirmados ?? 0) + Number(r.total_reprobados ?? 0),
      approvedExams: Number(r.total_confirmados ?? 0),
      failedExams: Number(r.total_reprobados ?? 0),
      missingExams: Number(r.total_faltantes ?? 0),
      extraExams: 0,
      findings: JSON.stringify(hallazgos),
      comments: r.comentarios ?? "",
      excludedCount: Number(r.total_excluidos ?? 0),
      status: Array.isArray(hallazgos) && hallazgos.length > 0 ? "CON_HALLAZGOS" : "SIN_HALLAZGOS",
      reportEvidenceId: r.evidencia_reporte_id ?? "",
      reviewedBy: r.revisor_nombre ?? "",
      reviewedAt: r.revisado_en ? new Date(r.revisado_en).toISOString() : "",
      updatedAt: r.actualizado_en ? new Date(r.actualizado_en).toISOString() : "",
    };
  }

  private mapReport(r: FilaEvidencia): ReportEvidenceRecord {
    return {
      evidenceId: r.evidencia_id,
      sessionId: r.sesion_id,
      kind: REPORT_KIND,
      fileName: r.nombre_archivo,
      mimeType: REPORT_MIME_TYPE,
      sha256: r.sha256,
      byteSize: Number(r.tamanio_bytes ?? 0),
      storagePath: r.ruta_almacenamiento,
      immutable: true,
      createdBy: r.autor_nombre ?? "",
      createdAt: new Date(r.creada_en).toISOString(),
    };
  }

  private mapAudit(r: FilaAuditoria): AuditEventRecord {
    return {
      eventId: r.evento_id,
      sequence: Number(r.secuencia),
      occurredAt: new Date(r.ocurrido_en).toISOString(),
      actor: r.actor,
      role: r.rol,
      entityType: r.entidad_tipo,
      entityId: r.entidad_id,
      action: r.accion,
      previousState: r.estado_anterior ?? "",
      newState: r.estado_nuevo ?? "",
      reason: r.motivo ?? "",
      sessionId: r.sesion_id ?? "",
      requestId: r.solicitud_id ?? "",
      provenance: r.procedencia as AuditEventRecord["provenance"],
      contractVersion: r.contrato_version,
    };
  }
}

const SESSION_SELECT = `
  SELECT s.*, a.nombre_visible AS capacitador_nombre, cr.nombre_visible AS creador_nombre
    FROM kcm.sesion s
    LEFT JOIN kcm.actor a ON a.actor_id = s.capacitador_id
    LEFT JOIN kcm.actor cr ON cr.actor_id = s.creada_por
`;

/**
 * El DDL de E4 sólo admite tres estados en `revision_preliberacion.estado`, que
 * describen la etapa; el dominio maneja además el resultado de la revisión. Se
 * traduce aquí en vez de relajar la restricción de la base.
 */
function estadoDeRevision(status: string): string {
  return status === "SIN_HALLAZGOS" || status === "CON_HALLAZGOS"
    ? "COTEJO_CONFIRMADO"
    : "EN_REVISION";
}
