-- =============================================================================
-- 0010 — Evidencias y banco de trabajo de preliberación
-- Fuente: docs/arquitectura/MODELO_DATOS.md hojas `EVIDENCIAS` y
--         `PRELIBERACION_REVISION`
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Evidencias documentales
-- -----------------------------------------------------------------------------
-- Hoja `EVIDENCIAS`. Registro protegido de archivos de reporte o evidencia.
-- Invariante: Inmutabilidad garantizada.
CREATE TABLE kcm.evidencia (
  evidencia_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id           uuid NOT NULL REFERENCES kcm.sesion (sesion_id) ON DELETE RESTRICT,
  tipo                text NOT NULL,
  nombre_archivo      text NOT NULL,
  mime_type           text NOT NULL,
  sha256              kcm.sha256 NOT NULL,
  tamanio_bytes       bigint NOT NULL,
  ruta_almacenamiento text NOT NULL,
  inmutable           boolean NOT NULL DEFAULT true,
  creada_por          uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creada_en           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidencia_tipo_no_vacio CHECK (btrim(tipo) <> ''),
  CONSTRAINT evidencia_nombre_no_vacio CHECK (btrim(nombre_archivo) <> ''),
  CONSTRAINT evidencia_mime_valido CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  CONSTRAINT evidencia_tamanio_positivo CHECK (tamanio_bytes > 0)
);

COMMENT ON TABLE kcm.evidencia IS
  'Hoja EVIDENCIAS. Referencia inmutable a reportes PDF o evidencias de sesión.';

CREATE INDEX evidencia_sesion_idx ON kcm.evidencia (sesion_id);
CREATE INDEX evidencia_sha256_idx ON kcm.evidencia (sha256);

-- -----------------------------------------------------------------------------
-- Revisión de preliberación
-- -----------------------------------------------------------------------------
-- Hoja `PRELIBERACION_REVISION`. Una fila vigente por sesión que consolida
-- los hallazgos del cotejo, resultados de exámenes y el acta de preliberación.
CREATE TABLE kcm.revision_preliberacion (
  revision_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id             uuid NOT NULL UNIQUE REFERENCES kcm.sesion (sesion_id) ON DELETE RESTRICT,
  total_padron          integer NOT NULL DEFAULT 0,
  total_confirmados     integer NOT NULL DEFAULT 0,
  total_reprobados      integer NOT NULL DEFAULT 0,
  total_faltantes       integer NOT NULL DEFAULT 0,
  total_excluidos       integer NOT NULL DEFAULT 0,
  hallazgos             jsonb NOT NULL DEFAULT '[]'::jsonb,
  comentarios           text,
  evidencia_reporte_id  uuid REFERENCES kcm.evidencia (evidencia_id) ON DELETE SET NULL,
  estado                text NOT NULL DEFAULT 'EN_REVISION',
  revisado_por          uuid NOT NULL REFERENCES kcm.actor (actor_id),
  revisado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,

  CONSTRAINT revision_preliberacion_conteos_positivos
    CHECK (
      total_padron >= 0 AND total_confirmados >= 0 AND total_reprobados >= 0 AND
      total_faltantes >= 0 AND total_excluidos >= 0
    ),
  CONSTRAINT revision_preliberacion_estado_valido
    CHECK (estado IN ('EN_REVISION', 'COTEJO_CONFIRMADO', 'AUTORIZADA_LIBERACION'))
);

COMMENT ON TABLE kcm.revision_preliberacion IS
  'Hoja PRELIBERACION_REVISION. Estado consolidado de la preliberación por sesión.';

CREATE INDEX revision_preliberacion_sesion_idx ON kcm.revision_preliberacion (sesion_id);

CREATE TRIGGER revision_preliberacion_actualizacion
  BEFORE UPDATE ON kcm.revision_preliberacion
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();
