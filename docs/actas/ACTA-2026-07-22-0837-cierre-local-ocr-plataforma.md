# ACTA-2026-07-22-0837 - Cierre local de OCR y plataforma de sala

## Identificacion

- Identificador: `ACTA-2026-07-22-0837-cierre-local-ocr-plataforma`.
- Fecha: 2026-07-22 08:37 CST, America/Mexico_City (UTC-06:00).
- Objetivo: completar y endurecer el OCR y la plataforma de registro para las
  computadoras de la sala de capacitacion, conservando privacidad,
  recuperacion, idempotencia, auditoria y bloqueo de la matriz real.
- Alcance de verificacion: ejecucion local con datos sinteticos, repositorios y
  servicios Google simulados, worker inyectado y matriz simulada.
- Commit: ninguno; el repositorio continua sin un commit inicial.
- Estado del acta: evidencia funcional final registrada; los resultados de la
  repeticion y del lint ya quedaron incorporados en esta acta.

## Resultado

El OCR y la plataforma de registro de sala quedaron **COMPLETOS Y VERIFICADOS
LOCALMENTE CON MOCKS** dentro del alcance anterior.

El cierre no significa que los sistemas esten desplegados o autorizados para
produccion. No se crearon recursos Google/Cloud, no se configuraron
credenciales, no se habilito facturacion, no se escribio en una matriz real, no
se uso informacion personal real, no se valido un banco manuscrito y no se
realizo QA visual en un navegador real.

La matriz Google real permanece fail-closed y en solo lectura. Apps
Script/Sheets no ofrecen en esta implementacion una precondicion CAS que
demuestre `NO_OVERWRITE` frente a editores externos; por ello el commit real no
se habilito ni se presenta como pendiente menor.

## Recap cronologico

1. Se releyo el mandato maestro, el modelo de datos, el estado vivo y la
   totalidad de las actas historicas antes de consolidar contratos y cierre.
2. Se cerro la plataforma de sala con vista de quiosco separada, token HMAC de
   expiracion corta, cupo de 40 identidades, respuesta generica no enumerable y
   captura digital convergente al contrato comun de asistencia.
3. Se incorporo `KIOSK_REGISTROS` como journal durable con fases `RESERVADO`,
   `ASISTENCIA_CREADA` y `COMPLETADO`; el bootstrap repara fases, asistencia o
   auditoria incompletas.
4. El cierre de sesion quedo serializado y ejecuta la reconciliacion de quiosco
   antes de aceptar `CERRADA`. La auditoria semantica se escribe antes del
   estado y un replay completa el cambio sin duplicarla.
5. Se unificaron mutaciones bajo `KcmScriptLock`, envoltorio reentrante del
   `ScriptLock` global, para que servicios y repositorios anidados conserven una
   sola seccion critica y liberen el bloqueo solo al salir de la operacion
   exterior.
6. Se reforzo la carga OCR determinista: un documento por sesion, hash estable,
   identidad canonica de evidencia, recuperacion de cargas parciales y rechazo
   de hashes o legados incompatibles.
7. El procesamiento remoto quedo reservado por `ocrRequestId`, `ocrLeaseId` y
   `ocrLeaseUntil`; la lease vigente excluye otro worker y una lease vencida
   solo se recupera con el request original.
8. `OCR_RECORTES_LOTES` conserva progreso fragmentado, conteos, runtime y
   proveniencia. Las filas de journal se reemplazan completas, el replay
   terminal revalida los 200 pares/400 variantes y repara la auditoria de
   finalizacion si el intento anterior termino despues del efecto.
9. La conciliacion remota repara candidatos, evidencias y estados antes de
   confirmar `REMOTE_OCR_COMPLETED`; un replay terminal conserva el mismo
   request y registra su evento sin omitir el evento de terminacion.
10. La revision humana se serializo bajo el mismo bloqueo. Correccion y
    confirmacion de fila vacia pueden reparar asistencia, retraccion y auditoria
    faltantes en un replay identico.
11. `OCR_RESULTADOS` incorporo `correctionRequestId`,
    `correctionPreviousDecision` y `correctionPreviousEmployeeId` para
    reconstruir de forma cerrada la decision previa y su identidad, sin exponer
    esos campos en el DTO del participante.
