-- =============================================================================
-- Compatibilidad con Supabase para una base PostgreSQL normal
--
-- Las migraciones se escribieron contra Supabase y dan por hechos tres roles
-- que un PostgreSQL recién instalado no tiene. `0017` y `0018` les conceden
-- permisos por nombre:
--
--   REVOKE ALL ON SCHEMA kcm FROM PUBLIC, anon, authenticated;
--   GRANT USAGE ON SCHEMA kcm_lectura TO authenticated, anon;
--
-- Sin los roles, esas dos migraciones fallan con «role does not exist» y la
-- base local no se puede levantar. Crearlos aquí permite que las migraciones
-- del árbol se apliquen sin ninguna modificación, que es lo que mantiene
-- una sola fuente de verdad entre el entorno local y Supabase.
--
-- Este archivo NO se aplica a Supabase: allí los tres roles ya existen y los
-- administra la plataforma. Sólo lo corre `aplicar-migraciones.js --local`.
--
-- Los tres son `NOLOGIN`: nadie se conecta con ellos. Existen únicamente para
-- ser el destinatario de un `GRANT` y para que el deny-by-default de la RLS
-- tenga a quién negarle el acceso.
-- =============================================================================

DO $$
BEGIN
  -- Rol de visitante sin sesión. En Supabase lo usa PostgREST para peticiones
  -- anónimas. Aquí no lo usa nadie, pero `0018` le concede USAGE sobre
  -- `kcm_lectura` y EXECUTE sobre la ocupación de salas, que es la única
  -- superficie pública del sistema.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;

  -- Rol de usuario con sesión iniciada. Recibe EXECUTE sobre las funciones de
  -- lectura de ficha, resumen departamental, sesiones operativas y padrón.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;

  -- No lo nombra ninguna migración, pero existe en Supabase y su ausencia
  -- confundiría a quien compare las dos bases. Se crea sin BYPASSRLS: en local
  -- no hay razón para tener un rol capaz de atravesar la seguridad por fila.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT;
  END IF;
END;
$$;

-- El aviso de que esta base es de desarrollo lo pone `semilla-sintetica.sql`,
-- no este archivo: aqui el esquema `kcm` todavia no existe —lo crea `0001`— y
-- un COMMENT sobre un esquema ausente detendria el arranque.
