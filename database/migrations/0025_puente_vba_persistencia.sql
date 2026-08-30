-- =============================================================================
-- 0025 — Persistencia real del puente VBA
--
-- El contrato `KCM_VBA_BRIDGE_V1` está implementado de los dos lados —cliente en
-- `clients/excel/vba/` y servidor en `app/src/domain/excel/`— pero el esquema no podía
-- guardar lo que ese contrato mueve. Punto por punto:
--
--   1. `credencial_equipo` no tenía `client_id`, `recurso` ni la sal del hash.
--      El cliente se identifica con `CLIENT_ID` y el servidor autentica por
--      (clientId, alcance, recurso); sin esas tres columnas ninguna credencial
--      emitida podía volver a encontrarse. El `algoritmo` además declaraba
--      argon2id cuando el servicio deriva con scrypt.
--   2. `useNonce` no tenía dónde escribir. Sin nonce persistido, la garantía de
--      "una solicitud se recibe una sola vez" dura lo que dure el proceso.
--   3. `acuse_liberacion_vba.sha256_xlsb` era NOT NULL. Un acuse de conflicto
--      —`HEADER_MISMATCH`, `EXISTING_VALUE`, `DESTINATION_MISSING`— no trae
--      huella del libro porque no se guardó nada: la restricción impedía
--      registrar justamente los casos que hay que revisar. Faltaba también el
--      detalle textual del conflicto.
--   4. `MATRIX_IMPORT_V1` conserva el snapshot entre la vista previa y la
--      aprobación; no existía tabla para él.
--   5. `STATUS_V1` lee eventos DC-3 del puente y la tabla nunca se creó.
--   6. `RELEASE_PULL_V1` necesita las liberaciones efectivas todavía sin acuse,
--      resueltas contra el mapeo declarado. Eso es una consulta, y vive en la
--      superficie de lectura para que el puente no toque el dominio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Credencial por equipo: identidad completa del cliente
-- -----------------------------------------------------------------------------
ALTER TABLE kcm.credencial_equipo
  ADD COLUMN client_id text,
  ADD COLUMN recurso   text,
  ADD COLUMN sal       text;

-- La tabla está vacía: las tres son obligatorias desde el primer registro.
ALTER TABLE kcm.credencial_equipo
  ALTER COLUMN client_id SET NOT NULL,
  ALTER COLUMN recurso   SET NOT NULL,
  ALTER COLUMN sal       SET NOT NULL,
  ALTER COLUMN algoritmo SET DEFAULT 'scrypt';

ALTER TABLE kcm.credencial_equipo
  ADD CONSTRAINT credencial_partes_cliente_no_vacias
    CHECK (btrim(client_id) <> '' AND btrim(recurso) <> '' AND btrim(sal) <> ''),
  -- El puente autentica siempre contra el recurso `bridge`; Power Query usa el
  -- nombre del archivo que consume. Se enumeran para que un recurso mal escrito
  -- falle al emitir y no en la primera llamada del cliente.
  ADD CONSTRAINT credencial_recurso_conocido
    CHECK (
      (alcance = 'PUENTE_VBA' AND recurso = 'bridge')
      OR (alcance = 'POWER_QUERY_LECTURA' AND recurso <> '')
    );

COMMENT ON COLUMN kcm.credencial_equipo.client_id IS
  'CLIENT_ID declarado en la hoja KCM_CONFIG del libro controlador.';
COMMENT ON COLUMN kcm.credencial_equipo.sal IS
  'Sal hexadecimal del scrypt. El secreto en claro se muestra una vez y no se persiste.';

CREATE UNIQUE INDEX credencial_cliente_vigente_unica
  ON kcm.credencial_equipo (client_id, alcance, recurso)
  WHERE revocada_en IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Nonces del puente
-- -----------------------------------------------------------------------------
-- Un nonce se acepta una sola vez por cliente. La fila caduca sola: la ventana
-- del servidor son cinco minutos de desfase y diez de retención.
CREATE TABLE kcm.nonce_puente (
  client_id   text NOT NULL,
  nonce       text NOT NULL,
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (client_id, nonce),
  CONSTRAINT nonce_puente_partes_no_vacias
    CHECK (btrim(client_id) <> '' AND btrim(nonce) <> '')
);

