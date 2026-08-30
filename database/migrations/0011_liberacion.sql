-- =============================================================================
-- 0011 — Liberación de fechas a matriz: lotes y efectos de liberación
-- Fuente: docs/arquitectura/MODELO_DATOS.md hojas `LIBERACION_LOTES` y
--         `LIBERACIONES`
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lotes de liberación
-- -----------------------------------------------------------------------------
-- Hoja `LIBERACION_LOTES`. Journal autenticado de ejecución del lote de liberación.
-- Invariantes:
-- 1. Fases recuperables: PENDIENTE -> MATRIZ_APLICADA -> DOMINIO_APLICADO -> COMPLETADO.
-- 2. Autenticación con journal_mac para prevenir adulteraciones.
CREATE TABLE kcm.lote_liberacion (
  lote_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id         uuid NOT NULL REFERENCES kcm.sesion (sesion_id) ON DELETE RESTRICT,
  solicitud_id      kcm.identificador_solicitud NOT NULL UNIQUE,
  version_mapeo     text NOT NULL DEFAULT 'operational-hc-v1',
  sha256_plan       kcm.sha256 NOT NULL,
  journal_mac       text NOT NULL,
  fase              kcm.fase_lote_liberacion NOT NULL DEFAULT 'PENDIENTE',
  estado            kcm.estado_lote_liberacion NOT NULL DEFAULT 'PENDIENTE',
  total_candidatos  integer NOT NULL DEFAULT 0,
  total_escritos    integer NOT NULL DEFAULT 0,
  total_conflictos  integer NOT NULL DEFAULT 0,
  resultados        jsonb NOT NULL DEFAULT '[]'::jsonb,
  creado_por        uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  completado_en     timestamptz,

  CONSTRAINT lote_liberacion_conteos_positivos
    CHECK (total_candidatos >= 0 AND total_escritos >= 0 AND total_conflictos >= 0),
  CONSTRAINT lote_liberacion_cierre_coherente
    CHECK (
      (estado IN ('COMPLETADO', 'CONFLICTO') AND completado_en IS NOT NULL)
      OR (estado NOT IN ('COMPLETADO', 'CONFLICTO'))
    )
);

COMMENT ON TABLE kcm.lote_liberacion IS
  'Hoja LIBERACION_LOTES. Journal transaccional autenticado del proceso de liberación de sesiones.';

CREATE INDEX lote_liberacion_sesion_idx ON kcm.lote_liberacion (sesion_id);
CREATE INDEX lote_liberacion_fase_idx ON kcm.lote_liberacion (fase);

CREATE TRIGGER lote_liberacion_actualizacion
  BEFORE UPDATE ON kcm.lote_liberacion
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Liberaciones individuales persistidas
-- -----------------------------------------------------------------------------
-- Hoja `LIBERACIONES`. Efecto individual de liberación exitosa por trabajador y curso.
-- Invariante: Clave idempotente única (sesión + trabajador + curso + versión mapeo).
CREATE TABLE kcm.liberacion (
  liberacion_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_idempotencia  text NOT NULL UNIQUE,
  lote_id             uuid NOT NULL REFERENCES kcm.lote_liberacion (lote_id) ON DELETE RESTRICT,
  sesion_id           uuid NOT NULL REFERENCES kcm.sesion (sesion_id) ON DELETE RESTRICT,
  trabajador_id       uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE RESTRICT,
  capacitacion_id     uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  fecha_efectiva      date NOT NULL,
  version_mapeo       text NOT NULL DEFAULT 'operational-hc-v1',
  resultado           text NOT NULL DEFAULT 'APPLIED',
  marcador            text NOT NULL,
  creada_en           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT liberacion_clave_no_vacia CHECK (btrim(clave_idempotencia) <> ''),
  CONSTRAINT liberacion_marcador_no_vacio CHECK (btrim(marcador) <> '')
);

COMMENT ON TABLE kcm.liberacion IS
  'Hoja LIBERACIONES. Registro individual e inmutable de la fecha liberada con clave idempotente.';

CREATE INDEX liberacion_lote_idx ON kcm.liberacion (lote_id);
CREATE INDEX liberacion_trabajador_curso_idx ON kcm.liberacion (trabajador_id, capacitacion_id);
CREATE INDEX liberacion_sesion_idx ON kcm.liberacion (sesion_id);

CREATE TRIGGER liberacion_solo_agrega
  BEFORE UPDATE OR DELETE ON kcm.liberacion
  FOR EACH ROW EXECUTE FUNCTION kcm.impedir_modificacion();

CREATE TRIGGER liberacion_sin_truncado
  BEFORE TRUNCATE ON kcm.liberacion
  FOR EACH STATEMENT EXECUTE FUNCTION kcm.impedir_modificacion();
