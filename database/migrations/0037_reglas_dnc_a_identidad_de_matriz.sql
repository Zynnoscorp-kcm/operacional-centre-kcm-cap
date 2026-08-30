-- =============================================================================
-- 0037 — Reglas DNC reapuntadas a la identidad de la matriz
--
-- RECUPERADA DEL HISTORIAL REMOTO (2026-08-06). Aplicada al proyecto Supabase
-- como `20260806080331`; no existía como archivo en el repositorio.
--
-- ADVERTENCIA: es una reparación de datos, no un cambio de esquema. Los UUID
-- de abajo son los de la base piloto y no existen en una base reconstruida desde
-- cero, donde las identidades se generan de nuevo. Reaplicarla allí no rompe
-- nada, pero tampoco corrige nada: los `UPDATE` no encuentran fila. El bloque
-- final lo dice en voz alta en lugar de dejarlo pasar en silencio, porque el
-- síntoma —cobertura DNC reportando pendientes falsos de planta entera— no se
-- parece a su causa.
-- =============================================================================

-- 42 de las 128 reglas DNC apuntaban a identidades sin un solo registro, y por
-- eso el tablero reportaba como pendiente a toda la planta en dos cursos:
--
--   QMS  regla en 269cb2c8 (0 registros) | matriz en cffa699f (452)
--   BPM  regla en 31b941c3 (0 registros) | matriz en fc5ae9e4 como
--        'BUENAS PRACTICAS DE MANUFACTURA' (columna Y)
--
-- El segundo es exactamente el alias anticipado: BPM
-- contra su nombre desarrollado, cuya omision reportaria todos los BPM como
-- pendientes falsos. La regla se reapunta a la identidad que carga las fechas,
-- que es la de la matriz, y el nombre corto queda como alias aprobado.
UPDATE kcm.regla_dnc
   SET capacitacion_id = 'cffa699f-5c0a-44dd-941a-282084a48b48'
 WHERE capacitacion_id = '269cb2c8-e381-46a6-a2f2-beb66bc35c7a';

UPDATE kcm.regla_dnc
   SET capacitacion_id = 'fc5ae9e4-9cf2-478a-a024-3080737aec00'
 WHERE capacitacion_id = '31b941c3-a1de-40c8-b5db-7de265e9355f';

INSERT INTO kcm.alias_capacitacion
  (capacitacion_id, alias, alias_normalizado, origen_fuente, aprobado_por, aprobado_en, notas)
SELECT 'fc5ae9e4-9cf2-478a-a024-3080737aec00'::uuid,
       'BPM', 'BPM', 'TSV_DNC'::kcm.origen_fuente,
       (SELECT actor_id FROM kcm.actor WHERE activo ORDER BY creado_en LIMIT 1),
       now(),
       'BPM es el nombre corto de BUENAS PRACTICAS DE MANUFACTURA en el TSV de DNC. Sin este alias, los 21 departamentos con la regla reportan pendientes falsos.'
 WHERE NOT EXISTS (SELECT 1 FROM kcm.alias_capacitacion WHERE alias = 'BPM');

-- Aviso, no aserción: en una base reconstruida el reapuntamiento legítimamente
-- no aplica, y fallar cerrado aquí bloquearía un reset correcto.
DO $$
DECLARE
  v_destinos integer;
BEGIN
  SELECT count(*) INTO v_destinos
    FROM kcm.capacitacion
   WHERE capacitacion_id IN ('cffa699f-5c0a-44dd-941a-282084a48b48'::uuid,
                             'fc5ae9e4-9cf2-478a-a024-3080737aec00'::uuid);
  IF v_destinos < 2 THEN
    RAISE WARNING 'Migracion 0037 sin efecto: las identidades de destino no existen en esta base. '
      'Es una reparacion ligada al piloto 2026-08-03. En una base reconstruida hay que rehacer el '
      'reapuntamiento de QMS y BPM contra los UUID nuevos y volver a declarar el alias BPM, o la '
      'cobertura DNC volvera a reportar pendientes falsos de planta entera.';
  END IF;
END;
$$;
