import type {
  Dc3AreaCoverage,
  Dc3Candidate,
  Dc3CandidateDetail,
  Dc3CandidateFilter,
  Dc3CandidateOrder,
  Dc3CertificatePort,
  Dc3CourseCoverage,
  Dc3CourseMetadata,
  Dc3DataGaps,
  Dc3EmissionEntry,
  Dc3EmissionFilter,
  Dc3EmissionRecord,
  Dc3EmissionState,
  Dc3EmissionSummary,
  Dc3EmissionTotals,
  Dc3Key,
  Dc3OccupationGap,
  Dc3PlanSummary,
  Dc3PlanTab,
  Dc3WorkerWithoutOccupation,
} from "../../ports/dc3-constancia.port.ts";
import { AREAS_TEMATICAS_STPS, nombreDeAreaTematica } from "../../domain/dc3/areas-tematicas.ts";
import { CORTE_DE_CONSTANCIAS, type PeriodoDc3 } from "../../domain/dc3/corte.ts";
import type { SqlExecutor } from "./matriz.ts";

interface FilaCandidato {
  numero_trabajador: string;
  nombre_completo: string;
  area: string | null;
  departamento: string | null;
  puesto: string | null;
  clave_cno: string | null;
  descripcion_cno: string | null;
  tipo_nomina: string | null;
  clave_curso: string;
  nombre_dc3: string;
  fecha: string | Date | null;
  tiene_curp: boolean;
  curp: string | null;
  duracion_horas: number | null;
  area_tematica_clave: string | null;
  area_tematica_nombre: string | null;
  agente_capacitador: string | null;
  dias_periodo: number | null;
  antes_del_corte: boolean | null;
}

const CANDIDATOS = `
  WITH curso AS (
    SELECT m.capacitacion_id,
           c.clave_curso,
           coalesce(m.nombre_dc3, c.nombre) AS nombre_dc3,
           m.duracion_horas,
           m.area_tematica_clave,
           m.area_tematica_nombre,
           m.agente_capacitador,
           m.regla_fecha,
           m.dias_periodo
      FROM dc3.curso_configuracion m
      JOIN catalogo.capacitacion c ON c.capacitacion_id = m.capacitacion_id
  )
  SELECT t.numero_trabajador,
         t.nombre_completo,
         a.nombre AS area,
         d.nombre AS departamento,
         p.nombre AS puesto,
         -- La clave del trabajador manda sobre la del puesto desde la migración
         -- 0041: la ocupación varía según puesto y área, así que la del puesto
         -- sólo respalda a quien todavía no tiene la suya.
         coalesce(t.clave_ocupacion, p.clave_cno) AS clave_cno,
         coalesce(t.descripcion_ocupacion, p.descripcion_cno) AS descripcion_cno,
         t.tipo_nomina,
         t.curp,
         (t.curp IS NOT NULL AND length(btrim(t.curp)) = 18) AS tiene_curp,
         cu.clave_curso,
         cu.nombre_dc3,
         cu.duracion_horas,
         cu.area_tematica_clave,
         cu.area_tematica_nombre,
         cu.agente_capacitador,
         cu.dias_periodo,
         f.fecha,
         (f.fecha < $1::date) AS antes_del_corte
    FROM organizacion.trabajador t
    CROSS JOIN curso cu
    LEFT JOIN LATERAL (
      SELECT min(h.fecha_capacitacion) FILTER (WHERE h.fecha_capacitacion >= $1::date) AS desde_corte,
             max(h.fecha_capacitacion) FILTER (WHERE h.fecha_capacitacion < $1::date) AS antes_del_corte
        FROM operacion.historial_capacitacion h
       WHERE h.trabajador_id = t.trabajador_id
         AND h.capacitacion_id = cu.capacitacion_id
         AND h.estado_registro = 'VIGENTE'
    ) hc ON cu.regla_fecha <> 'FECHA_ALTA'
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN cu.regla_fecha = 'FECHA_ALTA' THEN t.fecha_alta
               ELSE coalesce(hc.desde_corte, hc.antes_del_corte)
             END AS fecha
    ) f
    LEFT JOIN organizacion.area a ON a.area_id = t.area_id
    LEFT JOIN organizacion.departamento d ON d.departamento_id = t.departamento_id
    LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
   WHERE t.activo`;

