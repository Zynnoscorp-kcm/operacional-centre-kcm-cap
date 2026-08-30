/**
 * Adaptador PostgreSQL para el Sistema General por Trabajador (Función 8).
 *
 * Tablas que consume:
 * - `kcm.trabajador`, `kcm.departamento`, `kcm.area`, `kcm.puesto`
 * - `kcm.atributo_declarado` (escolaridad declarada, con su procedencia)
 * - `kcm.registro_hc` y `kcm.capacitacion` (trayectoria acreditada)
 * - `kcm.sesion` y `kcm.asistencia` (cursos ya programados)
 * - `kcm.documento_dc3` y `kcm.metadato_curso_dc3` (constancias y sus bloqueos)
 */

import { parseWorkerNumber, type WorkerNumber } from "../../domain/numero-trabajador.ts";
import type {
  WorkerSystemRepositoryPort,
  WorkerFilter,
  DncCoverageFilter,
  DncCoverageRow,
  DncReconciliation,
  DepartmentDncSummary,
  CourseDncSummary,
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

/**
 * La ficha laboral se arma con los mismos `JOIN` en todas las consultas. La
 * escolaridad sólo se toma de su atributo vigente; una cerrada describe el
 * pasado y no debe aparecer como el valor actual.
 */
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
  FROM kcm.trabajador t
  LEFT JOIN kcm.departamento d ON d.departamento_id = t.departamento_id
  LEFT JOIN kcm.area a ON a.area_id = t.area_id
  LEFT JOIN kcm.puesto p ON p.puesto_id = t.puesto_id
  LEFT JOIN kcm.atributo_declarado esc
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

  /**
   * Trayectoria acreditada: la réplica consultable de la matriz. Sólo cuenta el
   * registro vigente; un retirado dejó de ser un hecho del trabajador.
   */
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
         FROM kcm.registro_hc r
         JOIN kcm.capacitacion c ON c.capacitacion_id = r.capacitacion_id
         JOIN kcm.trabajador t ON t.trabajador_id = r.trabajador_id
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

  /**
   * Cursos ya programados: sesiones abiertas donde el trabajador tiene
   * asistencia y todavía no se libera. Sirve para que la pantalla distinga
   * `PROGRAMADO` de `PENDIENTE`.
   */
  async getWorkerScheduledSessions(workerNumber: WorkerNumber): Promise<Record<string, string>> {
    const { rows } = await this.sqlClient.query<{
      clave_curso: string;
      codigo_sesion: string;
    }>(
      `SELECT c.clave_curso, s.codigo_sesion
         FROM kcm.asistencia asi
         JOIN kcm.sesion s ON s.sesion_id = asi.sesion_id
         JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
         JOIN kcm.trabajador t ON t.trabajador_id = asi.trabajador_id
        WHERE t.numero_trabajador = $1
          AND asi.liberada = false
          AND s.estado IN ('BORRADOR', 'ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR')
        ORDER BY s.fecha_sesion DESC`,
      [String(workerNumber)],
    );

    const map: Record<string, string> = {};
    // La primera fila de cada curso gana: viene de la sesión más reciente.
    for (const r of rows) map[r.clave_curso] ??= r.codigo_sesion;
    return map;
  }

  /**
   * Última fecha por trabajador y curso, para toda la planta en una consulta.
   * El `max` lo resuelve la base: traer las decenas de miles de filas del
   * historial para quedarse con una por par sería mover el problema de sitio.
   */
  async getLatestTrainingByWorker(): Promise<ReadonlyMap<string, Record<string, string>>> {
    const { rows } = await this.sqlClient.query<{
      numero_trabajador: string;
      clave_curso: string;
      fecha_capacitacion: string | Date;
    }>(
      `SELECT t.numero_trabajador, c.clave_curso,
              max(r.fecha_capacitacion) AS fecha_capacitacion
         FROM kcm.registro_hc r
         JOIN kcm.capacitacion c ON c.capacitacion_id = r.capacitacion_id
         JOIN kcm.trabajador t ON t.trabajador_id = r.trabajador_id
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

  /**
   * Resumen DNC por departamento y por curso, sumado por la base.
   *
   * `kcm_lectura.cobertura_dnc` ya resuelve a quién le toca cada curso y con
   * qué fecha lo cumplió; lo que falta para llegar a los cinco estados del motor
   * es la vigencia, que vive en `kcm.regla_dnc`. Se vuelve a unir contra la
   * regla porque la vista no publica `meses_recurrencia`, y se toma una sola
   * regla por par con `DISTINCT ON`: si un curso estuviera declarado a la vez
   * por área y por departamento, gana el área —la más específica—, que es lo que
   * hace el registro de reglas en JavaScript.
   */
  readonly #EVALUACION_DNC = `
    WITH programado AS (
      SELECT DISTINCT asi.trabajador_id, s.capacitacion_id
        FROM kcm.asistencia asi
        JOIN kcm.sesion s ON s.sesion_id = asi.sesion_id
       WHERE asi.liberada = false
         AND s.estado IN ('BORRADOR','ABIERTA','CERRADA','PRELIBERACION','LISTA_PARA_LIBERAR')
    ),
    par AS (
      SELECT DISTINCT ON (cob.trabajador_id, cob.capacitacion_id)
             cob.trabajador_id, cob.capacitacion_id, cob.curso, cob.departamento,
             cob.fecha_cumplida, r.nivel::text AS nivel_regla,
             r.meses_recurrencia, r.dias_gracia
        FROM kcm_lectura.cobertura_dnc cob
        JOIN kcm.regla_dnc r
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
           FROM kcm.trabajador t
           LEFT JOIN kcm.departamento d ON d.departamento_id = t.departamento_id
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
         JOIN kcm.capacitacion c ON c.capacitacion_id = e.capacitacion_id
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

  /** Sesiones pendientes de liberar por trabajador y curso, en una consulta. */
  async getScheduledSessionsByWorker(): Promise<ReadonlyMap<string, Record<string, string>>> {
    const { rows } = await this.sqlClient.query<{
      numero_trabajador: string;
      clave_curso: string;
      codigo_sesion: string;
    }>(
      `SELECT t.numero_trabajador, c.clave_curso, s.codigo_sesion
         FROM kcm.asistencia asi
         JOIN kcm.sesion s ON s.sesion_id = asi.sesion_id
         JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
         JOIN kcm.trabajador t ON t.trabajador_id = asi.trabajador_id
        WHERE asi.liberada = false
          AND s.estado IN ('BORRADOR', 'ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR')
        ORDER BY s.fecha_sesion DESC`,
    );

    const mapa = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const porCurso = mapa.get(r.numero_trabajador) ?? {};
      // La primera fila de cada curso gana: viene de la sesión más reciente.
      porCurso[r.clave_curso] ??= r.codigo_sesion;
      mapa.set(r.numero_trabajador, porCurso);
    }
    return mapa;
  }

  /**
   * Constancias DC-3. Un curso es elegible cuando sus metadatos legales están
   * aprobados; mientras no lo estén, el motivo del bloqueo se nombra en vez de
   * dejar la fila muda.
   */
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
    }>(
      `SELECT c.clave_curso, c.nombre,
              dc.folio, dc.estado, dc.emitido_en, dc.codigo_bloqueo,
              COALESCE(m.aprobado, false) AS metadatos_aprobados,
              t.curp, t.puesto_id
         FROM kcm.trabajador t
         JOIN kcm.registro_hc r
           ON r.trabajador_id = t.trabajador_id AND r.estado_registro = 'VIGENTE'
         JOIN kcm.capacitacion c ON c.capacitacion_id = r.capacitacion_id
         JOIN kcm.metadato_curso_dc3 m ON m.capacitacion_id = c.capacitacion_id
         LEFT JOIN kcm.documento_dc3 dc
           ON dc.trabajador_id = t.trabajador_id AND dc.capacitacion_id = c.capacitacion_id
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
        isIssued: r.estado === "COMPLETADO",
        issuedAt: r.emitido_en ? new Date(r.emitido_en).toISOString().slice(0, 10) : null,
        documentFolio: r.folio ?? null,
        blockingReasons: bloqueos,
      };
    });
  }

  async listDepartments(): Promise<readonly string[]> {
    const { rows } = await this.sqlClient.query<{ nombre: string }>(
      `SELECT nombre FROM kcm.departamento WHERE activo = true ORDER BY nombre ASC`,
    );
    return rows.map((r) => r.nombre);
  }

  /**
   * Tablero DNC. Se apoya en `kcm_lectura.resumen_dnc_trabajador`, que ya
   * resuelve la regla por área subiendo al departamento; filtrar por curso o
   * por estado obliga a bajar al detalle, porque «trabajadores a los que les
   * falta BPM» no se contesta con el resumen.
   */
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
      donde.push(
        `EXISTS (SELECT 1 FROM kcm_lectura.cobertura_dnc d WHERE ${detalle.join(" AND ")})`,
      );
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
         FROM kcm_lectura.resumen_dnc_trabajador r
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
      `SELECT DISTINCT planta FROM kcm.trabajador
        WHERE planta IS NOT NULL AND activo = true ORDER BY planta ASC`,
    );
    return rows.map((r) => r.planta);
  }

  async listDncCourses(): Promise<readonly string[]> {
    const { rows } = await this.sqlClient.query<{ nombre: string }>(
      `SELECT DISTINCT c.nombre
         FROM kcm.regla_dnc r
         JOIN kcm.capacitacion c ON c.capacitacion_id = r.capacitacion_id
        WHERE r.vigente_hasta IS NULL ORDER BY c.nombre ASC`,
    );
    return rows.map((r) => r.nombre);
  }

  /**
   * Una sola consulta con subconsultas escalares. Podrían ser nueve viajes y no
   * lo son: este tablero se mira después de cada carga y multiplicarlo por
   * nueve es exactamente el gasto que la base no tiene presupuestado.
   */
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
         (SELECT count(*) FROM kcm.trabajador WHERE activo)::int AS activos,
         (SELECT count(*) FROM kcm.trabajador WHERE activo AND curp IS NOT NULL)::int AS con_curp,
         (SELECT count(*) FROM kcm_lectura.resumen_dnc_trabajador WHERE activo)::int AS con_regla,
         (SELECT count(*) FROM kcm_lectura.cobertura_dnc WHERE cubierto)::int AS cubiertos,
         (SELECT count(*) FROM kcm_lectura.cobertura_dnc WHERE NOT cubierto)::int AS faltantes,
         (SELECT count(*) FROM (
            SELECT h.trabajador_id
              FROM kcm.registro_hc h
              JOIN kcm.metadato_curso_dc3 m ON m.capacitacion_id = h.capacitacion_id
             WHERE h.estado_registro = 'VIGENTE'
             GROUP BY h.trabajador_id
            HAVING count(DISTINCT h.capacitacion_id) =
                   (SELECT count(*) FROM kcm.metadato_curso_dc3)) q)::int AS candidatos,
         (SELECT max(fecha_capacitacion)::text FROM kcm.registro_hc) AS ultimo_hc,
         (SELECT max(creado_en)::text FROM kcm.registro_hc
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
        FROM kcm.area a
        JOIN kcm.departamento d ON d.departamento_id = a.departamento_id
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
