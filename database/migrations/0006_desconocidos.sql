-- =============================================================================
-- 0006 — Admisión de entidades y campos desconocidos
-- Compatibilidad hacia adelante: lo desconocido es el caso normal y se admite
-- declarándolo, no rechazándolo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Candidatos a cursos desconocidos
-- -----------------------------------------------------------------------------
-- Un curso nuevo detectado en un extracto, TSV o sistema externo ingresa como
-- candidato con su procedencia. Un aprobador decide su resolución:
-- 1. INCORPORADO: Se crea un nuevo curso en `kcm.capacitacion`.
-- 2. DECLARADO_ALIAS: Se asocia como alias en `kcm.alias_capacitacion` a un curso existente.
-- 3. RECHAZADO: Se rechaza formalmente con motivo.
CREATE TABLE kcm.candidato_curso (
  candidato_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave_origen              text NOT NULL,
  nombre_detectado          text NOT NULL,
  nombre_normalizado        text NOT NULL,
  origen_fuente             kcm.origen_fuente NOT NULL,
  estado                    kcm.estado_candidato NOT NULL DEFAULT 'PENDIENTE',
  capacitacion_id_asignada  uuid REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE SET NULL,
  motivo_resolucion         kcm.motivo,
  resuelto_por              uuid REFERENCES kcm.actor (actor_id),
  resuelto_en               timestamptz,
  creado_en                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT candidato_curso_clave_no_vacia CHECK (btrim(clave_origen) <> ''),
  CONSTRAINT candidato_curso_nombre_no_vacio CHECK (btrim(nombre_detectado) <> ''),
  CONSTRAINT candidato_curso_resolucion_coherente
    CHECK (
      (estado = 'PENDIENTE' AND resuelto_en IS NULL AND resuelto_por IS NULL)
      OR
      (estado <> 'PENDIENTE' AND resuelto_en IS NOT NULL AND resuelto_por IS NOT NULL AND motivo_resolucion IS NOT NULL)
    ),
  CONSTRAINT candidato_curso_incorporado_exige_fk
    CHECK (
      (estado IN ('INCORPORADO', 'DECLARADO_ALIAS') AND capacitacion_id_asignada IS NOT NULL)
      OR (estado NOT IN ('INCORPORADO', 'DECLARADO_ALIAS'))
    )
);

COMMENT ON TABLE kcm.candidato_curso IS
  'Flujo gobernado de admisión de cursos desconocidos. Admisión con origen, estado y resolución auditada.';

CREATE INDEX candidato_curso_estado_idx ON kcm.candidato_curso (estado);
CREATE INDEX candidato_curso_clave_idx ON kcm.candidato_curso (clave_origen);

-- -----------------------------------------------------------------------------
-- Candidatos a trabajadores desconocidos
-- -----------------------------------------------------------------------------
-- Un colaborador detectado en una lista, quiosco o extracto que no existe en el
-- padrón maestro ingresa como candidato sin bloquear el lote y sin duplicar identidades.
CREATE TABLE kcm.candidato_trabajador (
  candidato_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_trabajador       kcm.numero_trabajador NOT NULL,
  nombre_detectado        text NOT NULL,
  datos_laborales         jsonb NOT NULL DEFAULT '{}'::jsonb,
  origen_fuente           kcm.origen_fuente NOT NULL,
  estado                  kcm.estado_candidato NOT NULL DEFAULT 'PENDIENTE',
  trabajador_id_asignado  uuid REFERENCES kcm.trabajador (trabajador_id) ON DELETE SET NULL,
  motivo_resolucion       kcm.motivo,
  resuelto_por            uuid REFERENCES kcm.actor (actor_id),
  resuelto_en             timestamptz,
  creado_en               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT candidato_trabajador_nombre_no_vacio CHECK (btrim(nombre_detectado) <> ''),
  CONSTRAINT candidato_trabajador_resolucion_coherente
    CHECK (
      (estado = 'PENDIENTE' AND resuelto_en IS NULL AND resuelto_por IS NULL)
      OR
      (estado <> 'PENDIENTE' AND resuelto_en IS NOT NULL AND resuelto_por IS NOT NULL AND motivo_resolucion IS NOT NULL)
    ),
  CONSTRAINT candidato_trabajador_incorporado_exige_fk
    CHECK (
      (estado = 'INCORPORADO' AND trabajador_id_asignado IS NOT NULL)
      OR (estado <> 'INCORPORADO')
    )
);

COMMENT ON TABLE kcm.candidato_trabajador IS
  'Flujo gobernado de trabajadores desconocidos detectados en fuentes externas.';

CREATE INDEX candidato_trabajador_estado_idx ON kcm.candidato_trabajador (estado);
CREATE INDEX candidato_trabajador_num_idx ON kcm.candidato_trabajador (numero_trabajador);

-- -----------------------------------------------------------------------------
-- Registro de campos declarados (extensibilidad sin despliegue de código)
-- -----------------------------------------------------------------------------
-- y no afecta ninguna regla ni ningún porcentaje hasta que se autorice explícitamente."
CREATE TABLE kcm.campo_declarado (
  campo_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_campo          text NOT NULL UNIQUE,
  tipo_dato             text NOT NULL,
  descripcion           text,
  origen_fuente         kcm.origen_fuente NOT NULL,
  aprobado_para_reglas  boolean NOT NULL DEFAULT false,
  aprobado_por          uuid REFERENCES kcm.actor (actor_id),
  aprobado_en           timestamptz,
  creado_en             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campo_declarado_nombre_no_vacio CHECK (btrim(nombre_campo) <> ''),
  CONSTRAINT campo_declarado_tipo_valido CHECK (tipo_dato IN ('TEXTO', 'NUMERO', 'FECHA', 'BOOLEANO', 'JSON')),
  CONSTRAINT campo_declarado_aprobacion_coherente
    CHECK ((aprobado_para_reglas = false) OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL))
);

COMMENT ON TABLE kcm.campo_declarado IS
  'Definición de campos nuevos declarados. Prohibido su uso en reglas hasta su aprobación formal.';
