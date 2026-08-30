-- =============================================================================
-- 0007 — Ingesta de matriz, registros HC e historial de sobrescritura
-- Fuente: docs/arquitectura/MODELO_DATOS.md hojas `HC_IMPORTACIONES`,
--         `HC_REGISTROS` y `HC_REGISTROS_HISTORIAL` (autoridad del XLSB
--         maestro, reconciliación por procedencia, sobrescritura gobernada
--         con historial).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lotes de importación de matriz
-- -----------------------------------------------------------------------------
-- Hoja `HC_IMPORTACIONES`. Control de ciclo de vida de un snapshot del XLSB maestro.
-- Invariantes:
-- 1. Recorrido estricto de fases: RECIBIDO -> PREPARADO -> VALIDADO -> APROBADO -> CONFIRMADO.
-- 2. Declaración de alcance FULL o DELTA antes de aplicar (ausencia != baja).
CREATE TABLE kcm.lote_importacion (
  importacion_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id            kcm.identificador_solicitud NOT NULL UNIQUE,
  sha256_fuente           kcm.sha256 NOT NULL,
  sha256_snapshot         kcm.sha256 NOT NULL,
  nombre_archivo_fuente   text NOT NULL,
  nombre_hoja_fuente      text NOT NULL,
  extraido_en             timestamptz NOT NULL,
  estado                  kcm.estado_lote_importacion NOT NULL DEFAULT 'RECIBIDO',
  alcance                 kcm.alcance_lote NOT NULL DEFAULT 'FULL',
  total_trabajadores      integer NOT NULL DEFAULT 0,
  total_cursos            integer NOT NULL DEFAULT 0,
  total_fechas            integer NOT NULL DEFAULT 0,
  insertados_count        integer NOT NULL DEFAULT 0,
  corregidos_count        integer NOT NULL DEFAULT 0,
  retirados_count         integer NOT NULL DEFAULT 0,
  reactivados_count       integer NOT NULL DEFAULT 0,
  conflictos_count        integer NOT NULL DEFAULT 0,
  pendientes_maestro_count integer NOT NULL DEFAULT 0,
  diagnosticos            jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_por              uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creado_en               timestamptz NOT NULL DEFAULT now(),
  completado_en           timestamptz,
  version                 integer NOT NULL DEFAULT 1,

  CONSTRAINT lote_importacion_archivo_no_vacio CHECK (btrim(nombre_archivo_fuente) <> ''),
  CONSTRAINT lote_importacion_hoja_no_vacia CHECK (btrim(nombre_hoja_fuente) <> ''),
  CONSTRAINT lote_importacion_conteos_positivos
    CHECK (
      total_trabajadores >= 0 AND total_cursos >= 0 AND total_fechas >= 0 AND
      insertados_count >= 0 AND corregidos_count >= 0 AND retirados_count >= 0 AND
      reactivados_count >= 0 AND conflictos_count >= 0 AND pendientes_maestro_count >= 0
    ),
  CONSTRAINT lote_importacion_cierre_coherente
    CHECK (
      (estado IN ('CONFIRMADO', 'RECHAZADO', 'CONFLICTO') AND completado_en IS NOT NULL)
      OR (estado NOT IN ('CONFIRMADO', 'RECHAZADO', 'CONFLICTO'))
    )
);

COMMENT ON TABLE kcm.lote_importacion IS
  'Hoja HC_IMPORTACIONES. Registro de lotes de importación con ciclo de vida completo y conteos conciliados.';

CREATE INDEX lote_importacion_estado_idx ON kcm.lote_importacion (estado);
CREATE INDEX lote_importacion_sha_snap_idx ON kcm.lote_importacion (sha256_snapshot);

-- -----------------------------------------------------------------------------
-- Registros HC (Persistencia técnica durable de fechas de capacitación)
-- -----------------------------------------------------------------------------
-- Hoja `HC_REGISTROS`. Réplica de la matriz con trazabilidad de procedencia.
-- Invariante: Una sola fecha vigente por trabajador y capacitación.
CREATE TABLE kcm.registro_hc (
  registro_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_idempotencia  text NOT NULL UNIQUE,
  trabajador_id       uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE RESTRICT,
  capacitacion_id     uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  fecha_capacitacion  date NOT NULL,
  procedencia         kcm.procedencia_fecha NOT NULL,
  estado_registro     kcm.estado_registro_hc NOT NULL DEFAULT 'VIGENTE',
  sesion_id           uuid,
  liberacion_id       uuid,
  version_mapeo       text NOT NULL DEFAULT 'operational-hc-v1',
  lote_id             uuid,
  marcador            text,
  importacion_id      uuid REFERENCES kcm.lote_importacion (importacion_id) ON DELETE SET NULL,
  solicitud_id        kcm.identificador_solicitud,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,

  CONSTRAINT registro_hc_clave_no_vacia CHECK (btrim(clave_idempotencia) <> '')
);

