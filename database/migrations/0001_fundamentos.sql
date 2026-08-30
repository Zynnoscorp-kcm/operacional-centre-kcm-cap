-- =============================================================================
-- 0001 — Fundamentos
-- Esquemas, extensiones, dominios, enumeraciones y utilidades compartidas.
--
-- Fuente: docs/MODELO_DATOS.md (contratos e invariantes) y
--
-- ESTE ARCHIVO NO SE APLICA SIN CONFIRMACIÓN DEL DEPARTAMENTO. Ver db/README.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Esquemas
-- -----------------------------------------------------------------------------
-- `kcm` guarda el dominio completo. Ninguna tabla vive en `public`: así el
-- deny-by-default de 0016 no depende de lo que Supabase deje en `public`.
CREATE SCHEMA IF NOT EXISTS kcm;

-- `kcm_lectura` es la única superficie de lectura. Las tablas de `kcm` quedan
-- cerradas por RLS sin políticas permisivas; lo que se puede leer se expone
-- aquí por funciones SECURITY DEFINER que proyectan sólo las columnas
-- autorizadas. Ver 0016 y db/JUSTIFICACION.md, sección "Modelo de acceso".
CREATE SCHEMA IF NOT EXISTS kcm_lectura;

-- Supabase ya provee este esquema; se declara por si el destino no lo trae.
CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA kcm IS
  'Dominio y operación de la plataforma KCM. Todas las tablas con RLS forzada y sin políticas permisivas.';
COMMENT ON SCHEMA kcm_lectura IS
  'Superficie de lectura enumerada. Cada función proyecta sólo las columnas que su consumidor necesita.';

-- -----------------------------------------------------------------------------
-- Extensiones
-- -----------------------------------------------------------------------------
-- btree_gist habilita el EXCLUDE de traslape de salas (0013), que es la única
-- forma de sostener el invariante bajo concurrencia sin un lock aplicativo.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- pgcrypto para digest() en las claves derivadas del ledger DC-3 (0015).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- Dominios
-- -----------------------------------------------------------------------------

-- INVARIANTE: el número de trabajador es texto de cinco dígitos y jamás se
-- convierte a número. El dominio lo vuelve estructural: ninguna columna del
-- esquema puede almacenarlo como integer sin cambiar su tipo declarado.
CREATE DOMAIN kcm.numero_trabajador AS text
  CONSTRAINT numero_trabajador_formato CHECK (VALUE ~ '^\d{5}$');

COMMENT ON DOMAIN kcm.numero_trabajador IS
  'Texto de exactamente cinco dígitos. Invariante de Parte 1: nunca se convierte a número.';

CREATE DOMAIN kcm.sha256 AS text
  CONSTRAINT sha256_formato CHECK (VALUE ~ '^[0-9a-f]{64}$');

COMMENT ON DOMAIN kcm.sha256 IS 'Huella SHA-256 en hexadecimal minúsculo.';

-- Los identificadores de solicitud sostienen toda la idempotencia del sistema.
-- Se acotan para que un valor vacío o de longitud abusiva no llegue a una clave.
CREATE DOMAIN kcm.identificador_solicitud AS text
  CONSTRAINT identificador_solicitud_formato
  CHECK (VALUE ~ '^[A-Za-z0-9._:-]{8,128}$');

COMMENT ON DOMAIN kcm.identificador_solicitud IS
  'requestId. Acota longitud y alfabeto para que sea usable como clave idempotente.';

-- Texto libre capturado por una persona (motivo, hallazgo, comentario). Se acota
-- y se prohíbe el vacío para que un motivo obligatorio no se cumpla con "".
CREATE DOMAIN kcm.motivo AS text
  CONSTRAINT motivo_no_vacio CHECK (btrim(VALUE) <> '')
  CONSTRAINT motivo_longitud CHECK (length(VALUE) <= 1500);

COMMENT ON DOMAIN kcm.motivo IS
  'Texto justificativo no vacío. Un motivo obligatorio no se satisface con cadena vacía.';

