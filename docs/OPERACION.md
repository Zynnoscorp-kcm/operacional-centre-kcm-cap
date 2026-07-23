# Operacion e instalacion

## Preparacion local

```bash
npm install
npm test
npm run lint
npm run demo
npm run metrics:normalization
npm run metrics:ocr:compare
npm run test:load
npm run smoke:ocr-worker
npm run preview:ocr
npm run preview:platform
```

No se requieren credenciales para la vertical local. Las referencias privadas
deben permanecer en `referencias/privado/` y nunca agregarse a Git.

El banco del proveedor local requiere Tesseract 5 en PATH o en
`/opt/homebrew/bin/tesseract`:

```bash
npm run metrics:ocr:local
npm run evidence:ocr
npm run evidence:ocr:compare
```

`npm run smoke:ocr-worker` recorre el mismo normalizador, segmentador y productor
de 200 pares que usaria el contenedor, con Tesseract real y una plantilla
sintetica vacia. No abre red ni escribe evidencia.

El worker se prepara desde la raiz con:

```bash
docker build \
  --build-arg KCM_OCR_WORKER_BUILD_ID=example-build-001 \
  -f deploy/ocr-worker/Dockerfile \
  -t kcm-ocr-worker:local .
```

El `Dockerfile` incluye Tesseract, `pdfinfo` y `pdftoppm`; no contiene secretos.
La imagen inspecciona al arrancar las versiones efectivas de Node, Tesseract y
Poppler y falla cerrada si no puede verificarlas. La base esta fijada por digest;
los paquetes apt siguen dependiendo del snapshot resuelto al construir, por lo
que el `build ID` y las versiones efectivas deben persistirse con el resultado.
El build de
imagen permanece pendiente de verificacion en este equipo porque Docker no esta
instalado. No se publica imagen ni se ejecuta despliegue sin autorizacion.

En macOS, el PDF de una pagina se rasteriza con `sips`. En otros sistemas el
adaptador falla de forma recuperable hasta instalar/configurar un rasterizador;
no se hace fallback silencioso a una imagen negra o transparente.

`npm run preview:ocr` escucha unicamente en `127.0.0.1:4173`. Usa la hoja
sintetica densa bajo `artifacts/ocr-public/local-bank-v1/`; si falta, ejecutar
primero `npm run evidence:ocr`. La correccion realizada en este preview vive
solo en memoria y valida contra un padron sintetico interno. Para detenerlo se
usa `Ctrl+C`.

`npm run preview:platform` sirve exclusivamente la pantalla de registro de las
computadoras en `127.0.0.1:4174`. El vinculo impreso por el comando contiene un
token sintetico en el fragmento, acepta solamente los numeros ficticios `00001`
a `00040`, aplica el cupo de cuarenta y no usa Google ni credenciales. El mock
HTTP se niega a escuchar fuera de loopback y la pantalla lo rechaza fuera de
loopback cuando `google.script.run` no esta disponible.

## Recursos Google requeridos para un piloto autorizado

1. Proyecto Apps Script standalone con runtime V8.
2. Spreadsheet de datos con 16 hojas operativas y `MATRIZ_SIMULADA` para
   pruebas; nunca apuntar esta ultima a la matriz real.
3. Carpeta Drive de evidencia con acceso restringido a Capacitacion.
4. Copia Google Sheets de la matriz, nunca el XLSB original.
5. Proyecto Google Cloud estandar si se autoriza Cloud Run o Cloud Vision.
6. Para Tesseract: servicio Cloud Run privado, cuenta de servicio invocadora y
   secreto administrado; Supabase no es necesario.

Propiedades de Script previstas (valores ficticios):

