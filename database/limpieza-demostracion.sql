BEGIN;

ALTER TABLE operacion.historial_capacitacion_cambio DISABLE TRIGGER USER;
ALTER TABLE sistema.bitacora_auditoria DISABLE TRIGGER USER;
ALTER TABLE matriz.liberacion DISABLE TRIGGER USER;
ALTER TABLE matriz.liberacion_acuse DISABLE TRIGGER USER;
ALTER TABLE dc3.evento_excel DISABLE TRIGGER USER;

DELETE FROM matriz.liberacion_acuse;
DELETE FROM matriz.liberacion;
DELETE FROM matriz.liberacion_lote;
DELETE FROM dc3.evento_excel;
DELETE FROM dc3.constancia;
DELETE FROM operacion.preliberacion_revision;
DELETE FROM operacion.sesion_evidencia;
DELETE FROM operacion.quiosco_registro;
DELETE FROM operacion.asistencia;
DELETE FROM operacion.sesion;
DELETE FROM operacion.sala_reserva;
DELETE FROM operacion.historial_capacitacion_cambio;
DELETE FROM operacion.historial_capacitacion;
DELETE FROM matriz.mapeo_columna;
DELETE FROM matriz.destino;
DELETE FROM matriz.importacion;
DELETE FROM matriz.capacitacion_desconocida;
DELETE FROM matriz.trabajador_desconocido;
DELETE FROM dnc.evaluacion;
DELETE FROM organizacion.trabajador;
DELETE FROM organizacion.area;
DELETE FROM organizacion.departamento;
DELETE FROM organizacion.puesto;
DELETE FROM catalogo.capacitacion c
 WHERE NOT EXISTS (SELECT 1 FROM dc3.curso_configuracion d WHERE d.capacitacion_id = c.capacitacion_id);
DELETE FROM sistema.revision_pendiente;
DELETE FROM sistema.envio_parte;
DELETE FROM seguridad.nonce;
DELETE FROM seguridad.credencial_equipo;
DELETE FROM sistema.bitacora_auditoria WHERE entidad_tipo NOT IN ('CONFIGURACION', 'METADATO_DC3');

ALTER TABLE operacion.historial_capacitacion_cambio ENABLE TRIGGER USER;
ALTER TABLE sistema.bitacora_auditoria ENABLE TRIGGER USER;
ALTER TABLE matriz.liberacion ENABLE TRIGGER USER;
ALTER TABLE matriz.liberacion_acuse ENABLE TRIGGER USER;
ALTER TABLE dc3.evento_excel ENABLE TRIGGER USER;

COMMIT;
