-- =============================================================================
-- 0015 — Reglas DNC en dos niveles y evaluación de cumplimiento
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reglas de aplicabilidad DNC (Dos niveles: Department y Area)
-- -----------------------------------------------------------------------------
-- Define qué población debe tomar cada curso:
-- - Nivel DEPARTMENT: para los 8 cursos de calidad del TSV.
-- - Nivel AREA: para los 13 cursos técnicos del DNC.
-- Soporta vigencia, recurrencia en meses y periodos de gracia.
CREATE TABLE kcm.regla_dnc (
  regla_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacitacion_id   uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  nivel             kcm.nivel_poblacion NOT NULL,
  departamento_id   uuid REFERENCES kcm.departamento (departamento_id) ON DELETE CASCADE,
  area_id           uuid REFERENCES kcm.area (area_id) ON DELETE CASCADE,
  meses_recurrencia integer NOT NULL DEFAULT 12,
  dias_gracia       integer NOT NULL DEFAULT 30,
  vigente_desde     date NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta     date,
  version_regla     text NOT NULL DEFAULT '1.0.0',
  aprobada_por      uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creada_en         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT regla_dnc_recurrencia_positiva CHECK (meses_recurrencia > 0),
  CONSTRAINT regla_dnc_gracia_no_negativa CHECK (dias_gracia >= 0),
  CONSTRAINT regla_dnc_vigencia_valida CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  -- Coherencia estructural del nivel de aplicabilidad
  CONSTRAINT regla_dnc_nivel_coherente
    CHECK (
      (nivel = 'DEPARTMENT' AND departamento_id IS NOT NULL AND area_id IS NULL)
      OR
      (nivel = 'AREA' AND area_id IS NOT NULL)
    )
);

COMMENT ON TABLE kcm.regla_dnc IS
  'Reglas de aplicabilidad DNC en dos niveles con recurrencia, periodo de gracia y versión.';

CREATE INDEX regla_dnc_curso_idx ON kcm.regla_dnc (capacitacion_id);
CREATE INDEX regla_dnc_depto_idx ON kcm.regla_dnc (departamento_id) WHERE departamento_id IS NOT NULL;
CREATE INDEX regla_dnc_area_idx ON kcm.regla_dnc (area_id) WHERE area_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Snapshot de evaluación DNC por trabajador y curso
-- -----------------------------------------------------------------------------
-- Almacena el resultado calculado con los seis estados oficiales:
-- COMPLETADO, REFORZAR, PENDIENTE, NO_APLICA, DATOS_INSUFICIENTES, PROGRAMADO.
CREATE TABLE kcm.evaluacion_dnc_snapshot (
  evaluacion_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id       uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE CASCADE,
  capacitacion_id     uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  regla_id            uuid REFERENCES kcm.regla_dnc (regla_id) ON DELETE SET NULL,
  estado_dnc          kcm.estado_dnc NOT NULL,
  fecha_ultimo_curso  date,
  fecha_vencimiento   date,
  version_regla       text NOT NULL,
  evaluado_en         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evaluacion_dnc_trabajador_curso_unica UNIQUE (trabajador_id, capacitacion_id)
);

COMMENT ON TABLE kcm.evaluacion_dnc_snapshot IS
  'Snapshot de evaluación DNC por trabajador y curso con los 6 estados de negocio.';
COMMENT ON COLUMN kcm.evaluacion_dnc_snapshot.estado_dnc IS
  'Estado oficial. DATOS_INSUFICIENTES nunca suma al porcentaje de cumplimiento.';

CREATE INDEX evaluacion_dnc_trabajador_idx ON kcm.evaluacion_dnc_snapshot (trabajador_id);
CREATE INDEX evaluacion_dnc_estado_idx ON kcm.evaluacion_dnc_snapshot (estado_dnc);
