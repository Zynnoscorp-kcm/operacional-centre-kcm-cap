-- =============================================================================
-- 0036 — Vistas de cobertura DNC
--
-- RECUPERADA DEL HISTORIAL REMOTO (2026-08-06). Aplicada al proyecto Supabase
-- como `20260806075305`; no existía como archivo en el repositorio. Sin ella la
-- ruta `/trabajadores/cobertura` responde con error: las dos vistas que consulta
-- no existirían en una base reconstruida.
-- =============================================================================

-- Cobertura DNC por trabajador: que le toca, que tiene y que le falta.
--
-- Una fila por par (trabajador, curso requerido). El requisito se resuelve por
-- el AREA del trabajador, que es el "C. COSTOS" del padron, subiendo a su
-- departamento cuando la regla se declaro a ese nivel. Ambos niveles conviven a
-- proposito: hoy el TSV solo aporta reglas por departamento, y cuando aparezca
-- una excepcion por area entra sin reestructurar nada.
--
-- La jerarquia se verifico coherente al 100% (1 684 de 1 684 trabajadores con
-- departamento igual al de su area), asi que subir de area a departamento no
-- puede asignar el curso equivocado.
CREATE OR REPLACE VIEW kcm_lectura.cobertura_dnc AS
SELECT t.trabajador_id,
       t.numero_trabajador,
       t.nombre_completo,
       t.planta,
       t.activo,
       d.departamento_id,
       d.nombre        AS departamento,
       a.area_id,
       a.nombre        AS area,
       c.capacitacion_id,
       c.nombre        AS curso,
       r.nivel::text   AS nivel_regla,
       reg.fecha_capacitacion AS fecha_cumplida,
       (reg.registro_id IS NOT NULL) AS cubierto,
       CASE WHEN reg.registro_id IS NOT NULL THEN 'CUBIERTO' ELSE 'FALTANTE' END AS estado
  FROM kcm.trabajador t
  JOIN kcm.area a          ON a.area_id = t.area_id
  JOIN kcm.departamento d  ON d.departamento_id = t.departamento_id
  JOIN kcm.regla_dnc r     ON (r.nivel = 'AREA'       AND r.area_id = t.area_id)
                           OR (r.nivel = 'DEPARTMENT' AND r.departamento_id = t.departamento_id)
  JOIN kcm.capacitacion c  ON c.capacitacion_id = r.capacitacion_id
  -- La fecha mas reciente gana: un curso recurrente cursado dos veces esta
  -- cubierto por la ultima vez, no por la primera.
  LEFT JOIN LATERAL (
        SELECT h.registro_id, h.fecha_capacitacion
          FROM kcm.registro_hc h
         WHERE h.trabajador_id = t.trabajador_id
           AND h.capacitacion_id = r.capacitacion_id
           AND h.estado_registro = 'VIGENTE'
         ORDER BY h.fecha_capacitacion DESC
         LIMIT 1) reg ON TRUE
 WHERE r.vigente_hasta IS NULL;

COMMENT ON VIEW kcm_lectura.cobertura_dnc IS
  'Una fila por trabajador y curso requerido, con estado CUBIERTO o FALTANTE. Base de los filtros por area, planta y estado de curso.';

-- Resumen por trabajador para la lista, que no necesita el detalle por curso.
CREATE OR REPLACE VIEW kcm_lectura.resumen_dnc_trabajador AS
SELECT trabajador_id, numero_trabajador, nombre_completo, planta, activo,
       departamento_id, departamento, area_id, area,
       count(*)                                  AS cursos_requeridos,
       count(*) FILTER (WHERE cubierto)          AS cursos_cubiertos,
       count(*) FILTER (WHERE NOT cubierto)      AS cursos_faltantes,
       round(100.0 * count(*) FILTER (WHERE cubierto) / nullif(count(*), 0), 1) AS porcentaje
  FROM kcm_lectura.cobertura_dnc
 GROUP BY trabajador_id, numero_trabajador, nombre_completo, planta, activo,
          departamento_id, departamento, area_id, area;

GRANT SELECT ON kcm_lectura.cobertura_dnc, kcm_lectura.resumen_dnc_trabajador TO kcm_app;
