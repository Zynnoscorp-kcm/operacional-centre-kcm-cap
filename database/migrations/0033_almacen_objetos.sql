-- =============================================================================
-- 0033 — Almacén de objetos en la base
--
-- Las evidencias de preliberación son PDF con nombres y números de trabajador.
-- Antes de esta migración vivían en el disco del proceso (`FileObjectStore`), lo que era
-- correcto con Node corriendo en una máquina de oficina y deja de serlo en un
-- alojamiento sin disco persistente: la carpeta se vacía en cada redespliegue y
-- en cada ciclo de suspensión, mientras `kcm.evidencia` conserva el apuntador.
-- El resultado no es un error visible sino una evidencia que desaparece.
--
-- Se guardan como `bytea` en la propia base y no en un bucket externo por tres
-- razones: no introduce una credencial nueva —la más peligrosa sería la llave
-- de servicio, que salta RLS—, no agrega un salto de red que pueda fallar
-- aparte de la transacción que registra la evidencia, y el volumen no lo
-- justifica: un reporte ronda los cientos de kilobytes y se emiten decenas al
-- mes contra 500 MB disponibles.
--
-- Si algún día el volumen cambia de orden de magnitud, el puerto
-- `ObjectStorePort` ya aísla esta decisión y migrar a Storage es sustituir un
-- adaptador.
-- =============================================================================

CREATE TABLE kcm.objeto_almacenado (
  -- La ruta lógica que emite el dominio. Es la llave: el mismo reporte
  -- regenerado sobrescribe su contenido en lugar de duplicar la fila.
  ruta        text        PRIMARY KEY,
  contenido   bytea       NOT NULL,
  tipo_mime   text        NOT NULL,
  bytes       integer     NOT NULL GENERATED ALWAYS AS (octet_length(contenido)) STORED,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE kcm.objeto_almacenado IS
  'Almacén de objetos binarios de la plataforma (evidencias PDF de preliberación). Sustituye al disco del proceso, que no persiste entre despliegues.';
COMMENT ON COLUMN kcm.objeto_almacenado.ruta IS
  'Ruta lógica emitida por el dominio. Coincide con kcm.evidencia.storage_path.';

ALTER TABLE kcm.objeto_almacenado ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.objeto_almacenado FORCE ROW LEVEL SECURITY;

-- Mismo patrón que `kcm.evidencia`: el deny-by-default sigue en pie y el acceso
-- del rol de aplicación queda enumerado, no heredado.
CREATE POLICY app_acceso_total ON kcm.objeto_almacenado
  FOR ALL TO kcm_app USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE kcm.objeto_almacenado TO kcm_app;
