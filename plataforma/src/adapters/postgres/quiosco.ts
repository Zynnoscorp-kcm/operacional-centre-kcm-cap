/**
 * Adaptador de repositorio para PostgreSQL / Supabase para Quiosco, Sesiones y Auditoría.
 *
 * Mapea a las tablas del esquema kcm:
 * - kcm.sesion
 * - kcm.asistencia
 * - kcm.registro_quiosco
 * - kcm.auditoria
 * - kcm.secreto_operacion
 * - kcm.concesion
 * - kcm.trabajador
 * - kcm.capacitacion
 * - kcm_lectura.obtener_sesiones_operativas()
 */

import { scryptSync, timingSafeEqual } from "node:crypto";

import { parseWorkerNumber, type WorkerNumber } from "../../domain/numero-trabajador.ts";
import type {
  AuditEventRecord,
  AttendanceRecord,
  ConcessionRecord,
  KioskRegistrationJournal,
  OperativeSessionSummary,
  SecretScope,
  SessionRecord,
  SessionStatus,
  TrainingCatalogItem,
} from "../../domain/quiosco/tipos.ts";
import type { KioskSessionRepositoryPort } from "../../ports/quiosco.port.ts";
import type { SqlExecutor } from "./matriz.ts";

/**
 * Formas de las filas que devuelve PostgreSQL, escritas una vez.
 *
 * Este adaptador consultaba con `query<any>` y mapeaba con `(r: any)`, así que
 * el compilador no comprobaba ni un solo nombre de columna: un `SELECT` que
 * dejara de traer una columna producía `undefined` en silencio en lugar de
 * fallar. Fue exactamente así como `listOperativeSessions` acabó devolviendo el
 * nombre del curso en `trainingId`. Declararlas cuesta este bloque y convierte
 * ese error en uno de compilación.
 *
 * Los instantes se declaran `Date | string` porque el controlador entrega
 * `timestamptz` como `Date` y `date` como texto; el mapeo ya contempla los dos.
 */
type Instante = Date | string;

interface SesionRow {
  sesion_id: string;
  codigo_sesion: string;
  capacitacion_id: string;
  clave_curso: string | null;
  capacitador_nombre: string | null;
  capacitador_id: string | null;
  fecha_sesion: Instante;
  duracion_minutos: number;
  sala: string | null;
  turno: string | null;
  tipo_evento: string;
  cupo_maximo: number;
  estado: SessionStatus;
  autorizada: boolean | null;
  autorizada_por: string | null;
  autorizada_en: Instante | null;
  abierta_en: Instante | null;
  cerrada_en: Instante | null;
  creador_nombre: string | null;
  creada_por: string | null;
  creada_en: Instante;
  solicitud_creacion_id: string;
  version: number | null;
}

interface SesionOperativaRow {
  sesion_id: string;
  codigo_sesion: string;
  capacitacion_id: string;
  clave_curso: string | null;
  capacitacion: string;
  capacitador: string | null;
  fecha_sesion: Instante;
  turno: string | null;
  duracion_minutos: number;
  estado: SessionStatus;
  autorizada: boolean | null;
  total_asistencias: string | number | null;
}

interface AsistenciaRow {
  asistencia_id: string;
  sesion_id: string;
  numero_trabajador_capturado: string | null;
  numero_trabajador: string | null;
  ruta: AttendanceRecord["route"];
  origen: AttendanceRecord["origin"];
  identidad_validada: boolean | null;
  asistencia_comprobada: boolean | null;
  estado_examen: AttendanceRecord["examStatus"];
  estado: AttendanceRecord["status"];
  excluida_de_liberacion: boolean | null;
  motivo_exclusion: string | null;
  actor_exclusion: string | null;
  excluida_en: Instante | null;
  liberada: boolean | null;
  liberada_en: Instante | null;
  solicitud_id: string | null;
  creada_en: Instante;
  actualizada_en: Instante | null;
  version: number | null;
}

interface RegistroQuioscoRow {
  registro_id: string;
  sesion_id: string;
  numero_trabajador_capturado: string;
  asistencia_id: string | null;
  solicitud_id: string;
  estacion: string | null;
  fase: KioskRegistrationJournal["phase"];
  creado_en: Instante;
  actualizado_en: Instante | null;
  completado_en: Instante | null;
}

interface AuditoriaRow {
  evento_id: string;
  secuencia: string | number;
  ocurrido_en: Instante;
  actor: string;
  rol: AuditEventRecord["role"];
  entidad_tipo: string;
  entidad_id: string;
  accion: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  motivo: string | null;
  sesion_id: string | null;
  solicitud_id: string | null;
  procedencia: AuditEventRecord["provenance"];
  contrato_version: string;
}

