# ACTA-2026-07-21-0249 - Normalización y OCR local real

## Identificación

- Fecha: 2026-07-21 02:49:50 CST (America/Mexico_City, UTC-06:00).
- Objetivo: ejecutar el siguiente paso de la ruta crítica y sustituir la
  normalización simulada por una vertical raster real, medible y auditable.
- Commit: ninguno; el repositorio todavía no tiene commits y los cambios
  permanecen sin confirmar.

## Resumen de la solicitud

El usuario autorizó continuar con el siguiente paso recomendado: implementar
normalización y segmentación real de píxeles, mantener la convergencia de las
rutas digital y OCR, probar el resultado con datos sintéticos, conservar
evidencia visual y no utilizar datos personales ni servicios con costo.

## Recap cronológico

1. Se verificaron herramientas locales y dependencias compatibles con ejecución
   sin credenciales: Node.js, PNG/JPEG, Tesseract y el rasterizador PDF de macOS.
2. Se implementaron codecs, composición alfa sobre blanco, orientación,
   detección de hoja, homografía, rectificación a 1216 x 2002 y normalización de
   contraste.
3. Se conectó la geometría de la plantilla a la extracción de 40 filas por
   cinco casillas, conservando una vista normalizada sin umbralizar y otra
   procesada para revisión.
4. Se incorporó Tesseract 5.5.2 mediante una interfaz de proveedor restringida a
   dígitos, con límites por recorte y por hoja, reintento compacto y errores
   sanitizados.
5. Se creó un banco anonimizado de hojas sintéticas con perspectiva, rotación,
   iluminación y ruido; se midieron homografía, OCR, ocupación y tiempos.
6. Se integró la transformación real en el demo de punta a punta. El proveedor
   simulado quedó permitido únicamente mediante habilitación explícita para que
   las pruebas de negocio sigan siendo deterministas.
7. Tres auditorías independientes revisaron seguridad, precisión, artefactos y
   afirmaciones. Se corrigieron límites, validaciones, buffers, transparencia,
   geometría dudosa, recortes de borde y presentación de evidencia.
8. Se repitieron demo, métricas, banco OCR, carga, pruebas completas, hashes y
   revisión visual antes de actualizar el estado vivo.

## Materiales y herramientas inspeccionados

- Plantilla pública:
  `referencias/formato/Formato_Control_Asistencia_OCR.docx`, PDF y PNG.
- Raster PDF generado y revisado:
  `artifacts/ocr-public/pdf/template-rasterized.png`.
- Geometría documentada en `docs/PLANTILLA_OCR.md`.
- Tesseract 5.5.2, `sips-316`, Node.js 26.0.0 y npm 11.12.1.
- La fotografía privada y la matriz con datos no se usaron como entrada OCR,
  fixture ni evidencia pública en esta ejecución.
- `referencias/privado/` continúa excluido por `.gitignore`; la exclusión fue
  verificada para la matriz y la fotografía.

## Archivos creados o modificados

- Dependencias y comandos: `package.json`, `package-lock.json`, `AGENTS.md` y
  `README.md`.
- Imagen y geometría: `src/ocr/image/`,
  `src/ocr/preprocessing/pixel-normalizer.js` y
  `src/ocr/preprocessing/pdf-rasterizer.js`.
- Pipeline/proveedor: `src/ocr/raster-pipeline.js`,
  `src/ocr/adapters/tesseract-provider.js`,
  `src/ocr/adapters/simulated-provider.js` y `src/ocr/index.js`.
- Segmentación/revisión: `src/ocr/recognition/crop-extractor.js` y
  `src/ocr/review/contact-sheet.js`.
- Fixtures/métricas: `src/ocr/testing/distorted-fixture.js`,
  `src/ocr/metrics/normalization-metrics.js`, `src/ocr/metrics.js` y scripts de
  medición/evidencia.
- Pruebas: nuevas suites unitarias, de integración, seguridad, PDF, Tesseract,
  contacto, normalización y vertical raster bajo `tests/`.
- Documentación: arquitectura, operación, plantilla, plan de pruebas,
  `docs/OCR_LOCAL.md`, `docs/ESTADO_PROYECTO.md` y esta acta.
- Evidencia sintética: `artifacts/ocr-public/local-bank-v1/`.

## Decisiones y supuestos

- La plantilla OCR permanece fija en 1216 x 2002; el cliente no puede sustituir
  esas dimensiones mediante opciones del pipeline.
- Una geometría con fallback, advertencias o confianza menor a 0.8 obliga a
  revisión aun cuando el motor reporte alta confianza.
- El proveedor debe pasarse explícitamente. El simulado exige
  `allowSimulatedProvider: true` y se limita a pruebas locales.
- Los límites de resolución, píxeles, escala, padding, hoja de contacto y tiempo
  se validan antes de asignar trabajo costoso.
- Las imágenes PNG transparentes se componen sobre blanco para impedir que RGB
  invisible influya en detección u OCR.
- Los binarios normalizados y de recortes no forman parte del DTO por defecto;
  cuando se solicitan para evidencia se entregan mediante copias defensivas.
- Ninguna lectura Tesseract actual es apta para autoaceptación. Se conserva la
  política de priorizar falsos rechazos sobre aceptaciones incorrectas.
- La métrica de filas significa clasificación ocupado/blanco; no demuestra una
  detección geométrica independiente de renglones.

## Comandos relevantes

- `npm install` con versiones fijadas de `pngjs`, `jpeg-js` y
  `@napi-rs/canvas`; auditoría npm sin vulnerabilidades conocidas.