COMMENT ON TABLE kcm.nonce_puente IS
  'Nonces consumidos del puente VBA. La unicidad de la llave primaria es la garantía de un solo uso.';

CREATE INDEX nonce_puente_expiracion_idx ON kcm.nonce_puente (expira_en);

-- -----------------------------------------------------------------------------
-- 3. Acuses: los conflictos también se registran
-- -----------------------------------------------------------------------------
ALTER TABLE kcm.acuse_liberacion_vba
  ALTER COLUMN sha256_xlsb DROP NOT NULL;

ALTER TABLE kcm.acuse_liberacion_vba
  ADD COLUMN detalle text;

ALTER TABLE kcm.acuse_liberacion_vba
  ADD CONSTRAINT acuse_vba_huella_si_efectivo
    CHECK (
      (estado IN ('APPLIED', 'RECOVERED') AND sha256_xlsb IS NOT NULL)
      OR estado NOT IN ('APPLIED', 'RECOVERED')
    );

COMMENT ON COLUMN kcm.acuse_liberacion_vba.sha256_xlsb IS
  'Huella del XLSB tras guardar. Obligatoria sólo en APPLIED y RECOVERED: un conflicto no escribió nada.';
COMMENT ON COLUMN kcm.acuse_liberacion_vba.detalle IS
  'Descripción del conflicto tal como la envió el cliente. Se conserva para revisión humana.';

-- Un mismo acuse efectivo no puede registrarse dos veces; un reintento de un
-- acuse de conflicto sí agrega historial, que es el comportamiento declarado.
CREATE UNIQUE INDEX acuse_vba_efectivo_unico
  ON kcm.acuse_liberacion_vba (clave_idempotencia)
  WHERE estado IN ('APPLIED', 'RECOVERED');

