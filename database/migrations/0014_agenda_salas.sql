-- =============================================================================
-- 0014 — Agenda de salas y prevención estructural de traslapes
-- Fuente: docs/arquitectura/MODELO_DATOS.md hoja `RESERVAS_SALAS`
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catálogo de salas de capacitación
-- -----------------------------------------------------------------------------
CREATE TABLE kcm.sala (
  sala_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_sala      text NOT NULL UNIQUE,
  nombre_visible  text NOT NULL,
  capacidad       integer NOT NULL DEFAULT 20,
  activa          boolean NOT NULL DEFAULT true,
  creada_en       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sala_clave_no_vacia CHECK (btrim(clave_sala) <> ''),
  CONSTRAINT sala_nombre_no_vacio CHECK (btrim(nombre_visible) <> ''),
  CONSTRAINT sala_capacidad_positiva CHECK (capacidad > 0)
);

COMMENT ON TABLE kcm.sala IS
  'Catálogo de las 7 salas de capacitación de planta.';

-- Semilla de las 7 salas oficiales
INSERT INTO kcm.sala (clave_sala, nombre_visible, capacidad) VALUES
  ('VOGUE', 'Sala Vogue', 25),
  ('KLEENEX', 'Sala Kleenex', 30),
  ('MARLI', 'Sala Marlí', 20),
  ('PETALO', 'Sala Pétalo', 25),
  ('DELSEY', 'Sala Delsey', 20),
  ('SALA_GERENCIA', 'Sala Gerencia', 15),
  ('SALA_DRAGONES', 'Sala Dragones', 40)
ON CONFLICT (clave_sala) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Reservaciones de sala
-- -----------------------------------------------------------------------------
-- Hoja `RESERVAS_SALAS`.
-- Invariantes:
-- 1. Estructural: No traslape de horarios para la misma sala en reservas ACTIVAS
--    garantizado por índice de exclusión GiST de Postgres (`horario &&`).
-- 2. "Eliminar" es transición a CANCELADA, conservando actor, motivo y fecha.
CREATE TABLE kcm.reserva_sala (
  reserva_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id               uuid NOT NULL REFERENCES kcm.sala (sala_id) ON DELETE RESTRICT,
  fecha                 date NOT NULL,
  hora_inicio           time NOT NULL,
  hora_fin              time NOT NULL,
  horario               tstzrange NOT NULL,
  solicitante_nombre    text NOT NULL,
  solicitante_puesto    text,
  solicitante_area      text,
  solicitante_contacto  text NOT NULL,
  motivo                kcm.motivo NOT NULL,
  asistentes_estimados  integer NOT NULL DEFAULT 1,
  estado                kcm.estado_reserva NOT NULL DEFAULT 'ACTIVA',
  origen                kcm.origen_reserva NOT NULL DEFAULT 'AUTOSERVICIO',
  solicitud_id          kcm.identificador_solicitud NOT NULL UNIQUE,
  sha256_payload        kcm.sha256 NOT NULL,
  cancelada_en          timestamptz,
  cancelada_por         uuid REFERENCES kcm.actor (actor_id),
  motivo_cancelacion    kcm.motivo,
  creada_en             timestamptz NOT NULL DEFAULT now(),
  actualizada_en        timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,

  CONSTRAINT reserva_hora_valida CHECK (hora_fin > hora_inicio),
  CONSTRAINT reserva_asistentes_positivos CHECK (asistentes_estimados > 0),
  CONSTRAINT reserva_cancelacion_coherente
    CHECK (
      (estado = 'ACTIVA' AND cancelada_en IS NULL AND cancelada_por IS NULL AND motivo_cancelacion IS NULL)
      OR
      (estado = 'CANCELADA' AND cancelada_en IS NOT NULL AND motivo_cancelacion IS NOT NULL)
    ),
  -- INVARIANTE CONCURRENTE: Exclusión estructural de traslapes en reservas activas
  CONSTRAINT reserva_sin_traslape_activo
    EXCLUDE USING gist (sala_id WITH =, horario WITH &&)
    WHERE (estado = 'ACTIVA')
);

COMMENT ON TABLE kcm.reserva_sala IS
  'Hoja RESERVAS_SALAS. Reservaciones con garantía física de exclusión de traslapes en PostgreSQL.';

CREATE INDEX reserva_sala_fecha_idx ON kcm.reserva_sala (sala_id, fecha);
CREATE INDEX reserva_estado_idx ON kcm.reserva_sala (estado);

CREATE TRIGGER reserva_sala_actualizacion
  BEFORE UPDATE ON kcm.reserva_sala
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();
