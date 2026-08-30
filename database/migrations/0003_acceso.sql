-- =============================================================================
-- 0003 — Identidad, roles, concesiones y credenciales
-- Fuente: docs/arquitectura/MODELO_DATOS.md hoja `ACCESOS` (segunda
--         contraseña del quiosco; credencial por equipo revocable y caducable
--         para Excel).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Actor
-- -----------------------------------------------------------------------------
-- Supabase Auth autentica; esta tabla es la identidad DURABLE de la plataforma.
-- Son cosas distintas a propósito: la auditoría referencia actores para siempre
-- y no puede quedar colgada si alguien se borra de `auth.users`. Por eso no hay
-- clave foránea hacia el esquema `auth`, sino un enlace opcional y único.
CREATE TABLE kcm.actor (
  actor_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid UNIQUE,
  identificador   text NOT NULL UNIQUE,
  nombre_visible  text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT actor_identificador_no_vacio CHECK (btrim(identificador) <> '')
);

COMMENT ON TABLE kcm.actor IS
  'Identidad durable de la plataforma. Sin FK a auth.users: la auditoría referencia actores para siempre y no puede romperse si Auth borra la cuenta.';
COMMENT ON COLUMN kcm.actor.auth_user_id IS
  'Enlace opcional con Supabase Auth. Nulo mientras la persona no tenga cuenta o si su cuenta se retiró.';

CREATE TRIGGER actor_actualizacion
  BEFORE UPDATE ON kcm.actor
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Asignación de rol
-- -----------------------------------------------------------------------------
-- Un actor puede tener varios roles y cada asignación tiene vigencia propia.
-- Retirar un rol es cerrar su vigencia, no borrar la fila.
CREATE TABLE kcm.asignacion_rol (
  asignacion_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid NOT NULL REFERENCES kcm.actor (actor_id),
  rol             kcm.rol NOT NULL,
  otorgado_por    uuid NOT NULL REFERENCES kcm.actor (actor_id),
  vigente_desde   timestamptz NOT NULL DEFAULT now(),
  vigente_hasta   timestamptz,
  motivo_retiro   kcm.motivo,
  creado_en       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT asignacion_rol_vigencia
    CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  CONSTRAINT asignacion_rol_retiro_con_motivo
    CHECK (vigente_hasta IS NULL OR motivo_retiro IS NOT NULL)
);

COMMENT ON TABLE kcm.asignacion_rol IS
  'Roles con vigencia. Retirar un rol cierra su vigencia con motivo; no borra la fila.';

-- Un rol vigente por actor a la vez. `vigente_hasta IS NULL` es inmutable, así
-- que sirve como predicado de índice; `now()` no lo sería.
CREATE UNIQUE INDEX asignacion_rol_vigente_unica
  ON kcm.asignacion_rol (actor_id, rol)
  WHERE vigente_hasta IS NULL;

-- -----------------------------------------------------------------------------
-- Concesiones de plataforma
-- -----------------------------------------------------------------------------
-- Hoja `ACCESOS`. Token corto, de un solo uso, ligado a sesión y estación.
CREATE TABLE kcm.concesion (
  concesion_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL,
  sesion_id       uuid,
  codigo_hash     text NOT NULL,
  estado          text NOT NULL DEFAULT 'EMITIDA',
  emitida_por     uuid NOT NULL REFERENCES kcm.actor (actor_id),
  emitida_con_rol kcm.rol NOT NULL,
  emitida_en      timestamptz NOT NULL DEFAULT now(),
  expira_en       timestamptz NOT NULL,
  consumida_en    timestamptz,
  consumida_por   uuid REFERENCES kcm.actor (actor_id),
  estacion        text,
  solicitud_id    kcm.identificador_solicitud,

  CONSTRAINT concesion_estado_valido
    CHECK (estado IN ('EMITIDA', 'CONSUMIDA', 'EXPIRADA', 'REVOCADA')),
  CONSTRAINT concesion_caduca CHECK (expira_en > emitida_en),
  CONSTRAINT concesion_consumo_coherente
    CHECK ((estado = 'CONSUMIDA') = (consumida_en IS NOT NULL))
);

COMMENT ON TABLE kcm.concesion IS
  'Hoja ACCESOS. Concesiones de un solo uso ligadas a sesión y estación. Se guarda el hash del código, nunca el código.';
COMMENT ON COLUMN kcm.concesion.codigo_hash IS
  'Hash del código. El valor en claro nunca se persiste.';

