# Modelo de datos compartido

> [!IMPORTANT]
> **Reglas de autoridad vigentes.** Prevalecen sobre cualquier sección
> histórica de este documento: el reconocimiento óptico está retirado; el libro
> de Excel conserva la autoridad del historial de fechas y la base la de la
> operación y la réplica consultable; y `OVERWRITE_WITH_HISTORY` sólo se
> permite en un destino declarado, con valor anterior, actor y motivo
> persistidos antes de escribir. Las menciones posteriores a reconocimiento
> óptico obligatorio, a hojas de cálculo alojadas o a `NO_OVERWRITE` exclusivo
> son antecedentes, no contrato vigente.

La version vigente del contrato es `1.0.0`, definida en `packages/contracts/contracts.js`. El numero de trabajador se conserva siempre como texto con el patron `^\d{5}$`. Ambas rutas de captura producen `ParticipantAttendance` antes de entrar a preliberacion.

## Contratos

| Contrato | Identidad estable | Proposito |
|---|---|---|
| `Session` | `sessionId`, `sessionCode` | Encabezado y autorizacion de una capacitacion |
| `Participant` | `employeeId` | Vista minima y autorizada del padron |
| `Attendance` | `attendanceId` | Registro persistente por sesion y trabajador |
| `ParticipantAttendance` | `sessionId + employeeId` | Contrato común de la captura de asistencia |
| `KioskRegistration` | `registrationId`; unicidad logica `sessionId + employeeId` | Journal durable del registro digital |
| `OcrDocument` | `documentId`, `sha256` | Documento fuente y deteccion de duplicados |
| `OcrCandidate` | `candidateId` | Lectura por renglon, confianza y correccion |
| `ExamReconciliation` | `reconciliationId` | Conteos recibido/faltante confirmados |
| `PreReleaseReview` | `revisionId`; una revisión vigente por `sessionId` | Resultados, exclusiones, hallazgos y comentarios previos a liberación |
| `Release` | `idempotencyKey` | Resultado efectivo de escritura a matriz |
| `ReleaseBatch` | `batchId`, `requestId` | Journal autenticado y recuperable de un lote de liberacion |
| `AuditEvent` | `eventId` | Evento inmutable y ordenado en el tiempo |
| `Evidence` | `evidenceId`, `sha256` | Referencia protegida al reporte de preliberación |
| `RoomReservation` | `reservationId`; idempotencia por `requestId` | Bloque de ocupación de una de las siete salas y datos privados del solicitante |
| `Dc3Plan` | corte + hashes de matriz, padrón y plantilla | Detección local agregada de constancias por trabajador y curso |
| `Dc3DocumentJournal` | SHA-256 de `employeeId + courseId` | Journal privado local `PENDING -> COMPLETED`, con huella fuente y hash del XLSX |
| `ExcelDeviceCredential` | `clientId`; secreto sólo como hash + sal | Asignación individual, revocable y opcionalmente sin vencimiento de principal, perfil Windows, equipo, alcance y recurso |
| `ExcelImport` | `importId`, `requestId` | Carga gobernada que conserva staging y diff antes de aprobación |
| `OverwriteHistory` | `idempotencyKey` + destino | Registro append-only del valor anterior, actor, motivo, procedencia y momento previo a la escritura |

La clave idempotente efectiva de liberacion concatena `sessionId`, `employeeId`, `trainingId` y `mappingVersion`. Cambiar el `requestId` no genera una segunda escritura.

## Reglas e invariantes

- Existe como maximo una asistencia por `sessionId + employeeId`.
- `employeeId` nunca se convierte a numero.
- `ParticipantAttendance` es elegible solo con identidad validada, asistencia comprobada, examen confirmado, sesion autorizada y `released = false`.
- `EXAMEN_NO_ENCONTRADO` excluye solo a esa asistencia y permite una liberacion parcial.
- Una asistencia `LIBERADA` no puede reabrirse.
- Guardar una revisión confirma de forma auditada la asistencia de cada
  identidad validada que aparece en el padrón, clasifica los exámenes enviados
  por la pantalla y no cambia el estado de la sesión. Después de guardar, la
  acción explícita `enterPreRelease` mueve
  `CERRADA -> PRELIBERACION`. Sólo entonces `submitPreRelease` habilita
  `PRELIBERACION -> LISTA_PARA_LIBERAR`; la bandeja de liberación es de sólo
  lectura y `returnPreRelease` revierte la sesión a `PRELIBERACION`. Las
  transiciones son bloqueadas, idempotentes y auditadas antes de persistir el
  estado.
