# ACTA-2026-07-21-1058 - Revision OCR con recortes reales

## Identificacion

- Fecha: 2026-07-21 10:58:41 CST (America/Mexico_City, UTC-06:00).
- Objetivo: continuar la ruta critica conectando las cinco casillas OCR reales
  con la pantalla de revision, mantener correcciones auditables y cerrar los
  contratos locales y Apps Script sin credenciales.
- Commit: ninguno; el repositorio continua sin commits.

## Resumen de la solicitud

El usuario solicito continuar. Se tomo el siguiente paso recomendado que no
requiere muestras manuscritas, despliegue ni costo: implementar el bundle de
revision, resolver evidencia por candidato/casilla, construir el preview HTTP
local y conectar la UI HTML con cinco pares visual/procesado.

## Recap cronologico

1. Se inspeccionaron `OcrCandidate`, extraccion 40 x 5, servicios Apps Script,
   esquema Sheets y la pantalla de revision existente.
2. Se definio un DTO sanitizado sin padron, nombres ni buffers y un resolvedor
   con referencias opacas, hashes y enlace candidato-fila-casilla.
3. Se implemento un servidor local limitado a loopback que carga la hoja
   sintetica normalizada, extrae 200 recortes y expone tres operaciones de
   revision con el mismo envelope que Apps Script.
4. La UI ficticia de un solo renglon se sustituyo por una lista accesible de
   hasta 40 candidatos, detalle, cinco pares de imagenes, confianza, banderas,
   correccion y navegacion entre pendientes.
5. Se endurecio la UI para bloquear hosts arbitrarios y exigir diez eventos
   `load` exitosos antes de confirmar; eventos tardios de otro candidato se
   descartan.
6. Apps Script incorporo `cropEvidenceRefs`, DTO minimo, resolucion agregada de
   hasta diez blobs, validacion de sesion/tipo/MIME/hash y auditoria unica.
7. Se retiro del router el endpoint generico que aceptaba `evidenceId`; el
   navegador ya no puede elegir un ID Drive.
8. Se agregaron pruebas de contrato, HTTP, seguridad, Apps Script y UI; se
   repitieron la suite completa, lint, demo y auditoria npm.
9. Se intento abrir el preview con el navegador integrado. El runtime devolvio
   una lista vacia de navegadores, por lo que el QA visual se registro como
   pendiente en vez de declararlo ejecutado.

## Materiales inspeccionados

- `artifacts/ocr-public/local-bank-v1/dense-moderate/normalized.png`.
- `artifacts/ocr-public/local-bank-v1/dense-moderate/review-manifest.json`.
- Segmentacion y extractor bajo `src/ocr/`.
- Contratos en `src/shared/contracts.js` y `docs/MODELO_DATOS.md`.
- Apps Script: configuracion, Drive, router, `OcrWorkflowService` e
  `Index.html`.
- No se uso la fotografia privada, la matriz real, credenciales ni datos
  personales.

## Archivos creados o modificados

- Contrato OCR: `src/ocr/review/review-bundle.js` y export en
  `src/ocr/index.js`.
- Preview local: `src/ocr/review/local-preview-server.js`,
  `scripts/serve-local-preview.js` y comando `npm run preview:ocr`.
- Apps Script: `server/00_Config.gs`, `server/Router.gs`,
  `repositories/DriveEvidenceRepository.gs` y
  `services/OcrWorkflowService.gs`.
- UI: `src/apps-script/web/Index.html`.
- Pruebas: bundle, preview HTTP, Apps Script review y UI review bajo `tests/`.
- Documentacion: `README.md`, `AGENTS.md`, arquitectura, modelo, operacion,
  seguridad, plan de pruebas, OCR local, estado vivo, indice y esta acta.

## Decisiones y supuestos

- El listado de candidatos nunca contiene buffers, nombres, puesto, area,
  `evidenceId`, `driveFileId` ni actor de correccion.
- Cada fila de revision tiene cinco `slots` con `cropId` estable y dos
  referencias opacas: visual sin umbralizar y procesada.
- El resolvedor local exige exactamente la cuadricula completa de 200 recortes
  y devuelve copias defensivas solo al solicitar evidencia.
- Apps Script persiste en `cropEvidenceRefs` hasta cinco objetos con IDs internos
  de metadatos, nunca base64 ni IDs Drive en el DTO cliente.
- La resolucion agregada valida todas las referencias antes de leer como maximo
  diez blobs y registra un evento `OCR_REVIEW_CROPS_VIEWED`.
- Cada blob de recorte tiene un limite por defecto de 262,144 bytes, separado
  del limite del archivo fuente.
- En local, la correccion se valida contra un padron sintetico no expuesto y se
  vuelve idempotente por `requestId`; no representa persistencia Google.
- La confirmacion HTML permanece bloqueada hasta cargar las diez imagenes sin
  error. Una URL recibida no basta por si sola.

