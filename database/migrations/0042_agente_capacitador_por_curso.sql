-- =============================================================================
-- 0042 — Agente capacitador de los tres cursos con obligación DC-3
--
-- `0021` dejó `kcm.metadato_curso_dc3.agente_capacitador` nulo porque nadie lo
-- había declarado, y era el último recuadro que salía en blanco en el formato.
-- Capacitación lo entregó el 2026-08-23.
--
-- El orden del nombre es nombre, apellido paterno, apellido materno, que es
-- como lo pidió el departamento y como se lee en el recuadro impreso. La fuente
-- venía al revés —«JUAREZ VILLA MARICELA», «MARTINEZ,CARRANCO,DIMAS ALFREDO»—;
-- aquí se guarda ya volteado para que nadie tenga que recordar la regla al
-- leerlo.
--
-- Se empata por `clave_curso` y no por identificador: el identificador se genera
-- en cada base y la clave es la misma en todas.
-- =============================================================================

UPDATE kcm.metadato_curso_dc3 m
   SET agente_capacitador = v.agente,
       actualizado_en     = now()
  FROM (VALUES
          ('INDUCCION_EMPRESA',                                   'MARICELA JUAREZ VILLA'),
          ('B53030_QMS',                                          'DIMAS ALFREDO MARTINEZ CARRANCO'),
          ('2026_SISTEMAS_DE_PROTECCION_Y_DISPOSITIVOS_DE_SEGURIDAD_EN_L',
                                                                  'ALEJANDRA LOPEZ LOPEZ')
       ) AS v (clave_curso, agente)
  JOIN kcm.capacitacion c ON c.clave_curso = v.clave_curso
 WHERE c.capacitacion_id = m.capacitacion_id
   AND m.agente_capacitador IS DISTINCT FROM v.agente;

DO $$
DECLARE
  v_sin_agente integer;
BEGIN
  SELECT count(*) INTO v_sin_agente
    FROM kcm.metadato_curso_dc3
   WHERE agente_capacitador IS NULL;
  IF v_sin_agente > 0 THEN
    RAISE WARNING 'Quedan % cursos DC-3 sin agente capacitador declarado.', v_sin_agente;
  END IF;
END;
$$;
