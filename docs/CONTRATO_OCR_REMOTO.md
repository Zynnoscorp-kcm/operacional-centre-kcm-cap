# Contratos OCR remotos

Estado: **IMPLEMENTADO Y PROBADO CON TRANSPORTES SIMULADOS; NO DESPLEGADO**  
Version: `1.0.0`

## 1. Apps Script a worker de documento

`POST /v1/ocr/documents:recognize`

Esta frontera mueve el computo pesado fuera de Apps Script. La solicitud
contiene una sola pagina ya validada al cargarla, pero el worker vuelve a
validar bytes, MIME, hash, resolucion y numero de paginas.

```json
{
  "contractVersion": "1.0.0",
  "requestId": "request-example",
  "document": {
    "documentId": "document-example",
    "sha256": "<64 hex>",
    "mimeType": "image/png",
    "contentBase64": "<bytes>"
  },
  "template": {
    "version": "formato-ocr-v6-1",
    "expectedRows": 40,
    "digitsPerRow": 5
  },
  "recognition": {
    "mode": "DIGIT_BOXES_ONLY",
    "alphabet": "0123456789"
  }
}
```

El modo implementado firma exactamente `body + "\n" + timestamp + "\n" +
requestId` con HMAC-SHA-256. Los encabezados son:

- `X-KCM-Contract-Version`
- `X-KCM-Request-Id`
- `X-KCM-Timestamp`
- `X-KCM-Signature`

La respuesta exitosa conserva correlacion con solicitud y fuente, contiene
exactamente 40 filas, cinco casillas por fila y 200 pares de evidencia:

```json
{
  "contractVersion": "1.0.0",
  "requestId": "request-example",
  "documentId": "document-example",
  "sourceSha256": "<64 hex>",
  "status": "COMPLETED",
  "workerVersion": "document-worker-1.0.0",
  "runtime": {
    "nodeVersion": "22.17.0",
    "ocrEngineName": "tesseract",
    "ocrEngineVersion": "5.3.0",
    "pdfInfoVersion": "22.12.0",
    "pdfToPpmVersion": "22.12.0",
    "imagePipelineVersion": "raster-homography-1.0.0",
    "containerBuildId": "example-build-001",
    "pdfToolsUsed": false
  },
  "processingMs": 1000,
  "rows": [
    {
      "rowIndex": 1,
      "slots": [
        { "cropId": "r01-d1", "digitIndex": 0, "digit": "0", "confidence": 0.99 }
      ],
      "flags": []
    }
  ],
  "cropPairs": [
    {
      "cropId": "r01-d1",
      "rowIndex": 1,
      "digitIndex": 0,
      "visual": { "mimeType": "image/png", "sha256": "<64 hex>", "contentBase64": "<bytes>" },
      "processed": { "mimeType": "image/png", "sha256": "<64 hex>", "contentBase64": "<bytes>" }
    }
  ]
}
```

Los arreglos abreviados del ejemplo no representan cardinalidad valida. Los
valores de version mostrados tambien son ilustrativos; en una ejecucion se
registran los detectados, no se sustituyen por estos ejemplos. El cliente real
rechaza filas, casillas, posiciones, hashes, MIME, base64 o campos
extra que no coincidan exactamente con el contrato. Tampoco coerciona indices,
confianzas, tiempos ni versiones recibidos como texto, `null` u otro tipo. Una
casilla vacia exige confianza cero. Los recortes se convierten
en un lote interno para `KcmOcrCropEvidenceService`; los binarios no se devuelven
al navegador ni se guardan en Sheets.

`runtime` registra las versiones efectivas inspeccionadas al arrancar el
contenedor. Para PDF, `pdfinfo` debe confirmar estructuralmente una pagina no
cifrada antes de invocar `pdftoppm`; el conteo ligero por firma/regex de la capa
compartida es solo un prefiltro y no autoriza por si mismo el documento remoto.
La version `1.0.0` permanece en preliberacion y aun no se ha publicado ni
congelado para un consumidor desplegado.

La operacion Apps Script `processRemoteOcrDocument` llama a
`KcmRemoteOcrProcessingService`. Esta lee y vuelve a hashear el original de
Drive, invoca el worker, ingiere candidatos, conserva banderas geometricas y
almacena recortes. Si el almacenamiento de evidencia falla despues de insertar
candidatos, el mismo `requestId` reanuda el lote sin reinsertarlos; un replay ya
completo no vuelve a leer Drive ni invoca el worker.

Limites predeterminados:

- solicitud JSON: 15 MiB;
- documento decodificado: 10 MiB;
- respuesta JSON: 4 MiB;
- evidencia binaria agregada: 8 MiB;
- un recorte: 256 KiB en worker y Apps Script;
- desfase HMAC: cinco minutos;
- dos intentos de Apps Script, solo ante red, 408, 425, 429 o 5xx.

El deadline de Apps Script acota el presupuesto de reintentos, pero no cancela
una llamada `UrlFetchApp` ya iniciada. El servicio remoto debe aplicar su propio
timeout por debajo del presupuesto disponible.

Sobre el fixture sintetico denso, los 200 pares midieron 926,830 bytes binarios
y aproximadamente 1.24 MB antes del resto del JSON.

## 2. Pipeline Node a reconocedor de digitos

`RemoteRestDigitsProvider` define una frontera menor y opcional. Recibe la imagen
ya normalizada y segmentada dentro del pipeline, pero envia al reconocedor solo
200 PNG procesados. No envia pagina, sesion, documento, padron, nombres ni hints;
sin embargo, los cinco digitos forman un identificador personal y los recortes
se clasifican y protegen como datos personales.

- solicitud: `kcm.ocr-digits.request` version `1.0.0`;
- respuesta: `kcm.ocr-digits.response` version `1.0.0`;
- idempotencia: hash canonico de version geometrica, posiciones y hashes de los
  200 recortes;
- respuesta: 40 filas por cinco valores `0-9` o blanco, con confianza `0..1`;
- ejecucion: `runRasterOcrPipelineAsync`; la funcion sincrona local permanece
  sin cambios de contrato.

Esta frontera permite un reconocedor administrado o separado sin delegar las
reglas de identidad, umbrales, padron o revision.

## Privacidad y autorizacion

El worker de documento recibe la hoja completa y puede ver en sus pixeles
numeros, nombres, firmas y otros campos. No recibe el padron como tabla ni el
estado de asistencia, examenes o matriz, pero sigue siendo un procesador de datos
personales. No registra encabezados, cuerpos, IDs, hashes, OCR ni recortes. Su
disco temporal se usa solo para rasterizar PDF y se elimina al terminar.

HMAC esta implementado para pruebas y una integracion controlada. La interfaz de
autenticacion del cliente es inyectable para añadir un ID token de Cloud Run sin
cambiar el transporte. Antes de produccion se debe autorizar y configurar IAM,
cuenta de servicio, secreto administrado, region, timeout, concurrencia uno y
maximo de instancias, junto con aprobacion de privacidad, residencia, retencion
y encargado de tratamiento. No se ha habilitado API, facturacion ni endpoint
alguno.
