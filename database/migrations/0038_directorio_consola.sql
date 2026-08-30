-- =============================================================================
-- 0038 — Directorio de acceso a la consola
--
-- Antes de esta migración `/acceso` comparaba contra un usuario y una contraseña planos
-- leídos del entorno: una sola cuenta, sin rotación, sin bitácora por persona y
-- prohibida en producción por `loadConfig`. Esta tabla es el directorio que esa
-- pantalla no tenía.
--
-- Tres decisiones que no se ven en el DDL:
--
--   1. La contraseña no se guarda. Sólo su derivación scrypt de 32 bytes y
--      la sal, igual que `kcm.credencial_equipo`: un mismo esquema de secretos
--      en toda la plataforma y un solo lugar donde revisarlo.
--   2. El usuario es único sin distinguir mayúsculas y sólo entre las
--      cuentas vigentes. Retirar una cuenta y volver a darla de alta con el
--      mismo nombre es legítimo; tener dos activas con el mismo nombre no.
--   3. El retiro es revocación, no borrado: conserva quién, cuándo y por qué.
-- =============================================================================

CREATE TABLE kcm.credencial_consola (
  credencial_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario           text NOT NULL,
  nombre_visible    text NOT NULL,
  credencial_hash   text NOT NULL,
  sal               text NOT NULL,
  algoritmo         text NOT NULL DEFAULT 'scrypt',
  emitida_por       uuid NOT NULL REFERENCES kcm.actor (actor_id),
  emitida_en        timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso_en  timestamptz,
  revocada_en       timestamptz,
  revocada_por      uuid REFERENCES kcm.actor (actor_id),
  motivo_revocacion kcm.motivo,

  CONSTRAINT credencial_consola_partes_no_vacias
    CHECK (btrim(usuario) <> '' AND btrim(nombre_visible) <> ''
           AND btrim(credencial_hash) <> '' AND btrim(sal) <> ''),
  -- El usuario viaja en un formulario y termina en la bitácora: se acota a lo
  -- que una cuenta necesita y se prohíbe el espacio, que sólo produce cuentas
  -- que se tecleen distinto y se lean igual.
  CONSTRAINT credencial_consola_usuario_con_forma
    CHECK (usuario ~ '^[A-Za-z0-9._-]{3,120}$'),
  CONSTRAINT credencial_consola_algoritmo_conocido
    CHECK (algoritmo = 'scrypt'),
  CONSTRAINT credencial_consola_revocacion_coherente
    CHECK ((revocada_en IS NULL) = (revocada_por IS NULL)),
  CONSTRAINT credencial_consola_revocacion_con_motivo
    CHECK (revocada_en IS NULL OR motivo_revocacion IS NOT NULL)
);

COMMENT ON TABLE kcm.credencial_consola IS
  'Directorio de acceso a la consola central. Una fila por persona; la contraseña sólo existe como derivación scrypt.';
COMMENT ON COLUMN kcm.credencial_consola.credencial_hash IS
  'scrypt(contraseña, sal) de 32 bytes en hexadecimal. La contraseña en claro no se persiste ni se registra.';
COMMENT ON COLUMN kcm.credencial_consola.ultimo_acceso_en IS
  'Última entrada aceptada. Es el único campo que la pantalla de acceso escribe.';

CREATE UNIQUE INDEX credencial_consola_usuario_vigente_unico
  ON kcm.credencial_consola (lower(usuario))
  WHERE revocada_en IS NULL;

ALTER TABLE kcm.credencial_consola ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.credencial_consola FORCE ROW LEVEL SECURITY;

-- El resto del esquema le da a `kcm_app` una política `app_acceso_total`. Aquí
-- no: la aplicación sólo necesita leer una cuenta para comprobar la contraseña
-- y anotar la hora de entrada. El alta y la baja de cuentas se hacen contra la
-- base con actor y motivo declarados, no desde una pantalla, y sin política de
-- INSERT ni de DELETE ese límite no depende de que el código lo respete.
CREATE POLICY app_lee_cuentas ON kcm.credencial_consola
  FOR SELECT TO kcm_app USING (true);

CREATE POLICY app_marca_ultimo_acceso ON kcm.credencial_consola
  FOR UPDATE TO kcm_app USING (true) WITH CHECK (true);
