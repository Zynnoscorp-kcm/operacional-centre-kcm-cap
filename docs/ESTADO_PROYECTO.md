# Estado vivo del proyecto

Actualizado: 2026-07-22 23:11 CST (America/Mexico_City).

## Quién liberó, en Entregas a la matriz · 2026-09-30

El tablero «Entregas a la matriz» de `/liberacion` tiene la columna «Liberó»
(`seguridad.actor` del creador del lote). Preliberación y liberación firman ahora
con la cuenta de consola de la cookie; antes todo se asentaba como
`USUARIO_CAPACITACION`, que es lo que mostrarán los lotes ya liberados.
Verificado con 777 pruebas de plataforma. Acta:
`docs/actas/2026-09-30-quien-libero.md`.

## Nota chica en la fecha y casillas en Liberaciones (VBA) · 2026-09-30

La nota con el código de sesión que la macro deja en cada fecha ahora se
achica a su texto (`KcmAjustarNota` en `KcmReleaseSync`): una línea corta queda
en un recuadro de unos 65 × 16 puntos en vez del de 100 × 60 que pone Excel.
En la hoja KCM_ENTRADAS la columna MARCA es una casilla: una forma con macro
(`KcmEntradasAlternar`), como los botones del panel, porque el control de
formulario no se dibujó en el Excel del usuario. La columna del identificador
queda oculta. Una equis escrita a mano sigue contando.
Verificado con el analizador de VBA y `npm test`; falta importar los módulos
`KcmEntradas` y `KcmReleaseSync` en el libro (ya copiados a
`~/Desktop/KCM-VBA-CRLF`) y probarlo en Excel.
Acta: `docs/actas/2026-09-30-nota-y-casillas-vba.md`.

## Liberar desde preliberación sin «Error 409» · 2026-09-30

El atajo «revisar y liberar» sí liberaba (KC-0002 quedó `LIBERADA_TOTAL` con
seis asistencias en la matriz), pero después redirigía a la pantalla de la
sesión, que sólo abre sesiones revisables, y se veía «Error 409 · La sesión no
está en una etapa revisable». Ahora vuelve a la bandeja con el acuse, y abrir
una sesión que ya salió de revisión también regresa a la bandeja.
Acta: `docs/actas/2026-09-30-preliberacion-409.md`.

## Logotipo en talón y acta de preliberación · 2026-09-30

El talón de sesión concluida y el acta de hallazgos leían el logotipo de
`referencias/privado`, que no se publica: en Vercel salían sin logotipo. Ahora
usan el membrete de la DC-3 (`plataforma/src/web/pdf/membrete/empresa.png`).
Prueba de regresión nueva que falla con el código anterior.
Acta: `docs/actas/2026-09-30-logotipo-preliberacion.md`.

## PIN 2026, agenda sin nómina y sesiones con hora de fin · 2026-09-30

El PIN de quiosco (`REGISTRO_QUIOSCO`), el de apertura y autorización de
sesión (`APERTURA_SESION`) y la contraseña de agenda (`KCM_ROOM_PASSWORD` en
Vercel) son `2026`; los anteriores quedaron revocados en `seguridad.secreto`.
La agenda pública y la de la consola ya no piden nómina: el nombre de quien
reserva cumple el dato de contacto que exige la base. La alta de sesiones pide
hora de inicio y hora de fin (la duración se calcula y la sala se aparta en ese
tramo); la tabla muestra el horario y la cuenta que creó la sesión. En DC-3 se
quitó de «Datos del formato» el recuadro de datos del trabajador en blanco, y
el orden «Para repartir» se llama «Confianza y sindicalizados».
Acta: `docs/actas/2026-09-30-pin-agenda-y-sesiones.md`.

## DC-3: emitir o imprimir con relación · 2026-09-29

La relación de constancias ya no lleva columna de firma de recibido. Donde se
emite o reimprime varias (barra de marcadas, «emitir la lista», expediente e
historial) hay dos botones: «Emitir» baja sólo las constancias y «Imprimir con
relación» baja la relación delante de ellas. Quien ya tiene una constancia
emitida lleva una palomita verde junto al nombre en bandeja, búsqueda,
expediente e historial. «Para repartir» es un orden de la lista (confianza y
luego sindicalizados, por nómina), no una acción. Verificado con 775 pruebas.
Acta: `docs/actas/2026-09-29-dc3-emitir-o-imprimir-con-relacion.md`.

