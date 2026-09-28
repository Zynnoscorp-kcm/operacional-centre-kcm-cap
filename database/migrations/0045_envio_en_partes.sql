-- =============================================================================
-- 0045 — Envíos en partes desde Excel
--
-- La nube corta cada petición en 4.5 MB. Hoy el barrido completo de la matriz
-- viaja en ~2 MB y el padrón en menos de 1 MB, pero un libro que crezca no debe
-- depender de encender la plataforma en una computadora del departamento. Lo
-- que pasa de ~3 MB, Excel lo parte y manda las partes una tras otra con la
-- misma credencial y la misma solicitud; cada una puede caer en una instancia
-- distinta, así que esperan aquí hasta que llega la última y el envío se
-- procesa completo, con la acción original.
--
-- No es un ledger: es un borrador. Las partes vencen en una hora y se borran
-- solas al guardar la siguiente, por eso `kcm_app` sí puede borrarlas. No se
-- borran al juntarse: si la respuesta de la última se pierde y Excel la
-- repite, el envío se vuelve a juntar y la acción responde lo mismo.
--
-- Sigue las convenciones de 0043: la entidad principal primero (`envio_parte`,
-- como `liberacion_acuse` o `sesion_evidencia`), `cliente_id` y
-- `solicitud_id` como en el resto de la base, los conteos como `total_*` y las
-- marcas de tiempo terminadas en `_en`.
-- =============================================================================

CREATE TABLE sistema.envio_parte (
  cliente_id        text        NOT NULL,
  solicitud_id      text        NOT NULL,
  total_caracteres  integer     NOT NULL,
  numero_parte      integer     NOT NULL,
  total_partes      integer     NOT NULL,
  accion            text        NOT NULL,
  contenido         text        NOT NULL,
  recibida_en       timestamptz NOT NULL DEFAULT now(),
  vence_en          timestamptz NOT NULL,

  PRIMARY KEY (cliente_id, solicitud_id, total_caracteres, numero_parte),
  CONSTRAINT envio_parte_numero_en_rango
    CHECK (numero_parte BETWEEN 1 AND total_partes),
  CONSTRAINT envio_parte_total_partes_en_rango
    CHECK (total_partes BETWEEN 2 AND 64),
  CONSTRAINT envio_parte_total_caracteres_positivo
    CHECK (total_caracteres > 0),
  CONSTRAINT envio_parte_contenido_no_vacio
    CHECK (contenido <> ''),
  CONSTRAINT envio_parte_identificadores_no_vacios
    CHECK (btrim(cliente_id) <> '' AND btrim(solicitud_id) <> '' AND btrim(accion) <> '')
);

CREATE INDEX envio_parte_vence_en_idx ON sistema.envio_parte (vence_en);

COMMENT ON TABLE sistema.envio_parte IS
  'Partes de un envío de Excel que no cabe en una sola petición. Esperan a la última y vencen en una hora.';
COMMENT ON COLUMN sistema.envio_parte.cliente_id IS
  'Equipo que envía, como en seguridad.credencial_equipo.';
COMMENT ON COLUMN sistema.envio_parte.solicitud_id IS
  'Solicitud del envío completo: todas sus partes la comparten.';
COMMENT ON COLUMN sistema.envio_parte.total_caracteres IS
  'Largo del envío completo en base64 web-safe; al juntar las partes tiene que coincidir.';
COMMENT ON COLUMN sistema.envio_parte.numero_parte IS
  'Número de esta parte, desde 1.';
COMMENT ON COLUMN sistema.envio_parte.accion IS
  'Acción del puente que se ejecuta con el envío completo (por ejemplo MATRIX_SCAN_V1).';
COMMENT ON COLUMN sistema.envio_parte.vence_en IS
  'Después de esta hora la parte ya no cuenta y se borra al guardar la siguiente.';

COMMENT ON SCHEMA sistema IS
  'Bitácoras de auditoría y errores, archivos almacenados, revisiones pendientes, envíos en partes y marca de corrida piloto.';

ALTER TABLE sistema.envio_parte ENABLE ROW LEVEL SECURITY;
ALTER TABLE sistema.envio_parte FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sistema.envio_parte FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON sistema.envio_parte TO kcm_app;
CREATE POLICY app_acceso_total ON sistema.envio_parte
  FOR ALL TO kcm_app USING (true) WITH CHECK (true);
