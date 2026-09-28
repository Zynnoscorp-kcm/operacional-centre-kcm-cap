-- =============================================================================
-- Semilla sintética del entorno de desarrollo
--
-- ATENCIÓN: todo lo que hay aquí está INVENTADO. Los nombres, las CURP, los
-- números de nómina y las fechas no corresponden a ninguna persona real. El
-- padrón y la matriz reales están ignorados por Git, nunca se usan como
-- fixtures y NO deben cargarse en esta base.
--
-- Existe porque las migraciones dejan los catálogos de configuración —el
-- patrón, las siete salas, las tres áreas temáticas y los metadatos DC-3— pero
-- ninguna persona ni ningún departamento. Sin trabajadores, el directorio está
-- vacío, el quiosco rechaza todo y el motor DNC no tiene a quién evaluar: un
-- clon recién levantado no serviría para desarrollar nada.
--
-- Es idempotente. Correrla dos veces no duplica nada.
--
-- Números de nómina: 90001–90040. El rango 9xxxx no se usa en la planta, así
-- que una fila sintética nunca puede confundirse con una real.
-- =============================================================================

COMMENT ON SCHEMA kcm IS
  'ENTORNO DE DESARROLLO LOCAL. Datos sinteticos e inventados. Ninguna identidad de aqui corresponde a una persona real. No cargar el padron ni la matriz reales en esta base.';

-- -----------------------------------------------------------------------------
-- Actor responsable de la semilla
-- -----------------------------------------------------------------------------
INSERT INTO seguridad.actor (identificador, nombre_visible)
VALUES ('sistema.semilla.local', 'Semilla de desarrollo')
ON CONFLICT (identificador) DO NOTHING;

-- `asignacion_rol` no tiene restricción de unicidad, así que `ON CONFLICT` no
-- protegería de nada: una segunda corrida agregaría otra asignación idéntica.
-- La guarda tiene que ser explícita.
INSERT INTO seguridad.actor_rol (actor_id, rol, otorgado_por)
SELECT a.actor_id, 'ADMINISTRADOR', a.actor_id
FROM seguridad.actor a
WHERE a.identificador = 'sistema.semilla.local'
  AND NOT EXISTS (
    SELECT 1 FROM seguridad.actor_rol r
    WHERE r.actor_id = a.actor_id AND r.rol = 'ADMINISTRADOR' AND r.vigente_hasta IS NULL
  );

-- -----------------------------------------------------------------------------
-- Estructura laboral
--
-- Cinco departamentos y cuatro áreas. Se eligieron para cubrir los dos niveles
-- del motor DNC: los cursos de calidad se aplican por departamento y los
-- técnicos por área, así que la semilla necesita al menos un área con población
-- propia para que esa distinción se pueda probar.
-- -----------------------------------------------------------------------------
INSERT INTO organizacion.departamento (nombre, nombre_normalizado) VALUES
  ('OPERACION DE MAQUINAS',   'OPERACION DE MAQUINAS'),
  ('GERENCIA DE MANTTO.',     'GERENCIA DE MANTTO '),
  ('ASEGURAMIENTO DE CALIDAD','ASEGURAMIENTO DE CALIDAD'),
  ('CONVERSION',              'CONVERSION'),
  ('ALMACEN Y EMBARQUES',     'ALMACEN Y EMBARQUES')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO organizacion.area (departamento_id, nombre, nombre_normalizado)
SELECT d.departamento_id, v.nombre, v.norm
FROM (VALUES
  ('GERENCIA DE MANTTO.',      'GERENCIA DE MANTTO. ELECTRICO', 'GERENCIA DE MANTTO  ELECTRICO'),
  ('GERENCIA DE MANTTO.',      'GERENCIA DE MANTTO. MECANICO',  'GERENCIA DE MANTTO  MECANICO'),
  ('OPERACION DE MAQUINAS',    'MAQUINA 1',                     'MAQUINA 1'),
  ('CONVERSION',               'LINEA DE CONVERSION A',         'LINEA DE CONVERSION A')
) AS v(departamento, nombre, norm)
JOIN organizacion.departamento d ON d.nombre = v.departamento
ON CONFLICT (departamento_id, nombre) DO NOTHING;

