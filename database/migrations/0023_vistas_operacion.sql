-- =============================================================================
-- 0023 — Superficie de lectura de las cuatro pantallas en operación
--
-- Cada función proyecta exactamente los campos que la pantalla necesita:
--
--   · ficha del trabajador (control de cursos): + antigüedad derivada y foto;
--   · cursos aplicables por área con realizados y pendientes;
--   · registro de asistencia por sesión;
--   · preparación DC-3: qué falta, por curso, para poder emitir.
--
-- La antigüedad se calcula aquí y no se almacena: `trabajador.fecha_alta` es su
-- única fuente y un valor guardado envejecería mal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ficha del trabajador con antigüedad y fotografía
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS kcm_lectura.obtener_perfil_trabajador(kcm.numero_trabajador);

CREATE FUNCTION kcm_lectura.obtener_perfil_trabajador(p_numero kcm.numero_trabajador)
RETURNS TABLE (
  trabajador_id         uuid,
  numero_trabajador     kcm.numero_trabajador,
  nombre_completo       text,
  fecha_alta            date,
  antiguedad_anios      integer,
  antiguedad_meses      integer,
  departamento          text,
  area                  text,
  puesto                text,
  clave_cno             text,
  categoria             text,
  escolaridad           text,
  escolaridad_declarada boolean,
  foto_ruta             text,
  activo                boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.trabajador_id,
    t.numero_trabajador,
    t.nombre_completo,
    t.fecha_alta,
    CASE WHEN t.fecha_alta IS NULL THEN NULL
         ELSE date_part('year', age(CURRENT_DATE, t.fecha_alta))::integer END,
    CASE WHEN t.fecha_alta IS NULL THEN NULL
         ELSE date_part('month', age(CURRENT_DATE, t.fecha_alta))::integer END,
    d.nombre,
    a.nombre,
    p.nombre,
    p.clave_cno,
    COALESCE(cat.valor, 'OPER'),
    COALESCE(esc.valor, 'Preparatoria'),
    COALESCE(esc.declarado_por_omision, true),
    t.foto_ruta,
    t.activo
  FROM kcm.trabajador t
  LEFT JOIN kcm.departamento d ON d.departamento_id = t.departamento_id
  LEFT JOIN kcm.area a ON a.area_id = t.area_id
  LEFT JOIN kcm.puesto p ON p.puesto_id = t.puesto_id
  LEFT JOIN kcm.atributo_declarado cat
    ON cat.trabajador_id = t.trabajador_id
   AND cat.nombre_atributo = 'CATEGORIA'
   AND cat.vigente_hasta IS NULL
  LEFT JOIN kcm.atributo_declarado esc
    ON esc.trabajador_id = t.trabajador_id
   AND esc.nombre_atributo = 'ESCOLARIDAD'
   AND esc.vigente_hasta IS NULL
  WHERE t.numero_trabajador = p_numero;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_perfil_trabajador(kcm.numero_trabajador) IS
  'Ficha laboral con antigüedad derivada de fecha_alta, atributos declarados y referencia de fotografía.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_perfil_trabajador(kcm.numero_trabajador) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Cursos que le tocan a un trabajador, con realizados y pendientes
-- -----------------------------------------------------------------------------
-- La lista sale de las reglas DNC vigentes de su área y de su departamento; el
-- estado sale de la matriz replicada en `registro_hc`. Cuando un curso aplica
-- por las dos vías, gana la regla de área, que es la más específica.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_cursos_trabajador(p_numero kcm.numero_trabajador)
RETURNS TABLE (
  clave_curso       text,
  nombre_curso      text,
  nivel             kcm.nivel_poblacion,
  estado            text,
  fecha_realizado   date,
  fecha_vencimiento date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.capacitacion_id)
    c.clave_curso,
    c.nombre,
    r.nivel,
    CASE
      WHEN rh.registro_id IS NULL THEN 'PENDIENTE'
      WHEN rh.fecha_capacitacion + make_interval(months => r.meses_recurrencia) < CURRENT_DATE
        THEN 'REFORZAR'
      ELSE 'REALIZADO'
    END,
    rh.fecha_capacitacion,
    CASE WHEN rh.registro_id IS NULL THEN NULL
         ELSE (rh.fecha_capacitacion + make_interval(months => r.meses_recurrencia))::date END
  FROM kcm.trabajador t
  JOIN kcm.regla_dnc r
    ON (r.vigente_hasta IS NULL OR r.vigente_hasta >= CURRENT_DATE)
   AND (
        (r.nivel = 'AREA' AND r.area_id = t.area_id)
     OR (r.nivel = 'DEPARTMENT' AND r.departamento_id = t.departamento_id)
   )
  JOIN kcm.capacitacion c
    ON c.capacitacion_id = r.capacitacion_id AND c.activa = true
  LEFT JOIN kcm.registro_hc rh
    ON rh.trabajador_id = t.trabajador_id
   AND rh.capacitacion_id = c.capacitacion_id
   AND rh.estado_registro = 'VIGENTE'
  WHERE t.numero_trabajador = p_numero
  ORDER BY c.capacitacion_id, (r.nivel = 'AREA') DESC, c.nombre;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_cursos_trabajador(kcm.numero_trabajador) IS
  'Cursos aplicables al trabajador según su área y departamento, con estado realizado, pendiente o a reforzar.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_cursos_trabajador(kcm.numero_trabajador) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Registro de asistencia de una sesión
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_asistencia_sesion(p_codigo_sesion text)
RETURNS TABLE (
  numero_trabajador kcm.numero_trabajador,
  nombre_completo   text,
  area              text,
  nombre_curso      text,
  estado            kcm.estado_asistencia,
  registrado_en     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.numero_trabajador,
    t.nombre_completo,
    a.nombre,
    c.nombre,
    asi.estado,
    asi.creada_en
  FROM kcm.sesion s
  JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
  JOIN kcm.asistencia asi ON asi.sesion_id = s.sesion_id
  JOIN kcm.trabajador t ON t.trabajador_id = asi.trabajador_id
  LEFT JOIN kcm.area a ON a.area_id = t.area_id
  WHERE s.codigo_sesion = p_codigo_sesion
  ORDER BY t.nombre_completo;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_asistencia_sesion(text) IS
  'Lista de asistencia de una sesión: número de nómina, nombre, área y curso.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_asistencia_sesion(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Preparación DC-3: qué falta para poder emitir
-- -----------------------------------------------------------------------------
-- Devuelve una fila por curso con metadatos DC-3 y la lista de datos faltantes.
-- Mientras `faltantes` no venga vacío, la emisión de ese curso está bloqueada.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_preparacion_dc3()
RETURNS TABLE (
  clave_curso           text,
  nombre_dc3            text,
  duracion_horas        integer,
  duracion_dias         integer,
  area_tematica_clave   text,
  area_tematica_nombre  text,
  agente_capacitador    text,
  regla_fecha           kcm.regla_fecha_dc3,
  dias_periodo          integer,
  aprobado              boolean,
  faltantes             text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    c.clave_curso,
    m.nombre_dc3,
    m.duracion_horas,
    m.duracion_dias,
    m.area_tematica_clave,
    at.nombre,
    m.agente_capacitador,
    m.regla_fecha,
    m.dias_periodo,
    m.aprobado,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN m.nombre_dc3 IS NULL THEN 'nombre_dc3' END,
      CASE WHEN m.duracion_horas IS NULL THEN 'duracion_horas' END,
      CASE WHEN m.area_tematica_clave IS NULL THEN 'area_tematica_clave' END,
      CASE WHEN at.nombre IS NULL THEN 'area_tematica_nombre' END,
      CASE WHEN m.agente_capacitador IS NULL THEN 'agente_capacitador' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM kcm.patron WHERE vigente_hasta IS NULL)
           THEN 'patron_vigente' END
    ], NULL)
  FROM kcm.capacitacion c
  JOIN kcm.metadato_curso_dc3 m ON m.capacitacion_id = c.capacitacion_id
  LEFT JOIN kcm.area_tematica_dc3 at ON at.clave = m.area_tematica_clave
  ORDER BY c.clave_curso;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_preparacion_dc3() IS
  'Estado de los metadatos legales por curso. Un arreglo `faltantes` no vacío significa emisión bloqueada.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_preparacion_dc3() TO authenticated;