```text
KCM_MODE=MOCK
KCM_DATA_SPREADSHEET_ID=example_data_sheet_id
KCM_EVIDENCE_FOLDER_ID=example_drive_folder_id
KCM_REVIEW_CROP_FOLDER_ID=example_review_crop_folder_id
KCM_MATRIX_SPREADSHEET_ID=example_matrix_copy_id
KCM_MATRIX_EMPLOYEE_COLUMN=B
KCM_MATRIX_FIRST_DATA_ROW=4
KCM_RELEASE_INTEGRITY_SECRET=replace_with_cryptographically_random_value_at_least_32_chars
KCM_KIOSK_TOKEN_SECRET=replace_with_base64url_value_from_at_least_32_random_bytes
KCM_KIOSK_WEB_APP_URL=https://script.google.com/macros/s/example_deployment_id/exec
KCM_ROLE_ADMINISTRADOR_EMAILS=admin@example.invalid
KCM_ROLE_CAPACITACION_EMAILS=training@example.invalid
KCM_ROLE_CAPACITADOR_EMAILS=trainer@example.invalid
KCM_ROLE_AUDITOR_EMAILS=auditor@example.invalid
KCM_OCR_AUTO_ACCEPT_THRESHOLD=0.995
KCM_OCR_DIGIT_THRESHOLD=0.98
KCM_OCR_REQUIRE_HUMAN_REVIEW=true
KCM_MAX_UPLOAD_BYTES=10485760
KCM_MAX_REVIEW_CROP_BYTES=262144
KCM_MAX_REVIEW_CROP_BATCH_BYTES=8388608
KCM_MAX_REVIEW_CROP_DIMENSION=2048
KCM_MIN_IMAGE_SHORT_SIDE=700
KCM_MIN_IMAGE_LONG_SIDE=1000
KCM_KIOSK_TOKEN_MINUTES=120
KCM_OCR_WORKER_ENABLED=false
KCM_OCR_WORKER_ENDPOINT=https://ocr-worker.example.invalid/v1/ocr/documents:recognize
KCM_OCR_WORKER_ALLOWED_HOSTS=ocr-worker.example.invalid
KCM_OCR_WORKER_AUTH_MODE=HMAC
KCM_OCR_WORKER_SECRET=replace_with_generated_secret_at_least_32_chars
KCM_OCR_TEMPLATE_VERSION=formato-ocr-v6-1
KCM_OCR_WORKER_MAX_REQUEST_BYTES=15728640
KCM_OCR_WORKER_MAX_RESPONSE_BYTES=4194304
KCM_OCR_WORKER_MAX_ATTEMPTS=2
KCM_OCR_WORKER_BACKOFF_MS=500
KCM_OCR_WORKER_DEADLINE_MS=60000
KCM_OCR_CROP_CHUNK_PAIRS=20
KCM_OCR_CROP_EXECUTION_BUDGET_MS=240000
```

Los umbrales OCR fallan de forma cerrada: deben ser numeros finitos entre
`0.96` y `1` para confianza total, y entre `0.94` y `1` para confianza por
digito. Un valor ausente usa `0.98`; un valor invalido detiene el procesamiento
sin autoaceptar candidatos. `KCM_OCR_REQUIRE_HUMAN_REVIEW` admite solamente
`true` o `false` y su valor predeterminado es `true`. Debe permanecer activo
hasta completar y autorizar la calibracion con el banco manuscrito
representativo; mientras esta activo, incluso una lectura de confianza alta se
envia a revision humana.

No se debe guardar un secreto real en `CONFIG`, `.clasp.json`, Git o HTML.
`KCM_KIOSK_TOKEN_SECRET` debe ser base64url de 43 a 128 caracteres y provenir de
al menos 32 bytes aleatorios; una frase humana o placeholder falla cerrado.
`KCM_RELEASE_INTEGRITY_SECRET` tambien debe generarse criptograficamente y
mantenerse estable mientras exista cualquier lote pendiente.
En Cloud Run, `KCM_OCR_WORKER_SECRET` debe inyectarse desde un gestor de secretos,
no incorporarse a la imagen. HMAC es el unico modo ejecutable implementado de
punta a punta. La autenticacion del cliente es inyectable, pero el adaptador de
ID token y la aceptacion IAM en el worker siguen PENDIENTES y requieren scopes,
API, cuenta de servicio y autorizacion antes de produccion.

## Operacion de las computadoras de registro

1. Abrir la sesion desde la consola autorizada y generar un vinculo distinto
   para cada equipo, usando una etiqueta que permita reconocerlo.
2. Abrir el vinculo con forma
   `...?view=kiosk#kioskToken=...` directamente en esa computadora. El token no
   debe copiarse a parametros de consulta, marcadores, capturas ni documentos.
3. La pantalla retira el fragmento del historial visible al iniciar y conserva
   el token unicamente en memoria. Cada participante captura cinco digitos; tras
   cada envio muestra solo el recibo generico y limpia el numero. No muestra
   nombres, areas, existencia, duplicidad ni conteo exacto.
4. El registro se cierra si vence el token, la sesion deja de estar `ABIERTA` o
   se alcanza el maximo de cuarenta asistencias. Un reintento del mismo numero no
   crea una segunda asistencia.
5. Cerrar la sesion al terminar y retirar los vinculos de cualquier portapapeles
   o mensajeria operativa. Emitir un token nuevo para otra sesion o equipo.

`KIOSK_REGISTROS` reserva el registro antes de crear la asistencia. Un bootstrap
posterior repara asistencia, auditoria y fase si una llamada se interrumpe; antes
de cerrar la sesion, recargar al menos un quiosco vigente permite ejecutar esa
reconciliacion final.

