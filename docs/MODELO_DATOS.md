# Modelo de datos compartido

Estado: **IMPLEMENTADO** en contratos de dominio y repositorios locales; persistencia Google Sheets **PENDIENTE de despliegue**.

La version vigente del contrato es `1.0.0`, definida en `src/shared/contracts.js`. El numero de trabajador se conserva siempre como texto con el patron `^\d{5}$`. Ambas rutas de captura producen `ParticipantAttendance` antes de entrar a preliberacion.

## Contratos

| Contrato | Identidad estable | Proposito |
|---|---|---|
| `Session` | `sessionId`, `sessionCode` | Encabezado y autorizacion de una capacitacion |
| `Participant` | `employeeId` | Vista minima y autorizada del padron |
| `Attendance` | `attendanceId` | Registro persistente por sesion y trabajador |
| `ParticipantAttendance` | `sessionId + employeeId` | Contrato comun de captura digital y OCR |
| `KioskRegistration` | `registrationId`; unicidad logica `sessionId + employeeId` | Journal durable del registro digital |
| `OcrDocument` | `documentId`, `sha256` | Documento fuente y deteccion de duplicados |
| `OcrCandidate` | `candidateId` | Lectura por renglon, confianza y correccion |
| `ExamReconciliation` | `reconciliationId` | Conteos recibido/faltante confirmados |
| `Release` | `idempotencyKey` | Resultado efectivo de escritura a matriz |
| `ReleaseBatch` | `batchId`, `requestId` | Journal autenticado y recuperable de un lote de liberacion |
| `AuditEvent` | `eventId` | Evento inmutable y ordenado en el tiempo |
| `Evidence` | `evidenceId`, `sha256` | Referencia protegida a evidencia en Drive |

La clave idempotente efectiva de liberacion concatena `sessionId`, `employeeId`, `trainingId` y `mappingVersion`. Cambiar el `requestId` no genera una segunda escritura.

## Reglas e invariantes

- Existe como maximo una asistencia por `sessionId + employeeId`.
- `employeeId` nunca se convierte a numero.
- `ParticipantAttendance` es elegible solo con identidad validada, asistencia comprobada, examen confirmado, sesion autorizada y `released = false`.
- `EXAMEN_NO_ENCONTRADO` excluye solo a esa asistencia y permite una liberacion parcial.
- Una asistencia `LIBERADA` no puede reabrirse.
- `REVISION_OCR` exige evidencia remota completa; mientras falte un fragmento
  el documento y la sesion permanecen `OCR_EN_PROCESO`.
- Cada sesion de lista fisica admite un solo `OcrDocument`. La repeticion del
  mismo `sessionId + sha256` recupera o devuelve la carga canonica; un segundo
  hash o un legado con varios documentos falla cerrado antes de procesar.
- La carga original usa IDs y nombre Drive deterministas bajo bloqueo. Un
  reintento completa evidencia, documento o transicion parcial sin crear otra
  identidad; un archivo canonico duplicado o con hash distinto se rechaza.
- `ocrLeaseId + ocrLeaseUntil` reserva durablemente una invocacion remota antes
  de enviar el documento. Una concesion vigente excluye concurrencia y una
  concesion expirada solo puede recuperarse con el mismo `ocrRequestId`.
- Una fila sin participante termina como `CONFIRMADO_VACIO` con actor, fecha y
  motivo; no genera una asistencia ficticia.
- Una asistencia OCR retractada se conserva como `EXCLUIDA`, sin identidad ni
  asistencia comprobada; nunca se borra ni neutraliza una captura digital.
- Una resolucion humana terminal conserva `correctionRequestId`,
  `correctionPreviousDecision` y `correctionPreviousEmployeeId`. Estos campos
  permiten distinguir un replay identico, reconstruir la decision anterior y
  reparar de forma determinista la asistencia o auditoria que hubiera quedado
  incompleta. No se exponen en el DTO de revision del participante.
- Un registro de quiosco avanza por `RESERVADO`, `ASISTENCIA_CREADA` y
  `COMPLETADO`. El bootstrap repara fases incompletas, asistencia o auditoria
  sin depender del reintento de esa persona; el cierre de sesion ejecuta la
  misma reconciliacion antes de aceptar `CERRADA`.
- Las mutaciones Apps Script comparten `KcmScriptLock`, un envoltorio reentrante
  del `ScriptLock` global. Las llamadas anidadas de una misma ejecucion
  comparten el bloqueo y solo la liberacion exterior lo entrega; un conflicto
  de adquisicion falla de forma reintentable.
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
  autorizacion, OCR y elegibilidad se vuelven a validar antes de cada efecto.
- La escritura directa a una matriz Google Sheets real esta deshabilitada:
  Apps Script/Sheets no ofrecen en esta implementacion una precondicion CAS que
  demuestre `NO_OVERWRITE` frente a editores externos. Solo la matriz simulada
  permite commit; la matriz real admite vista previa de solo lectura.
- Los eventos de auditoria se agregan como objetos inmutables; no existe operacion de edicion.

## Esquema logico de Sheets

Las columnas se resuelven por encabezado, no por posicion fija. Los arreglos se leen y escriben por lote.

