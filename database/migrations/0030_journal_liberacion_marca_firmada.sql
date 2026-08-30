-- =============================================================================
-- 0030 — La marca de actualización del journal debe coincidir con su HMAC
--
-- `lote_liberacion` firma todos los datos operativos, incluida
-- `actualizado_en`. El trigger genérico sustituía esa marca por `now()` aun
-- cuando el servicio la había firmado, haciendo imposible reanudar un lote
-- legítimo después de cualquier avance de fase.
--
-- Este trigger se limita al journal: conserva una marca explícitamente
-- entregada por el servicio y sólo genera `now()` cuando el UPDATE no cambió
-- la marca. La autenticidad no descansa en la hora sino en `journal_mac`, que
-- el servicio vuelve a calcular antes de persistir cada transición.
-- =============================================================================

CREATE OR REPLACE FUNCTION kcm.marcar_actualizacion_lote_liberacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.actualizado_en IS NOT DISTINCT FROM OLD.actualizado_en THEN
    NEW.actualizado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lote_liberacion_actualizacion ON kcm.lote_liberacion;

CREATE TRIGGER lote_liberacion_actualizacion
  BEFORE UPDATE ON kcm.lote_liberacion
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion_lote_liberacion();

COMMENT ON FUNCTION kcm.marcar_actualizacion_lote_liberacion() IS
  'Conserva actualizado_en cuando viene firmado por el journal; usa now() sólo si no se proporcionó una marca nueva.';
