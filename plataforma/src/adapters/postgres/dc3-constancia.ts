/**
 * Adaptador PostgreSQL para la emisión individual de constancias DC-3.
 *
 * Todo sale de la base ya conciliada: identidad y CURP de `kcm.trabajador`,
 * metadatos legales de `kcm.metadato_curso_dc3`, y la fecha del curso según la
 * regla que el propio metadato declara —`FECHA_ALTA` para la inducción, la
 * fecha del registro de HC para los demás—. No se vuelve a abrir el XLSB.
 */

import type {
  Dc3Candidate,
  Dc3CandidateDetail,
  Dc3CandidateFilter,
  Dc3CertificatePort,
  Dc3PlanSummary,
  Dc3PlanTab,
} from "../../ports/dc3-constancia.port.ts";
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
}

/**
 * La base del listado y de la ficha es la misma: un producto de trabajadores
 * activos por cursos con obligación DC-3, con la fecha resuelta por la regla del
 * curso. Se escribe una vez y las dos consultas le cuelgan su `WHERE`.
 */
const CANDIDATOS = `
  WITH curso AS (
    SELECT m.capacitacion_id,
           c.clave_curso,
           coalesce(m.nombre_dc3, c.nombre) AS nombre_dc3,
           m.duracion_horas,
           m.area_tematica_clave,
           m.area_tematica_nombre,
           m.agente_capacitador,
           m.regla_fecha
      FROM kcm.metadato_curso_dc3 m
      JOIN kcm.capacitacion c ON c.capacitacion_id = m.capacitacion_id
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
         CASE
           WHEN cu.regla_fecha = 'FECHA_ALTA' THEN t.fecha_alta
           ELSE (SELECT max(h.fecha_capacitacion)
                   FROM kcm.registro_hc h
                  WHERE h.trabajador_id = t.trabajador_id
                    AND h.capacitacion_id = cu.capacitacion_id
                    AND h.estado_registro = 'VIGENTE')
         END AS fecha
    FROM kcm.trabajador t
    CROSS JOIN curso cu
    LEFT JOIN kcm.area a ON a.area_id = t.area_id
    LEFT JOIN kcm.departamento d ON d.departamento_id = t.departamento_id
    LEFT JOIN kcm.puesto p ON p.puesto_id = t.puesto_id
   WHERE t.activo`;

/**
 * Una constancia está lista cuando tiene fecha del curso, CURP y los metadatos
 * legales de su curso.
 *
 * La clave de ocupación no entra en esta cuenta, y no es un descuido: hoy
 * falta para el padrón entero, así que meterla dejaría la pestaña de listos en
 * cero y la de incompletos con todo el mundo, que es tanto como no partir nada.
 * Es un pendiente del padrón, no un defecto de cada persona: se cuenta aparte,
 * se avisa en la pantalla y sigue apareciendo entre los recuadros en blanco de
 * cada renglón.
 *
 * Se escribe en SQL —y no en TypeScript sobre las filas ya traídas— porque las
 * tres pestañas cuentan sobre el padrón entero y traerlo para contarlo sería
 * traer cinco mil renglones por cada cifra.
 */
const COMPLETA = `(b.fecha IS NOT NULL
  AND b.tiene_curp
  AND b.duracion_horas IS NOT NULL
  AND coalesce(btrim(b.area_tematica_nombre), '') <> ''
  AND coalesce(btrim(b.agente_capacitador), '') <> '')`;

