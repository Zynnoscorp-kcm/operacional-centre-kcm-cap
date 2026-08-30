-- =============================================================================
-- 0020 — Corrección de kcm.marcar_actualizacion()
--
-- La versión de 0001 asignaba `NEW.actualizado_en` de forma fija. Cinco tablas
-- —`area`, `asistencia`, `capacitacion`, `reserva_sala` y `sesion`— declaran esa
-- columna en femenino (`actualizada_en`), así que cualquier UPDATE sobre ellas
-- abortaba con "record new has no field actualizado_en". Es decir: quiosco,
-- sesiones, catálogo y agenda quedaban inoperables en escritura.
--
-- La función resuelve ahora el nombre real de la columna. Si la tabla no declara
-- ninguna de las dos, devuelve la fila intacta en vez de fallar.
-- =============================================================================

CREATE OR REPLACE FUNCTION kcm.marcar_actualizacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_columna text;
  v_json jsonb;
BEGIN
  v_json := to_jsonb(NEW);

  IF v_json ? 'actualizado_en' THEN
    v_columna := 'actualizado_en';
  ELSIF v_json ? 'actualizada_en' THEN
    v_columna := 'actualizada_en';
  ELSE
    RETURN NEW;
  END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object(v_columna, now()));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION kcm.marcar_actualizacion() IS
  'Mantiene la marca de actualización sin confiar en que el cliente la envíe. Admite actualizado_en y actualizada_en.';

-- Aserción ejecutable de la corrección sobre una tabla en femenino.
DO $$
DECLARE
  v_marca timestamptz;
BEGIN
  -- La fila se siembra con una marca antigua: dentro de una transacción now()
  -- es constante, así que comparar contra `creada_en` no probaría nada.
  INSERT INTO kcm.capacitacion (clave_curso, nombre, nombre_normalizado, actualizada_en)
  VALUES ('__PRUEBA_TRIGGER__', 'prueba', 'prueba', '2000-01-01T00:00:00Z');

  UPDATE kcm.capacitacion SET nombre = 'prueba 2' WHERE clave_curso = '__PRUEBA_TRIGGER__';

  SELECT actualizada_en INTO v_marca
  FROM kcm.capacitacion WHERE clave_curso = '__PRUEBA_TRIGGER__';

  DELETE FROM kcm.capacitacion WHERE clave_curso = '__PRUEBA_TRIGGER__';

  IF v_marca <> now() THEN
    RAISE EXCEPTION 'El trigger no actualizó la columna en femenino (quedó en %).', v_marca;
  END IF;
END;
$$;
