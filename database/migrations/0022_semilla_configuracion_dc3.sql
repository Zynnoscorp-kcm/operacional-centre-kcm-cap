-- =============================================================================
-- 0022 — Semilla de configuración entregada por Capacitación el 2026-08-03
--
-- Sólo se siembra lo que el departamento entregó como firme. Lo que quedó
-- pendiente se deja explícitamente nulo, y ningún curso queda `aprobado`: el
-- invariante de 0016 impide emitir una constancia con un metadato faltante, así
-- que la aprobación es un acto posterior y deliberado, no un efecto de la
-- semilla.
--
-- Pendientes conocidos al momento de esta migración:
--   · ocupación específica del CNO por puesto (`kcm.puesto.clave_cno`);
--   · nombre del agente capacitador de los tres cursos;
--   · duración en horas de la Inducción (se conoce en días: 3);
--   · texto oficial de las áreas temáticas 3131, 3132 y 6000.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Actor de configuración
-- -----------------------------------------------------------------------------
-- Casi toda escritura del dominio exige un actor responsable. Éste representa la
-- carga inicial de configuración y no sustituye a las cuentas nominales.
INSERT INTO kcm.actor (identificador, nombre_visible)
VALUES ('sistema.configuracion', 'Configuración KCM')
ON CONFLICT (identificador) DO NOTHING;

INSERT INTO kcm.asignacion_rol (actor_id, rol, otorgado_por)
SELECT a.actor_id, 'ADMINISTRADOR', a.actor_id
FROM kcm.actor a
WHERE a.identificador = 'sistema.configuracion'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Patrón
-- -----------------------------------------------------------------------------
-- Razón social y RFC tal como los entregó el departamento. El RFC se almacena
-- sin el guion de la homoclave (KCM810226-DEA -> KCM810226DEA).
INSERT INTO kcm.patron (razon_social, rfc)
SELECT 'KIMBERLY CLARK DE MÉXICO S.A DE C.V', 'KCM810226DEA'
WHERE NOT EXISTS (SELECT 1 FROM kcm.patron WHERE vigente_hasta IS NULL);

-- -----------------------------------------------------------------------------
-- Áreas temáticas declaradas
-- -----------------------------------------------------------------------------
INSERT INTO kcm.area_tematica_dc3 (clave, nombre) VALUES
  ('3131', NULL),
  ('3132', NULL),
  ('6000', NULL)
ON CONFLICT (clave) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Los tres cursos con constancia DC-3
-- -----------------------------------------------------------------------------
-- Las claves coinciden con las que ya usa el generador
-- (`config/dc3-generator.example.json`), de modo que el worker y la base hablan
-- del mismo curso sin una tabla de traducción.
INSERT INTO kcm.capacitacion (clave_curso, nombre, nombre_normalizado, clave_origen) VALUES
  ('INDUCCION_EMPRESA', 'INDUCCIÓN A LA EMPRESA', 'INDUCCION A LA EMPRESA', 'ACTIVE_HIRE_DATE'),
  ('QMS', 'QMS', 'QMS', 'hc-course:QMS'),
  ('LOTO',
   'SISTEMAS DE PROTECCIÓN Y DISPOSITIVOS DE SEGURIDAD EN LA MAQUINARIA Y EQUIPO, PARA PREVENIR Y PROTEGER A LOS TRABAJADORES CONTRA LOS RIESGOS DE TRABAJO LOTO',
   'SISTEMAS DE PROTECCION Y DISPOSITIVOS DE SEGURIDAD EN LA MAQUINARIA Y EQUIPO, PARA PREVENIR Y PROTEGER A LOS TRABAJADORES CONTRA LOS RIESGOS DE TRABAJO LOTO',
   'hc-course:LOTO')
ON CONFLICT (clave_curso) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Metadatos DC-3 por curso
-- -----------------------------------------------------------------------------
-- Inducción: el periodo arranca el día del alta del trabajador y termina dos
-- días después. Los otros dos se imparten y se acreditan el mismo día.
INSERT INTO kcm.metadato_curso_dc3
  (capacitacion_id, nombre_dc3, duracion_horas, duracion_dias, area_tematica_clave, regla_fecha, dias_periodo)
SELECT c.capacitacion_id, 'INDUCCIÓN A LA EMPRESA', NULL, 3, '3132', 'FECHA_ALTA', 2
FROM kcm.capacitacion c WHERE c.clave_curso = 'INDUCCION_EMPRESA'
ON CONFLICT (capacitacion_id) DO NOTHING;

INSERT INTO kcm.metadato_curso_dc3
  (capacitacion_id, nombre_dc3, duracion_horas, area_tematica_clave, regla_fecha, dias_periodo)
SELECT c.capacitacion_id, 'QMS', 1, '3131', 'FECHA_MATRIZ', 0
FROM kcm.capacitacion c WHERE c.clave_curso = 'QMS'
ON CONFLICT (capacitacion_id) DO NOTHING;

INSERT INTO kcm.metadato_curso_dc3
  (capacitacion_id, nombre_dc3, duracion_horas, area_tematica_clave, regla_fecha, dias_periodo)
SELECT c.capacitacion_id, c.nombre, 1, '6000', 'FECHA_MATRIZ', 0
FROM kcm.capacitacion c WHERE c.clave_curso = 'LOTO'
ON CONFLICT (capacitacion_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Rastro de la carga
-- -----------------------------------------------------------------------------
INSERT INTO kcm.auditoria (actor, rol, entidad_tipo, entidad_id, accion, estado_nuevo, motivo, procedencia)
VALUES (
  'sistema.configuracion', 'ADMINISTRADOR', 'CONFIGURACION', 'SEMILLA_DC3_2026-08-03',
  'CONFIGURACION_SEMBRADA', 'PENDIENTE_APROBACION',
  'Carga inicial de patrón, áreas temáticas y metadatos DC-3 entregados por Capacitación el 2026-08-03.',
  'DEPARTAMENTO'
);
