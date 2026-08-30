-- =============================================================================
-- 0032 — Credenciales Excel con vencimiento opcional
--
-- Una instalación física puede conservar una credencial sin fecha de vencimiento
-- cuando el responsable la emite explícitamente. No equivale a una credencial
-- irrestrita: sigue ligada a client_id, alcance, recurso y secreto scrypt, y la
-- revocación conserva actor, fecha y motivo.
-- =============================================================================

ALTER TABLE kcm.credencial_equipo
  ALTER COLUMN expira_en DROP NOT NULL;

COMMENT ON COLUMN kcm.credencial_equipo.expira_en IS
  'Momento de vencimiento de la credencial; NULL sólo para una asignación permanente emitida de forma explícita. La revocación sigue siendo obligatoria y auditable.';
