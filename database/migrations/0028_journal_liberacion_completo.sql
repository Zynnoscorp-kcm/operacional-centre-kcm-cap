-- =============================================================================
-- 0028 — El journal de liberación conserva lo que el dominio necesita releer
--
-- `ReleaseBatch` y `ReleaseEffect` traen cuatro datos que la tabla no podía
-- guardar, y sin ellos una reanudación no puede reconstruir el lote:
--
--   · `sessionOutcome`: si la sesión quedó liberada total o parcial. Sin él, un
--     replay no sabe a qué estado devolver la sesión.
--   · `overwriteReason`: el motivo que autorizó la sobrescritura. El diseño exige
--     actor y motivo; perderlo dejaría el historial sin su justificación.
--   · `contractVersion`: la versión con la que se firmó el journal.
--   · `attendanceId` en el efecto: el vínculo con la asistencia que lo originó.
--
-- Guardarlos dentro del JSON de resultados los volvía inconsultables y
-- dependientes de una forma que nadie valida.
-- =============================================================================

ALTER TABLE kcm.lote_liberacion
  ADD COLUMN resultado_sesion     text,
  ADD COLUMN motivo_sobrescritura text,
  ADD COLUMN contrato_version     text NOT NULL DEFAULT '1.0.0';

ALTER TABLE kcm.lote_liberacion
  ADD CONSTRAINT lote_liberacion_resultado_valido
    CHECK (resultado_sesion IS NULL OR resultado_sesion IN ('LIBERADA_TOTAL', 'LIBERADA_PARCIAL'));

COMMENT ON COLUMN kcm.lote_liberacion.motivo_sobrescritura IS
  'Motivo que autorizó sobrescribir un valor previo. Sin él no hay sobrescritura gobernada.';

ALTER TABLE kcm.liberacion
  ADD COLUMN asistencia_id uuid REFERENCES kcm.asistencia (asistencia_id) ON DELETE SET NULL;

COMMENT ON COLUMN kcm.liberacion.asistencia_id IS
  'Asistencia que originó el efecto. Permite reparar su estado en una reanudación.';

CREATE INDEX liberacion_asistencia_idx
  ON kcm.liberacion (asistencia_id) WHERE asistencia_id IS NOT NULL;
