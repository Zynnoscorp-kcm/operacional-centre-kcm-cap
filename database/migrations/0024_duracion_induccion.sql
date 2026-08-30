-- =============================================================================
-- 0024 — Duración de la Inducción a la Empresa
--
-- Aclaración del departamento (2026-08-03): los "3 días" son tres sesiones de
-- una hora, una por día. La constancia imprime 3 horas; los 3 días quedan como
-- referencia operativa y explican el periodo de ejecución de 2 días adicionales
-- a partir del alta del trabajador.
-- =============================================================================

UPDATE kcm.metadato_curso_dc3 m
   SET duracion_horas = 3,
       duracion_dias  = 3
  FROM kcm.capacitacion c
 WHERE c.capacitacion_id = m.capacitacion_id
   AND c.clave_curso = 'INDUCCION_EMPRESA';

INSERT INTO kcm.auditoria (actor, rol, entidad_tipo, entidad_id, accion, estado_anterior, estado_nuevo, motivo, procedencia)
VALUES (
  'sistema.configuracion', 'ADMINISTRADOR', 'METADATO_DC3', 'INDUCCION_EMPRESA',
  'DURACION_CAPTURADA', 'duracion_horas=NULL', 'duracion_horas=3',
  'El departamento aclaró que la Inducción son 3 horas, una por día durante tres días.',
  'DEPARTAMENTO'
);
