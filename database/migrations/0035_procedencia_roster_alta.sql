-- =============================================================================
-- 0035 — Procedencia `ROSTER_ALTA` para la fecha de inducción
--
-- RECUPERADA DEL HISTORIAL REMOTO (2026-08-06). Aplicada al proyecto Supabase
-- como `20260806075111`; no existía como archivo en el repositorio.
--
-- `ALTER TYPE ... ADD VALUE` no puede usarse en la misma transacción que lo
-- agrega: si esta migración se aplica junto con datos que ya escriban
-- 'ROSTER_ALTA', debe correr en su propia transacción, antes que ellos.
-- =============================================================================

-- La fecha de INDUCCION A LA EMPRESA no viene del XLSB ni de una sesion liberada:
-- es la fecha de alta del padron semanal (SND ACTIVOS / EMP ACTIVOS). Declararla
-- como procedencia propia mantiene la trazabilidad: un registro de induccion
-- nunca debe confundirse con una fecha capturada en la matriz.
ALTER TYPE kcm.procedencia_fecha ADD VALUE IF NOT EXISTS 'ROSTER_ALTA';
