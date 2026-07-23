# Decision de despliegue del OCR

Estado: **ACEPTADA PARA CONSTRUCCION LOCAL; DESPLIEGUE PENDIENTE DE AUTORIZACION**  
Fecha de revision: 2026-07-21  
Alcance: computo OCR, no persistencia ni liberacion a matriz

## Decision

La plataforma operativa permanece en Google Apps Script, HTML Service, Google
Sheets y Google Drive. No se agrega Supabase. El reconocimiento se conserva
detras del puerto versionado `OcrProvider` y admite dos alternativas de piloto:

1. **Tesseract/OpenCV en un contenedor Cloud Run**, recomendada cuando sea
   requisito usar Tesseract o mantener control del preprocesamiento.
2. **Google Cloud Vision por REST**, alternativa administrada si la directiva
   prefiere no operar Tesseract y autoriza API, tratamiento de datos y costo.

Apps Script crea sesiones, autoriza usuarios, recibe y conserva la evidencia,
orquesta trabajos, aplica reglas, presenta la revision y libera. El worker
normaliza la hoja completa, segmenta 40 x 5 y devuelve lecturas, confianza y
recortes. La imagen puede incluir numeros, nombres y firmas, de modo que el
worker trata datos personales aunque no reciba el padron ni campos estructurados
de puesto, area, examen o matriz.

No se desplego ningun recurso ni se habilito facturacion como parte de esta
decision.

## Por que Tesseract no vive dentro de Apps Script

Apps Script V8 no es Node.js ni un navegador estandar. No expone `process`, un
sistema operativo ni una forma de ejecutar binarios nativos. WebAssembly existe,
por lo que Tesseract.js/WASM es teoricamente empaquetable, pero el runtime es
fundamentalmente sincrono, carece de modulos ES y tiene un limite documentado de
seis minutos por ejecucion. Sumados el peso del modelo, memoria, rasterizacion,
homografia y 200 recortes, esa opcion no se considera operable ni verificable
para el piloto.

Apps Script si puede llamar servicios HTTPS con `UrlFetchApp`. Por eso puede
alojar toda la aplicacion de negocio y delegar solamente el computo OCR.

Fuentes oficiales consultadas:

- [Limitaciones del runtime V8 de Apps Script](https://developers.google.com/apps-script/guides/v8-runtime#limitations)
- [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
- [Cuotas y limites de Apps Script](https://developers.google.com/apps-script/guides/services/quotas)

## Evaluacion de alternativas

| Alternativa | Tesseract nativo | Preprocesamiento geometrico | Encaje con el sistema | Decision |
|---|---:|---:|---|---|
| Solo Apps Script | No | Riesgoso con JS/WASM | Mantiene un solo despliegue, pero no cumple el OCR robusto | No seleccionada |
| Apps Script + Cloud Vision REST | No | Requiere resolver segmentacion fuera del OCR administrado o aceptar menor control | Buena alternativa administrada con costo/API autorizados | Alternativa |
| Apps Script + Cloud Run | Si | Si, dentro del mismo contenedor | Mantiene Drive/Sheets y separa computo pesado | Recomendada |
| Apps Script + Supabase Edge Functions | No nativo; WASM | Limitado para una carga CPU intensiva | Duplica servicios que ya cubren Drive/Sheets | No seleccionada |

Cloud Run ejecuta contenedores y ofrece un endpoint HTTPS escalable, acceso
restringible e instancias que pueden escalar a cero. Es suficiente para incluir
Tesseract, bibliotecas de imagen y el pipeline existente sin introducir otra
base de datos. Ver [descripcion oficial de Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run).

Supabase Edge Functions usa un runtime Deno/TypeScript con WASM. En la plataforma
alojada documenta 256 MB de memoria y dos segundos de CPU por solicitud, y
advierte que las cargas pesadas deben moverse a workers. Es apropiado para APIs
ligeras, no es un anfitrion equivalente a un contenedor Tesseract. Ver
[Edge Functions](https://supabase.com/docs/guides/functions) y sus
[limites](https://supabase.com/docs/guides/functions/limits).

## Frontera de datos

La solicitud remota debe transportar solo:

- version del contrato y del pipeline;
- `requestId`, `documentId`, hash SHA-256 y MIME permitido;
- bytes de una unica pagina dentro del limite configurado; estos bytes pueden
  contener datos personales visibles y requieren controles de encargado de
  tratamiento;
- geometria/version de plantilla y umbrales no sensibles.

La respuesta debe contener exactamente 40 renglones por plantilla y cinco
resultados por renglon, con digito restringido a `0-9` o blanco, confianza,
banderas tecnicas sanitizadas y tiempos agregados. El padron y la decision de
aceptar/revisar permanecen en Apps Script. No se registran cuerpos, imagenes,
numeros leidos ni secretos en logs del worker.

Para el volumen objetivo, 500 participantes equivalen aproximadamente a 13
hojas llenas de 40 personas por dia. El limite local de carga es 10 MiB; su
representacion base64 sigue por debajo del limite de 50 MB por POST de
`UrlFetchApp`. Esto debe medirse con fotografias anonimizadas antes del piloto.

## Seguridad minima del piloto

- HTTPS obligatorio y endpoint configurado fuera del cliente HTML.
- Para Cloud Run se prefiere servicio privado con `roles/run.invoker` y un ID
  token de audiencia limitada. Apps Script puede obtenerlo sin llave privada al
  invocar `iam.serviceAccounts.generateIdToken` con una cuenta de servicio
  dedicada; el principal efectivo solo recibe permiso para crear ese ID token.
  Ese adaptador IAM no esta implementado ni autorizado todavia: el vertical
  local ejecutable usa HMAC contra transportes simulados.
- El modo HMAC es un mecanismo alterno para pruebas o para una puerta publica
  controlada: el secreto vive solo en Script Properties y en un gestor de
  secretos del worker, y la firma cubre version, fecha, `requestId` y cuerpo.
- Idempotencia por documento, hash y version del pipeline; un reintento no crea
  una segunda asistencia ni una segunda evidencia efectiva.
- Limites de cuerpo, MIME real, una pagina, tiempo, reintentos y respuesta.
- El deadline local limita reintentos, pero no cancela una llamada en curso
  porque `UrlFetchApp` no ofrece timeout por solicitud; el worker debe imponer
  ademas un timeout servidor menor al presupuesto de Apps Script.
- Errores con codigos sanitizados; sin respuesta cruda del proveedor en Sheets.
- No se autoriza un endpoint anonimo sin control de infraestructura y de
  aplicacion.

Referencias: [autenticacion servicio a servicio de Cloud Run](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
y [`generateIdToken`](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken).

## Autorizaciones aun requeridas

Antes de desplegar se requiere una decision de directiva entre Cloud Run con
Tesseract y Cloud Vision, ademas de autorizacion explicita para proyecto Cloud,
facturacion, region, cuenta de servicio, encargado de tratamiento, retencion,
monitoreo y prueba controlada con documentos reales. Supabase solo se reevaluaria si aparece una necesidad
independiente de Postgres, Storage o Auth que el stack Google no cubra.