## Sesiones y notas de la matriz · 2026-09-29

Las sesiones nuevas se llaman `KC-0001`, `KC-0002`…: un consecutivo de cuatro
cifras, sin migración, porque la base sólo exige que el código sea único. La
nota de cada fecha que la macro escribe en la matriz dice el código de su
sesión, en lugar de la clave técnica. Verificado con pruebas y con el
analizador de VBA, y publicado en Vercel el mismo día (`cf8ab76`); falta
importar los módulos en el libro y probar una liberación en Excel.
Acta: `docs/actas/2026-09-29-codigo-kc-y-nota-de-sesion.md`.

## Ocupaciones · 2026-09-29

La clasificación de `/ocupaciones` va un caso por petición, conducida por el
navegador: la corrida en una sola petición la cortaba Vercel a los 120 s. Un
solo modelo, Nemotron 3 Super, con Gemma 4 de respaldo, todo por OpenRouter
con la misma llave. Verificado con pruebas, en Chrome sin interfaz con un
agente falso y con una consulta real a Nemotron; publicado en Vercel el mismo
día (`bd93e97`). Acta:
`docs/actas/2026-09-29-ocupaciones-un-caso-por-peticion.md`.

## Resultado actual

El OCR y la plataforma de registro para las computadoras de la sala de
capacitacion estan **COMPLETOS Y VERIFICADOS LOCALMENTE** con datos sinteticos,
mocks de Google y matriz simulada. Este estado cubre implementacion,
recuperacion, idempotencia, auditoria y pruebas automatizadas; no equivale a un
despliegue productivo ni a validacion con informacion personal real.

La plataforma de sala ofrece una vista de quiosco separada, token de sesion con
HMAC y expiracion, limite de 40 identidades por sesion, respuesta generica que
no permite enumerar el padron, captura digital y reconciliacion durable antes de
cerrar la sesion. El OCR cubre carga determinista, documento unico por sesion,
normalizacion y grilla 40 x 5, worker Tesseract remoto inyectable, evidencia por
fragmentos, revision humana obligatoria, confirmacion de fila vacia y
convergencia al mismo contrato `Attendance`.

La liberacion local conserva elegibilidad estricta, plan congelado, HMAC de
journal y marcador de matriz, escritura atomica simulada, idempotencia,
auditoria y recuperacion de efectos parciales. La escritura sobre una matriz
Google Sheets real sigue **DESHABILITADA Y FAIL-CLOSED**: esta implementacion no
puede demostrar una precondicion compare-and-set (CAS) frente a editores
externos y, por tanto, no puede garantizar `NO_OVERWRITE` en produccion.

No se desplego Apps Script ni Cloud Run, no se configuraron credenciales o
recursos Google, no se habilito facturacion, no se proceso un banco manuscrito
autorizado y no hubo QA visual en un navegador real. Docker, `pdfinfo` y
`pdftoppm` reales tampoco fueron verificados en este host. Esas actividades
permanecen pendientes y no reducen el alcance del cierre local con mocks.

## Entregables