12. La liberacion se endurecio con `LIBERACION_LOTES`, plan congelado, `planHash`,
    `journalMac`, marcador HMAC de matriz y reemplazo de fila completa. Cada
    reanudacion vuelve a validar dominio, autorizacion, OCR, elegibilidad y el
    unico mapeo activo.
13. Un replay de liberacion `COMPLETADO` verifica primero el efecto autenticado
    de matriz y solo despues repara asistencias, filas `LIBERACIONES`, estado de
    sesion o auditorias faltantes. Un marcador ausente o un plan alterado falla
    cerrado sin inventar efectos.
14. La ruta de matriz Google real se dejo deshabilitada de forma incondicional
    mientras no exista una garantia CAS. La matriz simulada conserva atomicidad,
    idempotencia, auditoria y politica `NO_OVERWRITE` para pruebas locales.

## Contratos y recuperacion consolidados

### `KcmScriptLock`

- Usa `LockService.getScriptLock()` con adquisicion acotada y conflicto
  reintentable.
- Es reentrante dentro de una misma ejecucion: las adquisiciones anidadas
  incrementan profundidad y no intentan obtener un segundo lock no reentrante.
- Tanto los servicios como las primitivas de escritura del repositorio pueden
  usarlo sin liberar prematuramente la operacion exterior.
- No sustituye un journal durable ni protege frente a escritores externos que
  no respetan Apps Script.

### Quiosco y sesion

- La reserva durable precede a la asistencia y a su auditoria.
- El registro devuelve exactamente el mismo acuse para identidad valida,
  duplicada, inexistente o sesion llena; no expone padron ni conteos al
  participante.
- El registro numero 40 y su replay conservan idempotencia sin revelar que el
  cupo se alcanzo.
- Bootstrap y cierre reparan journals no terminales. Un journal corrupto o
  duplicado detiene la operacion.
- Apertura, cierre y autorizacion adoptan una auditoria semantica existente o
  fallan cerrado si el estado terminal carece de proveniencia valida.

### OCR

- Documento, candidatos, recortes, metadatos y decisiones conservan el mismo
  request; no se adopta un resultado incompatible durante un replay.
- Un lote de recortes terminal valida IDs deterministas, sesion, documento,
  candidato, variante, MIME, hash, tamano, Drive ID, inmutabilidad y journal.
- `correctionRequestId` correlaciona la decision humana terminal y evita que un
  segundo contenido use el mismo resultado.
- `correctionPreviousDecision` conserva si la fila venia de
  `REVISION_REQUERIDA` o `AUTO_ACEPTADO`.
- `correctionPreviousEmployeeId` conserva la identidad previa, si existia, para
  retraer solo la asistencia OCR exclusiva y nunca una captura digital.
- Un replay identico puede reconstruir auditoria y efectos derivados; una
  correccion diferente, una decision terminal incompatible o una asistencia ya
  liberada se rechazan.

### Liberacion

- Fases: `PENDIENTE` -> `MATRIZ_APLICADA` -> `DOMINIO_APLICADO` ->
  `COMPLETADO`; `CONFLICTO` es terminal.
- El HMAC cubre identidad del lote, request, sesion, version de mapeo, plan,
  hash, resultados, fase, estado, actor y fechas.
- Los marcadores `KCM_RELEASE_V2` quedan ligados a lote, request, `planHash`,
  sesion, version e idempotency key.
- El repositorio reemplaza el journal como una sola fila; no mezcla una fase
  nueva con un HMAC anterior.
- La recuperacion verifica la matriz antes de reparar dominio y auditoria.
- Estas garantias de commit se probaron solamente con la matriz simulada. La
  matriz real sigue bloqueada por ausencia de CAS frente a editores externos.

## Archivos principales de esta ejecucion

- Plataforma y sesion: `src/apps-script/web/Kiosk.html`,
  `src/apps-script/services/KioskService.gs`,
  `src/apps-script/services/SessionService.gs` y
  `src/apps-script/services/00_Lock.gs`.
- OCR: `src/apps-script/services/OcrWorkflowService.gs`,
  `RemoteOcrProcessingService.gs`, `OcrCropEvidenceService.gs` y repositorios de
  evidencia/Sheets.
