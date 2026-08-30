-- =============================================================================
-- 0031 — Permisos mínimos del nonce del puente para el rol de aplicación
--
-- El rol `kcm_app` ya tiene una política RLS explícita sobre
-- `kcm.nonce_puente`, pero la tabla fue creada después de la concesión inicial
-- de privilegios. Sin INSERT y DELETE, el puente falla antes de procesar toda
-- solicitud, incluso si la credencial es correcta.
-- =============================================================================

GRANT INSERT, DELETE ON TABLE kcm.nonce_puente TO kcm_app;
