-- =============================================================================
-- 0041 — La clave de ocupación baja del puesto al trabajador
--
-- La migración `0004` colocó la ocupación específica del DC-3 en
-- `kcm.puesto.clave_cno`, con este razonamiento: la ocupación describe al
-- puesto, así que todos los que ocupan el mismo puesto comparten clave. El
-- padrón semanal lo implementó tal cual: consolida la clave por puesto y
-- rechaza sin escribir el puesto que llega con dos claves distintas, para no
-- dejar a la mitad de esa gente con la ocupación equivocada impresa en un
-- documento oficial.
--
-- El departamento corrigió la premisa: la clave varía según el
-- puesto y el área de cada trabajador. Con esa regla, un mismo puesto que
-- existe en dos áreas trae legítimamente dos claves, y la regla anterior lo
-- convierte en conflicto: no escribiría ninguna de las dos. La consolidación
-- por puesto no es una simplificación conservadora, es una pérdida de dato.
--
-- Esta migración mueve el dato a donde el departamento dice que vive.
--
--   1. `kcm.trabajador` recibe la clave, su actor aprobador y el momento, con
--      la misma coherencia que `kcm.puesto`: una clasificación legal la firma
--      alguien, o no existe.
--   2. `kcm.puesto.clave_cno` se conserva. No se borra nada: es lo que hoy
--      imprime el DC-3 y sigue sirviendo de respaldo para el trabajador que aún
--      no tenga clave propia. La lectura prefiere la del trabajador.
--   3. Se copia hacia abajo lo que el puesto ya tenía, conservando su firma.
--      Sin eso, aplicar esta migración dejaría en blanco un recuadro que hoy se
--      imprime lleno.
--
-- Reparación de datos, no replayable: el paso 3 depende del estado de
-- `kcm.puesto` al momento de aplicarla. Reaplicarla sobre una base ya migrada
-- es inocua —el `WHERE` la vuelve un no-op— pero no reconstruye el mismo estado
-- desde cero.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La clave, su firma y su momento
-- -----------------------------------------------------------------------------
ALTER TABLE kcm.trabajador
  ADD COLUMN clave_ocupacion        text,
  ADD COLUMN descripcion_ocupacion  text,
  ADD COLUMN aprobado_ocupacion_por uuid REFERENCES kcm.actor (actor_id),
  ADD COLUMN aprobado_ocupacion_en  timestamptz;

ALTER TABLE kcm.trabajador
  ADD CONSTRAINT trabajador_ocupacion_coherente
    CHECK ((clave_ocupacion IS NULL) = (aprobado_ocupacion_por IS NULL)),
  -- No se valida la forma de la clave. El catálogo usa claves numéricas, pero
  -- mientras Capacitación no declare por escrito cuál es el formato obligatorio,
  -- rechazar aquí una clave con otra forma sería inventar una regla. Lo que sí
  -- se impide es lo que evidentemente no es una clave.
  ADD CONSTRAINT trabajador_ocupacion_longitud
    CHECK (clave_ocupacion IS NULL OR length(btrim(clave_ocupacion)) BETWEEN 1 AND 20);

COMMENT ON COLUMN kcm.trabajador.clave_ocupacion IS
  'Clave de ocupación que imprime el recuadro «Ocupación específica» del DC-3. Vive en el trabajador porque varía según su puesto y su área; la del puesto queda como respaldo.';
COMMENT ON COLUMN kcm.trabajador.aprobado_ocupacion_por IS
  'Quién firma la clasificación. La carga del padrón semanal firma como padron.semanal.';

CREATE INDEX trabajador_ocupacion_idx
  ON kcm.trabajador (clave_ocupacion)
  WHERE clave_ocupacion IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Lo que el puesto ya tenía baja al trabajador, con su firma original
-- -----------------------------------------------------------------------------
-- Se conserva el actor y el momento del puesto en lugar de firmar de nuevo: la
-- clasificación es la misma que alguien ya aprobó, y refirmarla hoy borraría
-- cuándo se decidió de verdad.
UPDATE kcm.trabajador t
   SET clave_ocupacion        = p.clave_cno,
       descripcion_ocupacion  = p.descripcion_cno,
       aprobado_ocupacion_por = p.aprobado_cno_por,
       aprobado_ocupacion_en  = p.aprobado_cno_en
  FROM kcm.puesto p
 WHERE p.puesto_id = t.puesto_id
   AND p.clave_cno IS NOT NULL
   AND p.aprobado_cno_por IS NOT NULL
   AND t.clave_ocupacion IS NULL;

-- -----------------------------------------------------------------------------
-- 3. La clave del puesto deja de ser lo que el padrón escribe
-- -----------------------------------------------------------------------------
-- No se retira la columna ni se toca su contenido: sigue respaldando al
-- trabajador sin clave propia y sigue siendo el mapeo declarado del catálogo de
-- puestos. Lo que cambia es quién la escribe, y eso vive en la aplicación.
COMMENT ON COLUMN kcm.puesto.clave_cno IS
  'Mapeo del puesto al Catálogo Nacional de Ocupaciones. Respaldo del trabajador sin clave propia desde 0041; el padrón semanal ya no lo escribe.';