-- -----------------------------------------------------------------------------
-- Enumeraciones de estado
-- -----------------------------------------------------------------------------

CREATE TYPE kcm.rol AS ENUM (
  'ADMINISTRADOR', 'CAPACITACION', 'AUDITOR', 'CAPACITADOR'
);

-- Los tres estados de OCR del legado (`EVIDENCIA_RECIBIDA`, `OCR_EN_PROCESO`,
-- `REVISION_OCR`) NO se trasladan: el OCR quedó suspendido por
-- completo. La máquina legada ya admitía `CERRADA -> PRELIBERACION`, así que el
-- camino sobrevive sin ellos. Ver db/JUSTIFICACION.md, "Lo que no se tradujo".
CREATE TYPE kcm.estado_sesion AS ENUM (
  'BORRADOR', 'ABIERTA', 'CERRADA', 'PRELIBERACION', 'LISTA_PARA_LIBERAR',
  'LIBERADA_PARCIAL', 'LIBERADA_TOTAL', 'CANCELADA', 'ERROR'
);

CREATE TYPE kcm.estado_asistencia AS ENUM (
  'CAPTURADA', 'IDENTIDAD_INVALIDA', 'PENDIENTE_COTEJO', 'COTEJADA',
  'EXAMEN_PENDIENTE', 'EXAMEN_CONFIRMADO', 'EXAMEN_NO_ENCONTRADO',
  'ELEGIBLE', 'EXCLUIDA', 'LIBERADA'
);

CREATE TYPE kcm.estado_examen AS ENUM (
  'EXAMEN_PENDIENTE', 'EXAMEN_CONFIRMADO', 'EXAMEN_NO_ENCONTRADO'
);

-- `OCR` sale del contrato de rutas. El alta manual de preliberación reutiliza
-- la ruta `DIGITAL` (MODELO_DATOS.md); su origen se distingue en otra columna.
CREATE TYPE kcm.ruta_captura AS ENUM ('DIGITAL');

CREATE TYPE kcm.origen_asistencia AS ENUM ('QUIOSCO', 'ALTA_MANUAL');

CREATE TYPE kcm.fase_registro_quiosco AS ENUM (
  'RESERVADO', 'ASISTENCIA_CREADA', 'COMPLETADO'
);

-- Procedencia de una fecha de curso. Es el eje de la reconciliación: el
-- conflicto se resuelve por procedencia, nunca por orden de llegada.
CREATE TYPE kcm.procedencia_fecha AS ENUM ('XLSB_IMPORT', 'SESSION_RELEASE');

CREATE TYPE kcm.estado_registro_hc AS ENUM ('VIGENTE', 'RETIRADO');

-- `SOBRESCRITA` es nueva respecto del legado: es el tipo de cambio que produce
-- la sobrescritura gobernada.
CREATE TYPE kcm.tipo_cambio_hc AS ENUM (
  'ALTA', 'CORREGIDA', 'RETIRADA', 'REACTIVADA', 'SOBRESCRITA'
);

-- El legado sólo admitía `NO_OVERWRITE` (KcmReleaseSync.bas). El diseño admite un
-- segundo valor gobernado; ninguno más.
CREATE TYPE kcm.politica_sobrescritura AS ENUM (
  'NO_OVERWRITE', 'OVERWRITE_WITH_HISTORY'
);

-- INVARIANTE: los lotes de importación recorren recibido, preparado, validado,
-- aprobado y confirmado, o terminan en rechazo o conflicto.
CREATE TYPE kcm.estado_lote_importacion AS ENUM (
  'RECIBIDO', 'PREPARADO', 'VALIDADO', 'APROBADO', 'CONFIRMADO',
  'RECHAZADO', 'CONFLICTO'
);

-- INVARIANTE: ausencia en un extracto no equivale a baja. Cada lote declara su
-- alcance ANTES de aplicarse; por eso la columna es NOT NULL desde el alta.
CREATE TYPE kcm.alcance_lote AS ENUM ('FULL', 'DELTA');

CREATE TYPE kcm.estado_candidato AS ENUM (
  'PENDIENTE', 'INCORPORADO', 'DECLARADO_ALIAS', 'RECHAZADO'
);

