import { parseWorkerNumber, type WorkerNumber } from "../../domain/comun/numero-trabajador.ts";
import type {
  WorkerSystemRepositoryPort,
  WorkerFilter,
  DncCoverageFilter,
  DncCoverageRow,
  DncReconciliation,
  DepartmentDncSummary,
  CourseDncSummary,
  AreaCourseCompletionRow,
} from "../../ports/sistema-trabajador.port.ts";
import type {
  WorkerRecord,
  CourseTrajectoryEntry,
  Dc3WorkerLogEntry,
  ProvenanceType,
} from "../../domain/sistema-trabajador/tipos.ts";

export interface SqlClient {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: readonly T[] }>;
}

interface FilaTrabajador {
  numero_trabajador: string;
  nombre_completo: string;
  departamento: string | null;
  area: string | null;
  puesto: string | null;
  tipo_nomina: string | null;
  fecha_alta: string | null;
  activo: boolean;
  planta: string | null;
  escolaridad: string | null;
}

const SELECCION_TRABAJADOR = `
  SELECT
    t.numero_trabajador,
    t.nombre_completo,
    d.nombre AS departamento,
    a.nombre AS area,
    p.nombre AS puesto,
    t.tipo_nomina,
    t.fecha_alta,
    t.activo,
    t.planta,
    esc.valor AS escolaridad
  FROM organizacion.trabajador t
  LEFT JOIN organizacion.departamento d ON d.departamento_id = t.departamento_id
  LEFT JOIN organizacion.area a ON a.area_id = t.area_id
  LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
  LEFT JOIN organizacion.trabajador_atributo esc
    ON esc.trabajador_id = t.trabajador_id
   AND esc.nombre_atributo = 'ESCOLARIDAD'
   AND esc.vigente_hasta IS NULL
`;

function aWorkerRecord(row: FilaTrabajador): WorkerRecord {
  return {
    employeeId: parseWorkerNumber(row.numero_trabajador),
    name: row.nombre_completo,
    department: row.departamento ?? "",
    area: row.area ?? "",
    position: row.puesto ?? "",
    payrollType: row.tipo_nomina,
    hireDate: row.fecha_alta ? String(row.fecha_alta).slice(0, 10) : null,
    active: Boolean(row.activo),
    ...(row.planta ? { plant: row.planta } : {}),
    ...(row.escolaridad ? { schoolingDeclared: row.escolaridad } : {}),
  };
}

export class SupabaseWorkerSystemRepository implements WorkerSystemRepositoryPort {
  private readonly sqlClient: SqlClient;

  constructor(sqlClient: SqlClient) {
    this.sqlClient = sqlClient;
  }

  async listWorkers(filter?: WorkerFilter): Promise<readonly WorkerRecord[]> {
    let sql = `${SELECCION_TRABAJADOR} WHERE 1=1`;
    const params: unknown[] = [];

    if (filter?.activeOnly) sql += " AND t.activo = true";

    if (filter?.department) {
      params.push(`%${filter.department}%`);
      sql += ` AND d.nombre ILIKE $${String(params.length)}`;
    }
    if (filter?.area) {
      params.push(`%${filter.area}%`);
      sql += ` AND a.nombre ILIKE $${String(params.length)}`;
    }
    if (filter?.payrollType) {
      params.push(filter.payrollType.trim().toUpperCase());
      sql += ` AND upper(coalesce(t.tipo_nomina, '')) = $${String(params.length)}`;
    }
    if (filter?.hireDateFrom) {
      params.push(filter.hireDateFrom);
      sql += ` AND t.fecha_alta >= $${String(params.length)}::date`;
    }
    if (filter?.hireDateTo) {
      params.push(filter.hireDateTo);
      sql += ` AND t.fecha_alta <= $${String(params.length)}::date`;
    }
    if (filter?.query) {
      params.push(`%${filter.query}%`);
      const idx = String(params.length);
      sql +=
        ` AND (t.numero_trabajador ILIKE $${idx} OR t.nombre_completo ILIKE $${idx}` +
        ` OR p.nombre ILIKE $${idx})`;
    }

    sql += " ORDER BY t.numero_trabajador ASC";

    const { rows } = await this.sqlClient.query<FilaTrabajador>(sql, params);
    return rows.map(aWorkerRecord);
  }

