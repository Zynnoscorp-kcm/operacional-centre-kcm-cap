-- =============================================================================
-- 0013 — Acuses de ejecución del puente VBA (Excel Escritor)
-- Fuente: docs/arquitectura/MODELO_DATOS.md hoja `VBA_LIBERACION_ACUSES`
--         (función 10).
-- =============================================================================

CREATE TABLE kcm.acuse_liberacion_vba (
  acuse_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_idempotencia  text NOT NULL,
  lote_id             uuid NOT NULL REFERENCES kcm.lote_liberacion (lote_id) ON DELETE RESTRICT,
  cliente_equipo      text NOT NULL,
  version_mapeo       text NOT NULL,
  fecha_capacitacion  date NOT NULL,
  estado              kcm.estado_acuse_vba NOT NULL,
  sha256_xlsb         kcm.sha256 NOT NULL,
  direccion_aplicada  text,
  mensaje_error       text,
  solicitud_id        kcm.identificador_solicitud NOT NULL,
  recibido_en         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT acuse_vba_clave_no_vacia CHECK (btrim(clave_idempotencia) <> ''),
  CONSTRAINT acuse_vba_equipo_no_vacio CHECK (btrim(cliente_equipo) <> ''),
  CONSTRAINT acuse_vba_version_no_vacia CHECK (btrim(version_mapeo) <> '')
);

COMMENT ON TABLE kcm.acuse_liberacion_vba IS
  'Hoja VBA_LIBERACION_ACUSES. Ledger append-only de acuses de aplicación física en el XLSB por el cliente VBA.';

CREATE INDEX acuse_vba_lote_idx ON kcm.acuse_liberacion_vba (lote_id);
CREATE INDEX acuse_vba_clave_idx ON kcm.acuse_liberacion_vba (clave_idempotencia);
CREATE INDEX acuse_vba_estado_idx ON kcm.acuse_liberacion_vba (estado);
CREATE INDEX acuse_vba_recibido_idx ON kcm.acuse_liberacion_vba (recibido_en DESC);

CREATE TRIGGER acuse_liberacion_vba_solo_agrega
  BEFORE UPDATE OR DELETE ON kcm.acuse_liberacion_vba
  FOR EACH ROW EXECUTE FUNCTION kcm.impedir_modificacion();

CREATE TRIGGER acuse_liberacion_vba_sin_truncado
  BEFORE TRUNCATE ON kcm.acuse_liberacion_vba
  FOR EACH STATEMENT EXECUTE FUNCTION kcm.impedir_modificacion();
