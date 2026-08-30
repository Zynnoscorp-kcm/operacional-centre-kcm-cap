-- =============================================================================
-- 0004 — Catálogos: capacitaciones, alias, estructura organizacional y puestos
-- Fuente: docs/MODELO_DATOS.md hoja `CAPACITACIONES` (unificación de catálogo
--         con tabla de alias, dos niveles organizacionales para DNC).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Capacitaciones
-- -----------------------------------------------------------------------------
-- Hoja `CAPACITACIONES` y `HC_CURSOS`. Catálogo canónico de cursos de la
-- plataforma. `clave_curso` corresponde al `trainingId` estable (e.g. HC-...).
CREATE TABLE kcm.capacitacion (
  capacitacion_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_curso         text NOT NULL UNIQUE,
  nombre              text NOT NULL,
  nombre_normalizado  text NOT NULL,
  clave_origen        text,
  activa              boolean NOT NULL DEFAULT true,
  primera_importacion text,
  ultima_importacion  text,
  creada_en           timestamptz NOT NULL DEFAULT now(),
  actualizada_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,

  CONSTRAINT capacitacion_clave_no_vacia CHECK (btrim(clave_curso) <> ''),
  CONSTRAINT capacitacion_nombre_no_vacio CHECK (btrim(nombre) <> ''),
  CONSTRAINT capacitacion_nombre_norm_no_vacio CHECK (btrim(nombre_normalizado) <> '')
);

COMMENT ON TABLE kcm.capacitacion IS
  'Hoja CAPACITACIONES / HC_CURSOS. Catálogo canónico de capacitaciones con identificador estable.';
COMMENT ON COLUMN kcm.capacitacion.clave_curso IS
  'Identificador estable de la capacitación (trainingId), e.g. HC-HEX o clave de dominio.';
COMMENT ON COLUMN kcm.capacitacion.clave_origen IS
  'sourceKey original en la matriz o sistema origen (e.g. hc-course:...).';

CREATE INDEX capacitacion_nombre_norm_idx ON kcm.capacitacion (nombre_normalizado);
CREATE INDEX capacitacion_clave_origen_idx ON kcm.capacitacion (clave_origen) WHERE clave_origen IS NOT NULL;

CREATE TRIGGER capacitacion_actualizacion
  BEFORE UPDATE ON kcm.capacitacion
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Alias de capacitaciones
-- -----------------------------------------------------------------------------
-- no un programa de trabajo." Permite mapear nombres alternos (e.g. BPM ->
-- BUENAS PRACTICAS DE MANUFACTURA) sin duplicar el curso.
CREATE TABLE kcm.alias_capacitacion (
  alias_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacitacion_id   uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  alias             text NOT NULL UNIQUE,
  alias_normalizado text NOT NULL,
  origen_fuente     kcm.origen_fuente NOT NULL,
  aprobado_por      uuid NOT NULL REFERENCES kcm.actor (actor_id),
  aprobado_en       timestamptz NOT NULL DEFAULT now(),
  notas             text,

  CONSTRAINT alias_capacitacion_no_vacio CHECK (btrim(alias) <> ''),
  CONSTRAINT alias_capacitacion_norm_no_vacio CHECK (btrim(alias_normalizado) <> '')
);

COMMENT ON TABLE kcm.alias_capacitacion IS
  'Tabla de alias aprobados para reconciliación automática de nombres entre matriz, TSV y DNC.';

CREATE INDEX alias_capacitacion_curso_idx ON kcm.alias_capacitacion (capacitacion_id);
CREATE INDEX alias_capacitacion_norm_idx ON kcm.alias_capacitacion (alias_normalizado);

-- -----------------------------------------------------------------------------
-- Estructura organizacional: departamentos y áreas
-- -----------------------------------------------------------------------------
-- 'department' resuelve la aplicabilidad de los 8 cursos TSV; 'area' resuelve
-- los 13 cursos técnicos del DNC (e.g. GERENCIA DE MANTTO. ELECTRICO).
CREATE TABLE kcm.departamento (
  departamento_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text NOT NULL UNIQUE,
  nombre_normalizado  text NOT NULL,
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT departamento_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

COMMENT ON TABLE kcm.departamento IS
  'Catálogo de 24 departamentos organizacionales. Nivel 1 de aplicabilidad DNC.';

CREATE INDEX departamento_norm_idx ON kcm.departamento (nombre_normalizado);

CREATE TRIGGER departamento_actualizacion
  BEFORE UPDATE ON kcm.departamento
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

CREATE TABLE kcm.area (
  area_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departamento_id     uuid NOT NULL REFERENCES kcm.departamento (departamento_id) ON DELETE RESTRICT,
  nombre              text NOT NULL,
  nombre_normalizado  text NOT NULL,
  activo              boolean NOT NULL DEFAULT true,
  creada_en           timestamptz NOT NULL DEFAULT now(),
  actualizada_en      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT area_nombre_no_vacio CHECK (btrim(nombre) <> ''),
  CONSTRAINT area_departamento_nombre_unico UNIQUE (departamento_id, nombre)
);

COMMENT ON TABLE kcm.area IS
  'Catálogo de áreas subordinadas a departamentos. Nivel 2 de aplicabilidad DNC (técnicos).';

CREATE INDEX area_departamento_idx ON kcm.area (departamento_id);
CREATE INDEX area_norm_idx ON kcm.area (nombre_normalizado);

CREATE TRIGGER area_actualizacion
  BEFORE UPDATE ON kcm.area
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Puestos de trabajo y mapeo CNO (Catálogo Nacional de Ocupaciones)
-- -----------------------------------------------------------------------------
-- oficial DC-3, pero su ausencia no bloquea la operación general, sino la
-- emisión individual del DC-3.
CREATE TABLE kcm.puesto (
  puesto_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text NOT NULL UNIQUE,
  nombre_normalizado  text NOT NULL,
  clave_cno           text,
  descripcion_cno     text,
  aprobado_cno_por    uuid REFERENCES kcm.actor (actor_id),
  aprobado_cno_en     timestamptz,
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT puesto_nombre_no_vacio CHECK (btrim(nombre) <> ''),
  CONSTRAINT puesto_cno_coherente
    CHECK ((clave_cno IS NULL) = (aprobado_cno_por IS NULL))
);

COMMENT ON TABLE kcm.puesto IS
  'Catálogo de 101 puestos laborales y su mapeo al Catálogo Nacional de Ocupaciones (CNO).';
COMMENT ON COLUMN kcm.puesto.clave_cno IS
  'Clave oficial de ocupación CNO para STPS. Bloqueante por candidato para emisión DC-3.';

CREATE INDEX puesto_norm_idx ON kcm.puesto (nombre_normalizado);
CREATE INDEX puesto_cno_idx ON kcm.puesto (clave_cno) WHERE clave_cno IS NOT NULL;

CREATE TRIGGER puesto_actualizacion
  BEFORE UPDATE ON kcm.puesto
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();
