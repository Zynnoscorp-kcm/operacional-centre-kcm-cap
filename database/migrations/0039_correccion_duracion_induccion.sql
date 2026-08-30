-- =============================================================================
-- 0039 — Corrección de la duración de la Inducción a la Empresa
--
-- La migración `0024` fijó 3 horas a partir de una aclaración del 2026-08-03
-- que resultó equivocada: la Inducción son 12 horas repartidas en 3 días.
-- Los 3 días no cambian —siguen explicando el periodo de dos días adicionales
-- a partir del alta— y lo que cambia es lo que imprime la constancia.
--
-- Se corrige en vez de editar `0024` porque una migración aplicada es historia:
-- lo que la constancia decía antes y lo que dice ahora tiene que poder leerse,
-- y el renglón de auditoría deja el dato anterior por escrito.
-- =============================================================================

UPDATE kcm.metadato_curso_dc3 m
   SET duracion_horas = 12,
       duracion_dias  = 3
  FROM kcm.capacitacion c
 WHERE c.capacitacion_id = m.capacitacion_id
   AND c.clave_curso = 'INDUCCION_EMPRESA';

INSERT INTO kcm.auditoria (actor, rol, entidad_tipo, entidad_id, accion, estado_anterior, estado_nuevo, motivo, procedencia)
VALUES (
  'sistema.configuracion', 'ADMINISTRADOR', 'METADATO_DC3', 'INDUCCION_EMPRESA',
  'DURACION_CAPTURADA', 'duracion_horas=3', 'duracion_horas=12',
  'El departamento corrigió la duración: la Inducción son 12 horas repartidas en tres días, no 3.',
  'DEPARTAMENTO'
);
