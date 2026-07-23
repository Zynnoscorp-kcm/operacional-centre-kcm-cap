# Seguridad y privacidad

## Modelo de acceso

- **CAPACITADOR:** administra unicamente sus sesiones.
- **CAPACITACION:** evidencia, OCR, cotejo, examenes y liberacion.
- **ADMINISTRADOR:** configuracion, catalogos, permisos y mapeos.
- **AUDITOR:** lectura de evidencias, eventos y liberaciones.

Cada funcion publica de Apps Script verifica rol en servidor. La UI solo mejora
la experiencia; nunca concede autorizacion. Las listas de correos o grupos se
configuran fuera del codigo.

## Participante/quiosco

El quiosco recibe un token de sesion corto, firmado y ligado a sesion/estacion,
limitado a registrar un numero de cinco digitos. Se aplican intentos limitados
por token en CacheService y `ScriptLock`. Un numero valido, repetido o
inexistente devuelve exactamente el mismo recibo generico: "Solicitud recibida;
la asistencia se confirmara durante el cotejo fisico". No devuelve nombre, area,
existencia, duplicidad ni ocupacion exacta; el bootstrap solo expone cupo maximo
y disponibilidad booleana.

`KIOSK_REGISTROS` reserva la identidad durable antes de crear la asistencia. Un
bootstrap posterior repara idempotentemente la asistencia, su unico evento y la
fase terminal si una ejecucion se interrumpe.

## Entradas y salidas

- Todos los IDs se validan en servidor y los numeros de trabajador son cadenas.
- Texto destinado a Sheets se neutraliza si comienza con `=`, `+`, `-` o `@`.
- HTML usa `textContent`; no inserta entradas del usuario con `innerHTML`.
- La revision acepta imagenes `data:` raster, rutas del mismo origen o loopback;
  rechaza hosts HTTPS arbitrarios y no habilita confirmar si alguna imagen falla.
- Tipos de archivo se validan por firma y no solo por extension.
- Errores externos se sanitizan; no se guardan tokens, binarios ni OCR real en logs.

## Evidencia y auditoria

La evidencia original se guarda en Drive con permisos minimos, hash SHA-256 y
referencia inmutable. Las correcciones OCR conservan antes, despues, actor,
fecha y motivo. `AUDITORIA` es append-only y contiene requestId, estados y
evidenceId suficientes para reconstruir efectos terminados; los journals
durables permiten reconstruir operaciones parciales.

El productor de recortes sólo admite `CAPACITACION` o `ADMINISTRADOR`, nunca el
quiosco. Valida firma real, MIME, dimensiones, hash, limite individual y limite
de lote. Los nombres Drive y los IDs de evidencia son deterministas; el journal
permite reanudar fallos sin borrar o sustituir silenciosamente evidencia previa.
Referencias existentes corruptas o duplicadas producen conflicto antes de crear
archivos.

La lista de candidatos no expone nombres, area, puesto, actor de correccion ni
IDs Drive. Las cinco referencias de casilla se resuelven en servidor desde el
candidato almacenado; el cliente no elige `evidenceId` ni `driveFileId`. Antes
de devolver una imagen se comprueban sesion, documento, tipo de evidencia,
inmutabilidad, MIME, hash y un limite independiente de 256 KiB por recorte. El
endpoint generico de vista previa por `evidenceId` ya no esta publicado.

## Secretos y propiedades

IDs productivos, secretos de token y configuracion de proveedor viven en Script
Properties. El repositorio solo documenta nombres ficticios. Nunca se transmite
`ScriptApp.getOAuthToken()` al navegador; la guia oficial de web apps advierte
sobre esa exposicion: https://developers.google.com/apps-script/guides/web

`KCM_KIOSK_TOKEN_SECRET` debe ser base64url de 43 a 128 caracteres, generado con
al menos 32 bytes aleatorios. La web app usa `DOMAIN` / `USER_DEPLOYING`: los
equipos de sala no reciben acceso directo a Sheets o Drive y las operaciones
privilegiadas siguen validando el usuario activo. Esta frontera debe comprobarse
dentro del dominio antes del piloto.

