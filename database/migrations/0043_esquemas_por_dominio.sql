-- =============================================================================
-- 0043 — Esquemas por dominio y nombres formales
--
-- Hasta aquí las 44 tablas vivían juntas en `kcm` y la superficie de lectura
-- en `kcm_lectura`. Un solo cajón con nombres heredados de cada etapa
-- (`registro_hc`, `acuse_liberacion_vba`, `evaluacion_dnc_snapshot`,
-- `errores` en plural, columnas `client_id` o `*_count`) obligaba a conocer
-- la historia del proyecto para leer la base.
--
-- Esta migración reparte las tablas en ocho esquemas por dominio y les da
-- nombres uniformes: sustantivo en singular, en español, con la entidad
-- principal primero (`liberacion_lote`, `sala_reserva`, `capacitacion_alias`).
--
--   organizacion  padrón y estructura de la empresa
--   catalogo      cursos, alias y salas
--   operacion     sesiones, asistencias, quiosco, reservas e historial
--   matriz        integración con la matriz de Excel y liberaciones
--   dnc           reglas y evaluación de necesidades de capacitación
--   dc3           constancias DC-3 y su configuración
--   seguridad     actores, roles, credenciales y secretos
--   sistema       bitácoras, archivos y marca de piloto
--   comun         (antes `kcm`) tipos, dominios y funciones de trigger
--   lectura       (antes `kcm_lectura`) vistas y funciones de lectura
--
-- Todo se hace con RENAME y SET SCHEMA: no se copia ni se pierde un solo
-- renglón, y la RLS, las políticas de `kcm_app`, los triggers, las llaves
-- foráneas y los privilegios viajan con cada tabla. Lo único que PostgreSQL no
-- sigue solo es el texto de las funciones SQL de `lectura`: se reescriben al
-- final con el mismo mapa.
--
-- `corrida_piloto` no existe en una base reconstruida (0026 no se reaplica),
-- por eso cada tabla se mueve sólo si existe.
-- =============================================================================

-- 1. Esquemas nuevos, con el mismo acceso que tenía `kcm`.
CREATE SCHEMA IF NOT EXISTS organizacion;
COMMENT ON SCHEMA organizacion IS 'Padrón y estructura de la empresa: patrón, departamentos, áreas, puestos y trabajadores.';
CREATE SCHEMA IF NOT EXISTS catalogo;
COMMENT ON SCHEMA catalogo IS 'Catálogo de capacitaciones (cursos), sus alias aprobados y las salas.';
CREATE SCHEMA IF NOT EXISTS operacion;
COMMENT ON SCHEMA operacion IS 'Operación diaria: sesiones, asistencias, quiosco, preliberación, reservas de sala e historial de capacitación.';
CREATE SCHEMA IF NOT EXISTS matriz;
COMMENT ON SCHEMA matriz IS 'Integración con la matriz de Excel: importaciones, desconocidos por resolver, mapeo de columnas y liberaciones.';
CREATE SCHEMA IF NOT EXISTS dnc;
COMMENT ON SCHEMA dnc IS 'Detección de necesidades de capacitación: reglas por área o departamento y su evaluación.';
CREATE SCHEMA IF NOT EXISTS dc3;
COMMENT ON SCHEMA dc3 IS 'Constancias DC-3: configuración por curso, áreas temáticas STPS, constancias emitidas y eventos del cliente Excel.';
CREATE SCHEMA IF NOT EXISTS seguridad;
COMMENT ON SCHEMA seguridad IS 'Actores, roles, credenciales, secretos, concesiones de quiosco y nonces del puente.';
CREATE SCHEMA IF NOT EXISTS sistema;
COMMENT ON SCHEMA sistema IS 'Bitácoras de auditoría y errores, archivos almacenados y marca de corrida piloto.';
REVOKE ALL ON SCHEMA organizacion, catalogo, operacion, matriz, dnc, dc3, seguridad, sistema FROM PUBLIC;
GRANT USAGE ON SCHEMA organizacion, catalogo, operacion, matriz, dnc, dc3, seguridad, sistema TO kcm_app, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA organizacion, catalogo, operacion, matriz, dnc, dc3, seguridad, sistema
  GRANT SELECT, INSERT, UPDATE ON TABLES TO kcm_app;

