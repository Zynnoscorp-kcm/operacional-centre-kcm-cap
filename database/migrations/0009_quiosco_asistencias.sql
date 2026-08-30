-- =============================================================================
-- 0009 — Quiosco y asistencias de participantes
-- Fuente: docs/arquitectura/MODELO_DATOS.md hojas `KIOSK_REGISTROS` y
--         `ASISTENCIAS`
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Asistencias de participantes
-- -----------------------------------------------------------------------------
-- Hoja `ASISTENCIAS`. Contrato unificado de participación por sesión y trabajador.
-- Invariantes:
-- 1. Unicidad: como máximo una asistencia por sesion_id + trabajador_id.
-- 2. Elegibilidad para liberación: identidad_validada = true, asistencia_comprobada = true,
--    estado_examen = 'EXAMEN_CONFIRMADO', excluida_de_liberacion = false, liberada = false.
-- 3. Exclusión: exige motivo explícito y actor responsable.
CREATE TABLE kcm.asistencia (
  asistencia_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id               uuid NOT NULL REFERENCES kcm.sesion (sesion_id) ON DELETE RESTRICT,
  trabajador_id           uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE RESTRICT,
  ruta                    kcm.ruta_captura NOT NULL DEFAULT 'DIGITAL',
  origen                  kcm.origen_asistencia NOT NULL DEFAULT 'QUIOSCO',
  identidad_validada      boolean NOT NULL DEFAULT false,
  asistencia_comprobada   boolean NOT NULL DEFAULT false,
  estado_examen           kcm.estado_examen NOT NULL DEFAULT 'EXAMEN_PENDIENTE',
  estado                  kcm.estado_asistencia NOT NULL DEFAULT 'CAPTURADA',
  excluida_de_liberacion  boolean NOT NULL DEFAULT false,
  motivo_exclusion        kcm.motivo,
  actor_exclusion         uuid REFERENCES kcm.actor (actor_id),
  excluida_en             timestamptz,
  liberada                boolean NOT NULL DEFAULT false,
  liberada_en             timestamptz,
  solicitud_id            kcm.identificador_solicitud,
  creada_en               timestamptz NOT NULL DEFAULT now(),
  actualizada_en          timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,

  CONSTRAINT asistencia_sesion_trabajador_unica UNIQUE (sesion_id, trabajador_id),
  CONSTRAINT asistencia_exclusion_coherente
    CHECK (
      (excluida_de_liberacion = false AND motivo_exclusion IS NULL AND actor_exclusion IS NULL AND excluida_en IS NULL)
      OR
      (excluida_de_liberacion = true AND motivo_exclusion IS NOT NULL AND actor_exclusion IS NOT NULL AND excluida_en IS NOT NULL)
    ),
  CONSTRAINT asistencia_liberada_coherente
    CHECK ((liberada = false) = (liberada_en IS NULL))
);

COMMENT ON TABLE kcm.asistencia IS
  'Hoja ASISTENCIAS. Registro central de participación, validación, examen y elegibilidad para liberación.';

CREATE INDEX asistencia_sesion_idx ON kcm.asistencia (sesion_id);
CREATE INDEX asistencia_trabajador_idx ON kcm.asistencia (trabajador_id);
CREATE INDEX asistencia_estado_idx ON kcm.asistencia (estado);
CREATE INDEX asistencia_elegible_idx
  ON kcm.asistencia (sesion_id)
  WHERE identidad_validada = true AND asistencia_comprobada = true
    AND estado_examen = 'EXAMEN_CONFIRMADO' AND excluida_de_liberacion = false AND liberada = false;

CREATE TRIGGER asistencia_actualizacion
  BEFORE UPDATE ON kcm.asistencia
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Registro durable de quiosco (Journal)
-- -----------------------------------------------------------------------------
-- Hoja `KIOSK_REGISTROS`. Journal transaccional del quiosco.
-- Avanza por: RESERVADO -> ASISTENCIA_CREADA -> COMPLETADO.
-- Permite auto-reparación en el arranque de la plataforma.
CREATE TABLE kcm.registro_quiosco (
  registro_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id                   uuid NOT NULL REFERENCES kcm.sesion (sesion_id) ON DELETE RESTRICT,
  trabajador_id               uuid REFERENCES kcm.trabajador (trabajador_id) ON DELETE SET NULL,
  numero_trabajador_capturado kcm.numero_trabajador NOT NULL,
  asistencia_id               uuid REFERENCES kcm.asistencia (asistencia_id) ON DELETE SET NULL,
  solicitud_id                kcm.identificador_solicitud NOT NULL UNIQUE,
  estacion                    text,
  fase                        kcm.fase_registro_quiosco NOT NULL DEFAULT 'RESERVADO',
  creado_en                   timestamptz NOT NULL DEFAULT now(),
  actualizado_en              timestamptz NOT NULL DEFAULT now(),
  completado_en               timestamptz,

  CONSTRAINT registro_quiosco_sesion_numero_unico UNIQUE (sesion_id, numero_trabajador_capturado),
  CONSTRAINT registro_quiosco_completado_coherente
    CHECK ((fase = 'COMPLETADO') = (completado_en IS NOT NULL))
);

COMMENT ON TABLE kcm.registro_quiosco IS
  'Hoja KIOSK_REGISTROS. Journal durable para registro concurrente e idempotente desde quiosco físico.';

CREATE INDEX registro_quiosco_sesion_idx ON kcm.registro_quiosco (sesion_id);
CREATE INDEX registro_quiosco_fase_idx ON kcm.registro_quiosco (fase);

CREATE TRIGGER registro_quiosco_actualizacion
  BEFORE UPDATE ON kcm.registro_quiosco
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();
