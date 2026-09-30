import type { CotejoCrudo, SincroniaPort } from "../../ports/sincronia.port.ts";
import type { SqlExecutor } from "./matriz.ts";

const NORMALIZA = (columna: string): string =>
  `nullif(upper(translate(btrim(regexp_replace(${columna}, '\\s+', ' ', 'g')),
     'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '')`;

const CAMPOS = `(VALUES
  (1, 'nombre',       (par.m)."displayName", (par.p).nombre_completo, true),
  (2, 'fechaAlta',    (par.m)."hireDate",    (par.p).fecha_alta,      false),
  (3, 'tipoNomina',   (par.m)."payrollType", (par.p).tipo_nomina,     false),
  (4, 'puesto',       (par.m).position,      (par.p).puesto,          false),
  (5, 'area',         (par.m).area,          (par.p).area,            false),
  (6, 'departamento', (par.m).department,    (par.p).departamento,    false),
  (7, 'planta',       (par.m).plant,         (par.p).planta,          false)
) AS v(orden, campo, en_matriz, en_padron, personal)`;

const COTEJO = `
WITH ultimo AS (
  SELECT s.contenido AS snapshot,
         l.nombre_archivo_fuente AS archivo,
         l.nombre_hoja_fuente    AS hoja,
         l.sha256_fuente         AS sha256,
         l.extraido_en,
         l.estado
    FROM matriz.importacion_contenido s
    JOIN matriz.importacion l ON l.importacion_id = s.importacion_id
   ORDER BY l.extraido_en DESC
   LIMIT 1
), matriz AS (
  SELECT e.*
    FROM ultimo,
         jsonb_to_recordset(ultimo.snapshot -> 'employees') AS e(
           "employeeId" text, "displayName" text, "hireDate" text, "payrollType" text,
           position text, department text, area text, plant text)
), padron AS (
  SELECT t.numero_trabajador,
         t.nombre_completo,
         t.fecha_alta::text AS fecha_alta,
         t.tipo_nomina,
         t.planta,
         p.nombre AS puesto,
         a.nombre AS area,
         d.nombre AS departamento
    FROM organizacion.trabajador t
    LEFT JOIN organizacion.puesto p       ON p.puesto_id = t.puesto_id
    LEFT JOIN organizacion.area a         ON a.area_id = t.area_id
    LEFT JOIN organizacion.departamento d ON d.departamento_id = t.departamento_id
), par AS (
  SELECT coalesce(m."employeeId", p.numero_trabajador) AS numero,
         m."employeeId" IS NOT NULL      AS en_matriz,
         p.numero_trabajador IS NOT NULL AS en_padron,
         m, p
    FROM matriz m
    FULL OUTER JOIN padron p ON p.numero_trabajador = m."employeeId"
), campo AS (
  SELECT par.numero, v.orden, v.campo, v.personal,
         v.en_matriz AS valor_matriz, v.en_padron AS valor_padron
    FROM par
    CROSS JOIN LATERAL ${CAMPOS}
   WHERE par.en_matriz AND par.en_padron
), clasificado AS (
  SELECT c.*,
         CASE
           WHEN c.valor_matriz IS NOT DISTINCT FROM c.valor_padron THEN 'IGUAL'
           WHEN ${NORMALIZA("c.valor_matriz")} IS NOT DISTINCT FROM ${NORMALIZA("c.valor_padron")}
             THEN 'EQUIVALENTE'
           WHEN ${NORMALIZA("c.valor_matriz")} IS NULL THEN 'SOLO_PADRON'
           WHEN ${NORMALIZA("c.valor_padron")} IS NULL THEN 'SOLO_MATRIZ'
           ELSE 'DISCREPANTE'
         END AS clase
    FROM campo c
), muestra AS (
  SELECT campo, numero, clase, personal, valor_matriz, valor_padron,
         row_number() OVER (PARTITION BY campo ORDER BY numero) AS n
    FROM clasificado
   WHERE clase <> 'IGUAL'
)
SELECT jsonb_build_object(
  'fuente', (SELECT jsonb_build_object(
       'archivo', archivo, 'hoja', hoja, 'sha256', sha256,
       'extraidoEn', extraido_en, 'estado', estado,
       'empleados', jsonb_array_length(snapshot -> 'employees')) FROM ultimo),
  'universo', jsonb_build_object(
      'enMatriz',   (SELECT count(*) FROM par WHERE en_matriz),
      'enPadron',   (SELECT count(*) FROM par WHERE en_padron),
      'enAmbos',    (SELECT count(*) FROM par WHERE en_matriz AND en_padron),
      'soloMatriz', (SELECT count(*) FROM par WHERE en_matriz AND NOT en_padron),
      'soloPadron', (SELECT count(*) FROM par WHERE en_padron AND NOT en_matriz),
      'muestraSoloMatriz', (SELECT coalesce(jsonb_agg(numero ORDER BY numero), '[]'::jsonb)
                              FROM (SELECT numero FROM par WHERE en_matriz AND NOT en_padron
                                     ORDER BY numero LIMIT $1) sm),
      'muestraSoloPadron', (SELECT coalesce(jsonb_agg(numero ORDER BY numero), '[]'::jsonb)
                              FROM (SELECT numero FROM par WHERE en_padron AND NOT en_matriz
                                     ORDER BY numero LIMIT $1) sp)),
  'campos', (SELECT coalesce(jsonb_agg(f ORDER BY f ->> 'orden'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'orden', orden, 'campo', campo,
        'iguales',      count(*) FILTER (WHERE clase = 'IGUAL'),
        'equivalentes', count(*) FILTER (WHERE clase = 'EQUIVALENTE'),
        'discrepantes', count(*) FILTER (WHERE clase = 'DISCREPANTE'),
        'soloMatriz',   count(*) FILTER (WHERE clase = 'SOLO_MATRIZ'),
        'soloPadron',   count(*) FILTER (WHERE clase = 'SOLO_PADRON')) AS f
        FROM clasificado GROUP BY orden, campo) g),
  'muestras', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'campo', campo, 'numeroTrabajador', numero, 'clase', clase,
        'enMatriz', CASE WHEN personal THEN NULL ELSE valor_matriz END,
        'enPadron', CASE WHEN personal THEN NULL ELSE valor_padron END)
        ORDER BY campo, numero), '[]'::jsonb)
     FROM muestra WHERE n <= $1)
) AS informe;`;

export class SupabaseSincroniaRepository implements SincroniaPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async cotejar(muestra: number): Promise<CotejoCrudo | null> {
    const { rows } = await this.#db.query<{ informe: CotejoCrudo | null }>(COTEJO, [muestra]);
    const informe = rows[0]?.informe ?? null;
    return informe?.fuente ? informe : null;
  }
}