-- 2. Cada tabla a su esquema y con su nombre formal. Las restricciones,
--    índices y triggers que llevaban el nombre viejo como prefijo lo cambian.
DO $$
DECLARE
  m record;
  r record;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('patron', 'organizacion', 'patron'),
    ('departamento', 'organizacion', 'departamento'),
    ('area', 'organizacion', 'area'),
    ('puesto', 'organizacion', 'puesto'),
    ('trabajador', 'organizacion', 'trabajador'),
    ('atributo_declarado', 'organizacion', 'trabajador_atributo'),
    ('campo_declarado', 'organizacion', 'atributo_definicion'),
    ('capacitacion', 'catalogo', 'capacitacion'),
    ('alias_capacitacion', 'catalogo', 'capacitacion_alias'),
    ('sala', 'catalogo', 'sala'),
    ('sesion', 'operacion', 'sesion'),
    ('asistencia', 'operacion', 'asistencia'),
    ('registro_quiosco', 'operacion', 'quiosco_registro'),
    ('evidencia', 'operacion', 'sesion_evidencia'),
    ('revision_preliberacion', 'operacion', 'preliberacion_revision'),
    ('reserva_sala', 'operacion', 'sala_reserva'),
    ('registro_hc', 'operacion', 'historial_capacitacion'),
    ('historial_sobrescritura_fecha', 'operacion', 'historial_capacitacion_cambio'),
    ('lote_importacion', 'matriz', 'importacion'),
    ('snapshot_importacion', 'matriz', 'importacion_contenido'),
    ('candidato_trabajador', 'matriz', 'trabajador_desconocido'),
    ('candidato_curso', 'matriz', 'capacitacion_desconocida'),
    ('destino_matriz', 'matriz', 'destino'),
    ('mapeo_matriz', 'matriz', 'mapeo_columna'),
    ('lote_liberacion', 'matriz', 'liberacion_lote'),
    ('liberacion', 'matriz', 'liberacion'),
    ('acuse_liberacion_vba', 'matriz', 'liberacion_acuse'),
    ('regla_dnc', 'dnc', 'regla'),
    ('evaluacion_dnc_snapshot', 'dnc', 'evaluacion'),
    ('documento_dc3', 'dc3', 'constancia'),
    ('metadato_curso_dc3', 'dc3', 'curso_configuracion'),
    ('area_tematica_dc3', 'dc3', 'area_tematica'),
    ('evento_dc3_vba', 'dc3', 'evento_excel'),
    ('actor', 'seguridad', 'actor'),
    ('asignacion_rol', 'seguridad', 'actor_rol'),
    ('credencial_consola', 'seguridad', 'credencial_consola'),
    ('credencial_equipo', 'seguridad', 'credencial_equipo'),
    ('secreto_operacion', 'seguridad', 'secreto'),
    ('concesion', 'seguridad', 'concesion'),
    ('nonce_puente', 'seguridad', 'nonce'),
    ('auditoria', 'sistema', 'bitacora_auditoria'),
    ('errores', 'sistema', 'bitacora_error'),
    ('objeto_almacenado', 'sistema', 'archivo'),
    ('corrida_piloto', 'sistema', 'corrida_piloto')
  ) AS t (viejo, esquema, nuevo)
  LOOP
    CONTINUE WHEN to_regclass(format('kcm.%I', m.viejo)) IS NULL;

    EXECUTE format('ALTER TABLE kcm.%I SET SCHEMA %I', m.viejo, m.esquema);
    IF m.viejo <> m.nuevo THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', m.esquema, m.viejo, m.nuevo);

      FOR r IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = format('%I.%I', m.esquema, m.nuevo)::regclass
           AND conname LIKE m.viejo || '\_%'
      LOOP
        EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I', m.esquema, m.nuevo,
                       r.conname, m.nuevo || substr(r.conname, length(m.viejo) + 1));
      END LOOP;

      FOR r IN
        SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
         WHERE x.indrelid = format('%I.%I', m.esquema, m.nuevo)::regclass
           AND i.relname LIKE m.viejo || '\_%'
      LOOP
        EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', m.esquema, r.relname,
                       m.nuevo || substr(r.relname, length(m.viejo) + 1));
      END LOOP;

      FOR r IN
        SELECT tgname FROM pg_trigger
         WHERE tgrelid = format('%I.%I', m.esquema, m.nuevo)::regclass
           AND NOT tgisinternal
           AND tgname LIKE m.viejo || '\_%'
      LOOP
        EXECUTE format('ALTER TRIGGER %I ON %I.%I RENAME TO %I', r.tgname, m.esquema, m.nuevo,
                       m.nuevo || substr(r.tgname, length(m.viejo) + 1));
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 3. Columnas con nombre en inglés o con sufijo técnico.
ALTER TABLE dc3.evento_excel RENAME COLUMN client_id TO cliente_id;
ALTER TABLE dc3.evento_excel RENAME COLUMN dc3_key TO clave_dc3;
ALTER TABLE dc3.constancia RENAME COLUMN metadatos_snapshot TO metadatos_emision;
ALTER TABLE seguridad.credencial_equipo RENAME COLUMN client_id TO cliente_id;
ALTER TABLE seguridad.nonce RENAME COLUMN client_id TO cliente_id;
ALTER TABLE operacion.sesion_evidencia RENAME COLUMN mime_type TO tipo_mime;
ALTER TABLE operacion.sesion_evidencia RENAME COLUMN tamanio_bytes TO bytes;
ALTER TABLE operacion.sala_reserva RENAME COLUMN sha256_payload TO sha256_solicitud;
ALTER TABLE matriz.importacion RENAME COLUMN insertados_count TO total_insertados;
ALTER TABLE matriz.importacion RENAME COLUMN corregidos_count TO total_corregidos;
ALTER TABLE matriz.importacion RENAME COLUMN retirados_count TO total_retirados;
ALTER TABLE matriz.importacion RENAME COLUMN reactivados_count TO total_reactivados;
ALTER TABLE matriz.importacion RENAME COLUMN conflictos_count TO total_conflictos;
ALTER TABLE matriz.importacion RENAME COLUMN pendientes_maestro_count TO total_pendientes_maestro;
ALTER TABLE matriz.importacion_contenido RENAME COLUMN snapshot TO contenido;
ALTER TABLE matriz.liberacion_lote RENAME COLUMN journal_mac TO firma_hmac;

