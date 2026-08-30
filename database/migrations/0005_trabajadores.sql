-- =============================================================================
-- 0005 — Padrón de trabajadores y atributos declarados
-- Fuente: docs/arquitectura/MODELO_DATOS.md hojas `EMPLEADOS` y
--         `HC_TRABAJADORES`. Separa el núcleo tipado de las dos columnas
--         declaradas —escolaridad por omisión y categoría derivada— con su
--         procedencia y vigencia.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trabajadores
-- -----------------------------------------------------------------------------
-- Hoja `EMPLEADOS` y `HC_TRABAJADORES`. Núcleo tipado y verificado de la persona.
-- Invariante: `numero_trabajador` es texto de cinco dígitos y jamás integer.
CREATE TABLE kcm.trabajador (
  trabajador_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_trabajador kcm.numero_trabajador NOT NULL UNIQUE,
  nombre_completo   text NOT NULL,
  fecha_alta        date,
  tipo_nomina       text,
  puesto_id         uuid REFERENCES kcm.puesto (puesto_id) ON DELETE SET NULL,
  departamento_id   uuid REFERENCES kcm.departamento (departamento_id) ON DELETE SET NULL,
  area_id           uuid REFERENCES kcm.area (area_id) ON DELETE SET NULL,
  planta            text,
  curp              text,
  activo            boolean NOT NULL DEFAULT true,
  hash_fuente       text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,

  CONSTRAINT trabajador_nombre_no_vacio CHECK (btrim(nombre_completo) <> ''),
  CONSTRAINT trabajador_curp_formato
    CHECK (curp IS NULL OR curp ~ '^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$')
);

COMMENT ON TABLE kcm.trabajador IS
  'Hoja EMPLEADOS / HC_TRABAJADORES. Padrón del personal con identidad tipada e invariante de 5 dígitos.';
COMMENT ON COLUMN kcm.trabajador.fecha_alta IS
  'hireDate. Fuente exclusiva de la antigüedad calculada.';
COMMENT ON COLUMN kcm.trabajador.curp IS
  'CURP oficial validada por formato de 18 caracteres. Requerida para constancia DC-3.';

CREATE INDEX trabajador_puesto_idx ON kcm.trabajador (puesto_id);
CREATE INDEX trabajador_depto_idx ON kcm.trabajador (departamento_id);
CREATE INDEX trabajador_area_idx ON kcm.trabajador (area_id);
CREATE INDEX trabajador_activo_idx ON kcm.trabajador (activo);

CREATE TRIGGER trabajador_actualizacion
  BEFORE UPDATE ON kcm.trabajador
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Atributos declarados con procedencia y vigencia
-- -----------------------------------------------------------------------------
-- Criterio de diseño: "Separar el núcleo tipado de las dos columnas
-- declaradas —escolaridad y categoría— con procedencia y vigencia."
--
-- Invariantes específicos:
-- 1. Escolaridad: Arranca con 'Preparatoria' por omisión para toda la plantilla,
--    marcado con `declarado_por_omision = true`, procedencia `DECLARADO_POR_OMISION`.
--    No alimenta reglas ni porcentajes hasta que RH entregue fuente real.
-- 2. Categoría: Derivada de `position` (e.g. `*OPERARIO 1°` -> `OPER 1ª`),
--    procedencia `DERIVADO_DE_PUESTO`.
-- 3. Retirar o modificar un atributo cierra su vigencia (`vigente_hasta = now()`)
--    y crea una nueva fila; nunca sobrescribe el hecho histórico.
CREATE TABLE kcm.atributo_declarado (
  atributo_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id         uuid NOT NULL REFERENCES kcm.trabajador (trabajador_id) ON DELETE CASCADE,
  nombre_atributo       text NOT NULL,
  valor                 text NOT NULL,
  procedencia           kcm.procedencia_atributo NOT NULL,
  declarado_por_omision boolean NOT NULL DEFAULT false,
  vigente_desde         timestamptz NOT NULL DEFAULT now(),
  vigente_hasta         timestamptz,
  motivo_actualizacion  kcm.motivo,
  actualizado_por       uuid REFERENCES kcm.actor (actor_id),
  creado_en             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT atributo_nombre_no_vacio CHECK (btrim(nombre_atributo) <> ''),
  CONSTRAINT atributo_valor_no_vacio CHECK (btrim(valor) <> ''),
  CONSTRAINT atributo_vigencia_valida
    CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  CONSTRAINT atributo_retiro_con_motivo
    CHECK (vigente_hasta IS NULL OR motivo_actualizacion IS NOT NULL),
  CONSTRAINT atributo_omision_coherente
    CHECK ((procedencia = 'DECLARADO_POR_OMISION') = (declarado_por_omision = true))
);

COMMENT ON TABLE kcm.atributo_declarado IS
  'Atributos declarados con procedencia y vigencia (escolaridad por omisión y categoría derivada).';
COMMENT ON COLUMN kcm.atributo_declarado.declarado_por_omision IS
  'Verdadero si el valor es provisional. Un valor por omisión tiene prohibido alimentar reglas.';

-- Un atributo vigente por trabajador a la vez
CREATE UNIQUE INDEX atributo_declarado_vigente_unico
  ON kcm.atributo_declarado (trabajador_id, nombre_atributo)
  WHERE vigente_hasta IS NULL;

CREATE INDEX atributo_declarado_trabajador_idx
  ON kcm.atributo_declarado (trabajador_id);