const CLAVES_DEL_CATALOGO = Object.keys(AREAS_TEMATICAS_STPS)
  .map((clave) => `'${clave}'`)
  .join(", ");

const COMPLETA = `(b.fecha IS NOT NULL
  AND b.tiene_curp
  AND b.duracion_horas IS NOT NULL
  AND (coalesce(btrim(b.area_tematica_nombre), '') <> ''
       OR btrim(b.area_tematica_clave) IN (${CLAVES_DEL_CATALOGO}))
  AND coalesce(btrim(b.agente_capacitador), '') <> '')`;

const POR_PESTANA: Readonly<Record<Dc3PlanTab, string>> = {
  listos: COMPLETA,
  incompletos: `(b.fecha IS NOT NULL AND NOT ${COMPLETA})`,
  "sin-curso": "(b.fecha IS NULL)",
};

const POR_ORDEN: Readonly<Record<Dc3CandidateOrder, string>> = {
  nombre: "b.nombre_completo, b.nombre_dc3",
  personal: `CASE upper(btrim(coalesce(b.tipo_nomina, '')))
                    WHEN 'NQ' THEN 0
                    WHEN 'NS' THEN 1
                    ELSE 2
                  END,
                  b.numero_trabajador,
                  b.nombre_dc3`,
};

const POR_PERIODO: Readonly<Record<PeriodoDc3, string>> = {
  "desde-corte": "(b.fecha IS NOT NULL AND NOT b.antes_del_corte)",
  anteriores: "(b.fecha IS NOT NULL AND b.antes_del_corte)",
};

const EMITIDAS = `
  FROM sistema.bitacora_auditoria a
 WHERE a.accion = 'DC3_EMITIDA_INDIVIDUAL'
   AND a.entidad_tipo = 'CONSTANCIA_DC3'`;

const CRUCE_DE_EMITIDAS = `
  LEFT JOIN (SELECT a.entidad_id, bool_or(a.estado_nuevo = 'EMITIDA') AS alguna_completa
             ${EMITIDAS}
              GROUP BY a.entidad_id) e
         ON e.entidad_id = b.numero_trabajador || ':' || b.clave_curso`;

const POR_EMISION: Readonly<Record<Dc3EmissionState, string>> = {
  emitidas: "e.entidad_id IS NOT NULL",
  pendientes: "e.entidad_id IS NULL",
  parciales: "(e.entidad_id IS NOT NULL AND NOT e.alguna_completa)",
};

const DIA_DE_PLANTA = "(a.ocurrido_en AT TIME ZONE 'America/Mexico_City')::date";

const SIN_OCUPACION = "coalesce(btrim(coalesce(t.clave_ocupacion, p.clave_cno)), '') = ''";

interface Consulta {
  readonly dentro: string;
  readonly cruce: string;
  readonly fuera: string;
  readonly params: unknown[];
  readonly pestana: string;
  readonly periodo: string;
}

function soloIdentidad(filter: Dc3CandidateFilter): Dc3CandidateFilter {
  const { status: _pestana, emission: _emision, period: _periodo, ...resto } = filter;
  return resto;
}

function aIso(valor: string | Date): string {
  return typeof valor === "string" ? valor : valor.toISOString();
}