- `npm test` y `npm run lint`.
- `npm run demo`.
- `npm run metrics:normalization` y `npm run metrics:ocr`.
- `npm run metrics:ocr:local` y `npm run evidence:ocr`.
- `npm run test:load`.
- `shasum -a 256 -c metrics.sha256`.
- `git check-ignore -v referencias/privado ...` y revisión de estado Git.

## Pruebas y resultados reales

- Suite completa: 66 pruebas aprobadas, 0 fallos y 0 omitidas.
- Lint/guardas: 82 archivos revisados, resultado OK.
- Demo: tres asistentes sintéticos; dos incluidos, uno excluido por
  `EXAMEN_NO_ENCONTRADO`; dos escrituras efectivas y cero en el reintento.
- Homografía: tres escenarios, 600 casillas comparadas, error medio entre 0.150
  y 0.156 px e IoU entre 0.9780 y 0.9792. Los tres superaron el gate; la línea
  base sin normalizar quedó entre 288.7 y 318.4 px.
- PDF: raster 1216 x 2002 compuesto sobre blanco y verificado visualmente.
- Carga final: 500 registros sintéticos, 13 sesiones, 500 liberaciones, 2,026
  eventos, 51.343 ms y 9,738 registros/s. El tiempo es local, variable y no
  representa latencia Google ni SLA.
- Regresiones de seguridad: umbrales vacíos/NaN, filas repetidas o fuera de
  rango, transparencia, fallback geométrico, buffers mutables, tamaños excesivos,
  polvo y trazos cercanos al borde.

## Métricas OCR local

Banco Tesseract con 48 números ficticios y 240 dígitos esperados:

- Exactitud de número completo: 50.0% (24/48).
- Exactitud por dígito: 77.08% (185/240).
- Clasificación ocupado/blanco: 100% (80/80).
- Autoaceptaciones: 0.
- Tasa de aceptación falsa: NO ESTIMABLE, porque el denominador de
  autoaceptaciones es cero.
- Revisión manual: 100% (48/48).
- Corrida final: 37.056 s totales y 18.528 s/hoja promedio; no es un SLA.

Estas cifras corresponden a tipografía sintética, no a escritura manuscrita.
Demuestran instrumentación, conservación de ceros iniciales y una barrera de
revisión conservadora; no demuestran preparación para piloto.

## Evidencias y hashes

- Reporte: `artifacts/ocr-public/local-bank-v1/metrics.json`.
- SHA-256 del reporte:
  `8ced963892b7be770a0fa854b0921c5b8f121bb60b4002bcedcf361fad611625`.
- La comprobación `shasum -a 256 -c metrics.sha256` devolvió `metrics.json: OK`.
- Hoja densa: 200 pares de recortes en
  `dense-moderate/review-crops.png`; el reporte registra hashes de fuente,
  normalizado, contacto y manifiesto.
- Hoja dispersa: 60 pares de recortes, incluidas casillas vacías, en
  `sparse-strong/review-crops.png`.
- Las imágenes fuente, normalizadas y hojas de contacto se inspeccionaron
  visualmente. Los PNG no contienen EXIF ni metadatos textuales con PII.

## Errores investigados y correcciones

- El primer render PDF apareció negro por transparencia en la herramienta de
  visualización. Se compuso el alfa sobre blanco y se agregó una regresión.
- La primera variante tipográfica del fixture produjo precisión insuficiente;
  se ajustó sólo el fixture para ejercer mejor el motor y se conservaron las
  métricas finales desfavorables sin relajar umbrales.
- Se intentó inicialmente un alias de carga inexistente. Se agregó el comando
  reproducible `test:load` y se repitió con éxito.
- Las auditorías detectaron aceptación permisiva con umbrales inválidos,
  proveedor simulado implícito, contenido oculto bajo alfa, falta de límites,
  buffers expuestos y pérdida de trazos de borde. Cada frontera quedó corregida
  y cubierta por pruebas.

## Riesgos y bloqueos

1. Tesseract sólo logró 50% de números completos y envió 100% a revisión. No
   está listo para autoaceptación ni piloto y el proceso por casilla es costoso.
2. Falta un banco autorizado, anonimizado y representativo de dígitos escritos a
   mano en el formato nuevo.
3. El adaptador PDF probado depende de `sips` en macOS; falta un adaptador de
   servidor y un conteo estructural de páginas para PDFs con object streams.
4. La homografía expuesta opera sobre el raster orientado; falta componer EXIF y
   rotación para overlays exactos sobre la fotografía original.
5. La idempotencia persistente de documentos y transiciones pertenece al
   orquestador de Google; el pipeline raster puro sólo calcula hashes.
6. Apps Script, Sheets y Drive no se probaron contra recursos Google reales.
7. Cloud Vision continúa deshabilitado por requerir autorización y posible costo.

## Estado de entregables

- Normalización y segmentación real de píxeles: VERIFICADO en banco sintético.
- Proveedor OCR local: IMPLEMENTADO y VERIFICADO técnicamente; EN CALIBRACIÓN.
- Revisión visual de cinco dígitos por fila: VERIFICADO como artefacto local.
- Vertical común hasta matriz simulada: VERIFICADO.
- Endurecimiento de fronteras OCR: VERIFICADO por regresiones.
- Banco manuscrito, integración Google y piloto: PENDIENTES.

## Siguiente paso

Construir, con autorización, un banco de sólo dígitos representativo del trazo
real; calibrar o ensamblar proveedores sin bajar la barrera de seguridad y
conectar los recortes reales a la pantalla HTML de revisión. En paralelo, cuando
se autorice, crear recursos Google exclusivamente de prueba y ejecutar la
vertical contra una copia controlada de la matriz.
