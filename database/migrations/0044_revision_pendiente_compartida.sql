-- =============================================================================
-- 0044 — Revisiones pendientes compartidas entre instancias
--
-- El barrido de la matriz y el padrón semanal se leen en una petición y se
-- aplican en otra. Hasta aquí la revisión vivía en la memoria del proceso, que
-- basta en una máquina con un solo proceso. Publicada en un alojamiento con
-- varias instancias, el «Aplicar» puede caer en una instancia que nunca leyó el
-- archivo y contestar «la revisión ya no está disponible».
--
-- Una fila por tipo: una revisión nueva sustituye a la anterior, igual que en
-- memoria. No es un ledger: es un borrador que se borra al aplicarse o al
-- descartarse, y por eso `kcm_app` sí puede borrarla.
--
-- El contenido es el snapshot barrido o el plan del padrón: del orden de 1.5 MB
-- de JSON para la matriz completa de hoy. Vive a lo sumo treinta minutos.
-- =============================================================================

CREATE TABLE sistema.revision_pendiente (
  tipo         text PRIMARY KEY,
  revision_id  text NOT NULL,
  contenido    jsonb NOT NULL,
  vence_en     timestamptz NOT NULL,
  guardada_en  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT revision_pendiente_tipo_conocido
    CHECK (tipo IN ('BARRIDO_MATRIZ', 'PADRON')),
  CONSTRAINT revision_pendiente_id_no_vacio
    CHECK (btrim(revision_id) <> '')
);

COMMENT ON TABLE sistema.revision_pendiente IS
  'Revisión de barrido o de padrón que espera «Aplicar». Compartida entre instancias; se borra al aplicarse o descartarse.';

ALTER TABLE sistema.revision_pendiente ENABLE ROW LEVEL SECURITY;
ALTER TABLE sistema.revision_pendiente FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sistema.revision_pendiente FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON sistema.revision_pendiente TO kcm_app;
CREATE POLICY app_acceso_total ON sistema.revision_pendiente
  FOR ALL TO kcm_app USING (true) WITH CHECK (true);
