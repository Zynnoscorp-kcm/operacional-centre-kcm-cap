/**
 * El cotejo matriz-padrón, resuelto dentro de PostgreSQL.
 *
 * Una sola consulta y un solo viaje. Los dos lados que se comparan ya están en
 * la base —el `HC_SNAPSHOT_V1` del último lote y `organizacion.trabajador` con sus
 * catálogos—, así que traerlos a Node para compararlos aquí costaría el snapshot
 * entero, unos 190 kB, más mil setecientas filas, cada vez que alguien abre la
 * pestaña. Lo que cruza el cable es el informe: un kilobyte largo.
 *
 * ── Las tres decisiones de la consulta ─────────────────────────────────────
 *
 * 1. **`FULL OUTER JOIN` y no dos consultas.** El universo se resuelve en el
 *    mismo paso que los campos, y así «quién falta de cada lado» y «en qué no
 *    coinciden los que están en los dos» salen de la misma foto. Con dos
 *    consultas podrían verse estados distintos si alguien carga en medio.
 *
 * 2. **Los siete campos se despliegan a lo largo con `VALUES`.** La alternativa
 *    —siete bloques de conteo, uno por campo— repetiría la clasificación siete
 *    veces y garantizaría que con el tiempo alguno se quedara atrás. Así la
 *    regla se escribe una vez y se aplica a todos.
 *
 * 3. **La normalización va con `translate` y no con `unaccent`.** La extensión
 *    no está instalada en el proyecto y pedirla obligaría a una migración para
 *    una comparación de pantalla. Las trece letras acentuadas del español caben
 *    en un `translate`, que además no depende de la configuración regional.
 *    Consecuencia asumida: `MUÑOZ` y `MUNOZ` se declaran equivalentes. Entre un
 *    XLSB y una columna `text` esa diferencia es casi siempre una pérdida de
 *    codificación y no dos apellidos distintos, y de todos modos el informe la
 *    enseña como equivalente y no como idéntica.
 */

import type { CotejoCrudo, SincroniaPort } from "../../ports/sincronia.port.ts";
import type { SqlExecutor } from "./matriz.ts";

/**
 * La expresión que decide si dos textos son el mismo dato escrito distinto.
 *
 * Colapsa espacios, recorta orillas, sube a mayúsculas y quita acentos; la
 * cadena vacía se vuelve nula para que «sin dato» y «espacio en blanco» no sean
 * dos cosas. Se declara una vez y se aplica a los dos lados.
 */
const NORMALIZA = (columna: string): string =>
  `nullif(upper(translate(btrim(regexp_replace(${columna}, '\\s+', ' ', 'g')),
     'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '')`;

/**
 * Los siete campos, con el nombre que llevan en cada lado y si identifican a una
 * persona. El último valor es lo que enmascara el nombre completo: sale en nulo
 * de la base y por tanto nunca llega a la pantalla.
 */
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
    // `fuente` en nulo es el caso de «no hay snapshot guardado»: el `WITH
    // ultimo` no devolvió fila y los conteos salen todos en cero. Se distingue
    // aquí y no en la pantalla, porque un informe de ceros y un informe
    // imposible se dibujan distinto.
    const informe = rows[0]?.informe ?? null;
    return informe?.fuente ? informe : null;
  }
}