El secreto `KCM_RELEASE_INTEGRITY_SECRET` autentica tanto el journal de
liberacion como el contexto y los marcadores de matriz, con separacion de
dominios. Es obligatorio y de alta entropia en modo real. `planHash` por si solo
no concede recuperacion: es un hash publico y siempre se combina con HMAC y la
identidad durable del lote.

El worker OCR recibe la hoja completa. Aunque no recibe padron ni campos de
puesto, area, examen o matriz, los pixeles pueden contener numeros, nombres y
firmas; por tanto el worker y cualquier proveedor OCR son procesadores de datos
personales. El cliente exige HTTPS y allowlist de host; HMAC cubre el cuerpo
exacto, timestamp y requestId. El worker valida firma antes de decodificar la
pagina, no registra cuerpos/resultados, usa almacenamiento temporal efimero y
devuelve errores sanitizados. Los 200 pares se validan nuevamente en Apps Script
y se guardan en Drive mediante el productor idempotente; no pasan al HTML como
parte de la respuesta del worker. Para produccion se debe superponer IAM/ID
token al HMAC o sustituirlo por una frontera privada equivalente autorizada, y
aprobar region, encargado de tratamiento, retencion y acceso operativo.
El ID token IAM aun no esta implementado en ninguno de los dos extremos; una
prueba con encabezado `Authorization` inyectado valida solamente el puerto del
cliente, no una integracion real con Cloud Run.

## Amenazas prioritarias

| Riesgo | Control principal |
|---|---|
| Enumeracion de empleados | Respuesta generica, rate limit y token de sesion |
| Caida entre reserva, asistencia y auditoria | `KIOSK_REGISTROS` y reparacion idempotente en bootstrap |
| Doble clic/carrera | requestId, clave idempotente y ScriptLock |
| Inyeccion de formula | Neutralizacion antes de `setValues` |
| Archivo disfrazado o enorme | Magic bytes, MIME permitido y limites configurables |
| OCR falso positivo | Umbral alto, padron y revision obligatoria ante duda |
| Cambio de mapeo | Version y encabezado esperado en vista previa y commit |
| Mapeos activos multiples/cache obsoleto | Exactamente uno activo y relectura sin cache antes del commit |
| Journal o fase adulterados | HMAC de campos de control y verificacion del efecto antes del dominio |
| Adopcion por request nuevo | Marcador HMAC ligado a `batchId` y reanudacion solo con request original |
| Sobrescritura de fecha | Commit real deshabilitado sin CAS; `NO_OVERWRITE` verificado solo en mock |
| Fuga de PII | Privado ignorado, fixtures sinteticos y logs sanitizados |
| Sustitucion de recorte | Referencia candidato-casilla, MIME/hash y sin Drive ID del cliente |
| PNG truncado o metadato corrupto | Longitud/dimensiones finitas y conflicto antes de efectos |
| Exfiltracion desde UI | URLs raster same-origin/loopback y CSP del preview local |
| Invocacion OCR remota falsa | HTTPS, allowlist, HMAC temporal, hashes y futuro IAM |
| Respuesta OCR adulterada | Correlacion, esquema cerrado, 40 x 5, 200 pares y hashes |
| Fuga desde logs del worker | Sin cuerpos, IDs, hashes, lecturas ni stderr crudo |
| Tratamiento remoto de la lista completa | Aprobacion de privacidad, region, IAM, sin retencion y acceso minimo |
| Preliberacion con recortes parciales | Journal completo, cinco pares por fila y gate servidor antes del cotejo |
| Falso positivo que ya creo asistencia | Retraccion auditada y no destructiva; nunca afecta una captura digital |
| Runtime OCR no reproducible | Versiones efectivas y build ID persistidos en documento, lote y auditoria |
