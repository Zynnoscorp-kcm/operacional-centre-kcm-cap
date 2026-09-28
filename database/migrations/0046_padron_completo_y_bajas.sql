-- =============================================================================
-- 0046 — El padrón completo y la baja cuando falta en las dos fuentes
--
-- El departamento pidió el 2026-09-25 que el panel de cambios cubra todas las
-- columnas del padrón semanal, no sólo las que alimentan el DC-3. Para ver qué
-- cambió de una semana a otra hay que guardar lo de la semana anterior, así
-- que el trabajador recibe los datos que el padrón trae y hoy se descartan:
-- RFC, número de seguro social, centro de costos, dirección, código postal,
-- estado civil y sexo. La antigüedad (años, meses, días) no se guarda: se
-- calcula de la fecha de alta y cambiaría todos los días.
--
-- Y la baja. Nadie se daba de baja: la matriz reactiva a quien trae y el
-- padrón sólo avisaba de ausencias. La regla del departamento: un trabajador
-- se da de baja cuando no aparece ni en el padrón ni en la matriz. Las dos
-- fuentes se aplican por separado, en días distintos, así que cada una anota
-- en el trabajador si lo vio en su última carga, y la que se aplica después
-- decide con las dos marcas. Es una columna por fuente y un UPDATE por carga:
-- no hace falta guardar ni volver a leer el archivo de la otra.
--
-- Las marcas nacen en verdadero. Hasta que cada fuente se aplique una vez con
-- esta regla no hay de dónde saber quién falta, y nacer en falso daría de baja
-- a media planta con la primera carga.
--
-- `fecha_baja` es la que declara el padrón en sus hojas de bajas, para
-- enseñarla. La baja en sí es `activo = false`; nada se borra, porque el
-- historial de capacitación y las constancias apuntan al trabajador.
-- =============================================================================

ALTER TABLE organizacion.trabajador
  ADD COLUMN rfc                   text,
  ADD COLUMN nss                   text,
  ADD COLUMN centro_costos_clave   text,
  ADD COLUMN centro_costos_nombre  text,
  ADD COLUMN direccion             text,
  ADD COLUMN codigo_postal         text,
  ADD COLUMN estado_civil          text,
  ADD COLUMN sexo                  text,
  ADD COLUMN visto_en_padron       boolean NOT NULL DEFAULT true,
  ADD COLUMN visto_en_matriz       boolean NOT NULL DEFAULT true,
  ADD COLUMN fecha_baja            date;

COMMENT ON COLUMN organizacion.trabajador.visto_en_padron IS
  'Si el último padrón aplicado lo traía en sus hojas de activos. Con visto_en_matriz en falso también, el trabajador se da de baja.';
COMMENT ON COLUMN organizacion.trabajador.visto_en_matriz IS
  'Si la última matriz aplicada lo traía. Con visto_en_padron en falso también, el trabajador se da de baja.';
COMMENT ON COLUMN organizacion.trabajador.fecha_baja IS
  'Fecha de baja que declara el padrón en SND BAJAS o EMP BAJAS. Informativa: la baja es activo = false.';
COMMENT ON COLUMN organizacion.trabajador.rfc IS 'RFC tal como lo trae el padrón.';
COMMENT ON COLUMN organizacion.trabajador.nss IS 'Número de seguro social (columna I.M.S.S. del padrón).';
COMMENT ON COLUMN organizacion.trabajador.centro_costos_clave IS 'CVE C COSTOS del padrón.';
COMMENT ON COLUMN organizacion.trabajador.centro_costos_nombre IS 'NOMBRE C COSTOS del padrón.';