-- 4. Tipos que arrastraban el nombre de la tabla vieja o del cliente.
ALTER TYPE kcm.estado_acuse_vba RENAME TO estado_acuse;
ALTER TYPE kcm.estado_registro_hc RENAME TO estado_historial;
ALTER TYPE kcm.tipo_cambio_hc RENAME TO tipo_cambio_historial;
ALTER TYPE kcm.estado_lote_importacion RENAME TO estado_importacion;
ALTER TYPE kcm.alcance_lote RENAME TO alcance_importacion;
ALTER TYPE kcm.estado_lote_liberacion RENAME TO estado_liberacion;
ALTER TYPE kcm.fase_lote_liberacion RENAME TO fase_liberacion;
ALTER FUNCTION kcm.marcar_actualizacion_lote_liberacion() RENAME TO marcar_actualizacion_liberacion_lote;

-- 5. Lo que queda en `kcm` son tipos, dominios y funciones de trigger que usan
--    todos los esquemas: pasa a llamarse `comun`. La lectura pierde el prefijo.
ALTER SCHEMA kcm RENAME TO comun;
ALTER SCHEMA kcm_lectura RENAME TO lectura;
-- El aviso de piloto vivía en el comentario de `kcm`: se conserva mientras la
-- corrida siga abierta.
DO $$
BEGIN
  IF to_regclass('sistema.corrida_piloto') IS NULL THEN
    COMMENT ON SCHEMA comun IS 'Tipos, dominios y funciones de trigger compartidos por todos los esquemas.';
  END IF;
END $$;

