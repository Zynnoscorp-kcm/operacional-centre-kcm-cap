-- =============================================================================
-- 0026 — Marca de corrida piloto
--
-- El proyecto Supabase se usa como entorno de prueba del piloto. Los datos que
-- entren a partir de aquí NO son productivos y deben borrarse antes de cargar
-- el padrón real.
--
-- La marca no es documentación externa: es una fila viva, un comentario en el
-- propio esquema y una función que cualquiera puede consultar. Mientras exista
-- una corrida abierta, la base declara por sí misma que está sucia.
--
-- El cierre NO es borrar filas: auditoría, liberaciones, acuses e historiales son
-- append-only y sus triggers rechazan DELETE por diseño. El cierre es tirar los
-- dos esquemas y reaplicar 0001–0026. Ver `database/RESET.md`.
-- =============================================================================

CREATE TABLE kcm.corrida_piloto (
  piloto_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  etiqueta      text NOT NULL,
  proposito     kcm.motivo NOT NULL,
  abierta_en    timestamptz NOT NULL DEFAULT now(),
  cerrada_en    timestamptz,
  cerrada_por   text,
  motivo_cierre kcm.motivo,

  CONSTRAINT corrida_piloto_etiqueta_no_vacia CHECK (btrim(etiqueta) <> ''),
  CONSTRAINT corrida_piloto_cierre_coherente
    CHECK ((cerrada_en IS NULL) = (motivo_cierre IS NULL))
);

COMMENT ON TABLE kcm.corrida_piloto IS
  'ATENCION: si hay una fila con cerrada_en NULL, esta base contiene datos de prueba que deben borrarse.';

-- Una sola corrida abierta a la vez: dos pilotos simultáneos harían imposible
-- saber qué datos pertenecen a cuál.
CREATE UNIQUE INDEX corrida_piloto_abierta_unica
  ON kcm.corrida_piloto ((true))
  WHERE cerrada_en IS NULL;

ALTER TABLE kcm.corrida_piloto ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.corrida_piloto FORCE ROW LEVEL SECURITY;

INSERT INTO kcm.corrida_piloto (etiqueta, proposito)
VALUES (
  'PILOTO-2026-08-03',
  'Prueba de extremo a extremo: sesion, quiosco, preliberacion, liberacion y escritura en el XLSB por el puente VBA. Ningun dato de esta corrida es productivo.'
);

-- El comentario del esquema lo ve cualquier cliente SQL, el panel de Supabase y
-- `\dn+` en psql. Se revierte al reaplicar 0001 tras el reset.
COMMENT ON SCHEMA kcm IS
  'DATOS DE PRUEBA — PILOTO-2026-08-03 ABIERTO. Esta base NO es productiva: debe reconstruirse antes de cargar el padron real. Ver database/RESET.md.';

-- -----------------------------------------------------------------------------
-- Estado del piloto, consultable sin abrir el dominio
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kcm_lectura.estado_piloto()
RETURNS TABLE (
  hay_corrida_abierta boolean,
  etiqueta            text,
  abierta_en          timestamptz,
  dias_abierta        integer,
  trabajadores        bigint,
  sesiones            bigint,
  asistencias         bigint,
  registros_hc        bigint,
  liberaciones        bigint,
  acuses_vba          bigint,
  eventos_auditoria   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    c.piloto_id IS NOT NULL,
    c.etiqueta,
    c.abierta_en,
    CASE WHEN c.abierta_en IS NULL THEN NULL
         ELSE date_part('day', now() - c.abierta_en)::integer END,
    (SELECT count(*) FROM kcm.trabajador),
    (SELECT count(*) FROM kcm.sesion),
    (SELECT count(*) FROM kcm.asistencia),
    (SELECT count(*) FROM kcm.registro_hc),
    (SELECT count(*) FROM kcm.liberacion),
    (SELECT count(*) FROM kcm.acuse_liberacion_vba),
    (SELECT count(*) FROM kcm.auditoria)
  FROM (SELECT NULL::uuid AS piloto_id, NULL::text AS etiqueta, NULL::timestamptz AS abierta_en) vacio
  FULL OUTER JOIN (
    SELECT piloto_id, etiqueta, abierta_en
    FROM kcm.corrida_piloto WHERE cerrada_en IS NULL LIMIT 1
  ) c ON true
  LIMIT 1;
$$;

COMMENT ON FUNCTION kcm_lectura.estado_piloto() IS
  'Responde si la base trae datos de prueba y cuantos. Consultarla antes de cualquier carga real.';

GRANT EXECUTE ON FUNCTION kcm_lectura.estado_piloto() TO authenticated;

INSERT INTO kcm.auditoria (actor, rol, entidad_tipo, entidad_id, accion, estado_nuevo, motivo, procedencia)
VALUES (
  'sistema.configuracion', 'ADMINISTRADOR', 'CORRIDA_PILOTO', 'PILOTO-2026-08-03',
  'PILOTO_ABIERTO', 'ABIERTA',
  'La base queda declarada como entorno de prueba. Debe reconstruirse antes de cargar datos reales.',
  'DEPARTAMENTO'
);
