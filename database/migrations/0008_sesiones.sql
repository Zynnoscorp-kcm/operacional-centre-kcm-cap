-- =============================================================================
-- 0008 — Sesiones de capacitación
-- Fuente: docs/arquitectura/MODELO_DATOS.md hoja `SESIONES` (funciones 2 y
--         3).
-- =============================================================================

CREATE TABLE kcm.sesion (
  sesion_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_sesion     text NOT NULL UNIQUE,
  capacitacion_id   uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  capacitador_id    uuid NOT NULL REFERENCES kcm.actor (actor_id) ON DELETE RESTRICT,
  fecha_sesion      date NOT NULL,
  duracion_minutos  integer NOT NULL DEFAULT 60,
  cupo_maximo       integer NOT NULL DEFAULT 40,
  estado            kcm.estado_sesion NOT NULL DEFAULT 'BORRADOR',
  autorizada        boolean NOT NULL DEFAULT false,
  autorizada_por    uuid REFERENCES kcm.actor (actor_id),
  autorizada_en     timestamptz,
  abierta_en        timestamptz,
  cerrada_en        timestamptz,
  creada_por        uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creada_en         timestamptz NOT NULL DEFAULT now(),
  actualizada_en    timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,

  CONSTRAINT sesion_codigo_no_vacio CHECK (btrim(codigo_sesion) <> ''),
  CONSTRAINT sesion_duracion_positiva CHECK (duracion_minutos > 0),
  CONSTRAINT sesion_cupo_positivo CHECK (cupo_maximo > 0),
  CONSTRAINT sesion_autorizacion_coherente
    CHECK ((autorizada = false) OR (autorizada_por IS NOT NULL AND autorizada_en IS NOT NULL))
);

COMMENT ON TABLE kcm.sesion IS
  'Hoja SESIONES. Encabezado y control de estado de las sesiones de capacitación.';
COMMENT ON COLUMN kcm.sesion.codigo_sesion IS
  'Código alfanumérico público de sesión utilizado en el quiosco y en la búsqueda de auditoría.';

CREATE INDEX sesion_capacitacion_idx ON kcm.sesion (capacitacion_id);
CREATE INDEX sesion_capacitador_idx ON kcm.sesion (capacitador_id);
CREATE INDEX sesion_fecha_idx ON kcm.sesion (fecha_sesion);
CREATE INDEX sesion_estado_idx ON kcm.sesion (estado);

CREATE TRIGGER sesion_actualizacion
  BEFORE UPDATE ON kcm.sesion
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();