| Entregable | Estado | Evidencia o limite |
|---|---|---|
| Contratos, privacidad y referencias | VERIFICADO LOCAL | Datos sinteticos/enmascarados; `referencias/privado/` fuera de Git |
| Plantilla, normalizacion y segmentacion 40 x 5 | VERIFICADO EN BANCO SINTETICO | 40 renglones, 200 casillas y gates conservadores |
| Worker OCR y cliente Apps Script | VERIFICADO LOCAL CON MOCKS | Contrato cerrado, HMAC, lease, replay y proveniencia |
| Evidencia OCR y revision humana | VERIFICADO LOCAL CON MOCKS | 200 pares, 400 variantes, fragmentos, fila vacia y correccion auditable |
| Plataforma de registro de sala | VERIFICADO LOCAL CON MOCKS | Quiosco, token, capacidad, respuesta no enumerable y journal recuperable |
| Ciclo de vida de sesion | VERIFICADO LOCAL CON MOCKS | Apertura/cierre serializados, reconciliacion de quiosco y auditoria recuperable |
| Conciliacion, preliberacion y elegibilidad | VERIFICADO LOCAL | Identidad, asistencia, examen, autorizacion y ausencia de liberacion previa |
| Liberacion y matriz simulada | VERIFICADO LOCAL | Lote atomico, idempotente, autenticado, auditable y `NO_OVERWRITE` |
| Matriz Google real | BLOQUEADA DE FORMA SEGURA | Solo vista previa; sin CAS no se habilita commit |
| Evaluacion de infraestructura | APROBADA | Apps Script + Render (Web Service Docker) confirmado como arquitectura definitiva |
| Guia de despliegue | PRODUCIDA | 22 archivos .gs, 17 hojas, 25+ propiedades, Dockerfile, render.yaml y guia Render documentados |
| Despliegue Google/Render | PENDIENTE | Guia aprobada; falta crear servicio en Render y vincular con Apps Script |
| Precision manuscrita | PENDIENTE | No existe banco autorizado, anonimizado y representativo |
| QA visual real | PENDIENTE | El navegador integrado no estuvo disponible |

## Concurrencia y recuperacion

### Bloqueo comun

`KcmScriptLock` envuelve `LockService.getScriptLock()` y es reentrante dentro de
una misma ejecucion. Las mutaciones anidadas comparten el bloqueo y solo la
liberacion exterior lo entrega. Los servicios de quiosco, sesion, OCR, examen,
preliberacion, liberacion y las primitivas de repositorio lo usan para evitar
intercalados locales. El bloqueo no sustituye persistencia: si Apps Script
termina abruptamente, los journals descritos abajo permiten reanudar o fallar
cerrado.

### Plataforma de sala y sesiones

- `KIOSK_REGISTROS` reserva primero la identidad y avanza por `RESERVADO`,
  `ASISTENCIA_CREADA` y `COMPLETADO`.
- El bootstrap administrativo repara una asistencia o auditoria faltante sin
  depender de que la persona vuelva a registrar su numero.
- El cierre de sesion ejecuta esa misma reconciliacion antes de aceptar
  `CERRADA`; un journal incompleto o corrupto impide el cierre.
- Las transiciones de sesion escriben una auditoria semantica idempotente antes
  del estado. Un replay completa el cambio pendiente; un estado terminal sin la
  auditoria requerida falla cerrado.
- Una sesion llena devuelve el mismo acuse generico para un numero valido,
  duplicado o inexistente, incluida la repeticion del registro numero 40.

### OCR

- La carga usa identidades y nombres Drive deterministas y admite un solo
  documento por sesion.
- `ocrRequestId`, `ocrLeaseId` y `ocrLeaseUntil` reservan el worker. Una lease
  vigente excluye concurrencia; una vencida solo se recupera con el mismo
  request.
- `OCR_RECORTES_LOTES` conserva manifiesto, fragmentos completos, conteos,
  runtime y estado. Los reemplazos del journal se escriben como fila completa;
  un replay terminal revalida evidencias y repara la auditoria de finalizacion.
- La conciliacion remota repara candidatos y asistencia derivados antes de
  confirmar `REMOTE_OCR_COMPLETED`; un replay conserva el mismo request y
  proveniencia.
- La correccion humana se serializa con `KcmScriptLock` y conserva tres campos
  de recuperacion en `OCR_RESULTADOS`:
  - `correctionRequestId`: request original de la decision terminal.
  - `correctionPreviousDecision`: `REVISION_REQUERIDA` o `AUTO_ACEPTADO` antes
    de la correccion.
  - `correctionPreviousEmployeeId`: identidad previa, si existia, necesaria
    para retraer o reparar exclusivamente la asistencia OCR correspondiente.
- Un replay identico repara asistencia/retraccion/auditoria faltante. Una
  correccion diferente, una fila terminal incompatible o una asistencia ya
  liberada se rechazan.

### Liberacion