COMMENT ON TABLE kcm.registro_hc IS
  'Hoja HC_REGISTROS. Registro persistente de fechas de capacitación con procedencia y unicidad por par vigente.';
COMMENT ON COLUMN kcm.registro_hc.procedencia IS
  'XLSB_IMPORT (maestro) o SESSION_RELEASE (plataforma). Base de la reconciliación.';

-- Unicidad estricta: un solo registro VIGENTE por trabajador y curso
CREATE UNIQUE INDEX registro_hc_vigente_unico
  ON kcm.registro_hc (trabajador_id, capacitacion_id)
  WHERE estado_registro = 'VIGENTE';

CREATE INDEX registro_hc_trabajador_idx ON kcm.registro_hc (trabajador_id);
CREATE INDEX registro_hc_curso_idx ON kcm.registro_hc (capacitacion_id);
CREATE INDEX registro_hc_sesion_idx ON kcm.registro_hc (sesion_id) WHERE sesion_id IS NOT NULL;
CREATE INDEX registro_hc_fecha_idx ON kcm.registro_hc (fecha_capacitacion);

CREATE TRIGGER registro_hc_actualizacion
  BEFORE UPDATE ON kcm.registro_hc
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Historial de sobrescritura de fechas y cambios de estado (Hoja HC_REGISTROS_HISTORIAL)
-- -----------------------------------------------------------------------------
-- Criterio de diseño: "Sobrescribir sí, borrar no. Una sobrescritura
-- conserva el valor anterior en historial append-only, con actor, motivo,
-- momento y procedencia."
CREATE TABLE kcm.historial_sobrescritura_fecha (
  historial_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secuencia         bigint GENERATED ALWAYS AS IDENTITY,
  registro_id       uuid NOT NULL,
  trabajador_id     uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE RESTRICT,
  capacitacion_id   uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  tipo_cambio       kcm.tipo_cambio_hc NOT NULL,
  fecha_anterior    date,
  fecha_nueva       date,
  estado_anterior   kcm.estado_registro_hc,
  estado_nuevo      kcm.estado_registro_hc NOT NULL,
  procedencia       kcm.procedencia_fecha NOT NULL,
  actor_id          uuid NOT NULL REFERENCES kcm.actor (actor_id),
  motivo            kcm.motivo NOT NULL,
  solicitud_id      kcm.identificador_solicitud,
  importacion_id    uuid REFERENCES kcm.lote_importacion (importacion_id) ON DELETE SET NULL,
  registrado_en     timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,

  CONSTRAINT historial_sobrescritura_fechas_distintas
    CHECK (tipo_cambio <> 'SOBRESCRITA' OR (fecha_anterior IS NOT NULL AND fecha_nueva IS NOT NULL AND fecha_anterior <> fecha_nueva))
);

COMMENT ON TABLE kcm.historial_sobrescritura_fecha IS
  'Hoja HC_REGISTROS_HISTORIAL. Ledger append-only inmutable de toda sobrescritura, corrección o retiro de fecha.';

CREATE INDEX historial_sobrescritura_par_idx
  ON kcm.historial_sobrescritura_fecha (trabajador_id, capacitacion_id, secuencia DESC);
CREATE INDEX historial_sobrescritura_registro_idx
  ON kcm.historial_sobrescritura_fecha (registro_id, secuencia DESC);
CREATE INDEX historial_sobrescritura_fecha_idx
  ON kcm.historial_sobrescritura_fecha (registrado_en DESC);

CREATE TRIGGER historial_sobrescritura_solo_agrega
  BEFORE UPDATE OR DELETE ON kcm.historial_sobrescritura_fecha
  FOR EACH ROW EXECUTE FUNCTION kcm.impedir_modificacion();

CREATE TRIGGER historial_sobrescritura_sin_truncado
  BEFORE TRUNCATE ON kcm.historial_sobrescritura_fecha
  FOR EACH STATEMENT EXECUTE FUNCTION kcm.impedir_modificacion();
