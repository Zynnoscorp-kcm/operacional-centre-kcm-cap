-- =============================================================================
-- 0016 — Automatización y emisión de constancias de competencias laborales DC-3
-- Fuente: docs/arquitectura/MODELO_DATOS.md contratos Dc3Plan y
--         Dc3DocumentJournal, docs/DC3_AUTOMATIZACION.md (función 9).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Metadatos oficiales por curso para DC-3
-- -----------------------------------------------------------------------------
-- Duración, área temática (catálogo 178 claves) y agente capacitador registrado.
CREATE TABLE kcm.metadato_curso_dc3 (
  metadato_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacitacion_id       uuid NOT NULL UNIQUE REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  duracion_horas        integer,
  area_tematica_clave   text,
  area_tematica_nombre  text,
  agente_capacitador    text,
  aprobado              boolean NOT NULL DEFAULT false,
  aprobado_por          uuid REFERENCES kcm.actor (actor_id),
  aprobado_en           timestamptz,
  actualizado_en        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metadato_dc3_horas_positivas CHECK (duracion_horas IS NULL OR duracion_horas > 0),
  CONSTRAINT metadato_dc3_aprobacion_coherente
    CHECK (
      (aprobado = false)
      OR
      (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL AND duracion_horas IS NOT NULL AND area_tematica_clave IS NOT NULL AND agente_capacitador IS NOT NULL)
    )
);

COMMENT ON TABLE kcm.metadato_curso_dc3 IS
  'Metadatos oficiales aprobados por curso requeridos para emisión del formato oficial STPS DC-3.';

CREATE TRIGGER metadato_curso_dc3_actualizacion
  BEFORE UPDATE ON kcm.metadato_curso_dc3
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Ledger de emisión de constancias DC-3
-- -----------------------------------------------------------------------------
-- Invariante: Como máximo una constancia por trabajador y curso.
CREATE TABLE kcm.documento_dc3 (
  dc3_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_dc3           text NOT NULL UNIQUE,
  trabajador_id       uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE RESTRICT,
  capacitacion_id     uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  fecha_curso         date NOT NULL,
  folio               text UNIQUE,
  estado              kcm.estado_dc3 NOT NULL DEFAULT 'PENDIENTE',
  codigo_bloqueo      text,
  sha256_documento    kcm.sha256,
  ruta_almacenamiento text,
  metadatos_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  emitido_en          timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,

  CONSTRAINT documento_dc3_trabajador_curso_unico UNIQUE (trabajador_id, capacitacion_id),
  CONSTRAINT documento_dc3_bloqueo_coherente
    CHECK (
      (estado = 'BLOQUEADO' AND codigo_bloqueo IS NOT NULL)
      OR (estado <> 'BLOQUEADO')
    ),
  CONSTRAINT documento_dc3_completado_coherente
    CHECK (
      (estado = 'COMPLETADO' AND sha256_documento IS NOT NULL AND emitido_en IS NOT NULL AND ruta_almacenamiento IS NOT NULL)
      OR (estado <> 'COMPLETADO')
    )
);

COMMENT ON TABLE kcm.documento_dc3 IS
  'Ledger de constancias DC-3 emitidas con unicidad por trabajador y curso.';

CREATE INDEX documento_dc3_trabajador_idx ON kcm.documento_dc3 (trabajador_id);
CREATE INDEX documento_dc3_estado_idx ON kcm.documento_dc3 (estado);

CREATE TRIGGER documento_dc3_actualizacion
  BEFORE UPDATE ON kcm.documento_dc3
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();