- Un registro de quiosco avanza por `RESERVADO`, `ASISTENCIA_CREADA` y
  `COMPLETADO`. El bootstrap repara fases incompletas, asistencia o auditoria
  sin depender del reintento de esa persona; el cierre de sesion ejecuta la
  misma reconciliacion antes de aceptar `CERRADA`.
- Las transiciones de sesion escriben primero un evento semantico idempotente y
  despues el estado. Un reintento adopta el evento existente y completa el
  cambio; si la sesion ya esta en el estado terminal sin su auditoria requerida,
  falla cerrado en vez de inventar proveniencia.
- La matriz simulada rechaza el lote completo si una celda ya contiene valor; no sobrescribe por defecto.
- Antes de cada commit se exige exactamente un mapeo activo, leido sin cache, y
  debe coincidir campo por campo con el plan congelado.
- `LIBERACION_LOTES.journalMac` autentica con HMAC el plan, resultados, fase,
  estado, identidad del lote y sus fechas. Cambiar una fase o un resultado sin
  el secreto detiene la reanudacion antes de efectos de dominio.
- El marcador de matriz `KCM_RELEASE_V2` usa HMAC sobre `batchId`, `requestId`,
  `planHash`, sesion, version de mapeo y clave idempotente. Un SHA de la clave
  publica o un marcador de otro lote no autoriza recuperacion.
- Un lote no terminal solo se reanuda con su `requestId` original. Estado,
  autorizacion y elegibilidad se vuelven a validar antes de cada efecto.
- La escritura directa al libro maestro está deshabilitada: la liberación
  escribe únicamente en el ledger normalizado `HC_REGISTROS`, después de un
  preflight completo del lote. Una fecha previa aborta el lote salvo que el
  destino declare `OVERWRITE_WITH_HISTORY` y la solicitud traiga motivo, en
  cuyo caso el valor anterior se persiste antes que el nuevo.
- `HC` es una proyección reconstruible de valores. La identidad estable vive en
  `HC_TRABAJADORES.employeeId` y `HC_CURSOS.trainingId`, no en sus filas,
  columnas o encabezados visibles.
- Los eventos de auditoria se agregan como objetos inmutables; no existe operacion de edicion.
- Un alta manual en preliberación sólo acepta un `employeeId` activo de
  `EMPLEADOS`, reutiliza la ruta contractual `DIGITAL`, parte cotejada con
  `EXAMEN_CONFIRMADO`, es idempotente por `requestId` y agrega
  `PRERELEASE_ATTENDANCE_ADDED` antes de insertar la asistencia. Un duplicado
  con otra solicitud se rechaza.
- Una reservación activa no puede traslaparse con otra de la misma sala y fecha.
  La exclusión la garantiza la base con `EXCLUDE ... USING gist`; la creación
  adopta una solicitud repetida por `requestId` sólo si coincide su huella y
  audita antes de insertar. Cancelar es
  una transición `ACTIVA -> CANCELADA`: no elimina la fila y vuelve a liberar el
  horario.
- La disponibilidad compartida de salas sólo expone `roomId`, fecha, inicio,
  término y el estado genérico `RESERVADA`; nombre, puesto, área, contacto,
  motivo e identidad interna permanecen en la consulta administrativa.
- `RoomReservation.date`, `startTime` y `endTime` se escriben como texto
  canónico (`YYYY-MM-DD` y `HH:mm`). Las lecturas también normalizan celdas
  históricas que una hoja de cálculo haya convertido a `Date`, de modo que un
  intervalo largo ocupe todos sus bloques y permanezca visible.
- El plan DC-3 usa la primera fecha elegible a partir de `2026-01-01` y genera
  como máximo una constancia por `employeeId + courseId`. Todo documento exige
  identidad activa, nombre, CURP, puesto y fecha válidos, además de duración,
  área temática y agente capacitador aprobados. El ledger no guarda el
  `employeeId`: conserva un hash estable y nunca sobrescribe un archivo con una
  huella distinta.

## Esquema lógico

La nomenclatura de hojas se conserva porque es la que usa el libro maestro y la
que referencian los comentarios de las tablas en `database/migrations/`. Las columnas
se resuelven por encabezado y nunca por posición fija; los arreglos se leen y se
escriben por lote.