## Comandos relevantes

- `npm run preview:ocr -- --port 4173`.
- Pruebas focales con `node --test` para bundle, preview, Apps Script y UI.
- `npm test`, `npm run lint` y `npm run demo`.
- `npm audit --omit=dev`.
- Verificacion del servidor HTTP, CSP, origen y tipo de contenido mediante la
  prueba de integracion local.
- Conexion al navegador integrado y consulta de backends disponibles.

## Pruebas y resultados reales

- Suite completa: 93 pruebas aprobadas, 0 fallos y 0 omitidas; duracion Node
  aproximada de 11.48 s en la corrida final.
- Lint/guardas: 90 archivos revisados, resultado OK.
- Auditoria npm: 0 vulnerabilidades conocidas.
- Demo comun: tres asistentes sinteticos; dos incluidos, uno excluido por
  `EXAMEN_NO_ENCONTRADO`; dos escrituras y cero en el reintento.
- Bundle: 40 filas maximo, cinco slots, cardinalidad 200, hashes, copias
  defensivas, IDs seguros y rechazo de asociaciones cruzadas.
- Preview local: 40 candidatos, 200 evidencias, cinco pares por renglon, lista y
  evidencia por HTTP, correccion, reintento idempotente y un evento auditable.
- Fronteras HTTP: loopback, CSP, `application/json`, origen local, limite de
  cuerpo y rutas fuera del conjunto servido.
- Apps Script: DTO ordenado/sanitizado, referencia de cinco casillas, rechazo de
  sesion cruzada y cliente controlando IDs, maximo diez blobs y un solo evento.
- UI: lista accesible, motivo obligatorio, cinco digitos, `textContent`, URLs
  seguras, diez `load`, errores de imagen y carreras de seleccion.

## Evidencia verificable

- Contrato: `src/ocr/review/review-bundle.js`.
- Integracion HTTP: `tests/integration/local-review-preview.test.js`.
- UI: `src/apps-script/web/Index.html` y
  `tests/unit/apps-script-review-ui.test.js`.
- Seguridad Apps Script: `tests/unit/apps-script-ocr-review.test.js`.
- Artefactos visuales fuente: `artifacts/ocr-public/local-bank-v1/`.
- No se genero captura de la UI porque no existia un navegador disponible.

## Errores y correcciones

- La primera prueba del preview fallo por una expresion regular de expectativa
  que no incluia la palabra `pertenecen`; el producto habia rechazado
  correctamente la evidencia cruzada. Se corrigio la prueba y la repeticion
  aprobo.
- La primera seleccion del navegador devolvio `No browser is available` y la
  lista de backends fue `[]`. Se siguio la comprobacion recomendada y no se uso
  una herramienta distinta para simular QA visual.
- La auditoria de seguridad detecto que una URL HTTPS arbitraria y la mera
  recepcion de URLs podian habilitar la confirmacion. Se restringieron origenes
  y se exigieron diez eventos de carga reales.
- Se agrego un limite independiente por recorte para impedir que una lectura
  agregada de diez blobs consuma el limite completo de carga por cada archivo.

## Riesgos y bloqueos

1. Tesseract conserva 50% de exactitud de numero completo en el banco actual;
   no esta listo para piloto ni autoaceptacion.
2. Falta un banco autorizado de digitos manuscritos representativos.
3. Falta el productor Apps Script/proveedor que cree en Drive las variantes
   visual y procesada y registre `cropEvidenceRefs` de forma idempotente.
4. La UI no tuvo inspeccion visual en navegador; solo DOM, sintaxis, contratos,
   seguridad y comportamiento de carga estan verificados.
5. Una hoja creada con el esquema anterior requiere migrar el encabezado
   `cropEvidenceRefs`.
6. Apps Script/Drive/Sheets no se ejecutaron contra recursos Google reales.
7. Cloud Vision sigue deshabilitado por autorizacion y costo pendientes.

## Estado de entregables

- Contrato y resolvedor de revision 40 x 5: VERIFICADO LOCAL.
- Preview HTTP con recortes raster reales: VERIFICADO LOCAL.
- Pantalla HTML y guardas de carga: IMPLEMENTADO y VERIFICADO por pruebas;
  QA visual PENDIENTE.
- Apps Script de consulta/resolucion de evidencia: IMPLEMENTADO y VERIFICADO
  con mocks.
- Creacion persistente de blobs de recorte en Drive: PENDIENTE.
- Banco manuscrito e integracion Google: PENDIENTES.

## Siguiente paso

Implementar un productor idempotente de evidencia de casillas que almacene las
variantes visual/procesada, registre sus hashes y llene `cropEvidenceRefs` en
lote. Probarlo primero con repositorios/Drive simulados; al contar con recursos
autorizados, ejecutar contra una carpeta y Sheet de prueba. Completar en paralelo
el QA visual en navegador y preparar el banco manuscrito autorizado.