-- -----------------------------------------------------------------------------
-- 4. Snapshot de importación entre vista previa y aprobación
-- -----------------------------------------------------------------------------
CREATE TABLE kcm.snapshot_importacion (
  importacion_id  uuid PRIMARY KEY REFERENCES kcm.lote_importacion (importacion_id) ON DELETE CASCADE,
  snapshot        jsonb NOT NULL,
  guardado_en     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE kcm.snapshot_importacion IS
  'Snapshot HC_SNAPSHOT_V1 recibido, conservado entre la vista previa y la aprobación del lote.';

-- -----------------------------------------------------------------------------
-- 5. Eventos DC-3 reportados por el puente
-- -----------------------------------------------------------------------------
-- El cliente dejó de emitir DC-3 el 2026-08-01, pero la acción sigue viva en el
-- servidor y `STATUS_V1` la consulta. La tabla existe para que esa lectura no
-- falle y para conservar lo que una instalación anterior hubiera reportado.
-- Retirar la acción es una decisión aparte.
CREATE TABLE kcm.evento_dc3_vba (
  evento_id         text PRIMARY KEY,
  solicitud_id      kcm.identificador_solicitud NOT NULL,
  client_id         text NOT NULL,
  dc3_key           text NOT NULL,
  numero_trabajador kcm.numero_trabajador NOT NULL,
  clave_curso       text NOT NULL,
  fecha_curso       date,
  estado            text NOT NULL,
  sha256_archivo    kcm.sha256,
  generado_en       timestamptz,
  codigo_error      text,
  recibido_en       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evento_dc3_vba_estado_valido
    CHECK (estado IN ('GENERADO', 'REPETIDO', 'BLOQUEADO')),
  CONSTRAINT evento_dc3_vba_huella_si_generado
    CHECK ((estado IN ('GENERADO', 'REPETIDO')) = (sha256_archivo IS NOT NULL))
);

COMMENT ON TABLE kcm.evento_dc3_vba IS
  'Historial append-only de eventos DC-3 reportados por el puente. La vista operativa toma el más reciente por dc3_key.';

CREATE INDEX evento_dc3_vba_clave_idx ON kcm.evento_dc3_vba (dc3_key, recibido_en DESC);

CREATE TRIGGER evento_dc3_vba_solo_agrega
  BEFORE UPDATE OR DELETE ON kcm.evento_dc3_vba
  FOR EACH ROW EXECUTE FUNCTION kcm.impedir_modificacion();

CREATE TRIGGER evento_dc3_vba_sin_truncado
  BEFORE TRUNCATE ON kcm.evento_dc3_vba
  FOR EACH STATEMENT EXECUTE FUNCTION kcm.impedir_modificacion();

-- -----------------------------------------------------------------------------
-- 6. RLS deny-by-default en las tablas nuevas
-- -----------------------------------------------------------------------------
ALTER TABLE kcm.nonce_puente ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.nonce_puente FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.snapshot_importacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.snapshot_importacion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.evento_dc3_vba ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.evento_dc3_vba FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 7. RELEASE_PULL_V1: lo que el cliente debe escribir en el XLSB
-- -----------------------------------------------------------------------------
-- Devuelve exactamente las doce columnas del TSV del contrato, en su orden, ya
-- resueltas contra el mapeo vigente y el destino declarado. Una liberación sin
-- mapeo activo no se entrega: escribir sin destino declarado está prohibido.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_liberaciones_pendientes(p_limite integer DEFAULT 500)
RETURNS TABLE (
  idempotency_key       text,
  batch_id              text,
  session_id            text,
  employee_id           kcm.numero_trabajador,
  training_id           text,
  completion_date       text,
  destination_sheet     text,
  destination_column    text,
  header_row            integer,
  destination_header    text,
  target_mapping_version text,
  overwrite_policy      kcm.politica_sobrescritura
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    l.clave_idempotencia,
    l.lote_id::text,
    l.sesion_id::text,
    t.numero_trabajador,
    c.clave_curso,
    to_char(l.fecha_efectiva, 'YYYY-MM-DD'),
    m.hoja,
    m.columna,
    m.fila_encabezado,
    m.encabezado_esperado,
    m.version_mapeo,
    m.politica_sobrescritura
  FROM kcm.liberacion l
  JOIN kcm.trabajador t ON t.trabajador_id = l.trabajador_id
  JOIN kcm.capacitacion c ON c.capacitacion_id = l.capacitacion_id
  JOIN kcm.mapeo_matriz m
    ON m.capacitacion_id = l.capacitacion_id
   AND m.version_mapeo = l.version_mapeo
   AND m.vigente_hasta IS NULL
  JOIN kcm.destino_matriz d
    ON d.destino_id = m.destino_id AND d.activo = true
  WHERE NOT EXISTS (
    SELECT 1 FROM kcm.acuse_liberacion_vba a
     WHERE a.clave_idempotencia = l.clave_idempotencia
       AND a.estado IN ('APPLIED', 'RECOVERED')
  )
  ORDER BY l.creada_en, l.clave_idempotencia
  LIMIT GREATEST(p_limite, 0);
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_liberaciones_pendientes(integer) IS
  'Liberaciones efectivas sin acuse aplicado, resueltas contra el mapeo vigente. Es la carga de RELEASE_PULL_V1.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_liberaciones_pendientes(integer) TO authenticated;

-- Padrón mínimo que consume Power Query, con la misma proyección del CSV.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_padron_power_query()
RETURNS TABLE (
  employee_id kcm.numero_trabajador,
  department  text,
  area        text,
  -- `position` es palabra reservada de PostgreSQL; va entrecomillada para que
  -- el CSV conserve el nombre de columna que Power Query ya espera.
  "position"  text,
  active      boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.numero_trabajador,
    COALESCE(d.nombre, ''),
    COALESCE(a.nombre, ''),
    COALESCE(p.nombre, ''),
    t.activo
  FROM kcm.trabajador t
  LEFT JOIN kcm.departamento d ON d.departamento_id = t.departamento_id
  LEFT JOIN kcm.area a ON a.area_id = t.area_id
  LEFT JOIN kcm.puesto p ON p.puesto_id = t.puesto_id
  ORDER BY t.numero_trabajador;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_padron_power_query() IS
  'Proyección del padrón para el CSV de Power Query. Sin nombre, CURP ni fecha de alta.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_padron_power_query() TO authenticated;