interface CapacitacionRow {
  capacitacion_id: string;
  clave_curso: string | null;
  nombre: string;
  activa: boolean | null;
  duracion_horas: number | null;
}

interface ConcesionRow {
  concesion_id: string;
  sesion_id: string | null;
  tipo: ConcessionRecord["type"];
  codigo_hash: string;
  estado: ConcessionRecord["status"];
  emitida_por: string;
  emitida_con_rol: ConcessionRecord["issuedRole"];
  emitida_en: Instante;
  expira_en: Instante;
  consumida_en: Instante | null;
  consumida_por: string | null;
  estacion: string | null;
  solicitud_id: string | null;
}

export class SupabaseKioskSessionRepository implements KioskSessionRepositoryPort {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  /**
   * Resuelve el `actor_id` de un identificador de dominio, creándolo si aún no
   * existe. El dominio trae al instructor como texto y la tabla exige una clave
   * foránea: sin esta resolución, abrir una sesión con un capacitador nuevo
   * fallaría por integridad referencial en lugar de registrarlo.
   */
  private async resolveActorId(identificador: string): Promise<string> {
    const clave = (identificador || "SISTEMA").trim() || "SISTEMA";
    const res = await this.db.query<{ actor_id: string }>(
      `INSERT INTO kcm.actor (identificador, nombre_visible)
       VALUES ($1, $1)
       ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
       RETURNING actor_id;`,
      [clave],
    );
    const actorId = res.rows[0]?.actor_id;
    if (!actorId) throw new Error(`No fue posible resolver el actor ${clave}`);
    return actorId;
  }

  /**
   * `trainingId` del dominio es la clave estable del curso (`QMS`), no el uuid.
   * Un curso desconocido se rechaza aquí: darlo de alta en silencio crearía un
   * catálogo paralelo al que la matriz nunca reconciliaría.
   */
  private async resolveTrainingId(trainingId: string): Promise<string> {
    const res = await this.db.query<{ capacitacion_id: string }>(
      `SELECT capacitacion_id FROM kcm.capacitacion WHERE clave_curso = $1 LIMIT 1;`,
      [trainingId],
    );
    const id = res.rows[0]?.capacitacion_id;
    if (!id) throw new Error(`La capacitación ${trainingId} no está en el catálogo`);
    return id;
  }

  // --- Sesiones ---
  async createSession(session: SessionRecord): Promise<SessionRecord> {
    const capacitacionId = await this.resolveTrainingId(session.trainingId);
    const capacitadorId = await this.resolveActorId(session.instructor);
    const creadorId = await this.resolveActorId(session.createdBy);

    // `sesion_autorizacion_coherente` exige actor y momento cuando la sesión
    // nace autorizada: una autorización sin responsable no es una autorización.
    const autorizadaPor = session.authorized
      ? await this.resolveActorId(session.authorizedBy ?? session.createdBy)
      : null;
    const autorizadaEn = session.authorized ? (session.authorizedAt ?? session.createdAt) : null;

    const sql = `
      INSERT INTO kcm.sesion (
        sesion_id, codigo_sesion, capacitacion_id, capacitador_id,
        fecha_sesion, duracion_minutos, sala, turno, tipo_evento,
        cupo_maximo, estado, autorizada, autorizada_por, autorizada_en,
        creada_por, creada_en, solicitud_creacion_id, version
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $17, $18,
        $13, $14,
        $15, $16
      )
      RETURNING *;
    `;
    await this.db.query(sql, [
      session.sessionId,
      session.sessionCode,
      capacitacionId,
      capacitadorId,
      session.date,
      session.durationMinutes,
      session.room || null,
      session.startTime || null,
      session.eventType,
      session.maxCapacity,
      session.status,
      session.authorized,
      creadorId,
      session.createdAt,
      session.creationRequestId,
      session.version,
      autorizadaPor,
      autorizadaEn,
    ]);

    return session;
  }