CREATE INDEX concesion_sesion_idx ON kcm.concesion (sesion_id) WHERE sesion_id IS NOT NULL;
CREATE UNIQUE INDEX concesion_solicitud_unica
  ON kcm.concesion (solicitud_id) WHERE solicitud_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Secretos de operación — la segunda contraseña
-- -----------------------------------------------------------------------------
-- distintos, con alcances separados y auditoría independiente". El alcance es
-- un enum de dos valores, así que un secreto no puede servir para lo otro.
CREATE TABLE kcm.secreto_operacion (
  secreto_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alcance         kcm.alcance_secreto NOT NULL,
  secreto_hash    text NOT NULL,
  algoritmo       text NOT NULL DEFAULT 'argon2id',
  vigente_desde   timestamptz NOT NULL DEFAULT now(),
  expira_en       timestamptz,
  revocado_en     timestamptz,
  revocado_por    uuid REFERENCES kcm.actor (actor_id),
  motivo_revocacion kcm.motivo,
  creado_por      uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creado_en       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT secreto_vigencia CHECK (expira_en IS NULL OR expira_en > vigente_desde),
  CONSTRAINT secreto_revocacion_coherente
    CHECK ((revocado_en IS NULL) = (revocado_por IS NULL)),
  CONSTRAINT secreto_revocacion_con_motivo
    CHECK (revocado_en IS NULL OR motivo_revocacion IS NOT NULL)
);

COMMENT ON TABLE kcm.secreto_operacion IS
  'Segunda contraseña. Registrarse en el quiosco y abrir sesión desde la sala son dos secretos con alcances separados. Sólo se guarda el hash.';

-- Un secreto vigente por alcance. Rotar es revocar el anterior y crear otro.
CREATE UNIQUE INDEX secreto_operacion_vigente_unico
  ON kcm.secreto_operacion (alcance)
  WHERE revocado_en IS NULL;

-- -----------------------------------------------------------------------------
-- Credencial por equipo — Excel (funciones 10 y 11)
-- -----------------------------------------------------------------------------
-- Sustituye a un token compartido por todas las instalaciones. La identidad es la
-- combinación de principal, perfil de Windows y equipo.
--
-- `expira_en` es NOT NULL a propósito: el diseño exige que sea CADUCABLE, y una
-- credencial sin fecha de expiración no lo es. La caducidad no puede quedar
-- como convención de la aplicación.
--
-- Excel nunca recibe credenciales de base de datos: aquí sólo vive un hash que
-- el servidor revalida en cada consulta.
CREATE TABLE kcm.credencial_equipo (
  credencial_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal         text NOT NULL,
  perfil_windows    text NOT NULL,
  equipo            text NOT NULL,
  alcance           text NOT NULL,
  credencial_hash   text NOT NULL,
  algoritmo         text NOT NULL DEFAULT 'argon2id',
  emitida_por       uuid NOT NULL REFERENCES kcm.actor (actor_id),
  emitida_en        timestamptz NOT NULL DEFAULT now(),
  expira_en         timestamptz NOT NULL,
  revocada_en       timestamptz,
  revocada_por      uuid REFERENCES kcm.actor (actor_id),
  motivo_revocacion kcm.motivo,
  ultimo_uso_en     timestamptz,

  CONSTRAINT credencial_alcance_valido
    CHECK (alcance IN ('POWER_QUERY_LECTURA', 'PUENTE_VBA')),
  CONSTRAINT credencial_caduca CHECK (expira_en > emitida_en),
  CONSTRAINT credencial_revocacion_coherente
    CHECK ((revocada_en IS NULL) = (revocada_por IS NULL)),
  CONSTRAINT credencial_revocacion_con_motivo
    CHECK (revocada_en IS NULL OR motivo_revocacion IS NOT NULL),
  CONSTRAINT credencial_partes_no_vacias
    CHECK (btrim(principal) <> '' AND btrim(perfil_windows) <> '' AND btrim(equipo) <> '')
);

COMMENT ON TABLE kcm.credencial_equipo IS
  'Credencial por combinación de usuario, perfil de Windows y equipo (funciones 10 y 11). Revocable y caducable: expira_en es obligatoria.';
COMMENT ON COLUMN kcm.credencial_equipo.credencial_hash IS
  'Hash. Excel nunca recibe un token de la plataforma ni credenciales de base de datos.';

CREATE UNIQUE INDEX credencial_equipo_vigente_unica
  ON kcm.credencial_equipo (principal, perfil_windows, equipo, alcance)
  WHERE revocada_en IS NULL;
