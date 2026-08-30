-- =============================================================================
-- 0029 — Rol de aplicación sin BYPASSRLS
--
-- RECUPERADA DEL HISTORIAL REMOTO (2026-08-06). Esta migración se aplicó al
-- proyecto Supabase el 2026-08-03 (`20260803191105`) pero nunca existió como
-- archivo en el repositorio. Sin ella, reconstruir la base desde `db/migrations`
-- deja la plataforma sin el rol con el que se conecta.
--
-- ÚNICA DESVIACIÓN respecto de lo aplicado: la versión remota lleva la
-- contraseña del rol escrita en claro dentro del propio SQL, y por tanto
-- almacenada en `supabase_migrations.schema_migrations`. Aquí se lee de un
-- parámetro de sesión, porque ningún secreto vive en el árbol. Antes de aplicar:
--
--     SET kcm.app_password = '<contraseña del rol kcm_app>';
--
-- `current_setting` sin ese SET lanza excepción y la migración falla cerrada, en
-- lugar de crear un rol con una contraseña inventada.
-- =============================================================================

-- El deny-by-default se conserva intacto: `anon` y `authenticated` siguen sin
-- ninguna política y sin permisos sobre `kcm`. Lo que cambia es que la
-- aplicación deja de conectarse como `postgres` —que tiene BYPASSRLS y por eso
-- atravesaba la RLS sin que ninguna política lo autorizara— y pasa a usar un rol
-- propio, sin ese privilegio, cuyo acceso queda enumerado en políticas
-- explícitas. La diferencia práctica: hoy el acceso de la app es auditable y
-- revocable tabla por tabla.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kcm_app') THEN
    EXECUTE format(
      'CREATE ROLE kcm_app LOGIN PASSWORD %L NOBYPASSRLS',
      current_setting('kcm.app_password')
    );
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA kcm, kcm_lectura, extensions TO kcm_app;

-- Sin DELETE: los ledgers ya lo rechazan por trigger, y en el resto del dominio
-- "borrar" es una transición de estado, nunca la desaparición de la fila.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA kcm TO kcm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kcm TO kcm_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kcm_lectura TO kcm_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA kcm
  GRANT SELECT, INSERT, UPDATE ON TABLES TO kcm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA kcm_lectura
  GRANT EXECUTE ON FUNCTIONS TO kcm_app;

-- Una política por tabla, nombrada igual, para que la cobertura se pueda
-- comprobar con una consulta y no leyendo el archivo.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'kcm' AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'CREATE POLICY app_acceso_total ON kcm.%I FOR ALL TO kcm_app USING (true) WITH CHECK (true);',
      t.relname
    );
  END LOOP;
END;
$$;

-- Aserción: ninguna tabla puede quedar sin la política de la aplicación, y el
-- rol no puede tener BYPASSRLS.
DO $$
DECLARE
  v_sin_politica integer;
  v_bypass boolean;
BEGIN
  SELECT count(*) INTO v_sin_politica
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'kcm' AND c.relkind = 'r'
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'kcm' AND p.tablename = c.relname
          AND p.policyname = 'app_acceso_total'
     );
  IF v_sin_politica > 0 THEN
    RAISE EXCEPTION '% tablas quedaron sin política para kcm_app.', v_sin_politica;
  END IF;

  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'kcm_app';
  IF v_bypass THEN
    RAISE EXCEPTION 'kcm_app no puede tener BYPASSRLS: anularia el deny-by-default.';
  END IF;
END;
$$;
