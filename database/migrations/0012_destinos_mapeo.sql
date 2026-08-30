-- =============================================================================
-- 0012 — Destinos de escritura declarados y mapeos de matriz
-- Fuente: docs/arquitectura/MODELO_DATOS.md hoja `MATRIZ_MAPEO`
-- ("Cada destino se declara como un objetivo con hoja, columna,
--         encabezado esperado y política propia; no existe escritura a un
--         archivo no declarado.").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Destinos declarados de matriz
-- -----------------------------------------------------------------------------
-- Archivos o libros XLSB/Excel autorizados como objetivo de sincronización.
CREATE TABLE kcm.destino_matriz (
  destino_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_destino          text NOT NULL UNIQUE,
  identificador_archivo   text NOT NULL,
  descripcion             text,
  activo                  boolean NOT NULL DEFAULT true,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT destino_nombre_no_vacio CHECK (btrim(nombre_destino) <> ''),
  CONSTRAINT destino_identificador_no_vacio CHECK (btrim(identificador_archivo) <> '')
);

COMMENT ON TABLE kcm.destino_matriz IS
  'Destinos de sincronización autorizados. Prohíbe cualquier escritura hacia archivos no declarados.';

CREATE TRIGGER destino_matriz_actualizacion
  BEFORE UPDATE ON kcm.destino_matriz
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- Mapeos de columna por capacitación y versión
-- -----------------------------------------------------------------------------
-- Hoja `MATRIZ_MAPEO`. Define con precisión matemática la celda/columna destino,
-- el encabezado esperado para verificación preflight y la política de sobrescritura.
CREATE TABLE kcm.mapeo_matriz (
  mapeo_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destino_id            uuid NOT NULL REFERENCES kcm.destino_matriz (destino_id) ON DELETE RESTRICT,
  capacitacion_id       uuid NOT NULL REFERENCES kcm.capacitacion (capacitacion_id) ON DELETE RESTRICT,
  version_mapeo         text NOT NULL,
  hoja                  text NOT NULL,
  columna               text NOT NULL,
  encabezado_esperado   text NOT NULL,
  fila_encabezado       integer NOT NULL DEFAULT 3,
  politica_sobrescritura kcm.politica_sobrescritura NOT NULL DEFAULT 'NO_OVERWRITE',
  vigente_desde         timestamptz NOT NULL DEFAULT now(),
  vigente_hasta         timestamptz,
  aprobado_por          uuid NOT NULL REFERENCES kcm.actor (actor_id),
  creado_en             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mapeo_version_no_vacia CHECK (btrim(version_mapeo) <> ''),
  CONSTRAINT mapeo_hoja_no_vacia CHECK (btrim(hoja) <> ''),
  CONSTRAINT mapeo_columna_no_vacia CHECK (btrim(columna) <> ''),
  CONSTRAINT mapeo_encabezado_no_vacio CHECK (btrim(encabezado_esperado) <> ''),
  CONSTRAINT mapeo_fila_positiva CHECK (fila_encabezado > 0),
  CONSTRAINT mapeo_vigencia_valida CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde)
);

COMMENT ON TABLE kcm.mapeo_matriz IS
  'Hoja MATRIZ_MAPEO. Declaración explícita de ubicación, encabezado esperado y política por columna.';

-- Un único mapeo vigente por destino, curso y versión
CREATE UNIQUE INDEX mapeo_matriz_vigente_unico
  ON kcm.mapeo_matriz (destino_id, capacitacion_id, version_mapeo)
  WHERE vigente_hasta IS NULL;

CREATE INDEX mapeo_matriz_destino_idx ON kcm.mapeo_matriz (destino_id);
CREATE INDEX mapeo_matriz_curso_idx ON kcm.mapeo_matriz (capacitacion_id);
