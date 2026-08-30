-- =============================================================================
-- 0034 — Unificación de identidad para la primera regla DC-3
--
-- La emisión DC-3 exige QMS + LOTO (matriz) + INDUCCIÓN A LA EMPRESA (fecha de
-- alta del padrón semanal). Hoy no puede emitir una sola constancia, y no por
-- falta de datos sino porque la identidad del curso está partida en dos:
--
--   QMS   metadato en 269cb2c8 (0 registros) | datos en cffa699f (452)
--   LOTO  metadato en 085c906c (0 registros) | datos en 5026418f (1 154)
--
-- El planificador busca candidatos por el identificador que tiene metadato
-- legal, encuentra cero y reporta que no hay nada que emitir. Se reapunta el
-- metadato hacia el identificador que carga las fechas reales, porque la matriz
-- es la fuente de la fecha y cambiar el metadato no altera ningún registro.
--
-- LOTO además está duplicado en la propia matriz: `kcm.mapeo_matriz` declara
-- las columnas L y M con encabezado idéntico. La distinción no es el nombre
-- sino el año, y se resolvió contra los datos, no por la posición: la columna L
-- (5026418f) tiene 1 154 registros entre 2026-02-05 y 2026-05-19; la M
-- (f7f4a05c) tiene 493 entre 2025-01-23 y 2025-06-03. Vale la de 2026.
--
-- La corrida piloto sigue abierta: esta migración no inventa registros, sólo
-- corrige a qué identidad apuntan el metadato y la planta.
-- =============================================================================

-- --- 1. QMS: el metadato viaja al identificador que trae las fechas ----------
UPDATE kcm.metadato_curso_dc3
   SET capacitacion_id = 'cffa699f-5c0a-44dd-941a-282084a48b48',
       actualizado_en = now()
 WHERE capacitacion_id = '269cb2c8-e381-46a6-a2f2-beb66bc35c7a';

-- --- 2. LOTO: metadato hacia la columna L, que es la de 2026 -----------------
UPDATE kcm.metadato_curso_dc3
   SET capacitacion_id = '5026418f-b86e-469c-bab5-0dd904553223',
       actualizado_en = now()
 WHERE capacitacion_id = '085c906c-a7fb-4a72-b255-0fd2555e1bde';

-- --- 3. El nombre de cada curso queda anclado a la identidad que sí tiene datos
-- Las identidades vacías no se borran: `kcm.auditoria` y los ledgers pueden
-- referirlas, y un catálogo que pierde filas rompe la lectura de lo ya
-- registrado. El alias declara cuál gana cuando el nombre llegue de la matriz.
--
-- `alias` es único en toda la tabla y las dos LOTO comparten nombre idéntico,
-- así que el nombre largo produce una sola fila —que es justamente el sentido
-- de la unicidad: un nombre resuelve a una identidad y no a dos—.
INSERT INTO kcm.alias_capacitacion
  (capacitacion_id, alias, alias_normalizado, origen_fuente, aprobado_por, aprobado_en, notas)
SELECT v.destino_id,
       c.nombre,
       upper(c.nombre),
       'MATRIZ_XLSB'::kcm.origen_fuente,
       (SELECT actor_id FROM kcm.actor WHERE activo ORDER BY creado_en LIMIT 1),
       now(),
       v.nota
  FROM (VALUES
        ('cffa699f-5c0a-44dd-941a-282084a48b48'::uuid,
         'QMS: el metadato DC-3 se movió aquí desde la identidad sin registros 269cb2c8.'),
        ('5026418f-b86e-469c-bab5-0dd904553223'::uuid,
         'LOTO columna L, ciclo 2026. Absorbe la identidad vacía 085c906c y desplaza a la columna M (f7f4a05c), que es el ciclo 2025 y no emite DC-3.')
       ) AS v(destino_id, nota)
  JOIN kcm.capacitacion c ON c.capacitacion_id = v.destino_id
 WHERE NOT EXISTS (SELECT 1 FROM kcm.alias_capacitacion a WHERE a.alias = c.nombre);

-- --- 4. MANTTO INGENIERIA no es una planta -----------------------------------
-- Son 10 trabajadores adscritos que operan en Ecatepec I. El filtro de planta
-- de la plataforma sólo distingue las dos plantas físicas.
UPDATE kcm.trabajador
   SET planta = 'ECATEPEC I',
       actualizado_en = now(),
       version = version + 1
 WHERE planta = 'MANTTO INGENIERIA';
