-- =============================================================================
-- 0017 — Seguridad por fila (RLS) Deny-by-Default en el 100% de las tablas
-- RLS deny-by-default en todas las tablas del esquema de dominio.
-- =============================================================================

-- Revocar cualquier acceso heredado por omisión sobre el esquema de dominio
REVOKE ALL ON SCHEMA kcm FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA kcm TO authenticated;

-- -----------------------------------------------------------------------------
-- Activación forzada de RLS (Deny-by-Default) en todas las tablas del esquema kcm
-- -----------------------------------------------------------------------------

-- 0002 — Auditoría
ALTER TABLE kcm.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.auditoria FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.errores ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.errores FORCE ROW LEVEL SECURITY;

-- 0003 — Acceso e Identidad
ALTER TABLE kcm.actor ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.actor FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.asignacion_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.asignacion_rol FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.concesion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.concesion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.secreto_operacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.secreto_operacion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.credencial_equipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.credencial_equipo FORCE ROW LEVEL SECURITY;

-- 0004 — Catálogos
ALTER TABLE kcm.capacitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.capacitacion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.alias_capacitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.alias_capacitacion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.departamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.departamento FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.area ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.area FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.puesto ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.puesto FORCE ROW LEVEL SECURITY;

-- 0005 — Trabajadores y Atributos
ALTER TABLE kcm.trabajador ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.trabajador FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.atributo_declarado ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.atributo_declarado FORCE ROW LEVEL SECURITY;

-- 0006 — Desconocidos
ALTER TABLE kcm.candidato_curso ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.candidato_curso FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.candidato_trabajador ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.candidato_trabajador FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.campo_declarado ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.campo_declarado FORCE ROW LEVEL SECURITY;

-- 0007 — Importación Matriz e Historial
ALTER TABLE kcm.lote_importacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.lote_importacion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.registro_hc ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.registro_hc FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.historial_sobrescritura_fecha ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.historial_sobrescritura_fecha FORCE ROW LEVEL SECURITY;

-- 0008 — Sesiones
ALTER TABLE kcm.sesion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.sesion FORCE ROW LEVEL SECURITY;

-- 0009 — Quiosco y Asistencias
ALTER TABLE kcm.asistencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.asistencia FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.registro_quiosco ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.registro_quiosco FORCE ROW LEVEL SECURITY;

-- 0010 — Preliberación
ALTER TABLE kcm.evidencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.evidencia FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.revision_preliberacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.revision_preliberacion FORCE ROW LEVEL SECURITY;

-- 0011 — Liberación
ALTER TABLE kcm.lote_liberacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.lote_liberacion FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.liberacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.liberacion FORCE ROW LEVEL SECURITY;

-- 0012 — Destinos de Matriz
ALTER TABLE kcm.destino_matriz ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.destino_matriz FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.mapeo_matriz ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.mapeo_matriz FORCE ROW LEVEL SECURITY;

-- 0013 — Puente VBA
ALTER TABLE kcm.acuse_liberacion_vba ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.acuse_liberacion_vba FORCE ROW LEVEL SECURITY;

-- 0014 — Salas
ALTER TABLE kcm.sala ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.sala FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.reserva_sala ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.reserva_sala FORCE ROW LEVEL SECURITY;

-- 0015 — DNC
ALTER TABLE kcm.regla_dnc ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.regla_dnc FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.evaluacion_dnc_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.evaluacion_dnc_snapshot FORCE ROW LEVEL SECURITY;

-- 0016 — DC-3
ALTER TABLE kcm.metadato_curso_dc3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.metadato_curso_dc3 FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.documento_dc3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.documento_dc3 FORCE ROW LEVEL SECURITY;
