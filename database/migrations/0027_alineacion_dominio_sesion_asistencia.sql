-- =============================================================================
-- 0027 — Alineación del esquema con el contrato del dominio
--
-- Los adaptadores SQL se escribieron sin ejecutarse nunca contra la base, y al
-- cablearlos aparecieron dos clases de desajuste. Esta migración resuelve sólo
-- la primera; la segunda se corrige en el código, que es donde está el error.
--
--   1. Datos del dominio que la tabla no podía guardar. `SessionRecord`
--      declara sala, turno, tipo de evento y el `requestId` que hace idempotente
--      la creación de la sesión; `kcm.sesion` no tenía ninguno, así que crear
--      dos veces la misma sesión habría producido dos filas. Y la asistencia
--      perdía el número tal como se capturó en el quiosco, que es lo único que
--      queda si el trabajador se retira del padrón.
--
--   2. Nombres distintos para el mismo dato —`via_captura` por `ruta`,
--      `estado_asistencia` por `estado`, `creado_en` por `creada_en`,
--      `actor.nombre_completo` por `nombre_visible`—. Ahí el esquema es la
--      referencia auditada y el adaptador es quien se equivoca.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sesión: metadatos operativos e idempotencia de creación
-- -----------------------------------------------------------------------------
ALTER TABLE kcm.sesion
  ADD COLUMN sala        text,
  ADD COLUMN turno       text,
  ADD COLUMN tipo_evento text NOT NULL DEFAULT 'CAPACITACION',
  ADD COLUMN solicitud_creacion_id kcm.identificador_solicitud;

COMMENT ON COLUMN kcm.sesion.solicitud_creacion_id IS
  'requestId de creación. Su unicidad es lo que impide que un reintento abra una segunda sesión.';
COMMENT ON COLUMN kcm.sesion.sala IS
  'Sala declarada al abrir la sesión. Texto libre: no se ata al catálogo de agenda, que resuelve otro problema.';

CREATE UNIQUE INDEX sesion_solicitud_creacion_unica
  ON kcm.sesion (solicitud_creacion_id)
  WHERE solicitud_creacion_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Asistencia: el número tal como se capturó
-- -----------------------------------------------------------------------------
-- `trabajador_id` es la identidad resuelta; esta columna conserva lo que la
-- persona tecleó en el quiosco. Se llenan las dos: una sirve para unir, la otra
-- para auditar, y sobreviven a que el padrón cambie.
ALTER TABLE kcm.asistencia
  ADD COLUMN numero_trabajador_capturado kcm.numero_trabajador;

UPDATE kcm.asistencia a
   SET numero_trabajador_capturado = t.numero_trabajador
  FROM kcm.trabajador t
 WHERE t.trabajador_id = a.trabajador_id
   AND a.numero_trabajador_capturado IS NULL;

COMMENT ON COLUMN kcm.asistencia.numero_trabajador_capturado IS
  'Número tecleado en el quiosco. Se conserva como valor aunque el trabajador salga del padrón.';

CREATE INDEX asistencia_numero_capturado_idx
  ON kcm.asistencia (numero_trabajador_capturado)
  WHERE numero_trabajador_capturado IS NOT NULL;