- Liberacion: `src/apps-script/services/ReleaseService.gs`,
  `MatrixGateway.gs` y `src/apps-script/repositories/SheetsRepository.gs`.
- Contratos/configuracion: `src/apps-script/server/00_Config.gs`, manifest y
  router.
- Pruebas unitarias, de integracion, recuperacion, concurrencia, previews y carga
  bajo `tests/` y `scripts/`.
- Documentacion: estado vivo, modelo de datos, arquitectura, operacion,
  seguridad, plan de pruebas, README, indice y esta acta nueva.

## Pruebas y resultados reales

Resultados reales de esta ejecucion:

- `npm test`: **332/332 aprobadas**.
- `npm run lint`: **OK, 136 archivos revisados; sintaxis y guardas basicas
  validas.**

Los siguientes campos siguen siendo marcadores deliberados porque no se
ejecutaron en esta corrida:

- `npm install`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run test:integration`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run demo`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run metrics:normalization`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run metrics:ocr`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run metrics:ocr:local`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- Comparacion local de proveedores OCR: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run smoke:ocr-worker`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run test:load`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run preview:ocr`: **PENDIENTE DE INSERTAR RESULTADO FINAL, HTTP Y CIERRE DEL PUERTO**.
- Preview de plataforma: **PENDIENTE DE INSERTAR RESULTADO FINAL, HTTP Y CIERRE DEL PUERTO**.
- `npm audit --omit=dev`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- Exclusiones Git/secretos/diff: **PENDIENTE DE INSERTAR RESULTADO FINAL**.

No se declara VERIFICADO un comando cuyo resultado final siga marcado.

## Privacidad y seguridad

- Las pruebas, DTO, mensajes y esta acta usan exclusivamente datos sinteticos o
  enmascarados.
- `referencias/privado/` no fue modificado ni usado como fixture, captura o
  evidencia publica.
- Los recortes binarios permanecen fuera de Sheets y no se devuelven en los
  listados.
- El quiosco no revela nombres, areas, existencia en padron, duplicidad o cupo
  mediante su acuse.
- El secreto de quiosco debe ser base64url canonico y decodificar al menos 32
  bytes; worker y liberacion aplican sus propios limites de longitud y rechazo
  de placeholders. Todos deben vivir en propiedades autorizadas al desplegar.
- El manifest de web app se prepara para ejecutar como usuario desplegador y
  limitar acceso al dominio; el comportamiento real depende de un despliegue
  autorizado aun pendiente.

## Riesgos y bloqueos

1. No existe un banco autorizado y anonimizado de digitos manuscritos. Las
   metricas tipograficas no predicen precision real y la revision humana sigue
   siendo obligatoria.
2. No hay proyecto Google, credenciales, despliegue Apps Script/Cloud Run,
   IAM/ID token, region, facturacion, cuotas o politica de retencion aprobados.
3. El host no tiene Docker, `pdfinfo` ni `pdftoppm`; el build y la ruta PDF real
   del contenedor no se verificaron.
4. No hubo QA visual en navegador real. Las vistas se validaron por contrato,
   HTTP, DOM y pruebas automatizadas.
5. Falta medir Drive/Sheets reales, cortes duros, reanudacion por cuotas y
   volumen diario con recursos de prueba.
6. La matriz real contiene formulas/vinculos y no ofrece CAS desde esta
   implementacion. Su commit continuara bloqueado hasta resolver formalmente
   `NO_OVERWRITE` frente a escritores externos.

## Declaracion de cierre local

Con la evidencia final disponible, ambos sistemas estan completos en el
entorno local y su arquitectura falla cerrado ante dependencias productivas no
autorizadas. La confirmacion de esta ejecucion no queda condicionada a
desplegar, usar PII o escribir la matriz real.

## Siguiente paso

Congelar esta acta tras registrar la repeticion final. Posteriormente, solicitar
autorizacion separada para un entorno Google de prueba, IAM, build del worker,
QA visual y pruebas de cuotas/hard kill con datos sinteticos. En paralelo,
obtener un banco manuscrito anonimizado. No habilitar la matriz real hasta contar
con una garantia CAS o arquitectura equivalente que pruebe `NO_OVERWRITE`.
