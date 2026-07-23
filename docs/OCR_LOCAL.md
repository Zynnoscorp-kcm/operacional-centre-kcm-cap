# OCR local: implementación y resultados

Actualizado: 2026-07-22, America/Mexico_City.

## Alcance verificado

`runRasterOcrPipeline` valida el binario, conserva el hash del original,
rasteriza una página PDF en este host macOS, detecta la hoja, corrige
orientación y perspectiva, remuestrea a 1216 x 2002 y segmenta 40 renglones por
cinco casillas. Cada una de las 200 casillas conserva una variante visual y una
procesada con hash independiente.

El postproceso exige exactamente cinco caracteres, conserva ceros iniciales,
valida contra el padrón y envía blancos, duplicados, inexistentes, geometría
dudosa o confianza baja a revisión. El nombre manuscrito nunca interviene en la
identidad.

La integracion de Apps Script agrega una politica operativa fail-closed:
`KCM_OCR_REQUIRE_HUMAN_REVIEW=true` por defecto fuerza
`REVISION_REQUERIDA`, aun cuando identidad y confianzas superen los umbrales.
Solo puede cambiarse a `false` despues de autorizar la calibracion manuscrita.
Los umbrales fuera de los rangos conservadores (0.96--1 total y 0.94--1 por
digito), no numericos o no finitos detienen el procesamiento en vez de habilitar
la autoaceptacion.

## Proveedores locales

- `TesseractDigitsProvider` es la línea base local, con whitelist 0–9, PSM 10,
  límites de tiempo y errores sanitizados.
- `GlyphTemplateDigitsProvider` compara por casilla contra un banco tipográfico
  local de 300 plantillas. No recibe la verdad esperada ni el padrón durante la
  inferencia. Expone similitud, margen y confianza por dígito.
- La versión tipográfica es deliberadamente conservadora: el código impide
  configurar una confianza mayor a 0.93, por debajo de los umbrales de negocio
  0.94 por dígito y 0.96 total. Por ello nunca autoacepta.
- El banco puede construirse una vez e inyectarse por identidad. En la última
  corrida tardó 132.33 ms; construir un proveedor con el banco reutilizado
  tardó 0.062 ms en promedio y 0.344 ms como máximo en 25 muestras.

## Comparación reproducible

El banco anonimizado contiene una hoja densa de 40 participantes y una hoja con
8 participantes y 32 renglones blancos. Usa exclusivamente números ficticios
dibujados con Helvetica Neue, rotación, perspectiva, iluminación y ruido. La
verdad esperada sólo se usa después de inferir para calcular métricas.

La exactitud por dígito se calcula contra la casilla original. Esto evita correr
posiciones cuando un proveedor deja una casilla vacía.

| Métrica agregada | Tesseract 5.5.2 | Glyph conservador |
|---|---:|---:|
| Números completos | 24/48 (50.0%) | 48/48 (100%) |
| Dígitos por casilla | 214/240 (89.17%) | 240/240 (100%) |
| Ocupado/blanco | 80/80 (100%) | 80/80 (100%) |
| Autoaceptados | 0 | 0 |
| Enviados a revisión | 48/48 (100%) | 48/48 (100%) |
| Tiempo total | 36.526 s | 8.162 s |
| Tiempo medio por hoja | 18.263 s | 4.081 s |

El escenario denso tardó 5.412 s con Glyph y el disperso 2.750 s. Los tiempos
dependen del host y no constituyen un SLA.

La tasa formal de aceptación falsa no es estimable porque ningún candidato fue
autoaceptado. Como prueba negativa adicional, una fila con `X / ? + A` fue
forzada incluso a coincidir con el padrón mediante su lectura inferida: terminó
en `REVISION_REQUERIDA`, con confianza máxima 0.547177 y 0/1 aceptaciones falsas.

El 100% de Glyph sólo describe esta tipografía sintética. No estima dígitos
manuscritos ni autoriza un piloto o autoaceptación.

## Geometría

Tres escenarios reproducibles comparan la homografía estimada contra las 200
casillas. El gate exige error medio de centro <= 4 px e IoU medio >= 0.75. Las
corridas documentadas permanecen alrededor de 0.15 px de error medio e IoU
0.98; la línea base sin normalizar quedó entre 288.7 y 318.4 px.

## Evidencia, revisión y recuperación

`ReviewEvidenceProducer` materializa dos variantes por cada una de las 200
casillas: 400 objetos de evidencia para 40 candidatos. El almacén local mantiene
los binarios fuera del DTO y entrega sólo referencias. La clave estable combina
documento, casilla, variante y hash.

`OcrJobOrchestrator` une validación, normalización, segmentación,
reconocimiento, candidatos y evidencia. Deduplica solicitudes simultáneas,
aplica backoff limitado, sanitiza errores y conserva estados
`PENDIENTE`, `OCR_EN_PROCESO`, `REVISION_OCR`, `PROCESADO`,
`ERROR_REINTENTABLE` y `ERROR_FINAL`. Un fallo después de escrituras parciales
revierte el almacén local completo y el reintento produce un único lote.