-- Aplicabilidad en dos niveles desde la primera versión: `department` para los
-- ocho cursos de calidad del TSV, `area` para los trece técnicos del DNC.
CREATE TYPE kcm.nivel_poblacion AS ENUM ('DEPARTMENT', 'AREA');

CREATE TYPE kcm.estado_dnc AS ENUM (
  'COMPLETADO', 'REFORZAR', 'PENDIENTE', 'NO_APLICA',
  'DATOS_INSUFICIENTES', 'PROGRAMADO'
);

CREATE TYPE kcm.estado_reserva AS ENUM ('ACTIVA', 'CANCELADA');

CREATE TYPE kcm.origen_reserva AS ENUM ('AUTOSERVICIO', 'CONTROL');

CREATE TYPE kcm.fase_lote_liberacion AS ENUM (
  'PENDIENTE', 'MATRIZ_APLICADA', 'DOMINIO_APLICADO', 'COMPLETADO'
);

CREATE TYPE kcm.estado_lote_liberacion AS ENUM (
  'PENDIENTE', 'COMPLETADO', 'CONFLICTO'
);

-- Sólo `APPLIED` y `RECOVERED` son efectivos; los demás conservan el conflicto
-- para revisión y no confirman escritura en el XLSB (MODELO_DATOS.md).
CREATE TYPE kcm.estado_acuse_vba AS ENUM (
  'APPLIED', 'RECOVERED', 'HEADER_MISMATCH', 'EXISTING_VALUE',
  'DESTINATION_MISSING', 'REJECTED'
);

-- Registrarse en el quiosco y abrir una sesión desde la sala pasan a ser dos
-- secretos distintos, con alcances separados y auditoría independiente.
CREATE TYPE kcm.alcance_secreto AS ENUM ('REGISTRO_QUIOSCO', 'APERTURA_SESION');

-- CONJUNTO CERRADO de atributos que una regla DNC puede leer. La escolaridad no
-- está aquí a propósito: el diseño prohíbe que alimente ninguna regla ni ningún
-- porcentaje mientras sea un valor declarado por omisión. Al ser un enum, la
-- prohibición es estructural y no depende de que alguien la recuerde.
CREATE TYPE kcm.atributo_para_reglas AS ENUM ('DEPARTMENT', 'AREA', 'CATEGORIA');

CREATE TYPE kcm.procedencia_atributo AS ENUM (
  'DECLARADO_POR_OMISION', 'DERIVADO_DE_PUESTO', 'RECURSOS_HUMANOS'
);

CREATE TYPE kcm.estado_dc3 AS ENUM ('PENDIENTE', 'BLOQUEADO', 'COMPLETADO');

CREATE TYPE kcm.origen_fuente AS ENUM (
  'MATRIZ_XLSB', 'TSV_DNC', 'DNC_TECNICO', 'CAPTA', 'PLATAFORMA', 'DEPARTAMENTO'
);

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

-- INVARIANTE: auditoría y journals sólo se agregan; no existe operación de
-- edición. Se enforcea con trigger, no con disciplina: cualquier UPDATE, DELETE
-- o TRUNCATE sobre una tabla de sólo agregado aborta.
CREATE FUNCTION kcm.impedir_modificacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'La tabla %.% es de sólo agregado; la operación % no está permitida.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION kcm.impedir_modificacion() IS
  'Trigger de sólo agregado. Se instala en auditoría, historiales y journals. Ver 0018 para la aserción de cobertura.';

CREATE FUNCTION kcm.marcar_actualizacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION kcm.marcar_actualizacion() IS
  'Mantiene actualizado_en sin confiar en que el cliente lo envíe.';

-- NOTA: esta versión sólo sirve a las tablas cuya columna se llama
-- `actualizado_en`. Cinco tablas la declaran en femenino y por eso 0020 la
-- reemplaza por una versión que resuelve el nombre real. No edite este archivo
-- para arreglarlo: el historial de migraciones debe conservar el defecto y su
-- corrección.