const POR_PESTANA: Readonly<Record<Dc3PlanTab, string>> = {
  listos: COMPLETA,
  incompletos: `(b.fecha IS NOT NULL AND NOT ${COMPLETA})`,
  "sin-curso": "(b.fecha IS NULL)",
};

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
         FROM kcm.metadato_curso_dc3 m
         JOIN kcm.capacitacion c ON c.capacitacion_id = m.capacitacion_id
        ORDER BY 2`,
    );
    return rows.map((r) => ({ courseKey: r.clave_curso, courseName: r.nombre_dc3 }));
  }

  /**
   * Traduce los filtros de la pantalla a un `WHERE`. Lo comparten el listado y
   * las cuentas del plan: si se escribieran dos veces, un día contarían cosas
   * distintas de las que enseñan.
   */
  #filtrar(filter: Dc3CandidateFilter): { donde: string; params: unknown[] } {
    const params: unknown[] = [];
    const donde: string[] = [];

    if (filter.courseKey) {
      params.push(filter.courseKey);
      donde.push(`cu.clave_curso = $${String(params.length)}`);
    }
    if (filter.area) {
      params.push(filter.area);
      donde.push(`a.nombre = $${String(params.length)}`);
    }
    if (filter.payrollType) {
      params.push(filter.payrollType.trim().toUpperCase());
      donde.push(`upper(coalesce(t.tipo_nomina, '')) = $${String(params.length)}`);
    }
    if (filter.query) {
      params.push(`%${filter.query}%`);
      const indice = String(params.length);
      donde.push(`(t.numero_trabajador ILIKE $${indice} OR t.nombre_completo ILIKE $${indice})`);
    }

    return { donde: donde.length ? ` AND ${donde.join(" AND ")}` : "", params };
  }

  async listCandidates(
    filter: Dc3CandidateFilter,
    limit: number,
  ): Promise<readonly Dc3Candidate[]> {
    const { donde, params } = this.#filtrar(filter);

    // La fecha del curso y los recuadros vacíos son columnas calculadas, así que
    // no se pueden filtrar en el mismo `WHERE` que las produce: el listado se
    // envuelve para poder pedir una sola pestaña.
    const pestana = filter.status ? ` WHERE ${POR_PESTANA[filter.status]}` : "";

    params.push(limit);
    const { rows } = await this.#db.query<FilaCandidato>(
      `SELECT * FROM (${CANDIDATOS}${donde}) b${pestana}
        ORDER BY b.nombre_completo, b.nombre_dc3
        LIMIT $${String(params.length)}`,
      params,
    );
    return rows.map((r) => this.#aCandidato(r));
  }

  async summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary> {
    const { donde, params } = this.#filtrar(filter);
    const { rows } = await this.#db.query<{
      listos: number;
      incompletos: number;
      sin_fecha: number;
      sin_ocupacion: number;
    }>(
      `SELECT count(*) FILTER (WHERE ${POR_PESTANA.listos})::int AS listos,
              count(*) FILTER (WHERE ${POR_PESTANA.incompletos})::int AS incompletos,
              count(*) FILTER (WHERE ${POR_PESTANA["sin-curso"]})::int AS sin_fecha,
              count(*) FILTER (WHERE b.fecha IS NOT NULL
                                 AND coalesce(btrim(b.clave_cno), '') = '')::int AS sin_ocupacion
         FROM (${CANDIDATOS}${donde}) b`,
      params,
    );
    const fila = rows[0];
    return {
      ready: fila?.listos ?? 0,
      incomplete: fila?.incompletos ?? 0,
      withoutDate: fila?.sin_fecha ?? 0,
      withoutOccupation: fila?.sin_ocupacion ?? 0,
    };
  }

  /**
   * La emisión individual deja su rastro en `kcm.auditoria` con la clave
   * `numeroDeNomina:claveDeCurso`; de ahí sale quién ya tiene la suya.
   */
  async listEmittedKeys(): Promise<readonly string[]> {
    const { rows } = await this.#db.query<{ entidad_id: string }>(
      `SELECT DISTINCT entidad_id
         FROM kcm.auditoria
        WHERE accion = 'DC3_EMITIDA_INDIVIDUAL'
          AND entidad_tipo = 'CONSTANCIA_DC3'`,
    );
    return rows.map((r) => r.entidad_id);
  }

  async findCandidate(workerNumber: string, courseKey: string): Promise<Dc3CandidateDetail | null> {
    const { rows } = await this.#db.query<FilaCandidato>(
      `${CANDIDATOS} AND t.numero_trabajador = $1 AND cu.clave_curso = $2 LIMIT 1`,
      [workerNumber, courseKey],
    );
    const fila = rows[0];
    if (!fila) return null;

    // La ocupación específica del DC-3 es la clave del CNO del puesto, no el
    // nombre del puesto. Se imprime «clave — descripción» cuando el catálogo
    // trae las dos, porque el recuadro es ancho y la clave sola no la lee nadie.
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

  async recordEmission(input: {
    readonly actor: string;
    readonly workerNumber: string;
    readonly courseKey: string;
    readonly requestId: string;
    readonly partial: boolean;
  }): Promise<void> {
    await this.#db.query(
      `INSERT INTO kcm.auditoria
         (actor, rol, entidad_tipo, entidad_id, accion, estado_nuevo, motivo,
          solicitud_id, procedencia, contrato_version)
       VALUES ($1, 'CAPACITACION', 'CONSTANCIA_DC3', $2, 'DC3_EMITIDA_INDIVIDUAL',
               $3, $4, $5, 'PLATAFORMA', '1.0.0')`,
      [
        input.actor,
        `${input.workerNumber}:${input.courseKey}`,
        input.partial ? "EMITIDA_PARCIAL" : "EMITIDA",
        input.partial
          ? "Emitida con recuadros vacíos: falta algún dato legal por capturar."
          : "Emitida con todos los campos.",
        input.requestId,
      ],
    );
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
      hasCurp: Boolean(r.tiene_curp),
      missing: faltantes(r),
    };
  }
}

/**
 * Los recuadros legales que saldrían vacíos en la constancia de esta fila. Son
 * los mismos que el generador marca como obligatorios; se nombran como los lee
 * quien opera la pantalla y no como se llaman las columnas.
 */
function faltantes(r: FilaCandidato): readonly string[] {
  const vacio = (valor: string | null): boolean => (valor ?? "").trim() === "";
  const falta: string[] = [];
  if (!r.tiene_curp) falta.push("CURP");
  if (vacio(r.clave_cno)) falta.push("ocupación específica");
  if (r.duracion_horas === null) falta.push("duración");
  if (vacio(r.area_tematica_nombre)) falta.push("área temática");
  if (vacio(r.agente_capacitador)) falta.push("agente capacitador");
  return falta;
}