export class SupabaseDc3CertificateRepository implements Dc3CertificatePort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async listDc3Courses(): Promise<
    readonly { readonly courseKey: string; readonly courseName: string }[]
  > {
    const { rows } = await this.#db.query<{ clave_curso: string; nombre_dc3: string }>(
      `SELECT c.clave_curso, coalesce(m.nombre_dc3, c.nombre) AS nombre_dc3
         FROM dc3.curso_configuracion m
         JOIN catalogo.capacitacion c ON c.capacitacion_id = m.capacitacion_id
        ORDER BY 2`,
    );
    return rows.map((r) => ({ courseKey: r.clave_curso, courseName: r.nombre_dc3 }));
  }

  #consulta(filter: Dc3CandidateFilter, { facetas = false }: { facetas?: boolean } = {}): Consulta {
    const params: unknown[] = [CORTE_DE_CONSTANCIAS];
    const dentro: string[] = [];
    const fuera: string[] = [];
    const siguiente = (valor: unknown): string => {
      params.push(valor);
      return `$${String(params.length)}`;
    };

    if (filter.courseKey) dentro.push(`cu.clave_curso = ${siguiente(filter.courseKey)}`);
    if (filter.area) dentro.push(`a.nombre = ${siguiente(filter.area)}`);
    if (filter.payrollType) {
      dentro.push(
        `upper(coalesce(t.tipo_nomina, '')) = ${siguiente(filter.payrollType.trim().toUpperCase())}`,
      );
    }
    if (filter.query) {
      const indice = siguiente(`%${filter.query}%`);
      dentro.push(`(t.numero_trabajador ILIKE ${indice} OR t.nombre_completo ILIKE ${indice})`);
    }

    const pestana = filter.status ? POR_PESTANA[filter.status] : "true";
    const periodo = filter.period ? POR_PERIODO[filter.period] : "true";
    if (filter.status && !facetas) fuera.push(pestana);
    if (filter.period && !facetas) fuera.push(`(b.fecha IS NULL OR ${periodo})`);
    if (filter.emission) fuera.push(POR_EMISION[filter.emission]);

    return {
      dentro: dentro.length ? ` AND ${dentro.join(" AND ")}` : "",
      cruce: filter.emission ? CRUCE_DE_EMITIDAS : "",
      fuera: fuera.length ? ` WHERE ${fuera.join(" AND ")}` : "",
      params,
      pestana,
      periodo,
    };
  }

  async listCandidates(
    filter: Dc3CandidateFilter,
    limit: number,
    order: Dc3CandidateOrder = "nombre",
    offset = 0,
  ): Promise<readonly Dc3Candidate[]> {
    const q = this.#consulta(filter);
    const params = [...q.params, limit, Math.max(0, offset)];
    const tope = String(params.length - 1);
    const salto = String(params.length);

    const { rows } = await this.#db.query<FilaCandidato>(
      `SELECT b.* FROM (${CANDIDATOS}${q.dentro}) b${q.cruce}${q.fuera}
        ORDER BY ${POR_ORDEN[order]}
        LIMIT $${tope} OFFSET $${salto}`,
      params,
    );
    return rows.map((r) => this.#aCandidato(r));
  }

  async countCandidates(filter: Dc3CandidateFilter): Promise<number> {
    const q = this.#consulta(filter);
    const { rows } = await this.#db.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM (${CANDIDATOS}${q.dentro}) b${q.cruce}${q.fuera}`,
      q.params,
    );
    return rows[0]?.total ?? 0;
  }

  async countByCourse(
    filter: Dc3CandidateFilter,
  ): Promise<readonly { readonly courseKey: string; readonly total: number }[]> {
    const q = this.#consulta(filter);
    const { rows } = await this.#db.query<{ clave_curso: string; total: number }>(
      `SELECT b.clave_curso, count(*)::int AS total
         FROM (${CANDIDATOS}${q.dentro}) b${q.cruce}${q.fuera}
        GROUP BY b.clave_curso`,
      q.params,
    );
    return rows.map((r) => ({ courseKey: r.clave_curso, total: r.total }));
  }

  async coverage(filter: Dc3CandidateFilter): Promise<readonly Dc3CourseCoverage[]> {
    const q = this.#consulta(soloIdentidad(filter));
    const { rows } = await this.#db.query<FilaDeCobertura>(
      `SELECT b.clave_curso,
              b.nombre_dc3,
              ${cuentasDeCobertura(filter.period)}
         FROM (${CANDIDATOS}${q.dentro}) b${CRUCE_DE_EMITIDAS}
        GROUP BY b.clave_curso, b.nombre_dc3
        ORDER BY b.nombre_dc3`,
      q.params,
    );
    return rows.map(aCobertura);
  }

  async coverageByArea(filter: Dc3CandidateFilter): Promise<readonly Dc3AreaCoverage[]> {
    const q = this.#consulta(soloIdentidad(filter));
    const { rows } = await this.#db.query<FilaDeCobertura & { area: string }>(
      `SELECT coalesce(b.area, '') AS area,
              b.clave_curso,
              b.nombre_dc3,
              ${cuentasDeCobertura(filter.period)}
         FROM (${CANDIDATOS}${q.dentro}) b${CRUCE_DE_EMITIDAS}
        GROUP BY 1, b.clave_curso, b.nombre_dc3
        ORDER BY 1, b.nombre_dc3`,
      q.params,
    );
    return rows.map((r) => ({ ...aCobertura(r), area: r.area }));
  }

  #filtroDeEmisiones(filter: Dc3EmissionFilter): { donde: string; params: unknown[] } {
    const params: unknown[] = [];
    const donde: string[] = [];
    const siguiente = (valor: unknown): string => {
      params.push(valor);
      return `$${String(params.length)}`;
    };

    if (filter.from) donde.push(`${DIA_DE_PLANTA} >= ${siguiente(filter.from)}::date`);
    if (filter.to) donde.push(`${DIA_DE_PLANTA} <= ${siguiente(filter.to)}::date`);
    if (filter.courseKey) {
      donde.push(`split_part(a.entidad_id, ':', 2) = ${siguiente(filter.courseKey)}`);
    }
    if (filter.actor) donde.push(`a.actor = ${siguiente(filter.actor)}`);
    if (filter.outcome) {
      donde.push(
        `a.estado_nuevo = ${siguiente(filter.outcome === "parciales" ? "EMITIDA_PARCIAL" : "EMITIDA")}`,
      );
    }
    if (filter.workerNumber) {
      donde.push(`split_part(a.entidad_id, ':', 1) = ${siguiente(filter.workerNumber)}`);
    }
    if (filter.query) {
      const indice = siguiente(`%${filter.query}%`);
      donde.push(
        `(split_part(a.entidad_id, ':', 1) ILIKE ${indice} OR t.nombre_completo ILIKE ${indice})`,
      );
    }

    return { donde: donde.length ? ` AND ${donde.join(" AND ")}` : "", params };
  }

  async listEmissions(
    filter: Dc3EmissionFilter,
    limit: number,
    offset = 0,
  ): Promise<readonly Dc3EmissionRecord[]> {
    const { donde, params } = this.#filtroDeEmisiones(filter);
    const todos = [...params, limit, Math.max(0, offset)];
    const { rows } = await this.#db.query<{
      ocurrido_en: string | Date;
      actor: string;
      numero_trabajador: string;
      nombre_completo: string | null;
      clave_curso: string;
      nombre_dc3: string | null;
      estado_nuevo: string | null;
    }>(
      `SELECT a.ocurrido_en,
              a.actor,
              split_part(a.entidad_id, ':', 1) AS numero_trabajador,
              t.nombre_completo,
              split_part(a.entidad_id, ':', 2) AS clave_curso,
              coalesce(m.nombre_dc3, c.nombre) AS nombre_dc3,
              a.estado_nuevo
         FROM sistema.bitacora_auditoria a
         LEFT JOIN organizacion.trabajador t
                ON t.numero_trabajador = split_part(a.entidad_id, ':', 1)
         LEFT JOIN catalogo.capacitacion c
                ON c.clave_curso = split_part(a.entidad_id, ':', 2)
         LEFT JOIN dc3.curso_configuracion m ON m.capacitacion_id = c.capacitacion_id
        WHERE a.accion = 'DC3_EMITIDA_INDIVIDUAL'
          AND a.entidad_tipo = 'CONSTANCIA_DC3'${donde}
        ORDER BY a.ocurrido_en DESC, a.secuencia DESC
        LIMIT $${String(todos.length - 1)} OFFSET $${String(todos.length)}`,
      todos,
    );
    return rows.map((r) => ({
      at: aIso(r.ocurrido_en),
      actor: r.actor,
      workerNumber: r.numero_trabajador,
      workerName: r.nombre_completo,
      courseKey: r.clave_curso,
      courseName: r.nombre_dc3,
      partial: (r.estado_nuevo ?? "") === "EMITIDA_PARCIAL",
    }));
  }

  async countEmissions(filter: Dc3EmissionFilter): Promise<number> {
    const { donde, params } = this.#filtroDeEmisiones(filter);
    const { rows } = await this.#db.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM sistema.bitacora_auditoria a
         LEFT JOIN organizacion.trabajador t
                ON t.numero_trabajador = split_part(a.entidad_id, ':', 1)
        WHERE a.accion = 'DC3_EMITIDA_INDIVIDUAL'
          AND a.entidad_tipo = 'CONSTANCIA_DC3'${donde}`,
      params,
    );
    return rows[0]?.total ?? 0;
  }

  async summarizeEmissions(days: {
    readonly today: string;
    readonly week: string;
    readonly month: string;
  }): Promise<Dc3EmissionTotals> {
    const { rows } = await this.#db.query<{
      hoy: number;
      semana: number;
      mes: number;
      total: number;
      parciales: number;
    }>(
      `SELECT count(*) FILTER (WHERE ${DIA_DE_PLANTA} >= $1::date)::int AS hoy,
              count(*) FILTER (WHERE ${DIA_DE_PLANTA} >= $2::date)::int AS semana,
              count(*) FILTER (WHERE ${DIA_DE_PLANTA} >= $3::date)::int AS mes,
              count(*)::int AS total,
              count(*) FILTER (WHERE a.estado_nuevo = 'EMITIDA_PARCIAL')::int AS parciales
        ${EMITIDAS}`,
      [days.today, days.week, days.month],
    );
    const fila = rows[0];
    return {
      today: fila?.hoy ?? 0,
      week: fila?.semana ?? 0,
      month: fila?.mes ?? 0,
      total: fila?.total ?? 0,
      partial: fila?.parciales ?? 0,
    };
  }

  async listEmissionActors(): Promise<readonly string[]> {
    const { rows } = await this.#db.query<{ actor: string }>(
      `SELECT DISTINCT a.actor ${EMITIDAS} ORDER BY a.actor`,
    );
    return rows.map((r) => r.actor);
  }

  async listEmissionSummaries(): Promise<readonly Dc3EmissionSummary[]> {
    const { rows } = await this.#db.query<{
      entidad_id: string;
      veces: number;
      ultima: string | Date;
      ultimo_actor: string;
      ultima_parcial: boolean;
      alguna_completa: boolean;
    }>(
      `SELECT DISTINCT ON (a.entidad_id)
              a.entidad_id,
              count(*) OVER (PARTITION BY a.entidad_id)::int AS veces,
              a.ocurrido_en AS ultima,
              a.actor AS ultimo_actor,
              (a.estado_nuevo = 'EMITIDA_PARCIAL') AS ultima_parcial,
              bool_or(a.estado_nuevo = 'EMITIDA') OVER (PARTITION BY a.entidad_id) AS alguna_completa
        ${EMITIDAS}
        ORDER BY a.entidad_id, a.ocurrido_en DESC, a.secuencia DESC`,
    );
    return rows.map((r) => ({
      key: r.entidad_id,
      count: r.veces,
      lastAt: aIso(r.ultima),
      lastActor: r.ultimo_actor,
      lastPartial: Boolean(r.ultima_parcial),
      anyComplete: Boolean(r.alguna_completa),
    }));
  }

  async summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary> {
    const q = this.#consulta(filter, { facetas: true });
    const enPeriodo = `(b.fecha IS NULL OR ${q.periodo})`;
    const { rows } = await this.#db.query<{
      listos: number;
      incompletos: number;
      sin_fecha: number;
      sin_ocupacion: number;
      desde_corte: number;
      anteriores: number;
    }>(
      `SELECT count(*) FILTER (WHERE ${enPeriodo} AND ${POR_PESTANA.listos})::int AS listos,
              count(*) FILTER (WHERE ${enPeriodo} AND ${POR_PESTANA.incompletos})::int AS incompletos,
              count(*) FILTER (WHERE ${POR_PESTANA["sin-curso"]})::int AS sin_fecha,
              count(*) FILTER (WHERE ${enPeriodo} AND ${q.pestana}
                                 AND b.fecha IS NOT NULL
                                 AND coalesce(btrim(b.clave_cno), '') = '')::int AS sin_ocupacion,
              count(*) FILTER (WHERE ${q.pestana} AND ${POR_PERIODO["desde-corte"]})::int AS desde_corte,
              count(*) FILTER (WHERE ${q.pestana} AND ${POR_PERIODO.anteriores})::int AS anteriores
         FROM (${CANDIDATOS}${q.dentro}) b${q.cruce}${q.fuera}`,
      q.params,
    );
    const fila = rows[0];
    return {
      ready: fila?.listos ?? 0,
      incomplete: fila?.incompletos ?? 0,
      withoutDate: fila?.sin_fecha ?? 0,
      withoutOccupation: fila?.sin_ocupacion ?? 0,
      fromCutoff: fila?.desde_corte ?? 0,
      beforeCutoff: fila?.anteriores ?? 0,
    };
  }

  async findCandidate(workerNumber: string, courseKey: string): Promise<Dc3CandidateDetail | null> {
    const { rows } = await this.#db.query<FilaCandidato>(
      `${CANDIDATOS} AND t.numero_trabajador = $2 AND cu.clave_curso = $3 LIMIT 1`,
      [CORTE_DE_CONSTANCIAS, workerNumber, courseKey],
    );
    const fila = rows[0];
    return fila ? this.#aDetalle(fila) : null;
  }

  async findCandidates(keys: readonly Dc3Key[]): Promise<readonly Dc3CandidateDetail[]> {
    if (keys.length === 0) return [];
    const { rows } = await this.#db.query<FilaCandidato>(
      `${CANDIDATOS}
         AND (t.numero_trabajador, cu.clave_curso) IN
             (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [CORTE_DE_CONSTANCIAS, keys.map((k) => k.workerNumber), keys.map((k) => k.courseKey)],
    );
    return rows.map((fila) => this.#aDetalle(fila));
  }

  async listWorkerCandidates(workerNumber: string): Promise<readonly Dc3CandidateDetail[]> {
    const { rows } = await this.#db.query<FilaCandidato>(
      `${CANDIDATOS} AND t.numero_trabajador = $2 ORDER BY cu.nombre_dc3`,
      [CORTE_DE_CONSTANCIAS, workerNumber],
    );
    return rows.map((fila) => this.#aDetalle(fila));
  }

  async listCourseMetadata(): Promise<readonly Dc3CourseMetadata[]> {
    const { rows } = await this.#db.query<{
      clave_curso: string;
      nombre_dc3: string;
      duracion_horas: number | null;
      duracion_dias: number | null;
      area_tematica_clave: string | null;
      area_tematica_nombre: string | null;
      agente_capacitador: string | null;
      regla_fecha: string;
      dias_periodo: number;
      aprobado: boolean;
    }>(
      `SELECT c.clave_curso,
              coalesce(m.nombre_dc3, c.nombre) AS nombre_dc3,
              m.duracion_horas,
              m.duracion_dias,
              m.area_tematica_clave,
              m.area_tematica_nombre,
              m.agente_capacitador,
              m.regla_fecha::text AS regla_fecha,
              m.dias_periodo,
              m.aprobado
         FROM dc3.curso_configuracion m
         JOIN catalogo.capacitacion c ON c.capacitacion_id = m.capacitacion_id
        ORDER BY 2`,
    );
    return rows.map((r) => ({
      courseKey: r.clave_curso,
      courseName: r.nombre_dc3,
      durationHours: r.duracion_horas === null ? null : Number(r.duracion_horas),
      durationDays: r.duracion_dias === null ? null : Number(r.duracion_dias),
      thematicAreaKey: r.area_tematica_clave,
      thematicAreaName: r.area_tematica_nombre,
      trainingAgent: r.agente_capacitador,
      dateRule: r.regla_fecha,
      periodDays: Number(r.dias_periodo),
      approved: Boolean(r.aprobado),
    }));
  }

  async dataGaps(): Promise<Dc3DataGaps> {
    const { rows } = await this.#db.query<{
      activos: number;
      sin_curp: number;
      sin_ocupacion: number;
      sin_puesto: number;
    }>(
      `SELECT count(*)::int AS activos,
              count(*) FILTER (WHERE t.curp IS NULL OR length(btrim(t.curp)) <> 18)::int AS sin_curp,
              count(*) FILTER (WHERE ${SIN_OCUPACION})::int AS sin_ocupacion,
              count(*) FILTER (WHERE t.puesto_id IS NULL)::int AS sin_puesto
         FROM organizacion.trabajador t
         LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
        WHERE t.activo`,
    );
    const fila = rows[0];
    return {
      activeWorkers: fila?.activos ?? 0,
      withoutCurp: fila?.sin_curp ?? 0,
      withoutOccupation: fila?.sin_ocupacion ?? 0,
      withoutPosition: fila?.sin_puesto ?? 0,
    };
  }

  async listOccupationGaps(limit: number): Promise<readonly Dc3OccupationGap[]> {
    const { rows } = await this.#db.query<{ area: string; puesto: string; cuantos: number }>(
      `SELECT coalesce(a.nombre, '') AS area,
              coalesce(p.nombre, '') AS puesto,
              count(*)::int AS cuantos
         FROM organizacion.trabajador t
         LEFT JOIN organizacion.area a ON a.area_id = t.area_id
         LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
        WHERE t.activo AND ${SIN_OCUPACION}
        GROUP BY 1, 2
        ORDER BY 3 DESC, 1, 2
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ area: r.area, position: r.puesto, workers: r.cuantos }));
  }

  async listWorkersWithoutOccupation(
    limit: number,
  ): Promise<readonly Dc3WorkerWithoutOccupation[]> {
    const { rows } = await this.#db.query<{
      numero_trabajador: string;
      nombre_completo: string;
      area: string | null;
      puesto: string | null;
      tipo_nomina: string | null;
    }>(
      `SELECT t.numero_trabajador, t.nombre_completo, a.nombre AS area, p.nombre AS puesto,
              t.tipo_nomina
         FROM organizacion.trabajador t
         LEFT JOIN organizacion.area a ON a.area_id = t.area_id
         LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
        WHERE t.activo AND ${SIN_OCUPACION}
        ORDER BY a.nombre NULLS LAST, p.nombre NULLS LAST, t.numero_trabajador
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      workerNumber: r.numero_trabajador,
      workerName: r.nombre_completo,
      area: r.area ?? "",
      position: r.puesto ?? "",
      payrollType: r.tipo_nomina,
    }));
  }

  async listRequestEmissionKeys(requestId: string): Promise<readonly string[]> {
    const { rows } = await this.#db.query<{ entidad_id: string }>(
      `SELECT entidad_id
         FROM sistema.bitacora_auditoria
        WHERE accion = 'DC3_EMITIDA_INDIVIDUAL'
          AND (solicitud_id = $1 OR solicitud_id LIKE $1 || '-%')
        ORDER BY secuencia`,
      [requestId],
    );
    return rows.map((r) => r.entidad_id);
  }

  async recordEmission(input: Dc3EmissionEntry): Promise<void> {
    await this.recordEmissions([input]);
  }

  async recordEmissions(inputs: readonly Dc3EmissionEntry[]): Promise<void> {
    if (inputs.length === 0) return;
    await this.#db.query(
      `INSERT INTO sistema.bitacora_auditoria
         (actor, rol, entidad_tipo, entidad_id, accion, estado_nuevo, motivo,
          solicitud_id, procedencia, contrato_version)
       SELECT x.actor, 'CAPACITACION', 'CONSTANCIA_DC3', x.entidad, 'DC3_EMITIDA_INDIVIDUAL',
              x.estado, x.motivo, x.solicitud, 'PLATAFORMA', '1.0.0'
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS x (actor, entidad, estado, motivo, solicitud)`,
      [
        inputs.map((i) => i.actor),
        inputs.map((i) => `${i.workerNumber}:${i.courseKey}`),
        inputs.map((i) => (i.partial ? "EMITIDA_PARCIAL" : "EMITIDA")),
        inputs.map((i) =>
          i.partial
            ? "Emitida con recuadros vacíos: falta algún dato legal por capturar."
            : "Emitida con todos los campos.",
        ),
        inputs.map((i) => i.requestId),
      ],
    );
  }

  #aDetalle(fila: FilaCandidato): Dc3CandidateDetail {
    const claveCno = (fila.clave_cno ?? "").trim();
    const descripcionCno = (fila.descripcion_cno ?? "").trim();

    return {
      ...this.#aCandidato(fila),
      occupation: claveCno && descripcionCno ? `${claveCno} — ${descripcionCno}` : claveCno,
      curp: (fila.curp ?? "").trim(),
      durationHours: fila.duracion_horas === null ? null : Number(fila.duracion_horas),
      thematicAreaKey: fila.area_tematica_clave,
      thematicAreaName: fila.area_tematica_nombre,
      trainingAgent: fila.agente_capacitador,
    };
  }

  #aCandidato(r: FilaCandidato): Dc3Candidate {
    const fecha =
      r.fecha === null
        ? null
        : typeof r.fecha === "string"
          ? r.fecha.slice(0, 10)
          : r.fecha.toISOString().slice(0, 10);

    return {
      workerNumber: r.numero_trabajador,
      workerName: r.nombre_completo,
      area: r.area ?? "",
      department: r.departamento ?? "",
      position: r.puesto ?? "",
      payrollType: r.tipo_nomina,
      courseKey: r.clave_curso,
      courseName: r.nombre_dc3,
      completionDate: fecha,
      periodDays: Number(r.dias_periodo ?? 0),
      beforeCutoff: Boolean(r.antes_del_corte),
      hasCurp: Boolean(r.tiene_curp),
      missing: faltantes(r),
    };
  }
}