-- 6. Las funciones SQL de `lectura` guardan su cuerpo como texto: se reescriben
--    con el mismo mapa. Primero las tablas, luego los tipos renombrados y al
--    final cualquier `kcm.` restante, que ya sólo puede ser un tipo de `comun`.
DO $$
DECLARE
  f record;
  m record;
  def text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'lectura'::regnamespace
  LOOP
    def := pg_get_functiondef(f.oid);
    FOR m IN SELECT * FROM (VALUES
      ('patron', 'organizacion.patron'),
      ('departamento', 'organizacion.departamento'),
      ('area', 'organizacion.area'),
      ('puesto', 'organizacion.puesto'),
      ('trabajador', 'organizacion.trabajador'),
      ('atributo_declarado', 'organizacion.trabajador_atributo'),
      ('campo_declarado', 'organizacion.atributo_definicion'),
      ('capacitacion', 'catalogo.capacitacion'),
      ('alias_capacitacion', 'catalogo.capacitacion_alias'),
      ('sala', 'catalogo.sala'),
      ('sesion', 'operacion.sesion'),
      ('asistencia', 'operacion.asistencia'),
      ('registro_quiosco', 'operacion.quiosco_registro'),
      ('evidencia', 'operacion.sesion_evidencia'),
      ('revision_preliberacion', 'operacion.preliberacion_revision'),
      ('reserva_sala', 'operacion.sala_reserva'),
      ('registro_hc', 'operacion.historial_capacitacion'),
      ('historial_sobrescritura_fecha', 'operacion.historial_capacitacion_cambio'),
      ('lote_importacion', 'matriz.importacion'),
      ('snapshot_importacion', 'matriz.importacion_contenido'),
      ('candidato_trabajador', 'matriz.trabajador_desconocido'),
      ('candidato_curso', 'matriz.capacitacion_desconocida'),
      ('destino_matriz', 'matriz.destino'),
      ('mapeo_matriz', 'matriz.mapeo_columna'),
      ('lote_liberacion', 'matriz.liberacion_lote'),
      ('liberacion', 'matriz.liberacion'),
      ('acuse_liberacion_vba', 'matriz.liberacion_acuse'),
      ('regla_dnc', 'dnc.regla'),
      ('evaluacion_dnc_snapshot', 'dnc.evaluacion'),
      ('documento_dc3', 'dc3.constancia'),
      ('metadato_curso_dc3', 'dc3.curso_configuracion'),
      ('area_tematica_dc3', 'dc3.area_tematica'),
      ('evento_dc3_vba', 'dc3.evento_excel'),
      ('actor', 'seguridad.actor'),
      ('asignacion_rol', 'seguridad.actor_rol'),
      ('credencial_consola', 'seguridad.credencial_consola'),
      ('credencial_equipo', 'seguridad.credencial_equipo'),
      ('secreto_operacion', 'seguridad.secreto'),
      ('concesion', 'seguridad.concesion'),
      ('nonce_puente', 'seguridad.nonce'),
      ('auditoria', 'sistema.bitacora_auditoria'),
      ('errores', 'sistema.bitacora_error'),
      ('objeto_almacenado', 'sistema.archivo'),
      ('corrida_piloto', 'sistema.corrida_piloto'),
      ('estado_acuse_vba', 'comun.estado_acuse'),
      ('estado_registro_hc', 'comun.estado_historial'),
      ('tipo_cambio_hc', 'comun.tipo_cambio_historial'),
      ('estado_lote_importacion', 'comun.estado_importacion'),
      ('alcance_lote', 'comun.alcance_importacion'),
      ('estado_lote_liberacion', 'comun.estado_liberacion'),
      ('fase_lote_liberacion', 'comun.fase_liberacion')
    ) AS t (viejo, nuevo)
    LOOP
      def := regexp_replace(def, '\mkcm\.' || m.viejo || '\M', m.nuevo, 'g');
    END LOOP;
    def := regexp_replace(def, '\mkcm\.', 'comun.', 'g');
    EXECUTE def;
  END LOOP;
END $$;

-- 7. Comprobación: nada quedó atrás y la RLS sigue cerrada en todas las tablas.
DO $$
DECLARE
  v_sueltas int;
  v_sin_rls int;
  v_texto_viejo int;
BEGIN
  SELECT count(*) INTO v_sueltas FROM pg_class
   WHERE relnamespace = 'comun'::regnamespace AND relkind = 'r';
  IF v_sueltas > 0 THEN
    RAISE EXCEPTION '% tablas quedaron en comun sin esquema de dominio.', v_sueltas;
  END IF;

  SELECT count(*) INTO v_sin_rls FROM pg_class c
   WHERE c.relnamespace::regnamespace::text IN ('organizacion', 'catalogo', 'operacion', 'matriz', 'dnc', 'dc3', 'seguridad', 'sistema')
     AND c.relkind = 'r'
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_sin_rls > 0 THEN
    RAISE EXCEPTION '% tablas perdieron la RLS forzada.', v_sin_rls;
  END IF;

  SELECT count(*) INTO v_texto_viejo FROM pg_proc
   WHERE pronamespace = 'lectura'::regnamespace AND prosrc ~ '\mkcm\.';
  IF v_texto_viejo > 0 THEN
    RAISE EXCEPTION '% funciones de lectura siguen citando kcm.', v_texto_viejo;
  END IF;
END $$;
