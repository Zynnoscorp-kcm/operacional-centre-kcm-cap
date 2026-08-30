-- =============================================================================
-- 0002 — Auditoría y errores
-- Fuente: docs/arquitectura/MODELO_DATOS.md hojas `AUDITORIA` y `ERRORES`;
--         función 7.
--
-- INVARIANTE: auditoría y journals sólo se agregan; no existe operación de
-- edición. Aquí se instala por primera vez el trigger de sólo agregado.
-- =============================================================================

CREATE TABLE kcm.auditoria (
  evento_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Orden total. Dos eventos pueden compartir `ocurrido_en`; la secuencia
  -- desempata y permite reconstruir el orden real de los efectos.
  secuencia         bigint GENERATED ALWAYS AS IDENTITY,
  ocurrido_en       timestamptz NOT NULL DEFAULT now(),

  actor             text NOT NULL,
  rol               kcm.rol NOT NULL,

  entidad_tipo      text NOT NULL,
  entidad_id        text NOT NULL,
  accion            text NOT NULL,

  estado_anterior   text,
  estado_nuevo      text,
  motivo            kcm.motivo,

  -- Sin FK a propósito: la auditoría debe sobrevivir a cualquier reorganización
  -- de las entidades que describe y no puede quedar sujeta a su integridad
  -- referencial. Es un ledger, no una tabla hija.
  sesion_id         uuid,
  solicitud_id      kcm.identificador_solicitud,
  evidencia_id      uuid,

  -- Procedencia: qué fuente originó el hecho auditado. El diseño exige que la
  -- auditoría la lleve explícitamente.
  procedencia       kcm.origen_fuente NOT NULL DEFAULT 'PLATAFORMA',

  contrato_version  text NOT NULL DEFAULT '1.0.0',

  CONSTRAINT auditoria_entidad_tipo_no_vacio CHECK (btrim(entidad_tipo) <> ''),
  CONSTRAINT auditoria_entidad_id_no_vacio   CHECK (btrim(entidad_id) <> ''),
  CONSTRAINT auditoria_accion_no_vacia       CHECK (btrim(accion) <> '')
);

COMMENT ON TABLE kcm.auditoria IS
  'Hoja AUDITORIA. Ledger de sólo agregado con actor, rol, entidad, acción, estados, motivo, requestId y procedencia (función 7).';
COMMENT ON COLUMN kcm.auditoria.secuencia IS
  'Orden total de eventos; desempata timestamps iguales.';
COMMENT ON COLUMN kcm.auditoria.sesion_id IS
  'Sin clave foránea deliberadamente: un ledger no puede depender de la vigencia de la entidad que describe.';

CREATE INDEX auditoria_entidad_idx     ON kcm.auditoria (entidad_tipo, entidad_id, secuencia DESC);
CREATE INDEX auditoria_sesion_idx      ON kcm.auditoria (sesion_id, secuencia DESC) WHERE sesion_id IS NOT NULL;
CREATE INDEX auditoria_solicitud_idx   ON kcm.auditoria (solicitud_id) WHERE solicitud_id IS NOT NULL;
CREATE INDEX auditoria_ocurrido_en_idx ON kcm.auditoria (ocurrido_en DESC);

CREATE TRIGGER auditoria_solo_agrega
  BEFORE UPDATE OR DELETE ON kcm.auditoria
  FOR EACH ROW EXECUTE FUNCTION kcm.impedir_modificacion();

CREATE TRIGGER auditoria_sin_truncado
  BEFORE TRUNCATE ON kcm.auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION kcm.impedir_modificacion();

-- -----------------------------------------------------------------------------
-- Errores sanitizados
-- -----------------------------------------------------------------------------
-- Hoja `ERRORES`. Nunca guarda datos personales: sólo código, operación y un
-- mensaje ya sanitizado por la aplicación.
CREATE TABLE kcm.errores (
  error_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocurrido_en   timestamptz NOT NULL DEFAULT now(),
  solicitud_id  kcm.identificador_solicitud,
  operacion     text NOT NULL,
  categoria     text NOT NULL,
  mensaje_seguro text NOT NULL,
  reintentable  boolean NOT NULL DEFAULT false,
  resuelto_en   timestamptz,
  contrato_version text NOT NULL DEFAULT '1.0.0',

  CONSTRAINT errores_operacion_no_vacia CHECK (btrim(operacion) <> ''),
  CONSTRAINT errores_mensaje_longitud   CHECK (length(mensaje_seguro) <= 2000)
);

COMMENT ON TABLE kcm.errores IS
  'Hoja ERRORES. Diagnóstico sanitizado: código, operación y mensaje sin identidades ni números de trabajador.';
COMMENT ON COLUMN kcm.errores.mensaje_seguro IS
  'Mensaje ya sanitizado por la aplicación. Frontera de privacidad: nunca contiene nombres ni números de trabajador.';

CREATE INDEX errores_pendientes_idx ON kcm.errores (ocurrido_en DESC) WHERE resuelto_en IS NULL;