El despliegue usa `DOMAIN` / `USER_DEPLOYING`: Apps Script accede a Sheets y
Drive con la identidad del desplegador, mientras cada llamada privilegiada sigue
validando el correo y rol del usuario activo. Asi, una computadora de registro no
necesita acceso directo a la hoja de datos. Antes del piloto se debe verificar en
cada equipo una sesion del dominio que no pertenezca a ningun rol administrativo,
la disponibilidad del correo activo conforme a la politica Workspace y el flujo
de consentimiento. El preview local no valida este comportamiento de Google.

`KCM_OCR_WORKER_DEADLINE_MS` limita el presupuesto de reintentos y permite
rechazar una respuesta que recupera el control demasiado tarde. `UrlFetchApp`
no expone un timeout por solicitud, de modo que este valor no puede cancelar una
llamada HTTP ya iniciada. El piloto debe configurar tambien el timeout del
servicio remoto por debajo del margen disponible de Apps Script y verificar el
peor caso con fallos de red; no debe interpretarse esta propiedad como un corte
de socket.

Los recortes se guardan en fragmentos de 20 pares por defecto. El journal
conserva los fragmentos completos y el mismo boton reanuda con el mismo
`requestId`. Si se agota el presupuesto, los candidatos permanecen
`OCR_EN_PROCESO`; no se abre revision ni preliberacion. Como los recortes aun no
guardados no se cachean, el reintento vuelve a ejecutar el worker y debe medirse
en costo/latencia antes del piloto.

## Despliegue (pendiente de autorizacion)

1. Crear recursos de prueba y asignar minimo privilegio.
2. Configurar propiedades y scopes; revisar consentimiento.
3. Cargar `src/apps-script/` mediante clasp o editor.
4. Ejecutar inicializacion de esquema en una hoja vacia de prueba.
   Si la hoja ya existia, agregar/migrar `OCR_RESULTADOS.cropEvidenceRefs` y
   crear `EVIDENCIAS` y `OCR_RECORTES_LOTES` antes de habilitar la revision.
   Una hoja creada antes de la frontera remota tambien requiere las columnas de
   request/runtime/pipeline en `OCR_DOCUMENTOS`, progreso/runtime en
   `OCR_RECORTES_LOTES` y proveniencia OCR en `AUDITORIA`. Crear ademas
   `KIOSK_REGISTROS`, `LIBERACION_LOTES` con `journalMac`, y agregar `batchId`,
   `planHash` y `marker` a `MATRIZ_SIMULADA`.
5. Desplegar primero como `/dev` para editores y completar pruebas.
6. Configurar identidad de ejecucion y acceso de dominio de forma explicita.
7. Ejecutar piloto con matriz simulada y vista previa contra una copia. El
   gateway directo de Google Sheets no admite commit: para habilitar escritura
   real se requiere sustituirlo por una frontera con CAS/precondicion atomica
   demostrable, aprobarla y ejecutar pruebas adversariales nuevas.

La guia oficial explica que `/dev` solo es visible para editores y siempre usa
el codigo mas reciente: https://developers.google.com/apps-script/guides/web

## Recuperacion

Los trabajos OCR conservan estados recuperables y reintentos limitados con
backoff. Una liberacion fallida no se marca como efectiva. Para reintentar, se
reutiliza el mismo `requestId`; otro request se rechaza mientras exista un lote
no terminal. `journalMac` debe ser valido y el marcador de matriz debe
corresponder al mismo `batchId`. Antes de continuar se revalidan estado,
autorizacion, elegibilidad, OCR y mapeo, y antes de efectos de dominio se
comprueba el efecto de matriz. Una revocacion o deriva falla cerrada y requiere
resolucion manual; no se adopta un efecto bajo un request nuevo.

`KCM_RELEASE_INTEGRITY_SECRET` es obligatorio fuera de `MOCK`, debe tener al
menos 32 caracteres de alta entropia y permanecer estable durante toda la vida
de lotes pendientes. No se registra ni se incluye en respaldos de configuracion
no secreta. En `MOCK`, si falta, el script genera y persiste un valor aleatorio
local para conservar recuperacion entre invocaciones.

La carga de recortes acepta de 1 a 200 pares visual/procesado y ya se materializa
en fragmentos internos de 20 pares por defecto. Para el primer piloto se debe
medir memoria/RPC y ajustar el tamaño, incluso hasta fragmentos por renglón, antes
de procesar 8 MiB y 400 blobs por hoja. Si Drive falla tras crear archivos, se
reintenta con el mismo `requestId`: el journal y los nombres deterministas
reutilizan lo ya escrito. No se borran archivos durante la recuperación
automática.

## Respaldo y auditoria

- Exportacion periodica de Sheets y versionado de configuracion no secreta.
- Retencion de evidencia segun politica corporativa aprobada.
- Reconciliacion de hashes, conteos de liberacion y eventos append-only.
- Prueba de restauracion antes del piloto y checklist de reversa sin borrar datos.