  async getWorkerByNumber(workerNumber: WorkerNumber): Promise<WorkerRecord | null> {
    const { rows } = await this.sqlClient.query<FilaTrabajador>(
      `${SELECCION_TRABAJADOR} WHERE t.numero_trabajador = $1 LIMIT 1`,
      [String(workerNumber)],
    );
    const row = rows[0];
    return row ? aWorkerRecord(row) : null;
  }

  async getWorkerTrainingHistory(
    workerNumber: WorkerNumber,
  ): Promise<readonly CourseTrajectoryEntry[]> {
    const { rows } = await this.sqlClient.query<{
      registro_id: string;
      clave_curso: string;
      nombre: string;
      fecha_capacitacion: string;
      procedencia: string;
      lote_id: string | null;
      creado_en: string | Date;
    }>(
      `SELECT r.registro_id, c.clave_curso, c.nombre,
              r.fecha_capacitacion, r.procedencia, r.lote_id, r.creado_en
         FROM operacion.historial_capacitacion r
         JOIN catalogo.capacitacion c ON c.capacitacion_id = r.capacitacion_id
         JOIN organizacion.trabajador t ON t.trabajador_id = r.trabajador_id
        WHERE t.numero_trabajador = $1 AND r.estado_registro = 'VIGENTE'
        ORDER BY r.fecha_capacitacion DESC`,
      [String(workerNumber)],
    );

    return rows.map((r) => ({
      recordId: r.registro_id,
      trainingId: r.clave_curso,
      courseName: r.nombre,
      completionDate: String(r.fecha_capacitacion).slice(0, 10),
      provenance: r.procedencia as ProvenanceType,
      ...(r.lote_id ? { sourceBatchId: r.lote_id } : {}),
      recordedAt: new Date(r.creado_en).toISOString(),
      actor: "SISTEMA",
    }));
  }

  async getWorkerScheduledSessions(workerNumber: WorkerNumber): Promise<Record<string, string>> {
    const { rows } = await this.sqlClient.query<{
      clave_curso: string;
      codigo_sesion: string;
    }>(
      `SELECT c.clave_curso, s.codigo_sesion
         FROM operacion.asistencia asi
         JOIN operacion.sesion s ON s.sesion_id = asi.sesion_id
         JOIN catalogo.capacitacion c ON c.capacitacion_id = s.capacitacion_id
         JOIN organizacion.trabajador t ON t.trabajador_id = asi.trabajador_id
        WHERE t.numero_trabajador = $1
          AND asi.liberada = false
          AND s.estado IN ('BORRADOR', 'ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR')
        ORDER BY s.fecha_sesion DESC`,
      [String(workerNumber)],
    );

    const map: Record<string, string> = {};
    for (const r of rows) map[r.clave_curso] ??= r.codigo_sesion;
    return map;
  }