interface FilaDeCobertura {
  clave_curso: string;
  nombre_dc3: string;
  total: number;
  listos: number;
  incompletos: number;
  sin_fecha: number;
  emitidas: number;
  por_emitir: number;
  anteriores: number;
}

function cuentasDeCobertura(periodo: PeriodoDc3 | undefined): string {
  const enPeriodo = periodo ? POR_PERIODO[periodo] : "(b.fecha IS NOT NULL)";
  return `count(*)::int AS total,
              count(*) FILTER (WHERE ${enPeriodo} AND ${POR_PESTANA.listos})::int AS listos,
              count(*) FILTER (WHERE ${enPeriodo} AND ${POR_PESTANA.incompletos})::int AS incompletos,
              count(*) FILTER (WHERE ${POR_PESTANA["sin-curso"]})::int AS sin_fecha,
              count(*) FILTER (WHERE e.entidad_id IS NOT NULL
                                 AND (b.fecha IS NULL OR ${enPeriodo}))::int AS emitidas,
              count(*) FILTER (WHERE ${enPeriodo} AND e.entidad_id IS NULL)::int AS por_emitir,
              count(*) FILTER (WHERE ${POR_PERIODO.anteriores})::int AS anteriores`;
}

function aCobertura(r: FilaDeCobertura): Dc3CourseCoverage {
  return {
    courseKey: r.clave_curso,
    courseName: r.nombre_dc3,
    total: r.total,
    ready: r.listos,
    incomplete: r.incompletos,
    withoutDate: r.sin_fecha,
    emitted: r.emitidas,
    pending: r.por_emitir,
    beforeCutoff: r.anteriores,
  };
}

function faltantes(r: FilaCandidato): readonly string[] {
  const vacio = (valor: string | null): boolean => (valor ?? "").trim() === "";
  const falta: string[] = [];
  if (!r.tiene_curp) falta.push("CURP");
  if (vacio(r.clave_cno)) falta.push("ocupación específica");
  if (r.duracion_horas === null) falta.push("duración");
  if (nombreDeAreaTematica(r.area_tematica_clave, r.area_tematica_nombre) === "") {
    falta.push("área temática");
  }
  if (vacio(r.agente_capacitador)) falta.push("agente capacitador");
  return falta;
}
