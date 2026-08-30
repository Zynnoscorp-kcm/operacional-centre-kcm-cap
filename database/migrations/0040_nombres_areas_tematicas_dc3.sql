-- =============================================================================
-- 0040 — Texto oficial de las áreas temáticas DC-3
--
-- NO APLICADA. Requiere confirmación del departamento, como toda migración.
--
-- `0021` dejó `kcm.area_tematica_dc3.nombre` nulo con este comentario: «Nulo
-- mientras Capacitación no lo entregue». Ya lo entregó: el archivo
-- `referencias/Software Administración de Curs y Cap/Catalogo de areas
-- Tematicas-.xlsx` es el catálogo STPS detallado de cuatro dígitos, y las tres
-- claves sembradas en `0022` aparecen ahí con su denominación.
--
-- Nota sobre una confusión que conviene no repetir: el reverso del formato
-- oficial sólo lista los nueve grupos en millares (1000 Producción general …
-- 9000 Participación social). Eso hace parecer que `3131` y `3132` no existen.
-- Sí existen: son subáreas del grupo 3000, y el catálogo del departamento las
-- declara. Las claves sembradas son correctas.
--
-- Con esta migración, `kcm_lectura.obtener_preparacion_dc3()` deja de reportar
-- `area_tematica_nombre` entre los faltantes de los tres cursos. El único
-- faltante que queda es `agente_capacitador`, que nadie ha declarado todavía.
-- =============================================================================

UPDATE kcm.area_tematica_dc3 SET nombre = 'Apoyo a la calidad' WHERE clave = '3131';
UPDATE kcm.area_tematica_dc3 SET nombre = 'Recursos humanos'   WHERE clave = '3132';
UPDATE kcm.area_tematica_dc3 SET nombre = 'Seguridad'          WHERE clave = '6000';

-- El metadato por curso guarda su propia copia del texto, que es la que se
-- imprime. Se toma del catálogo para que no puedan divergir.
UPDATE kcm.metadato_curso_dc3 m
   SET area_tematica_nombre = a.nombre
  FROM kcm.area_tematica_dc3 a
 WHERE a.clave = m.area_tematica_clave
   AND a.nombre IS NOT NULL
   AND m.area_tematica_nombre IS DISTINCT FROM a.nombre;

DO $$
DECLARE
  v_sin_nombre integer;
BEGIN
  SELECT count(*) INTO v_sin_nombre
    FROM kcm.metadato_curso_dc3 m
    JOIN kcm.area_tematica_dc3 a ON a.clave = m.area_tematica_clave
   WHERE m.area_tematica_nombre IS NULL;
  IF v_sin_nombre > 0 THEN
    RAISE WARNING 'Quedan % cursos DC-3 sin texto de area tematica: su clave no esta en el catalogo.',
      v_sin_nombre;
  END IF;
END;
$$;