  async getLatestTrainingByWorker(): Promise<ReadonlyMap<string, Record<string, string>>> {
    const { rows } = await this.sqlClient.query<{
      numero_trabajador: string;
      clave_curso: string;
      fecha_capacitacion: string | Date;
    }>(
      `SELECT t.numero_trabajador, c.clave_curso,
              max(r.fecha_capacitacion) AS fecha_capacitacion
         FROM operacion.historial_capacitacion r
         JOIN catalogo.capacitacion c ON c.capacitacion_id = r.capacitacion_id
         JOIN organizacion.trabajador t ON t.trabajador_id = r.trabajador_id
        WHERE r.estado_registro = 'VIGENTE'
        GROUP BY t.numero_trabajador, c.clave_curso`,
    );

    const mapa = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const porCurso = mapa.get(r.numero_trabajador) ?? {};
      porCurso[r.clave_curso] = String(
        r.fecha_capacitacion instanceof Date
          ? r.fecha_capacitacion.toISOString()
          : r.fecha_capacitacion,
      ).slice(0, 10);
      mapa.set(r.numero_trabajador, porCurso);
    }
    return mapa;
  }

  readonly #EVALUACION_DNC = `
    WITH programado AS (
      SELECT DISTINCT asi.trabajador_id, s.capacitacion_id
        FROM operacion.asistencia asi
        JOIN operacion.sesion s ON s.sesion_id = asi.sesion_id
       WHERE asi.liberada = false
         AND s.estado IN ('BORRADOR','ABIERTA','CERRADA','PRELIBERACION','LISTA_PARA_LIBERAR')
    ),
    par AS (
      SELECT DISTINCT ON (cob.trabajador_id, cob.capacitacion_id)
             cob.trabajador_id, cob.capacitacion_id, cob.curso, cob.departamento,
             cob.fecha_cumplida, r.nivel::text AS nivel_regla,
             r.meses_recurrencia, r.dias_gracia
        FROM lectura.cobertura_dnc cob
        JOIN dnc.regla r
          ON r.capacitacion_id = cob.capacitacion_id
         AND r.vigente_hasta IS NULL
         AND ( (r.nivel = 'AREA'       AND r.area_id = cob.area_id)
            OR (r.nivel = 'DEPARTMENT' AND r.departamento_id = cob.departamento_id) )
       WHERE cob.activo
       ORDER BY cob.trabajador_id, cob.capacitacion_id, r.nivel
    ),
    evaluado AS (
      SELECT par.*,
             CASE
               WHEN par.fecha_cumplida IS NOT NULL
                AND (par.fecha_cumplida
                     + make_interval(months => coalesce(par.meses_recurrencia, 12))
                     + make_interval(days   => coalesce(par.dias_gracia, 0)))::date >= current_date
                 THEN 'COMPLETADO'
               WHEN par.fecha_cumplida IS NOT NULL THEN 'REFORZAR'
               WHEN p.trabajador_id IS NOT NULL THEN 'PROGRAMADO'
               ELSE 'PENDIENTE'
             END AS estado
        FROM par
        LEFT JOIN programado p
               ON p.trabajador_id = par.trabajador_id
              AND p.capacitacion_id = par.capacitacion_id
    )`;

  async getDncSummaryByDepartment(): Promise<readonly DepartmentDncSummary[]> {
    const { rows } = await this.sqlClient.query<{
      departamento: string;
      trabajadores_activos: string;
      completados: string;
      reforzar: string;
      pendientes: string;
      programados: string;
      datos_insuficientes: string;
    }>(
      `${this.#EVALUACION_DNC},
       plantilla AS (
         SELECT coalesce(d.nombre, 'SIN_DEPARTAMENTO') AS departamento,
                count(*) AS trabajadores_activos,
                count(*) FILTER (
                  WHERE t.departamento_id IS NULL AND t.area_id IS NULL
                ) AS datos_insuficientes
           FROM organizacion.trabajador t
           LEFT JOIN organizacion.departamento d ON d.departamento_id = t.departamento_id
          WHERE t.activo
          GROUP BY 1
       ),
       conteo AS (
         SELECT departamento,
                count(*) FILTER (WHERE estado = 'COMPLETADO') AS completados,
                count(*) FILTER (WHERE estado = 'REFORZAR')   AS reforzar,
                count(*) FILTER (WHERE estado = 'PENDIENTE')  AS pendientes,
                count(*) FILTER (WHERE estado = 'PROGRAMADO') AS programados
           FROM evaluado
          GROUP BY departamento
       )
       SELECT pl.departamento, pl.trabajadores_activos, pl.datos_insuficientes,
              coalesce(c.completados, 0) AS completados,
              coalesce(c.reforzar, 0)    AS reforzar,
              coalesce(c.pendientes, 0)  AS pendientes,
              coalesce(c.programados, 0) AS programados
         FROM plantilla pl
         LEFT JOIN conteo c ON c.departamento = pl.departamento
        ORDER BY pl.departamento`,
    );

    return rows.map((r) => ({
      departamento: r.departamento,
      trabajadoresActivos: Number(r.trabajadores_activos),
      completados: Number(r.completados),
      reforzar: Number(r.reforzar),
      pendientes: Number(r.pendientes),
      programados: Number(r.programados),
      datosInsuficientes: Number(r.datos_insuficientes),
    }));
  }

  async getDncSummaryByCourse(): Promise<readonly CourseDncSummary[]> {
    const { rows } = await this.sqlClient.query<{
      curso: string;
      clave_curso: string;
      nivel_regla: string;
      aplicables: string;
      completados: string;
      reforzar: string;
      pendientes: string;
      programados: string;
    }>(
      `${this.#EVALUACION_DNC}
       SELECT e.curso, c.clave_curso, e.nivel_regla,
              count(*) AS aplicables,
              count(*) FILTER (WHERE e.estado = 'COMPLETADO') AS completados,
              count(*) FILTER (WHERE e.estado = 'REFORZAR')   AS reforzar,
              count(*) FILTER (WHERE e.estado = 'PENDIENTE')  AS pendientes,
              count(*) FILTER (WHERE e.estado = 'PROGRAMADO') AS programados
         FROM evaluado e
         JOIN catalogo.capacitacion c ON c.capacitacion_id = e.capacitacion_id
        GROUP BY e.curso, c.clave_curso, e.nivel_regla
        ORDER BY e.curso`,
    );

    return rows.map((r) => ({
      curso: r.curso,
      claveCurso: r.clave_curso,
      nivelRegla: r.nivel_regla === "AREA" ? "AREA" : "DEPARTMENT",
      aplicables: Number(r.aplicables),
      completados: Number(r.completados),
      reforzar: Number(r.reforzar),
      pendientes: Number(r.pendientes),
      programados: Number(r.programados),
    }));
  }

  async getAreaCourseCompletion(
    workerNumber: WorkerNumber,
  ): Promise<readonly AreaCourseCompletionRow[]> {
    const { rows } = await this.sqlClient.query<{
      clave_curso: string;
      curso: string;
      aplicables: string;
      completados: string;
    }>(
      `${this.#EVALUACION_DNC}
       SELECT c.clave_curso, e.curso,
              count(*) AS aplicables,
              count(*) FILTER (WHERE e.estado = 'COMPLETADO') AS completados
         FROM evaluado e
         JOIN catalogo.capacitacion c ON c.capacitacion_id = e.capacitacion_id
         JOIN organizacion.trabajador t ON t.trabajador_id = e.trabajador_id
         JOIN organizacion.trabajador yo ON yo.numero_trabajador = $1
        WHERE t.area_id IS NOT DISTINCT FROM yo.area_id
        GROUP BY c.clave_curso, e.curso`,
      [String(workerNumber)],
    );

    return rows.map((r) => ({
      courseKey: r.clave_curso,
      courseName: r.curso,
      applicable: Number(r.aplicables),
      completed: Number(r.completados),
    }));
  }

  async getScheduledSessionsByWorker(): Promise<ReadonlyMap<string, Record<string, string>>> {
    const { rows } = await this.sqlClient.query<{
      numero_trabajador: string;
      clave_curso: string;
      codigo_sesion: string;
    }>(
      `SELECT t.numero_trabajador, c.clave_curso, s.codigo_sesion
         FROM operacion.asistencia asi
         JOIN operacion.sesion s ON s.sesion_id = asi.sesion_id
         JOIN catalogo.capacitacion c ON c.capacitacion_id = s.capacitacion_id
         JOIN organizacion.trabajador t ON t.trabajador_id = asi.trabajador_id
        WHERE asi.liberada = false
          AND s.estado IN ('BORRADOR', 'ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR')
        ORDER BY s.fecha_sesion DESC`,
    );

    const mapa = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const porCurso = mapa.get(r.numero_trabajador) ?? {};
      porCurso[r.clave_curso] ??= r.codigo_sesion;
      mapa.set(r.numero_trabajador, porCurso);
    }
    return mapa;
  }

  async getWorkerDc3Records(workerNumber: WorkerNumber): Promise<readonly Dc3WorkerLogEntry[]> {
    const { rows } = await this.sqlClient.query<{
      clave_curso: string;
      nombre: string;
      folio: string | null;
      estado: string | null;
      emitido_en: string | Date | null;
      codigo_bloqueo: string | null;
      metadatos_aprobados: boolean;
      curp: string | null;
      puesto_id: string | null;
      emitida_en: string | Date | null;
    }>(
      `SELECT DISTINCT ON (c.clave_curso)
              c.clave_curso, c.nombre,
              dc.folio, dc.estado, dc.emitido_en, dc.codigo_bloqueo,
              COALESCE(m.aprobado, false) AS metadatos_aprobados,
              t.curp, t.puesto_id,
              e.ultima AS emitida_en
         FROM organizacion.trabajador t
         JOIN operacion.historial_capacitacion r
           ON r.trabajador_id = t.trabajador_id AND r.estado_registro = 'VIGENTE'
         JOIN catalogo.capacitacion c ON c.capacitacion_id = r.capacitacion_id
         JOIN dc3.curso_configuracion m ON m.capacitacion_id = c.capacitacion_id
         LEFT JOIN dc3.constancia dc
           ON dc.trabajador_id = t.trabajador_id AND dc.capacitacion_id = c.capacitacion_id
         LEFT JOIN (SELECT a.entidad_id, max(a.ocurrido_en) AS ultima
                      FROM sistema.bitacora_auditoria a
                     WHERE a.accion = 'DC3_EMITIDA_INDIVIDUAL'
                       AND a.entidad_tipo = 'CONSTANCIA_DC3'
                       AND split_part(a.entidad_id, ':', 1) = $1
                     GROUP BY a.entidad_id) e
           ON e.entidad_id = t.numero_trabajador || ':' || c.clave_curso
        WHERE t.numero_trabajador = $1
        ORDER BY c.clave_curso`,
      [String(workerNumber)],
    );

    return rows.map((r) => {
      const bloqueos: string[] = [];
      if (!r.metadatos_aprobados) bloqueos.push("METADATOS_DC3_PENDIENTES");
      if (!r.curp) bloqueos.push("CURP_FALTANTE");
      if (!r.puesto_id) bloqueos.push("PUESTO_FALTANTE");
      if (r.codigo_bloqueo) bloqueos.push(r.codigo_bloqueo);

      return {
        courseId: r.clave_curso,
        courseName: r.nombre,
        isEligible: bloqueos.length === 0,
        isIssued: r.estado === "COMPLETADO" || r.emitida_en !== null,
        issuedAt:
          (r.emitido_en ?? r.emitida_en)
            ? new Date(r.emitido_en ?? r.emitida_en ?? "").toISOString().slice(0, 10)
            : null,
        documentFolio: r.folio ?? null,
        blockingReasons: bloqueos,
      };
    });
  }

  async listDepartments(): Promise<readonly string[]> {
    const { rows } = await this.sqlClient.query<{ nombre: string }>(
      `SELECT nombre FROM organizacion.departamento WHERE activo = true ORDER BY nombre ASC`,
    );
    return rows.map((r) => r.nombre);
  }

  async listDncCoverage(filter?: DncCoverageFilter): Promise<readonly DncCoverageRow[]> {
    const params: unknown[] = [];
    const donde: string[] = ["r.activo = true"];
    const agregar = (columna: string, valor?: string) => {
      if (!valor) return;
      params.push(valor);
      donde.push(`${columna} = $${params.length}`);
    };
    agregar("r.planta", filter?.planta);
    agregar("r.area", filter?.area);
    agregar("r.departamento", filter?.departamento);

    if (filter?.curso || filter?.estado) {
      const detalle: string[] = ["d.trabajador_id = r.trabajador_id"];
      if (filter.curso) {
        params.push(filter.curso);
        detalle.push(`d.curso = $${params.length}`);
      }
      if (filter.estado) {
        params.push(filter.estado);
        detalle.push(`d.estado = $${params.length}`);
      }
      donde.push(`EXISTS (SELECT 1 FROM lectura.cobertura_dnc d WHERE ${detalle.join(" AND ")})`);
    }

    const { rows } = await this.sqlClient.query<{
      numero_trabajador: string;
      nombre_completo: string;
      planta: string | null;
      departamento: string;
      area: string;
      cursos_requeridos: number;
      cursos_cubiertos: number;
      cursos_faltantes: number;
      porcentaje: string | null;
    }>(
      `SELECT r.numero_trabajador, r.nombre_completo, r.planta, r.departamento, r.area,
              r.cursos_requeridos, r.cursos_cubiertos, r.cursos_faltantes, r.porcentaje
         FROM lectura.resumen_dnc_trabajador r
        WHERE ${donde.join(" AND ")}
        ORDER BY r.cursos_faltantes DESC, r.numero_trabajador ASC
        LIMIT 2000`,
      params,
    );
    return rows.map((r) => ({
      numeroTrabajador: r.numero_trabajador,
      nombreCompleto: r.nombre_completo,
      planta: r.planta ?? "",
      departamento: r.departamento,
      area: r.area,
      cursosRequeridos: r.cursos_requeridos,
      cursosCubiertos: r.cursos_cubiertos,
      cursosFaltantes: r.cursos_faltantes,
      porcentaje: Number(r.porcentaje ?? 0),
    }));
  }

  async listPlants(): Promise<readonly string[]> {
    const { rows } = await this.sqlClient.query<{ planta: string }>(
      `SELECT DISTINCT planta FROM organizacion.trabajador
        WHERE planta IS NOT NULL AND activo = true ORDER BY planta ASC`,
    );
    return rows.map((r) => r.planta);
  }

  async listDncCourses(): Promise<readonly string[]> {
    const { rows } = await this.sqlClient.query<{ nombre: string }>(
      `SELECT DISTINCT c.nombre
         FROM dnc.regla r
         JOIN catalogo.capacitacion c ON c.capacitacion_id = r.capacitacion_id
        WHERE r.vigente_hasta IS NULL ORDER BY c.nombre ASC`,
    );
    return rows.map((r) => r.nombre);
  }

  async getDncReconciliation(): Promise<DncReconciliation> {
    const { rows } = await this.sqlClient.query<{
      activos: number;
      con_curp: number;
      con_regla: number;
      cubiertos: number;
      faltantes: number;
      candidatos: number;
      ultimo_hc: string | null;
      ultima_induccion: string | null;
    }>(
      `SELECT
         (SELECT count(*) FROM organizacion.trabajador WHERE activo)::int AS activos,
         (SELECT count(*) FROM organizacion.trabajador WHERE activo AND curp IS NOT NULL)::int AS con_curp,
         (SELECT count(*) FROM lectura.resumen_dnc_trabajador WHERE activo)::int AS con_regla,
         (SELECT count(*) FROM lectura.cobertura_dnc WHERE cubierto)::int AS cubiertos,
         (SELECT count(*) FROM lectura.cobertura_dnc WHERE NOT cubierto)::int AS faltantes,
         (SELECT count(*) FROM (
            SELECT h.trabajador_id
              FROM operacion.historial_capacitacion h
              JOIN dc3.curso_configuracion m ON m.capacitacion_id = h.capacitacion_id
             WHERE h.estado_registro = 'VIGENTE'
             GROUP BY h.trabajador_id
            HAVING count(DISTINCT h.capacitacion_id) =
                   (SELECT count(*) FROM dc3.curso_configuracion)) q)::int AS candidatos,
         (SELECT max(fecha_capacitacion)::text FROM operacion.historial_capacitacion) AS ultimo_hc,
         (SELECT max(creado_en)::text FROM operacion.historial_capacitacion
           WHERE procedencia = 'ROSTER_ALTA') AS ultima_induccion`,
    );
    const f = rows[0];
    return {
      trabajadoresActivos: f?.activos ?? 0,
      conCurp: f?.con_curp ?? 0,
      sinCurp: (f?.activos ?? 0) - (f?.con_curp ?? 0),
      conReglaDnc: f?.con_regla ?? 0,
      sinReglaDnc: (f?.activos ?? 0) - (f?.con_regla ?? 0),
      paresCubiertos: f?.cubiertos ?? 0,
      paresFaltantes: f?.faltantes ?? 0,
      candidatosDc3: f?.candidatos ?? 0,
      ultimoRegistroHc: f?.ultimo_hc ?? null,
      ultimaInduccion: f?.ultima_induccion ?? null,
    };
  }

  async listAreas(department?: string): Promise<readonly string[]> {
    let sql = `
      SELECT a.nombre
        FROM organizacion.area a
        JOIN organizacion.departamento d ON d.departamento_id = a.departamento_id
       WHERE a.activo = true`;
    const params: unknown[] = [];
    if (department) {
      params.push(department);
      sql += " AND d.nombre = $1";
    }
    sql += " ORDER BY a.nombre ASC";
    const { rows } = await this.sqlClient.query<{ nombre: string }>(sql, params);
    return rows.map((r) => r.nombre);
  }
}