INSERT INTO organizacion.puesto (nombre, nombre_normalizado) VALUES
  ('*OPERARIO 1°',            'OPERARIO 1'),
  ('*OPERARIO 2°',            'OPERARIO 2'),
  ('*OPERARIO 3°',            'OPERARIO 3'),
  ('TECNICO ELECTRICO',       'TECNICO ELECTRICO'),
  ('TECNICO MECANICO',        'TECNICO MECANICO'),
  ('SUPERVISOR DE TURNO',     'SUPERVISOR DE TURNO'),
  ('INSPECTOR DE CALIDAD',    'INSPECTOR DE CALIDAD')
ON CONFLICT (nombre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Catálogo de cursos
--
-- `0022` ya sembró los tres de DC-3: INDUCCION_EMPRESA, QMS y LOTO. Aquí se
-- agregan cinco de calidad del TSV y dos técnicos, que son los que dan sentido
-- a las reglas de dos niveles.
-- -----------------------------------------------------------------------------
INSERT INTO catalogo.capacitacion (clave_curso, nombre, nombre_normalizado, clave_origen) VALUES
  ('BPM',   'BUENAS PRACTICAS DE MANUFACTURA', 'BUENAS PRACTICAS DE MANUFACTURA', 'hc-course:bpm'),
  ('BPR',   'BUENAS PRACTICAS REGULATORIAS',   'BUENAS PRACTICAS REGULATORIAS',   'hc-course:bpr'),
  ('HACCP', 'HACCP',                           'HACCP',                           'hc-course:haccp'),
  ('POLITICA_CALIDAD', 'POLITICA DE CALIDAD',  'POLITICA DE CALIDAD',             'hc-course:politica-calidad'),
  ('INSPECCION_LINEA', 'INSPECCION EN LINEA',  'INSPECCION EN LINEA',             'hc-course:inspeccion-linea'),
  ('NEUMATICA_BASICA', 'NEUMATICA BASICA',     'NEUMATICA BASICA',                'hc-course:neumatica-basica'),
  ('FISICA_BASICA',    'FISICA BASICA',        'FISICA BASICA',                   'hc-course:fisica-basica')
ON CONFLICT (clave_curso) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Alias
--
-- El caso que la documentación repite: sin este alias, BPM se reportaría como
-- pendiente para la planta entera. Se siembra para que el defecto no pueda
-- reaparecer sin que una prueba local lo note.
-- -----------------------------------------------------------------------------
INSERT INTO catalogo.capacitacion_alias
  (capacitacion_id, alias, alias_normalizado, origen_fuente, aprobado_por)
SELECT c.capacitacion_id, 'BPM', 'BPM', 'TSV_DNC', a.actor_id
FROM catalogo.capacitacion c
CROSS JOIN seguridad.actor a
WHERE c.clave_curso = 'BPM' AND a.identificador = 'sistema.semilla.local'
ON CONFLICT (alias) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Cuarenta trabajadores sintéticos
--
-- Se generan para no escribir cuarenta INSERT a mano y para que la distribución
-- por departamento, puesto y antigüedad sea variada sin ser aleatoria: la misma
-- semilla produce siempre la misma base, que es lo que permite comparar dos
-- entornos de desarrollo.
--
-- Doce quedan sin departamento a propósito. Son los que el motor DNC debe
-- reportar como DATOS_INSUFICIENTES y dejar fuera de todo porcentaje; sin ellos
-- ese camino nunca se ejercita en local.
-- -----------------------------------------------------------------------------
INSERT INTO organizacion.trabajador
  (numero_trabajador, nombre_completo, fecha_alta, tipo_nomina,
   puesto_id, departamento_id, area_id, planta, curp, activo)
SELECT
  numero,
  nombre,
  alta,
  nomina,
  (SELECT puesto_id FROM organizacion.puesto WHERE nombre = puesto),
  (SELECT departamento_id FROM organizacion.departamento WHERE nombre = departamento),
  (SELECT a.area_id FROM organizacion.area a
     JOIN organizacion.departamento d ON d.departamento_id = a.departamento_id
    WHERE a.nombre = area),
  planta,
  curp,
  true
FROM (
  SELECT
    lpad((90000 + n)::text, 5, '0')                                   AS numero,
    'TRABAJADOR SINTETICO ' || lpad(n::text, 2, '0')                  AS nombre,
    (DATE '2018-01-15' + (n * 37))                                    AS alta,
    CASE WHEN n % 3 = 0 THEN 'NQ' ELSE 'NS' END                       AS nomina,
    CASE n % 7
      WHEN 0 THEN '*OPERARIO 1°'
      WHEN 1 THEN '*OPERARIO 2°'
      WHEN 2 THEN '*OPERARIO 3°'
      WHEN 3 THEN 'TECNICO ELECTRICO'
      WHEN 4 THEN 'TECNICO MECANICO'
      WHEN 5 THEN 'SUPERVISOR DE TURNO'
      ELSE 'INSPECTOR DE CALIDAD'
    END                                                               AS puesto,
    -- Del 29 al 40 quedan sin departamento: son los DATOS_INSUFICIENTES.
    CASE
      WHEN n > 28 THEN NULL
      WHEN n % 4 = 0 THEN 'OPERACION DE MAQUINAS'
      WHEN n % 4 = 1 THEN 'GERENCIA DE MANTTO.'
      WHEN n % 4 = 2 THEN 'ASEGURAMIENTO DE CALIDAD'
      ELSE 'CONVERSION'
    END                                                               AS departamento,
    -- Nueve trabajadores en el área eléctrica: es la población de los cursos
    -- técnicos, que se aplican por área y no por departamento.
    CASE WHEN n <= 9 THEN 'GERENCIA DE MANTTO. ELECTRICO' ELSE NULL END AS area,
    CASE WHEN n % 2 = 0 THEN 'PLANTA 1' ELSE 'PLANTA 2' END           AS planta,
    -- CURP con la forma que exige `trabajador_curp_formato`, evidentemente
    -- falsa: cuatro X iniciales y una fecha de nacimiento imposible de repetir.
    'XXXX' || to_char(DATE '1985-01-01' + (n * 91), 'YYMMDD')
           || CASE WHEN n % 2 = 0 THEN 'H' ELSE 'M' END
           || 'DFXXX' || chr(65 + (n % 26)) || (n % 10)::text          AS curp
  FROM generate_series(1, 40) AS n
) AS gen
ON CONFLICT (numero_trabajador) DO NOTHING;

-- Los trabajadores del área eléctrica tienen que colgar del departamento de
-- mantenimiento, o la regla de dos niveles no los alcanza.
--
-- El filtro por `9%` no es decorativo: acota el UPDATE a las filas sintéticas.
-- Sin él, correr esta semilla por error contra una base con el padrón real
-- reasignaría departamentos de personas de verdad.
UPDATE organizacion.trabajador t
SET departamento_id = a.departamento_id
FROM organizacion.area a
WHERE t.area_id = a.area_id
  AND t.numero_trabajador LIKE '9%'
  AND t.departamento_id IS DISTINCT FROM a.departamento_id;

-- -----------------------------------------------------------------------------
-- Historial de capacitación
--
-- Fechas con procedencia XLSB_IMPORT, que es lo que produciría una importación
-- de la matriz. Se reparten para que en el tablero DNC aparezcan los tres
-- estados que importan: COMPLETADO, REFORZAR —fecha vieja, fuera de vigencia—
-- y PENDIENTE, que es simplemente la ausencia de fila.
-- -----------------------------------------------------------------------------
INSERT INTO operacion.historial_capacitacion
  (clave_idempotencia, trabajador_id, capacitacion_id, fecha_capacitacion,
   procedencia, estado_registro, version_mapeo)
SELECT
  'semilla:' || t.numero_trabajador || ':' || c.clave_curso,
  t.trabajador_id,
  c.capacitacion_id,
  CASE
    -- Un tercio con fecha reciente: COMPLETADO.
    WHEN (right(t.numero_trabajador, 2)::int % 3) = 0 THEN CURRENT_DATE - 60
    -- Un tercio con fecha vieja: REFORZAR, si el curso tiene recurrencia anual.
    WHEN (right(t.numero_trabajador, 2)::int % 3) = 1 THEN CURRENT_DATE - 900
    ELSE CURRENT_DATE - 200
  END,
  'XLSB_IMPORT',
  'VIGENTE',
  'semilla-local-v1'
FROM organizacion.trabajador t
JOIN catalogo.capacitacion c ON c.clave_curso IN ('BPM', 'QMS', 'HACCP')
WHERE t.numero_trabajador LIKE '9%'
  -- El resto queda sin fila para que existan PENDIENTE de verdad.
  AND (right(t.numero_trabajador, 2)::int % 4) <> 3
ON CONFLICT (clave_idempotencia) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Reglas DNC
--
-- Tres por departamento y una por área. Es la configuración mínima con la que
-- `/trabajadores/cobertura` deja de estar vacío y se puede ver cómo se combinan
-- los dos niveles sobre una misma persona.
-- -----------------------------------------------------------------------------
-- Igual que en `asignacion_rol`: `regla_dnc` no declara unicidad, de modo que
-- la idempotencia depende de comprobarla aquí. Se identifica una regla por
-- curso, nivel, población y versión, que es lo que la hace la misma regla.
INSERT INTO dnc.regla
  (capacitacion_id, nivel, departamento_id, meses_recurrencia, dias_gracia,
   version_regla, aprobada_por)
SELECT c.capacitacion_id, 'DEPARTMENT', d.departamento_id, 12, 30,
       'SEMILLA-LOCAL-V1', a.actor_id
FROM catalogo.capacitacion c
CROSS JOIN organizacion.departamento d
CROSS JOIN seguridad.actor a
WHERE c.clave_curso IN ('BPM', 'QMS', 'HACCP')
  AND a.identificador = 'sistema.semilla.local'
  AND NOT EXISTS (
    SELECT 1 FROM dnc.regla r
    WHERE r.capacitacion_id = c.capacitacion_id
      AND r.nivel = 'DEPARTMENT'
      AND r.departamento_id = d.departamento_id
      AND r.version_regla = 'SEMILLA-LOCAL-V1'
  );

INSERT INTO dnc.regla
  (capacitacion_id, nivel, area_id, meses_recurrencia, dias_gracia,
   version_regla, aprobada_por)
SELECT c.capacitacion_id, 'AREA', ar.area_id, 24, 30,
       'SEMILLA-LOCAL-V1', a.actor_id
FROM catalogo.capacitacion c
CROSS JOIN organizacion.area ar
CROSS JOIN seguridad.actor a
WHERE c.clave_curso IN ('NEUMATICA_BASICA', 'FISICA_BASICA')
  AND ar.nombre = 'GERENCIA DE MANTTO. ELECTRICO'
  AND a.identificador = 'sistema.semilla.local'
  AND NOT EXISTS (
    SELECT 1 FROM dnc.regla r
    WHERE r.capacitacion_id = c.capacitacion_id
      AND r.nivel = 'AREA'
      AND r.area_id = ar.area_id
      AND r.version_regla = 'SEMILLA-LOCAL-V1'
  );

-- -----------------------------------------------------------------------------
-- Sobre la cuenta de `/acceso`
--
-- Aquí NO se siembra ninguna. La plataforma deriva las contraseñas con scrypt y
-- PostgreSQL no lo implementa —`pgcrypto` trae md5, sha, bf y xdes, no scrypt—,
-- así que cualquier hash que se calculara en SQL produciría una cuenta que
-- parece existir y nunca deja entrar. Eso es peor que no tener cuenta.
--
-- En desarrollo el compose declara `KCM_PILOT_OPEN_ACCESS=1`, que es justo para
-- lo que existe esa bandera: ninguna pantalla pide contraseña ni PIN y se puede
-- recorrer la plataforma completa. `loadConfig` rechaza el arranque si esa
-- bandera vive con `KCM_ENV=production`.
--
-- Quien quiera una cuenta nominal en su base local la crea con:
--
--   docker compose exec plataforma \
--     env KCM_ADMIN_DATABASE_URL="$KCM_ADMIN_DATABASE_URL" \
--         KCM_CLAVE_NUEVA='una-contrasena-larga' \
--     node scripts/alta-cuenta-consola.js desarrollo "Cuenta local"
-- -----------------------------------------------------------------------------