- `LIBERACION_LOTES` autentica con HMAC plan, hash, resultados, fase, estado,
  lote, request, actor y fechas.
- Las fases recuperables son `PENDIENTE`, `MATRIZ_APLICADA`,
  `DOMINIO_APLICADO` y `COMPLETADO`; `CONFLICTO` es terminal.
- Cada cambio del journal reemplaza la fila completa y vuelve a comprobar su
  HMAC. Antes de cada efecto se releen autorizacion, elegibilidad y el unico
  mapeo activo.
- Un replay terminal verifica primero el marcador autenticado y el efecto de
  matriz; solo despues repara asistencias, filas `LIBERACIONES`, estado de
  sesion y auditorias faltantes.
- La recuperacion con commit solo esta habilitada para la matriz simulada. La
  matriz real permanece en solo lectura hasta contar con CAS o una arquitectura
  equivalente que pruebe `NO_OVERWRITE` frente a escritores externos.

## Ultima verificacion

Evidencia final recibida durante esta ejecucion:

- `npm test`: **332/332 aprobadas**.
- `npm run lint`: **OK, 136 archivos revisados; sintaxis y guardas basicas validas.**

Los demas comandos base siguen registrados como pendientes porque no se
ejecutaron en esta corrida:

- `npm install`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run test:integration`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run demo`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run metrics:normalization`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run metrics:ocr`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run metrics:ocr:local`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run test:load`: **PENDIENTE DE INSERTAR RESULTADO FINAL**.
- `npm run preview:ocr`: **PENDIENTE DE INSERTAR RESULTADO FINAL Y CIERRE DEL PUERTO**.
- Preview de plataforma: **PENDIENTE DE INSERTAR RESULTADO FINAL Y CIERRE DEL PUERTO**.

No se eleva ningun resultado no ejecutado a `VERIFICADO`.

## Riesgos y bloqueos

1. La exactitud tipografica de Tesseract no estima escritura manuscrita. La
   revision humana permanece obligatoria y no se habilita autoaceptacion.
2. Faltan un banco manuscrito autorizado y anonimizado, politica de retencion y
   aprobacion para tratar una hoja completa en un worker remoto.
3. Faltan proyecto Google de prueba, credenciales, despliegue, IAM/ID token,
   cuotas, facturacion, benchmark Drive/Sheets y prueba de recuperacion ante
   corte duro real.
4. HMAC permite verificar el contrato local, pero IAM es el mecanismo pendiente
   para un Cloud Run privado.
5. No se construyo la imagen Docker ni se ejecutaron Poppler, `pdfinfo` y
   `pdftoppm` reales en este host.
6. Falta QA visual de las vistas administrativa, revision OCR y quiosco en un
   navegador real; las pruebas actuales son HTTP, DOM, contrato y seguridad.
7. La matriz real conserva formulas y vinculos externos y no admite escrituras
   de prueba. Sin una garantia CAS, el gateway continuara fail-closed.

## Siguiente paso recomendado

La evaluacion de infraestructura esta completa y aprobada. La arquitectura
definitiva es Apps Script + Google Sheets + Google Drive + Render (Free Web Service Docker).
Cloud Run, Supabase, Oracle y otras alternativas fueron descartadas. La guia de despliegue fue producida y aprobada.

El siguiente paso es ejecutar la guia de despliegue:

1. Crear los recursos Google (Spreadsheet, carpetas Drive, proyecto Apps Script).
2. Crear las 17 hojas con encabezados exactos.
3. Subir los 22 archivos .gs + 2 HTML al proyecto Apps Script.
4. Configurar las 25+ Script Properties con secretos generados.
5. Crear el Web Service en Render (Docker runtime, `./deploy/ocr-worker/Dockerfile`, `/healthz`).
6. Configurar la variable `KCM_OCR_WORKER_SECRET` en Render y conectar Apps Script mediante HMAC.
7. Desplegar como `/dev` y ejecutar pruebas con `MATRIZ_SIMULADA`.
8. En paralelo, obtener un banco manuscrito anonimizado para calibracion.

La matriz real solo debe considerarse despues de resolver CAS/`NO_OVERWRITE`.