| Hoja | Clave | Campos principales |
|---|---|---|
| `CONFIG` | `key` | `value`, `category`, `updatedAt` |
| `EMPLEADOS` | `employeeId` | `displayName`, `area`, `position`, `shift`, `active` |
| `CAPACITACIONES` | `trainingId` | `trainingName`, `active`, `version` |
| `SESIONES` | `sessionId` | `sessionCode`, `trainingId`, metadatos, `status`, `authorized` |
| `ASISTENCIAS` | `attendanceId` | `sessionId`, `employeeId`, ruta, banderas, examen, estado, version |
| `KIOSK_REGISTROS` | `registrationId` | sesion, trabajador, asistencia, request, estacion, fase y fechas |
| `OCR_DOCUMENTOS` | `documentId` | `sessionId`, evidencia, hash, estado, request, concesion temporal, worker, runtime, pipeline y tiempo |
| `OCR_RESULTADOS` | `candidateId` | `documentId`, renglon, lectura, confianza, decision, correccion, `correctionRequestId`, `correctionPreviousDecision`, `correctionPreviousEmployeeId` y `cropEvidenceRefs` |
| `OCR_RECORTES_LOTES` | `batchId` | `requestId`, manifiesto, fragmentos completos, estado, conteos, runtime y version |
| `EVIDENCIAS` | `evidenceId` | sesion, documento, candidato, casilla, variante, Drive ID, hash, MIME e inmutabilidad |
| `EXAMENES` | `reconciliationId` | `sessionId`, conteos, faltantes, operador, fecha |
| `LIBERACIONES` | `idempotencyKey` | sesion, trabajador, mapeo, resultado y fecha efectiva |
| `LIBERACION_LOTES` | `batchId` | request, plan/hash, resultados, fase, estado y `journalMac` |
| `MATRIZ_MAPEO` | `trainingId + mappingVersion` | hoja, columna, encabezado esperado, fila de encabezado, politica y vigencia |
| `AUDITORIA` | `eventId` | actor, rol, entidad, accion, estados, motivo, request, evidencia y proveniencia OCR |
| `ERRORES` | `errorId` | codigo sanitizado, operacion, reintentos, fecha y resolucion |
| `MATRIZ_SIMULADA` | `idempotencyKey` | sesion, trabajador, capacitacion, version, fecha, lote, hash y marcador autenticado |

Los IDs de hojas, carpetas y recursos productivos no forman parte del modelo versionado; deben vivir en `PropertiesService` o configuracion autorizada.

`cropEvidenceRefs` es JSON de hasta cinco objetos ordenables por `digitIndex`:
`cropId`, `digitIndex`, `visualEvidenceId` y `processedEvidenceId`. Solo contiene
referencias a filas de `EVIDENCIAS`; nunca base64 ni IDs Drive. El DTO que llega
al navegador elimina los IDs internos y expone unicamente `cropId`, indice y
variantes disponibles. El endpoint servidor vuelve a resolver y validar sesion,
documento, candidato, tipo, inmutabilidad, MIME y hash antes de cada vista.

El trabajo local OCR usa una clave estable de `documentId + sha256 + version de
pipeline` y estados recuperables fuera del contrato de negocio. En Apps Script,
`OCR_RECORTES_LOTES` es el journal persistente que permite continuar una carga
parcial de Drive sin confundirla con un resultado OCR liberado.

Un replay de `OCR_RECORTES_LOTES` completado vuelve a validar la referencia del
candidato, ID determinista, sesion, documento, variante, tipo, MIME, hash,
tamano, Drive ID, inmutabilidad, estado y journal del `requestId`. No se confia
en un resumen previo si alguno de esos vinculos cambio.

`OCR_DOCUMENTOS` conserva una concesion temporal (`ocrLeaseId` y
`ocrLeaseUntil`) ligada al `ocrRequestId`; `OCR_RECORTES_LOTES` conserva el
progreso por fragmento. Los replays terminales reparan la auditoria de
finalizacion antes de registrar el replay. La resolucion humana se serializa con
el mismo `KcmScriptLock` y usa los tres campos `correction*` anteriores como
journal minimo de la decision.

`LIBERACION_LOTES` progresa por `PENDIENTE`, `MATRIZ_APLICADA`,
`DOMINIO_APLICADO` y `COMPLETADO`, o termina en `CONFLICTO`. Cada reemplazo del
journal se escribe como fila completa y vuelve a validar su HMAC. Un replay
terminal comprueba primero el efecto autenticado de matriz y despues repara
asistencias, filas `LIBERACIONES`, estado de sesion y auditorias faltantes. Esta
recuperacion solo se habilita sobre la matriz simulada: la matriz Google real
permanece en solo lectura porque no existe una precondicion CAS demostrable
frente a editores externos.

La proveniencia OCR se almacena como un bloque JSON cerrado con versiones
efectivas de Node, Tesseract, `pdfinfo`, `pdftoppm`, pipeline, `containerBuildId`
y uso real de herramientas PDF. `processingMs` es una observacion auditable,
pero no forma parte del hash idempotente porque puede cambiar en un reintento.
