-- =============================================================================
-- 0018 — Superficie de lectura autorizada (Esquema kcm_lectura)
-- Fuente: docs/arquitectura/MODELO_DATOS.md
-- =============================================================================

GRANT USAGE ON SCHEMA kcm_lectura TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 1. Disponibilidad pública y compartida de salas de capacitación
-- -----------------------------------------------------------------------------
-- Invariante de privacidad: La vista compartida NUNCA expone nombre, puesto,
-- área, contacto, motivo ni solicitante; únicamente sala, horario y estado.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_ocupacion_salas(p_fecha date)
RETURNS TABLE (
  sala_id         uuid,
  clave_sala      text,
  nombre_visible  text,
  fecha           date,
  hora_inicio     time,
  hora_fin        time,
  estado          text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    s.sala_id,
    s.clave_sala,
    s.nombre_visible,
    r.fecha,
    r.hora_inicio,
    r.hora_fin,
    'RESERVADA'::text AS estado
  FROM kcm.sala s
  JOIN kcm.reserva_sala r ON r.sala_id = s.sala_id
  WHERE r.fecha = p_fecha
    AND r.estado = 'ACTIVA'
    AND s.activa = true
  ORDER BY s.clave_sala, r.hora_inicio;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_ocupacion_salas(date) IS
  'Disponibilidad compartida anonimizada de salas. Sin exposición de datos de solicitantes ni motivos.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_ocupacion_salas(date) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 2. Perfil individual de capacitación por trabajador (Función 8)
-- -----------------------------------------------------------------------------
-- Proyecta la ficha del trabajador, escolaridad marcada como declarada,
-- categoría derivada y el estado DNC consolidado de sus cursos.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_perfil_trabajador(p_numero kcm.numero_trabajador)
RETURNS TABLE (
  trabajador_id         uuid,
  numero_trabajador     kcm.numero_trabajador,
  nombre_completo       text,
  fecha_alta            date,
  departamento          text,
  area                  text,
  puesto                text,
  categoria             text,
  escolaridad           text,
  escolaridad_declarada boolean,
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
    d.nombre AS departamento,
    a.nombre AS area,
    p.nombre AS puesto,
    COALESCE(cat.valor, 'OPER') AS categoria,
    COALESCE(esc.valor, 'Preparatoria') AS escolaridad,
    COALESCE(esc.declarado_por_omision, true) AS escolaridad_declarada,
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
  'Ficha laboral del trabajador con atributos declarados y procedencia explícita.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_perfil_trabajador(kcm.numero_trabajador) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Resumen departamental de cumplimiento DNC (Función 8)
-- -----------------------------------------------------------------------------
-- Proyecta agregados por departamento excluyendo DATOS_INSUFICIENTES del porcentaje.
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_resumen_departamental()
RETURNS TABLE (
  departamento_id     uuid,
  departamento_nombre text,
  total_plantilla     bigint,
  total_completados   bigint,
  total_reforzar      bigint,
  total_pendientes    bigint,
  total_insuficientes bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    d.departamento_id,
    d.nombre AS departamento_nombre,
    COUNT(DISTINCT t.trabajador_id) AS total_plantilla,
    COUNT(CASE WHEN e.estado_dnc = 'COMPLETADO' THEN 1 END) AS total_completados,
    COUNT(CASE WHEN e.estado_dnc = 'REFORZAR' THEN 1 END) AS total_reforzar,
    COUNT(CASE WHEN e.estado_dnc = 'PENDIENTE' THEN 1 END) AS total_pendientes,
    COUNT(CASE WHEN e.estado_dnc = 'DATOS_INSUFICIENTES' THEN 1 END) AS total_insuficientes
  FROM kcm.departamento d
  LEFT JOIN kcm.trabajador t ON t.departamento_id = d.departamento_id AND t.activo = true
  LEFT JOIN kcm.evaluacion_dnc_snapshot e ON e.trabajador_id = t.trabajador_id
  WHERE d.activo = true
  GROUP BY d.departamento_id, d.nombre
  ORDER BY d.nombre;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_resumen_departamental() IS
  'Métricas de cumplimiento DNC agregadas por departamento. DATOS_INSUFICIENTES se cuenta aparte.';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_resumen_departamental() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Sesiones activas y recién cerradas (Función 3)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kcm_lectura.obtener_sesiones_operativas()
RETURNS TABLE (
  sesion_id         uuid,
  codigo_sesion     text,
  capacitacion      text,
  capacitador       text,
  fecha_sesion      date,
  duracion_minutos  integer,
  estado            kcm.estado_sesion,
  autorizada        boolean,
  total_asistencias bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    s.sesion_id,
    s.codigo_sesion,
    c.nombre AS capacitacion,
    act.nombre_visible AS capacitador,
    s.fecha_sesion,
    s.duracion_minutos,
    s.estado,
    s.autorizada,
    COUNT(a.asistencia_id) AS total_asistencias
  FROM kcm.sesion s
  JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
  JOIN kcm.actor act ON act.actor_id = s.capacitador_id
  LEFT JOIN kcm.asistencia a ON a.sesion_id = s.sesion_id
  WHERE s.estado IN ('ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR')
     OR (s.estado = 'LIBERADA_TOTAL' AND s.fecha_sesion >= CURRENT_DATE - INTERVAL '14 days')
  GROUP BY s.sesion_id, s.codigo_sesion, c.nombre, act.nombre_visible, s.fecha_sesion, s.duracion_minutos, s.estado, s.autorizada
  ORDER BY s.fecha_sesion DESC, s.codigo_sesion;
$$;

COMMENT ON FUNCTION kcm_lectura.obtener_sesiones_operativas() IS
  'Vista operativa de sesiones en curso y recientemente cerradas (últimos 14 días).';

GRANT EXECUTE ON FUNCTION kcm_lectura.obtener_sesiones_operativas() TO authenticated;