En Apps Script, una sesión admite una sola lista física. La carga usa
`sessionId + sha256` para IDs estables y un nombre Drive determinista bajo
`ScriptLock`; el replay recupera escrituras parciales de evidencia, documento o
estado. Si Drive contiene dos archivos con el nombre canónico, si sus bytes no
coinciden con MIME, hash y tamaño, o si la sesión ya tiene otro documento, el
flujo se detiene sin escoger uno implícitamente.

Antes de invocar el worker se persisten `ocrLeaseId` y `ocrLeaseUntil`. Una
segunda ejecución concurrente no lee ni vuelve a enviar la evidencia. La
concesión dura seis minutos, se limpia al terminar y, si una ejecución termina
abruptamente, sólo el mismo `ocrRequestId` puede recuperarla después de vencer;
un request diferente nunca reemplaza la proveniencia.

`OCR_PROCESSING_STARTED` queda persistido antes de leer Drive o invocar el
worker. Si una ejecucion cae despues de guardar candidatos, el mismo request
reconcilia las asistencias derivadas y repara idempotentemente
`OCR_RESULTS_INGESTED` y `OCR_ATTENDANCE_CAPTURED`. Una falla limpia la concesion
cuando es posible; si no, esta expira sin permitir que otro request adopte el
trabajo.

En Apps Script, `storeOcrCropEvidenceBatch` acepta de 1 a 200 pares sólo para
`CAPACITACION` o `ADMINISTRADOR`. Los materializa en fragmentos deterministas de
20 pares por defecto, con presupuesto preventivo y journal durable. Drive
conserva los blobs privados; Sheets guarda metadatos y `cropEvidenceRefs`. Como
Drive no es transaccional, el adaptador usa nombres deterministas y estados
`PENDIENTE/ERROR_RECUPERABLE/COMPLETADO` para reanudar sin duplicar.
Todo replay completado revalida además metadatos, referencias y pertenencia al
journal antes de reutilizar evidencia. Estas garantías se probaron con Drive y
Sheets sintéticos; la concurrencia, cuotas y consistencia observable de los
servicios Google reales permanecen como gate externo fail-closed del piloto.

El documento y la sesión permanecen `OCR_EN_PROCESO` hasta completar los 200
pares. Antes de preliberación, el gate productivo exige 40 decisiones terminales,
200 pares y 400 variantes íntegras. Una fila sin participante debe confirmarse
como `CONFIRMADO_VACIO`; un falso positivo conserva y neutraliza la asistencia
OCR anterior en vez de borrarla.

El preview loopback y la UI muestran cinco pares por renglón y no habilitan la
corrección hasta cargar las diez imágenes. La corrección conserva original,
nuevo valor, actor, fecha y motivo.

## Evidencia reproducible

- `npm run metrics:normalization`: geometría de tres escenarios.
- `npm run metrics:ocr:local`: línea base Tesseract.
- `npm run metrics:ocr:compare`: comparación Tesseract/Glyph.
- `npm run evidence:ocr`: regenera el banco visual Tesseract.
- `npm run evidence:ocr:compare`: regenera el comparador y su hash.
- `artifacts/ocr-public/local-bank-v1/metrics.json`, SHA-256
  `14a947a1d89101eccac66cfe39a7d46a4cf2933134fa617af41d2872801ac37a`.
- `artifacts/ocr-public/local-provider-comparison-v1/metrics.json`, SHA-256
  `ea9fe3a4ab2780f0e32934ad8bcb4509e07033080e1943ccf80b5a0e6a520b3e`.

## Límites antes de piloto

1. Construir un banco autorizado, anonimizado y representativo de dígitos
   manuscritos sobre el formato nuevo; mantener material real fuera de Git.
2. Medir sombras, desenfoque, compresión JPEG, hoja fuera de cuadro y trazos que
   crucen bordes. Mantener revisión obligatoria hasta calibrar una versión nueva.
3. Validar el productor Apps Script con Drive/Sheets reales y cuotas de memoria,
   RPC y ejecución. El límite local por defecto es 256 KiB por recorte, 8 MiB
   por lote y dimensión máxima 2048.
4. `sips` sólo cubre la ruta local de macOS. El worker Linux usa `pdfinfo` y
   `pdftoppm`, pero su imagen Docker real aún debe construirse y verificarse.
5. Cloud Vision sigue deshabilitado porque requiere autorización y posible
   costo. Un sondeo local de Vision.framework sobre el banco devolvió 0/50
   lecturas tanto en recortes visuales como procesados; no se integró y además
   sería específico de macOS.
6. El QA visual en navegador real y la integración Google permanecen pendientes.
