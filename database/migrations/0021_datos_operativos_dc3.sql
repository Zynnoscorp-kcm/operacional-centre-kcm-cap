-- =============================================================================
-- 0021 — Datos exigidos por la operación real: patrón DC-3, periodo de
--        ejecución, identidad del solicitante de sala y ficha del trabajador
--
-- Fuente: definición de datos entregada por el departamento de Capacitación
--         el
-- 2026-08-03. El esquema 0001–0019 cubría casi todo, pero cinco datos que el
-- formato oficial y las pantallas sí exigen no tenían dónde vivir:
--
--   1. Razón social y RFC del patrón: sólo existían en la configuración privada
--      del worker (`referencias/privado/dc3-config.json`). Un dato legal impreso
--      en cada constancia no puede vivir fuera de la base que audita la emisión.
--   2. Periodo de ejecución del curso: `documento_dc3` guardaba una sola
--      `fecha_curso`. El formato pide inicio y término, y la Inducción abarca
--      tres días desde el alta del trabajador.
--   3. Clave de área temática: era texto libre, sin catálogo que la valide.
--   4. Número de nómina del solicitante de sala: la reserva sólo guardaba nombre
--      y contacto.
--   5. Fotografía del trabajador para el sistema de control de cursos.
--
-- La antigüedad NO se agrega como columna: se deriva de `trabajador.fecha_alta`,
-- que ya es su fuente única, y se proyecta calculada en la superficie de lectura.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Patrón: la empresa que emite la constancia
-- -----------------------------------------------------------------------------
-- Sección "Datos de la empresa" del formato DC-3. Se versiona con vigencia
-- porque razón social y RFC son datos legales: si cambian, las constancias ya
-- emitidas deben poder reconstruir con cuál se imprimieron.
CREATE TABLE kcm.patron (
  patron_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social    text NOT NULL,
  rfc             text NOT NULL,
  vigente_desde   date NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta   date,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT patron_razon_social_no_vacia CHECK (btrim(razon_social) <> ''),
  -- RFC de persona moral: tres letras, seis dígitos de fecha y tres de
  -- homoclave. Se almacena sin guiones ni espacios.
  CONSTRAINT patron_rfc_formato CHECK (rfc ~ '^[A-ZÑ&]{3}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT patron_vigencia_valida CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde)
);

COMMENT ON TABLE kcm.patron IS
  'Datos de la empresa impresos en el DC-3: razón social y RFC con homoclave (SHCP).';
COMMENT ON COLUMN kcm.patron.rfc IS
  'RFC normalizado sin guiones. La impresión con separadores es responsabilidad del compositor del PDF.';

-- Un solo patrón vigente a la vez.
CREATE UNIQUE INDEX patron_vigente_unico ON kcm.patron ((true)) WHERE vigente_hasta IS NULL;

CREATE TRIGGER patron_actualizacion
  BEFORE UPDATE ON kcm.patron
  FOR EACH ROW EXECUTE FUNCTION kcm.marcar_actualizacion();

-- -----------------------------------------------------------------------------
-- 2. Catálogo de áreas temáticas del DC-3
-- -----------------------------------------------------------------------------
-- El reverso del formato oficial publica el catálogo de áreas temáticas. La
-- clave se declara aquí para que un curso no pueda imprimirse con una clave
-- inventada; el nombre queda pendiente hasta que Capacitación entregue el texto
-- oficial de cada clave.
CREATE TABLE kcm.area_tematica_dc3 (
  clave           text PRIMARY KEY,
  nombre          text,
  activa          boolean NOT NULL DEFAULT true,
  creada_en       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT area_tematica_clave_formato CHECK (clave ~ '^[0-9]{4}$')
);

COMMENT ON TABLE kcm.area_tematica_dc3 IS
  'Claves del catálogo de áreas temáticas del formato oficial STPS DC-3.';
COMMENT ON COLUMN kcm.area_tematica_dc3.nombre IS
  'Texto oficial del área temática. Nulo mientras Capacitación no lo entregue; no bloquea la clave.';

-- -----------------------------------------------------------------------------
-- 3. Metadatos por curso: nombre impreso, periodo y validación de la clave
-- -----------------------------------------------------------------------------
CREATE TYPE kcm.regla_fecha_dc3 AS ENUM ('FECHA_ALTA', 'FECHA_MATRIZ', 'FECHA_SESION');

COMMENT ON TYPE kcm.regla_fecha_dc3 IS
  'De dónde sale la fecha de inicio del periodo de ejecución: alta del trabajador, fecha de la matriz o fecha de la sesión.';

ALTER TABLE kcm.metadato_curso_dc3
  ADD COLUMN nombre_dc3    text,
  ADD COLUMN duracion_dias integer,
  ADD COLUMN regla_fecha   kcm.regla_fecha_dc3 NOT NULL DEFAULT 'FECHA_MATRIZ',
  ADD COLUMN dias_periodo  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN kcm.metadato_curso_dc3.nombre_dc3 IS
  'Nombre del curso tal como debe imprimirse en la constancia; puede diferir del nombre de catálogo.';
COMMENT ON COLUMN kcm.metadato_curso_dc3.duracion_dias IS
  'Duración operativa en días cuando el curso se imparte por jornadas. Referencia interna: el DC-3 imprime horas.';
COMMENT ON COLUMN kcm.metadato_curso_dc3.dias_periodo IS
  'Días que se suman al inicio para obtener el término. 0 significa que inicio y término son el mismo día.';

ALTER TABLE kcm.metadato_curso_dc3
  ADD CONSTRAINT metadato_dc3_dias_periodo_no_negativo CHECK (dias_periodo >= 0),
  ADD CONSTRAINT metadato_dc3_duracion_dias_positiva
    CHECK (duracion_dias IS NULL OR duracion_dias > 0),
  ADD CONSTRAINT metadato_dc3_area_tematica_declarada
    FOREIGN KEY (area_tematica_clave) REFERENCES kcm.area_tematica_dc3 (clave) ON DELETE RESTRICT;

-- La aprobación exige además el nombre impreso: una constancia sin nombre de
-- curso no es un documento incompleto, es un documento inválido.
ALTER TABLE kcm.metadato_curso_dc3
  DROP CONSTRAINT metadato_dc3_aprobacion_coherente;

ALTER TABLE kcm.metadato_curso_dc3
  ADD CONSTRAINT metadato_dc3_aprobacion_coherente
    CHECK (
      (aprobado = false)
      OR
      (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL
       AND duracion_horas IS NOT NULL AND area_tematica_clave IS NOT NULL
       AND agente_capacitador IS NOT NULL AND nombre_dc3 IS NOT NULL)
    );

-- -----------------------------------------------------------------------------
-- 4. Periodo de ejecución y patrón en el ledger de constancias
-- -----------------------------------------------------------------------------
-- `fecha_curso` se conserva como la fecha de referencia del cruce; el periodo
-- impreso es explícito y no se recalcula al leer.
ALTER TABLE kcm.documento_dc3
  ADD COLUMN fecha_inicio date,
  ADD COLUMN fecha_fin    date,
  ADD COLUMN patron_id    uuid REFERENCES kcm.patron (patron_id) ON DELETE RESTRICT;

UPDATE kcm.documento_dc3
   SET fecha_inicio = COALESCE(fecha_inicio, fecha_curso),
       fecha_fin    = COALESCE(fecha_fin, fecha_curso);

ALTER TABLE kcm.documento_dc3
  ALTER COLUMN fecha_inicio SET NOT NULL,
  ALTER COLUMN fecha_fin    SET NOT NULL,
  ADD CONSTRAINT documento_dc3_periodo_valido CHECK (fecha_fin >= fecha_inicio),
  ADD CONSTRAINT documento_dc3_periodo_contiene_fecha
    CHECK (fecha_curso BETWEEN fecha_inicio AND fecha_fin);

COMMENT ON COLUMN kcm.documento_dc3.fecha_inicio IS
  'Inicio del periodo de ejecución impreso en la constancia.';
COMMENT ON COLUMN kcm.documento_dc3.patron_id IS
  'Patrón con cuya razón social y RFC se emitió esta constancia.';

-- -----------------------------------------------------------------------------
-- 5. Identidad del solicitante en la reserva de sala
-- -----------------------------------------------------------------------------
-- El formulario pide número de nómina; el contacto deja de ser obligatorio
-- porque la nómina ya identifica a la persona dentro de planta.
ALTER TABLE kcm.reserva_sala
  ADD COLUMN solicitante_numero_trabajador kcm.numero_trabajador,
  ADD COLUMN solicitante_trabajador_id uuid REFERENCES kcm.trabajador (trabajador_id) ON DELETE SET NULL;

ALTER TABLE kcm.reserva_sala
  ALTER COLUMN solicitante_contacto DROP NOT NULL;

ALTER TABLE kcm.reserva_sala
  ADD CONSTRAINT reserva_solicitante_identificado
    CHECK (solicitante_numero_trabajador IS NOT NULL OR solicitante_contacto IS NOT NULL);

COMMENT ON COLUMN kcm.reserva_sala.solicitante_numero_trabajador IS
  'Número de nómina capturado. Se conserva como valor aunque el trabajador cause baja.';

CREATE INDEX reserva_solicitante_numero_idx
  ON kcm.reserva_sala (solicitante_numero_trabajador)
  WHERE solicitante_numero_trabajador IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. Fotografía del trabajador
-- -----------------------------------------------------------------------------
-- La imagen vive en Storage; la tabla sólo guarda su referencia y su huella,
-- igual que `kcm.evidencia`. Ninguna fila del padrón almacena binarios.
ALTER TABLE kcm.trabajador
  ADD COLUMN foto_ruta text,
  ADD COLUMN foto_sha256 kcm.sha256,
  ADD COLUMN foto_actualizada_en timestamptz;

ALTER TABLE kcm.trabajador
  ADD CONSTRAINT trabajador_foto_coherente
    CHECK ((foto_ruta IS NULL) = (foto_sha256 IS NULL));

COMMENT ON COLUMN kcm.trabajador.foto_ruta IS
  'Ruta en el bucket privado de fotografías. Nunca contiene la imagen.';

-- -----------------------------------------------------------------------------
-- 7. RLS deny-by-default en las tablas nuevas
-- -----------------------------------------------------------------------------
ALTER TABLE kcm.patron ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.patron FORCE ROW LEVEL SECURITY;

ALTER TABLE kcm.area_tematica_dc3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE kcm.area_tematica_dc3 FORCE ROW LEVEL SECURITY;