  async updateSession(sessionId: string, updates: Partial<SessionRecord>): Promise<SessionRecord> {
    // La columna `autorizada_por` es una FK. Al autorizar desde el piloto el
    // actor administrativo puede no existir todavía, por lo que debe
    // resolverse igual que al crear una sesión; una subconsulta que no devuelve
    // filas escribiría NULL y violaría `sesion_autorizacion_coherente`.
    const authorizedByActorId =
      updates.authorizedBy !== undefined
        ? await this.resolveActorId(updates.authorizedBy)
        : undefined;
    const fields: string[] = [];
    const values: unknown[] = [sessionId];
    let idx = 2;

    if (updates.status !== undefined) {
      fields.push(`estado = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.openedAt !== undefined) {
      fields.push(`abierta_en = $${idx++}`);
      values.push(updates.openedAt);
    }
    if (updates.closedAt !== undefined) {
      fields.push(`cerrada_en = $${idx++}`);
      values.push(updates.closedAt);
    }
    if (updates.authorized !== undefined) {
      fields.push(`autorizada = $${idx++}`);
      values.push(updates.authorized);
    }
    if (updates.authorizedBy !== undefined) {
      fields.push(`autorizada_por = $${idx++}`);
      values.push(authorizedByActorId);
    }
    if (updates.authorizedAt !== undefined) {
      fields.push(`autorizada_en = $${idx++}`);
      values.push(updates.authorizedAt);
    }

    if (fields.length > 0) {
      const sql = `UPDATE kcm.sesion SET ${fields.join(", ")} WHERE sesion_id = $1;`;
      await this.db.query(sql, values);
    }

    const current = await this.getSessionById(sessionId);
    if (!current) throw new Error(`Sesión ${sessionId} no encontrada tras actualizar`);
    return current;
  }

  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    const sql = `
      SELECT s.*, c.clave_curso, c.nombre as capacitacion_nombre, a.nombre_visible as capacitador_nombre,
             cr.nombre_visible as creador_nombre
      FROM kcm.sesion s
      JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
      LEFT JOIN kcm.actor a ON a.actor_id = s.capacitador_id
      LEFT JOIN kcm.actor cr ON cr.actor_id = s.creada_por
      WHERE s.sesion_id = $1;
    `;
    const res = await this.db.query<SesionRow>(sql, [sessionId]);
    const fila = res.rows[0];
    if (!fila) return null;
    return this.mapSessionRow(fila);
  }

  async getSessionByCode(sessionCode: string): Promise<SessionRecord | null> {
    const sql = `
      SELECT s.*, c.clave_curso, c.nombre as capacitacion_nombre, a.nombre_visible as capacitador_nombre,
             cr.nombre_visible as creador_nombre
      FROM kcm.sesion s
      JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
      LEFT JOIN kcm.actor a ON a.actor_id = s.capacitador_id
      LEFT JOIN kcm.actor cr ON cr.actor_id = s.creada_por
      WHERE s.codigo_sesion = $1;
    `;
    const res = await this.db.query<SesionRow>(sql, [sessionCode.trim().toUpperCase()]);
    const fila = res.rows[0];
    if (!fila) return null;
    return this.mapSessionRow(fila);
  }

  async getSessionByCreationRequestId(requestId: string): Promise<SessionRecord | null> {
    const sql = `
      SELECT s.*, c.clave_curso, c.nombre as capacitacion_nombre, a.nombre_visible as capacitador_nombre,
             cr.nombre_visible as creador_nombre
      FROM kcm.sesion s
      JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
      LEFT JOIN kcm.actor a ON a.actor_id = s.capacitador_id
      LEFT JOIN kcm.actor cr ON cr.actor_id = s.creada_por
      WHERE s.solicitud_creacion_id = $1;
    `;
    const res = await this.db.query<SesionRow>(sql, [requestId]);
    const fila = res.rows[0];
    if (!fila) return null;
    return this.mapSessionRow(fila);
  }

  async listSessions(predicate?: (s: SessionRecord) => boolean): Promise<readonly SessionRecord[]> {
    const sql = `
      SELECT s.*, c.clave_curso, c.nombre as capacitacion_nombre, a.nombre_visible as capacitador_nombre,
             cr.nombre_visible as creador_nombre
      FROM kcm.sesion s
      JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
      LEFT JOIN kcm.actor a ON a.actor_id = s.capacitador_id
      LEFT JOIN kcm.actor cr ON cr.actor_id = s.creada_por
      ORDER BY s.fecha_sesion DESC, s.codigo_sesion;
    `;
    const res = await this.db.query<SesionRow>(sql);
    const sessions = res.rows.map((r) => this.mapSessionRow(r));
    return predicate ? sessions.filter(predicate) : sessions;
  }

  /**
   * Sesiones que la consola puede operar hoy.
   *
   * No usa `kcm_lectura.obtener_sesiones_operativas()`: esa función excluye
   * `BORRADOR`, y una sesión recién creada nace precisamente ahí. El efecto era
   * que `/sesiones` creaba la sesión, redirigía, y la lista se veía idéntica:
   * la sesión existía en la base y la pantalla no la mostraba nunca, así que su
   * botón «Abrir» no llegaba a dibujarse y no había forma de operarla.
   *
   * El resto del criterio se conserva tal cual: los estados vivos siempre, y
   * `LIBERADA_TOTAL` sólo mientras siga siendo reciente. `cutoffDate` fija ese
   * corte —y el de los borradores, para que uno olvidado hace un mes no vuelva
   * a la pantalla— con catorce días por omisión.
   */
  async listOperativeSessions(options?: {
    cutoffDate?: string;
  }): Promise<readonly OperativeSessionSummary[]> {
    const sql = `
      SELECT
        s.sesion_id,
        s.codigo_sesion,
        c.capacitacion_id,
        c.clave_curso,
        c.nombre AS capacitacion,
        act.nombre_visible AS capacitador,
        s.fecha_sesion,
        s.turno,
        s.duracion_minutos,
        s.estado,
        s.autorizada,
        COUNT(a.asistencia_id) AS total_asistencias
      FROM kcm.sesion s
      JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
      LEFT JOIN kcm.actor act ON act.actor_id = s.capacitador_id
      LEFT JOIN kcm.asistencia a ON a.sesion_id = s.sesion_id
      WHERE s.estado IN ('ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR')
         OR (s.estado IN ('BORRADOR', 'LIBERADA_TOTAL') AND s.fecha_sesion >= $1::date)
      GROUP BY s.sesion_id, s.codigo_sesion, c.capacitacion_id, c.clave_curso, c.nombre,
               act.nombre_visible, s.fecha_sesion, s.turno, s.duracion_minutos, s.estado,
               s.autorizada
      ORDER BY s.fecha_sesion DESC, s.codigo_sesion;
    `;
    const corte =
      options?.cutoffDate ?? new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const res = await this.db.query<SesionOperativaRow>(sql, [corte]);
    return res.rows.map((r) => ({
      sessionId: r.sesion_id,
      sessionCode: r.codigo_sesion,
      // `trainingId` es la identidad del curso —`clave_curso`, con el UUID como
      // respaldo— y no su nombre. Traía el nombre en los dos campos porque la
      // consulta no seleccionaba ninguna de las dos columnas de identidad: la
      // lista quedaba con un rótulo donde el puerto promete un identificador, y
      // el adaptador de memoria sí lo devolvía bien, así que ninguna prueba lo
      // veía.
      trainingId: r.clave_curso ?? r.capacitacion_id,
      trainingName: r.capacitacion,
      // El `LEFT JOIN` sobre `kcm.actor` puede no traer nombre y el contrato
      // promete texto: sin este respaldo la pantalla imprimía «null».
      instructor: r.capacitador ?? "",
      date:
        typeof r.fecha_sesion === "string"
          ? r.fecha_sesion
          : r.fecha_sesion.toISOString().slice(0, 10),
      startTime: r.turno || "",
      durationMinutes: r.duracion_minutos,
      status: r.estado as SessionStatus,
      authorized: Boolean(r.autorizada),
      totalAttendances: Number(r.total_asistencias || 0),
    }));
  }

  private mapSessionRow(r: SesionRow): SessionRecord {
    return {
      sessionId: r.sesion_id,
      sessionCode: r.codigo_sesion,
      trainingId: r.clave_curso ?? r.capacitacion_id,
      instructor: r.capacitador_nombre || r.capacitador_id || "",
      date:
        typeof r.fecha_sesion === "string"
          ? r.fecha_sesion
          : r.fecha_sesion.toISOString().slice(0, 10),
      durationMinutes: r.duracion_minutos,
      room: r.sala || "",
      startTime: r.turno || "",
      eventType: r.tipo_evento,
      maxCapacity: r.cupo_maximo,
      status: r.estado as SessionStatus,
      authorized: Boolean(r.autorizada),
      authorizedBy: r.autorizada_por || undefined,
      authorizedAt: r.autorizada_en ? new Date(r.autorizada_en).toISOString() : undefined,
      openedAt: r.abierta_en ? new Date(r.abierta_en).toISOString() : undefined,
      closedAt: r.cerrada_en ? new Date(r.cerrada_en).toISOString() : undefined,
      createdBy: r.creador_nombre || r.creada_por || "SISTEMA",
      createdAt: new Date(r.creada_en).toISOString(),
      creationRequestId: r.solicitud_creacion_id,
      version: r.version || 1,
    };
  }

  // --- Asistencias ---
  async createAttendance(attendance: AttendanceRecord): Promise<AttendanceRecord> {
    const sql = `
      INSERT INTO kcm.asistencia (
        asistencia_id, sesion_id, trabajador_id, numero_trabajador_capturado,
        ruta, origen, identidad_validada, asistencia_comprobada,
        estado_examen, estado, excluida_de_liberacion, liberada,
        solicitud_id, version
      ) VALUES (
        $1, $2,
        (SELECT trabajador_id FROM kcm.trabajador WHERE numero_trabajador = $3 LIMIT 1),
        $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      RETURNING *;
    `;
    await this.db.query(sql, [
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
      attendance.released,
      attendance.requestId || null,
      attendance.version,
    ]);
    return attendance;
  }

  async getAttendanceBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<AttendanceRecord | null> {
    const sql = `
      SELECT a.*, t.numero_trabajador
      FROM kcm.asistencia a
      LEFT JOIN kcm.trabajador t ON t.trabajador_id = a.trabajador_id
      WHERE a.sesion_id = $1 AND (t.numero_trabajador = $2 OR a.numero_trabajador_capturado = $2);
    `;
    const res = await this.db.query<AsistenciaRow>(sql, [sessionId, String(workerNumber)]);
    const fila = res.rows[0];
    if (!fila) return null;
    return this.mapAttendanceRow(fila);
  }

  async listAttendancesBySession(sessionId: string): Promise<readonly AttendanceRecord[]> {
    const sql = `
      SELECT a.*, t.numero_trabajador
      FROM kcm.asistencia a
      LEFT JOIN kcm.trabajador t ON t.trabajador_id = a.trabajador_id
      WHERE a.sesion_id = $1;
    `;
    const res = await this.db.query<AsistenciaRow>(sql, [sessionId]);
    return res.rows.map((r) => this.mapAttendanceRow(r));
  }

  async countAttendancesBySession(sessionId: string): Promise<number> {
    const sql = `SELECT COUNT(*)::int as total FROM kcm.asistencia WHERE sesion_id = $1;`;
    const res = await this.db.query<{ total: number }>(sql, [sessionId]);
    return res.rows[0]?.total || 0;
  }

  private mapAttendanceRow(r: AsistenciaRow): AttendanceRecord {
    return {
      attendanceId: r.asistencia_id,
      sessionId: r.sesion_id,
      workerNumber: parseWorkerNumber(r.numero_trabajador_capturado || r.numero_trabajador),
      route: r.ruta,
      origin: r.origen,
      identityValidated: Boolean(r.identidad_validada),
      attendanceProven: Boolean(r.asistencia_comprobada),
      examStatus: r.estado_examen,
      status: r.estado,
      excludedFromRelease: Boolean(r.excluida_de_liberacion),
      exclusionReason: r.motivo_exclusion || undefined,
      excludedBy: r.actor_exclusion || undefined,
      excludedAt: r.excluida_en ? new Date(r.excluida_en).toISOString() : undefined,
      released: Boolean(r.liberada),
      releasedAt: r.liberada_en ? new Date(r.liberada_en).toISOString() : undefined,
      requestId: r.solicitud_id || undefined,
      createdAt: new Date(r.creada_en).toISOString(),
      updatedAt: new Date(r.actualizada_en || r.creada_en).toISOString(),
      version: r.version || 1,
    };
  }

  // --- Journal Quiosco ---
  async createJournal(journal: KioskRegistrationJournal): Promise<KioskRegistrationJournal> {
    const sql = `
      INSERT INTO kcm.registro_quiosco (
        registro_id, sesion_id, trabajador_id, numero_trabajador_capturado,
        asistencia_id, solicitud_id, estacion, fase, completado_en
      ) VALUES (
        $1, $2,
        (SELECT trabajador_id FROM kcm.trabajador WHERE numero_trabajador = $3 LIMIT 1),
        $3, $4, $5, $6, $7, $8
      )
      RETURNING *;
    `;
    // `registro_quiosco_completado_coherente` ata la fase COMPLETADO a su
    // momento: un registro completo sin fecha no permitiría reconstruir cuándo
    // se cerró, que es justo lo que el journal existe para responder.
    const completadoEn =
      journal.phase === "COMPLETADO"
        ? (journal.completedAt ?? journal.updatedAt ?? new Date().toISOString())
        : null;
    await this.db.query(sql, [
      journal.registrationId,
      journal.sessionId,
      String(journal.workerNumber),
      journal.attendanceId || null,
      journal.requestId,
      journal.stationLabel || null,
      journal.phase,
      completadoEn,
    ]);
    return journal;
  }

  async updateJournal(
    registrationId: string,
    updates: Partial<KioskRegistrationJournal>,
  ): Promise<KioskRegistrationJournal> {
    const fields: string[] = [];
    const values: unknown[] = [registrationId];
    let idx = 2;

    if (updates.phase !== undefined) {
      fields.push(`fase = $${idx++}`);
      values.push(updates.phase);
    }
    if (updates.attendanceId !== undefined) {
      fields.push(`asistencia_id = $${idx++}`);
      values.push(updates.attendanceId);
    }
    if (updates.completedAt !== undefined) {
      fields.push(`completado_en = $${idx++}`);
      values.push(updates.completedAt);
    }

    if (fields.length > 0) {
      const sql = `UPDATE kcm.registro_quiosco SET ${fields.join(", ")} WHERE registro_id = $1;`;
      await this.db.query(sql, values);
    }

    const res = await this.db.query<RegistroQuioscoRow>(
      `SELECT * FROM kcm.registro_quiosco WHERE registro_id = $1`,
      [registrationId],
    );
    const fila = res.rows[0];
    if (!fila) throw new Error(`Journal ${registrationId} no encontrado`);
    return this.mapJournalRow(fila);
  }

  async getJournalByRequest(requestId: string): Promise<KioskRegistrationJournal | null> {
    const sql = `SELECT * FROM kcm.registro_quiosco WHERE solicitud_id = $1 LIMIT 1;`;
    const res = await this.db.query<RegistroQuioscoRow>(sql, [requestId]);
    const fila = res.rows[0];
    if (!fila) return null;
    return this.mapJournalRow(fila);
  }

  async getJournalBySessionAndWorker(
    sessionId: string,
    workerNumber: WorkerNumber,
  ): Promise<KioskRegistrationJournal | null> {
    const sql = `SELECT * FROM kcm.registro_quiosco WHERE sesion_id = $1 AND numero_trabajador_capturado = $2 LIMIT 1;`;
    const res = await this.db.query<RegistroQuioscoRow>(sql, [sessionId, String(workerNumber)]);
    const fila = res.rows[0];
    if (!fila) return null;
    return this.mapJournalRow(fila);
  }

  async listJournalsBySession(sessionId: string): Promise<readonly KioskRegistrationJournal[]> {
    const sql = `SELECT * FROM kcm.registro_quiosco WHERE sesion_id = $1;`;
    const res = await this.db.query<RegistroQuioscoRow>(sql, [sessionId]);
    return res.rows.map((r) => this.mapJournalRow(r));
  }

  async listIncompleteJournalsBySession(
    sessionId: string,
  ): Promise<readonly KioskRegistrationJournal[]> {
    const sql = `SELECT * FROM kcm.registro_quiosco WHERE sesion_id = $1 AND fase <> 'COMPLETADO';`;
    const res = await this.db.query<RegistroQuioscoRow>(sql, [sessionId]);
    return res.rows.map((r) => this.mapJournalRow(r));
  }

  private mapJournalRow(r: RegistroQuioscoRow): KioskRegistrationJournal {
    return {
      registrationId: r.registro_id,
      sessionId: r.sesion_id,
      workerNumber: parseWorkerNumber(r.numero_trabajador_capturado),
      attendanceId: r.asistencia_id || undefined,
      requestId: r.solicitud_id,
      stationLabel: r.estacion || undefined,
      phase: r.fase,
      createdAt: new Date(r.creado_en).toISOString(),
      updatedAt: new Date(r.actualizado_en || r.creado_en).toISOString(),
      completedAt: r.completado_en ? new Date(r.completado_en).toISOString() : undefined,
    };
  }

  // --- Auditoría ---

  /**
   * El enum `kcm.rol` tiene cuatro valores y `KIOSK` no es uno: el equipo de la
   * sala actúa con el rol del capacitador, que es quien responde por lo que ahí
   * se registra. Sin esta traducción, `INSERT` en `kcm.auditoria` abortaba y se
   * llevaba consigo la operación entera —el PIN correcto respondía «error en el
   * servidor»—, porque la bitácora es parte de la misma transacción.
   */
  private static readonly ROL_EN_ESQUEMA: Readonly<Record<string, string>> = {
    KIOSK: "CAPACITADOR",
    SALA_QUIOSCO: "CAPACITADOR",
  };

  async recordAudit(
    event: Omit<AuditEventRecord, "eventId" | "occurredAt">,
  ): Promise<AuditEventRecord> {
    const sql = `
      INSERT INTO kcm.auditoria (
        actor, rol, entidad_tipo, entidad_id, accion,
        estado_anterior, estado_nuevo, motivo, sesion_id,
        solicitud_id, procedencia, contrato_version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING *;
    `;
    const res = await this.db.query<AuditoriaRow>(sql, [
      event.actor,
      SupabaseKioskSessionRepository.ROL_EN_ESQUEMA[event.role] ?? event.role,
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
    ]);

    const r = res.rows[0];
    if (!r) throw new Error("El INSERT de auditoría no devolvió la fila insertada");
    return {
      eventId: r.evento_id,
      sequence: Number(r.secuencia),
      occurredAt: new Date(r.ocurrido_en).toISOString(),
      actor: r.actor,
      role: r.rol,
      entityType: r.entidad_tipo,
      entityId: r.entidad_id,
      action: r.accion,
      previousState: r.estado_anterior || undefined,
      newState: r.estado_nuevo || undefined,
      reason: r.motivo || undefined,
      sessionId: r.sesion_id || undefined,
      requestId: r.solicitud_id || undefined,
      provenance: r.procedencia,
      contractVersion: r.contrato_version,
    };
  }

  async listAuditEvents(filter?: {
    sessionId?: string;
    requestId?: string;
    entityId?: string;
    entityType?: string;
    action?: string;
  }): Promise<readonly AuditEventRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filter?.sessionId) {
      conditions.push(`sesion_id = $${idx++}`);
      values.push(filter.sessionId);
    }
    if (filter?.requestId) {
      conditions.push(`solicitud_id = $${idx++}`);
      values.push(filter.requestId);
    }
    if (filter?.entityId) {
      conditions.push(`entidad_id = $${idx++}`);
      values.push(filter.entityId);
    }
    if (filter?.entityType) {
      conditions.push(`entidad_tipo = $${idx++}`);
      values.push(filter.entityType);
    }
    if (filter?.action) {
      conditions.push(`accion = $${idx++}`);
      values.push(filter.action);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM kcm.auditoria ${where} ORDER BY secuencia ASC;`;
    const res = await this.db.query<AuditoriaRow>(sql, values);

    return res.rows.map((r) => ({
      eventId: r.evento_id,
      sequence: Number(r.secuencia),
      occurredAt: new Date(r.ocurrido_en).toISOString(),
      actor: r.actor,
      role: r.rol,
      entityType: r.entidad_tipo,
      entityId: r.entidad_id,
      action: r.accion,
      previousState: r.estado_anterior || undefined,
      newState: r.estado_nuevo || undefined,
      reason: r.motivo || undefined,
      sessionId: r.sesion_id || undefined,
      requestId: r.solicitud_id || undefined,
      provenance: r.procedencia,
      contractVersion: r.contrato_version,
    }));
  }

  // --- Padrón ---
  async isWorkerActive(workerNumber: WorkerNumber): Promise<boolean> {
    const sql = `SELECT activo FROM kcm.trabajador WHERE numero_trabajador = $1 LIMIT 1;`;
    const res = await this.db.query<{ activo: boolean }>(sql, [String(workerNumber)]);
    return res.rows.length > 0 && Boolean(res.rows[0]?.activo);
  }

  // --- Catálogo ---
  async listActiveTrainings(): Promise<readonly TrainingCatalogItem[]> {
    const sql = `SELECT c.capacitacion_id, c.clave_curso, c.nombre, c.activa, m.duracion_horas
       FROM kcm.capacitacion c
       LEFT JOIN kcm.metadato_curso_dc3 m ON m.capacitacion_id = c.capacitacion_id
      WHERE c.activa = true ORDER BY c.nombre;`;
    const res = await this.db.query<CapacitacionRow>(sql);
    return res.rows.map((r) => ({
      trainingId: r.clave_curso ?? r.capacitacion_id,
      name: r.nombre,
      active: Boolean(r.activa),
      // `metadato_curso_dc3` entra por `LEFT JOIN`: un curso sin metadatos da
      // `null` y el contrato declara el campo opcional, no nulo.
      durationHours: r.duracion_horas ?? undefined,
    }));
  }

  async getTrainingById(trainingId: string): Promise<TrainingCatalogItem | null> {
    const sql = `SELECT c.capacitacion_id, c.clave_curso, c.nombre, c.activa, m.duracion_horas
       FROM kcm.capacitacion c
       LEFT JOIN kcm.metadato_curso_dc3 m ON m.capacitacion_id = c.capacitacion_id
      WHERE c.clave_curso = $1 OR c.capacitacion_id::text = $1 LIMIT 1;`;
    const res = await this.db.query<CapacitacionRow>(sql, [trainingId]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      trainingId: r.clave_curso ?? r.capacitacion_id,
      name: r.nombre,
      active: Boolean(r.activa),
      durationHours: r.duracion_horas ?? undefined,
    };
  }

  // --- Secretos ---
  async verifySecret(scope: SecretScope, candidate: string): Promise<boolean> {
    const sql = `
      SELECT secreto_hash, algoritmo
      FROM kcm.secreto_operacion
      WHERE alcance = $1 AND revocado_en IS NULL
        AND (expira_en IS NULL OR expira_en > now())
      ORDER BY creado_en DESC LIMIT 1;
    `;
    const res = await this.db.query<{ secreto_hash: string; algoritmo: string }>(sql, [scope]);
    const row = res.rows[0];
    if (!row) return false;
    // El esquema guarda el hash, nunca el secreto. Comparar en claro aceptaría
    // como válido el propio hash y convertiría una fuga de lectura en un acceso.
    if (row.algoritmo !== "scrypt") {
      throw new Error(
        `El secreto de ${scope} está en ${row.algoritmo}; este adaptador sólo verifica scrypt.`,
      );
    }
    const [sal, esperado] = row.secreto_hash.split(":");
    if (!sal || !esperado)
      throw new Error(`El hash del secreto de ${scope} no tiene la forma sal:hash.`);
    const calculado = scryptSync(candidate, Buffer.from(sal, "hex"), 32);
    const referencia = Buffer.from(esperado, "hex");
    return calculado.length === referencia.length && timingSafeEqual(calculado, referencia);
  }

  // --- Concesiones ---
  async createConcession(concession: ConcessionRecord): Promise<ConcessionRecord> {
    const sql = `
      INSERT INTO kcm.concesion (
        concesion_id, sesion_id, tipo, codigo_hash,
        estado, emitida_por, emitida_con_rol, emitida_en, expira_en,
        estacion, solicitud_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        (SELECT actor_id FROM kcm.actor WHERE identificador = $6 OR nombre_visible = $6 LIMIT 1),
        $7, $8, $9, $10, $11
      );
    `;
    await this.db.query(sql, [
      concession.concessionId,
      concession.sessionId || null,
      concession.type,
      concession.codeHash,
      concession.status,
      concession.issuedBy,
      concession.issuedRole,
      concession.issuedAt,
      concession.expiresAt,
      concession.stationLabel || null,
      concession.requestId || null,
    ]);
    return concession;
  }

  async getConcessionByCodeHash(codeHash: string): Promise<ConcessionRecord | null> {
    const sql = `SELECT * FROM kcm.concesion WHERE codigo_hash = $1 LIMIT 1;`;
    const res = await this.db.query<ConcesionRow>(sql, [codeHash]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      concessionId: r.concesion_id,
      sessionId: r.sesion_id || undefined,
      type: r.tipo,
      codeHash: r.codigo_hash,
      status: r.estado,
      issuedBy: r.emitida_por,
      issuedRole: r.emitida_con_rol,
      issuedAt: new Date(r.emitida_en).toISOString(),
      expiresAt: new Date(r.expira_en).toISOString(),
      consumedAt: r.consumida_en ? new Date(r.consumida_en).toISOString() : undefined,
      consumedBy: r.consumida_por || undefined,
      stationLabel: r.estacion || undefined,
      requestId: r.solicitud_id || undefined,
    };
  }

  async updateConcession(
    concessionId: string,
    updates: Partial<ConcessionRecord>,
  ): Promise<ConcessionRecord> {
    const fields: string[] = [];
    const values: unknown[] = [concessionId];
    let idx = 2;

    if (updates.status !== undefined) {
      fields.push(`estado = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.consumedAt !== undefined) {
      fields.push(`consumida_en = $${idx++}`);
      values.push(updates.consumedAt);
    }
    if (updates.consumedBy !== undefined) {
      fields.push(
        `consumida_por = (SELECT actor_id FROM kcm.actor WHERE identificador = $${idx} OR nombre_visible = $${idx} LIMIT 1)`,
      );
      idx++;
      values.push(updates.consumedBy);
    }

    if (fields.length > 0) {
      const sql = `UPDATE kcm.concesion SET ${fields.join(", ")} WHERE concesion_id = $1;`;
      await this.db.query(sql, values);
    }

    const res = await this.db.query<ConcesionRow>(
      `SELECT * FROM kcm.concesion WHERE concesion_id = $1`,
      [concessionId],
    );
    const r = res.rows[0];
    if (!r) throw new Error(`Concesión ${concessionId} no encontrada`);
    return {
      concessionId: r.concesion_id,
      sessionId: r.sesion_id || undefined,
      type: r.tipo,
      codeHash: r.codigo_hash,
      status: r.estado,
      issuedBy: r.emitida_por,
      issuedRole: r.emitida_con_rol,
      issuedAt: new Date(r.emitida_en).toISOString(),
      expiresAt: new Date(r.expira_en).toISOString(),
      consumedAt: r.consumida_en ? new Date(r.consumida_en).toISOString() : undefined,
      consumedBy: r.consumida_por || undefined,
      stationLabel: r.estacion || undefined,
      requestId: r.solicitud_id || undefined,
    };
  }

  async withLock<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(async () => fn());
  }
}