| Hoja | Clave | Campos principales |
|---|---|---|
| `CONFIG` | `key` | `value`, `category`, `updatedAt` |
| `EMPLEADOS` | `employeeId` | `displayName`, `area`, `position`, `shift`, `active` |
| `CAPACITACIONES` | `trainingId` | `trainingName`, `active`, `version` |
| `SESIONES` | `sessionId` | `sessionCode`, `trainingId`, metadatos, `status`, `authorized` |
| `ASISTENCIAS` | `attendanceId` | `sessionId`, `employeeId`, ruta, banderas, examen, estado, version |
| `KIOSK_REGISTROS` | `registrationId` | sesion, trabajador, asistencia, request, estacion, fase y fechas |
| `EVIDENCIAS` | `evidenceId` | sesion, documento, ruta de almacenamiento, hash, MIME e inmutabilidad |
| `EXAMENES` | `reconciliationId` | `sessionId`, conteos, faltantes, operador, fecha |
| `LIBERACIONES` | `idempotencyKey` | sesion, trabajador, mapeo, resultado y fecha efectiva |
| `LIBERACION_LOTES` | `batchId` | request, plan/hash, resultados, fase, estado y `journalMac` |
| `MATRIZ_MAPEO` | `trainingId + mappingVersion` | hoja, columna, encabezado esperado, fila de encabezado, politica y vigencia |
| `AUDITORIA` | `eventId` | actor, rol, entidad, accion, estados, motivo, request, evidencia y procedencia |
| `ERRORES` | `errorId` | codigo sanitizado, operacion, reintentos, fecha y resolucion |
| `MATRIZ_SIMULADA` | `idempotencyKey` | sesion, trabajador, capacitacion, version, fecha, lote, hash y marcador autenticado |
| `HC_TRABAJADORES` | `employeeId` | nombre y datos laborales como valores, vigencia, hash e importación |
| `HC_CURSOS` | `trainingId` | `sourceKey`, nombre, alias, vigencia e importaciones observadas |
| `HC_REGISTROS` | `idempotencyKey`; unicidad lógica `employeeId + trainingId` | fecha, origen, sesión, lote, marcador e importación |
| `HC_IMPORTACIONES` | `importId`; unicidad de `requestId` | hashes fuente/snapshot, conteos, diagnóstico, estado y actor |
| `VBA_LIBERACION_ACUSES` | `ackId`; efecto lógico por `idempotencyKey` | cliente, lote, versión de mapeo, fecha, estado, hash del XLSB y dirección aplicada |
| `VBA_DC3_EVENTOS` | `eventId`; estado lógico por `dc3Key` | trabajador, curso, fecha, estado, hash de archivo y código de bloqueo |
| `RESERVAS_SALAS` | `reservationId`; unicidad lógica `requestId` | sala, fecha, horario, solicitante, motivo, estado, origen y cancelación |
| `HC` | Proyección, sin identidad física | vista de valores; fila 2 oculta conserva `trainingId` por columna |

Los IDs de hojas, carpetas y recursos productivos no forman parte del modelo versionado; deben vivir en `PropertiesService` o configuracion autorizada.

`VBA_LIBERACION_ACUSES` no crea la liberación: confirma que un efecto ya
autorizado en `HC_REGISTROS` fue materializado en el XLSB. Sólo `APPLIED` y
`RECOVERED` son efectivos. Los demás estados conservan conflictos para revisión.
`VBA_DC3_EVENTOS` es un historial append-only; la vista operativa toma el evento
más reciente por `dc3Key`.

`LIBERACION_LOTES` progresa por `PENDIENTE`, `MATRIZ_APLICADA`,
`DOMINIO_APLICADO` y `COMPLETADO`, o termina en `CONFLICTO`. Cada reemplazo del
journal se escribe como fila completa y vuelve a validar su HMAC. Un replay
terminal comprueba primero el efecto autenticado de matriz y despues repara
asistencias, filas `LIBERACIONES`, estado de sesion y auditorias faltantes. Esta
recuperación se habilita sobre la réplica consultable y sobre el ledger
`HC_REGISTROS`. En modo HC, el replay exige el mismo efecto durable
(`requestId`, lote, plan, marcador, trabajador, curso y fecha) antes de
reconstruir la vista. La escritura directa a celdas del XLSB o de una conversión
permanece en solo lectura.
