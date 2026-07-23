# ACTA-2026-07-21-1340 - Arquitectura y worker OCR remoto

## Identificación

- Identificador: `ACTA-2026-07-21-1340-arquitectura-worker-ocr`.
- Fecha: 2026-07-21 13:40 CST, America/Mexico_City (UTC-06:00).
- Objetivo: continuar la construcción del OCR, resolver si Tesseract requiere
  Supabase u otro servidor y dejar una frontera remota ejecutable, segura,
  reanudable y auditable sin desplegar ni generar costos.
- Solicitud: proseguir con la construcción y explicar si el sistema puede
  desplegarse totalmente con Apps Script o necesita alojar Tesseract.
- Commit: no existe; el repositorio continúa sin un commit inicial.

## Resultado

No se agregó Supabase. La aplicación, los estados, Drive, Sheets, revisión,
preliberación y liberación permanecen en Apps Script. El binario nativo de
Tesseract no puede ejecutarse en el runtime V8 de Apps Script, por lo que se
implementó una frontera HTTPS desacoplada y un worker contenedorizado. Cloud Run
privado es la opción recomendada si Tesseract es obligatorio; Cloud Vision por
REST queda como alternativa administrada sujeta a autorización y costo.

La integración está IMPLEMENTADA Y VERIFICADA LOCALMENTE con mocks/procesos
inyectados: contrato estricto, worker, HMAC, cliente Apps Script, reintentos,
proveniencia, fragmentos reanudables, revisión humana, gate de evidencia y
liberación simulada. No se creó ningún recurso Cloud, no se habilitó facturación
y no se procesó información personal real en las pruebas.

## Recap cronológico

1. Se verificaron las limitaciones oficiales del runtime V8, `UrlFetchApp` y
   cuotas de Apps Script. V8 no es Node ni ofrece un sistema operativo para
   ejecutar Tesseract nativo; sí puede invocar HTTPS.
2. Se compararon cuatro alternativas: sólo Apps Script, Apps Script con Vision,
   Apps Script con Cloud Run y Supabase Edge Functions. Se descartó Supabase por
   no aportar un runtime nativo Tesseract ni resolver una necesidad adicional de
   datos, autenticación o almacenamiento.
3. Se documentó la frontera de privacidad: el worker de documento recibe la hoja
   completa y, por sus píxeles, puede tratar números, nombres y firmas. No recibe
   padrón, examen, matriz ni otros campos estructurados.
4. Se implementó `RemoteRestDigitsProvider` para una frontera opcional de sólo
   200 recortes procesados y `runRasterOcrPipelineAsync` para integrarlo sin
   cambiar el pipeline síncrono local.
5. Se implementó el worker de documento `POST /v1/ocr/documents:recognize`, con
   HMAC temporal, límites, MIME/hash, esquema cerrado 40 x 5, normalización,
   Tesseract y 200 pares visual/procesado.
6. Para PDF, `pdfinfo` quedó como autoridad: debe confirmar exactamente una
   página no cifrada antes de invocar `pdftoppm`. El conteo ligero por firmas es
   sólo un prefiltro.
7. El worker registra las versiones efectivas de Node, Tesseract, Poppler,
   pipeline y build ID. El arranque falla cerrado si no puede inspeccionarlas.
8. Apps Script recibió autenticación inyectable, cliente remoto, allowlist HTTPS,
   límites, backoff, validación estricta y orquestación desde Drive hasta
   candidatos/evidencia. HMAC es el modo funcional; IAM permanece pendiente.
9. La evidencia de 200 pares se dividió en fragmentos deterministas de 20 pares,
   con journal de fragmentos completos, bloqueos acotados y reanudación con el
   mismo `requestId`.
10. Documento y sesión permanecen `OCR_EN_PROCESO` hasta completar la evidencia.
    Sólo entonces avanzan a `REVISION_OCR`; se eliminó la reversión inválida de
    estados y el salto directo de procesamiento a preliberación.
11. La UI real quedó disponible sólo para `CAPACITACION`/`ADMINISTRADOR` y modo
    Google. Conserva el `requestId` al reintentar y los endpoints simulados se
    bloquean del lado servidor fuera de `MOCK`.
12. Se implementó un gate durable antes de preliberación. En modo productivo
    exige original íntegro, 40 candidatos terminales, 200 pares, 400 variantes,
    hashes, asociaciones y journal completo; la ruta sólo digital no depende de
    este gate.
13. Una fila física vacía se resuelve como `CONFIRMADO_VACIO`, con actor, fecha y
    motivo. Un falso positivo OCR neutraliza la asistencia exclusiva anterior
    como excluida sin borrarla ni tocar asistencias digitales o compartidas.
14. Dos revisiones independientes detectaron fallos de reintento, coerción de
    tipos, proveniencia, PDF, estados y evidencia parcial. Todos se corrigieron y
    se agregaron regresiones automatizadas.
15. Se ejecutaron la suite completa, lint, smoke Tesseract, demo, carga de 500,
    métricas OCR y auditoría de dependencias. Se actualizaron documentación,
    estado vivo e índice de actas.

## Fuentes oficiales inspeccionadas

- [Limitaciones del runtime V8 de Apps Script](https://developers.google.com/apps-script/guides/v8-runtime#limitations).
- [`UrlFetchApp`](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).
- [Cuotas y límites de Apps Script](https://developers.google.com/apps-script/guides/services/quotas).
- [Descripción de Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run).
- [Autenticación servicio a servicio de Cloud Run](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).
- [`iam.serviceAccounts.generateIdToken`](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken).
- [OCR de Cloud Vision](https://docs.cloud.google.com/vision/docs/ocr) y
  [`images:annotate`](https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate).
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) y sus
  [límites alojados](https://supabase.com/docs/guides/functions/limits).

## Materiales inspeccionados

- Pipeline, geometría y contratos existentes bajo `src/ocr/` y `src/shared/`.
- Proyecto Apps Script local bajo `src/apps-script/`.
- Plantilla pública renderizada de 40 x 5 bajo `referencias/formato/`.
- Fixtures y bancos exclusivamente sintéticos bajo `tests/fixtures/synthetic/`
  y `artifacts/ocr-public/`.
- Código del worker bajo `deploy/ocr-worker/`.
- Documentación operativa, de seguridad, datos y pruebas.

La fotografía privada y la matriz con datos reales no se utilizaron como
entrada, fixture, salida, captura o fuente de valores durante esta ejecución.

## Archivos creados principales

- `deploy/ocr-worker/Dockerfile` y `Dockerfile.dockerignore`.
- `deploy/ocr-worker/app.js`, `contract.js`, `http-server.js`,
  `pipeline-recognizer.js`, `runtime-metadata.js` y `server.js`.
- `src/ocr/adapters/remote-rest-provider.js`.
- `src/apps-script/services/OcrWorkerAuth.gs`.
- `src/apps-script/services/OcrRemoteWorkerClient.gs`.
- `src/apps-script/services/RemoteOcrProcessingService.gs`.
- `docs/DECISION_DESPLIEGUE_OCR.md`.
- `docs/CONTRATO_OCR_REMOTO.md`.
- Pruebas de worker, cliente, proveedor REST, metadata, procesamiento remoto,
  preliberación y resolución humana.
- Esta acta.

## Archivos modificados principales

- `src/ocr/index.js`, `src/ocr/raster-pipeline.js` y revisión humana.
- Contratos compartidos y validación de candidatos.
- `src/apps-script/repositories/DriveEvidenceRepository.gs` y
  `SheetsRepository.gs`.
- Configuración, soporte, router, workflow OCR, evidencia, preliberación,
  liberación e `Index.html` de Apps Script.
- `README.md`, `docs/ARQUITECTURA.md`, `MODELO_DATOS.md`, `OCR_LOCAL.md`,
  `OPERACION.md`, `PLAN_PRUEBAS.md`, `SEGURIDAD_Y_PRIVACIDAD.md`,
  `ESTADO_PROYECTO.md` e índice de actas.

## Decisiones y supuestos

- Supabase no es necesario para alojar Tesseract ni para el stack actual. Sólo se
  reevalúa si aparece una necesidad independiente de Postgres, Auth o Storage.
- “Todo en Apps Script” es viable para la plataforma, no para el cómputo nativo
  Tesseract. Tesseract.js/WASM no se adopta por límites de runtime, navegador,
  rasterización, memoria, tiempo y recuperabilidad.
- Si la directiva quiere Tesseract y control geométrico, Cloud Run privado es la
  propuesta. Si quiere evitar operar un motor, Vision REST es alternativa, pero
  sigue siendo un servicio externo con API, tratamiento de datos y costo.
- HMAC permite probar el contrato, pero no reemplaza la autenticación IAM
  recomendada para producción.
- El worker no registra cuerpos, imágenes, números leídos, hashes ni secretos.
  Aun así, recibir la hoja completa lo convierte en procesador de datos personales.
- La versión `1.0.0` del contrato aún es preliberación; no se considera congelada
  hasta desplegar un consumidor autorizado.
- La revisión humana sigue obligatoria. Las métricas sintéticas no habilitan
  autoaceptación ni predicen la escritura manuscrita real.

## Comandos y resultados reales

- `npm test`: 216/216 aprobadas, 0 fallos, 0 omitidas; repetición final
  17.171 s después de endurecer ambas máquinas de estado.
- Focal worker/proveedor REST: 41/41 aprobadas; 4.438 s.
- `npm run lint`: 119 archivos aprobados.
- `npm run smoke:ocr-worker`: Tesseract 5.5.2, 40 filas, 200 pares y
  1.825 s sobre plantilla vacía sintética.
- `npm run demo`: dos rutas, revisión, conciliación, dos escrituras efectivas,
  una exclusión por examen y cero escrituras en el replay.
- `npm run test:load`: 500 registros, 13 sesiones, 500 escrituras y 2,026 eventos
  en 45.098 ms; medición local, no SLA.
- `npm run metrics:ocr`: 7/8 números, 39/40 dígitos, 0 falsas aceptaciones y
  25% de revisión en el banco simulado controlado.
- `npm run metrics:ocr:local`: 24/48 números, 214/240 dígitos, 80/80 filas y
  100% de revisión con Tesseract real; 37.485 s totales.
- `npm audit --omit=dev`: 0 vulnerabilidades conocidas.
- Versiones observadas: Node 26.0.0, npm 11.12.1 y Tesseract 5.5.2.
- `command -v docker`, `pdfinfo` y `pdftoppm`: no disponibles en el host.

## Métricas y evidencia

| Métrica | Resultado |
|---|---:|
| Suite automatizada | 216/216 |
| Grilla worker | 40 filas, 200 pares, 400 variantes |
| Tesseract: número completo | 24/48 (50.0%) |
| Tesseract: dígito por casilla | 214/240 (89.17%) |
| Tesseract: ocupado/blanco | 80/80 (100%) |
| Autoaceptación Tesseract | 0/48 |
| Revisión manual Tesseract | 48/48 (100%) |
| Carga de dominio | 500 registros / 13 sesiones |

Evidencias principales:

- `docs/DECISION_DESPLIEGUE_OCR.md`.
- `docs/CONTRATO_OCR_REMOTO.md`.
- `deploy/ocr-worker/`.
- `src/apps-script/services/RemoteOcrProcessingService.gs`.
- `tests/unit/ocr-worker-http.test.js`.
- `tests/unit/apps-script-remote-processing.test.js`.
- `tests/unit/apps-script-ocr-prerelease-gate.test.js`.
- `tests/unit/apps-script-ocr-human-resolution.test.js`.

## Errores investigados y correcciones

- El proveedor REST reintentaba 429/5xx, pero no red ni timeout. Se unificó el
  clasificador reintentable y se cubrió red, lectura de cuerpo y agotamiento.
- El cliente aceptaba coerciones como índices de texto o confianza `null`. Los
  dos extremos ahora exigen tipos JSON exactos y rechazan campos extra.
- El conteo regex de páginas PDF podía ser incompleto. Se degradó a prefiltro y
  `pdfinfo` quedó como única autoridad previa a `pdftoppm`.
- La respuesta no demostraba qué versiones procesaron la hoja. Se agregó
  proveniencia inspeccionada al arranque y persistencia en documento, lote y
  auditoría.
- Guardar 400 archivos en una sola sección crítica podía acercarse al límite de
  Apps Script. Se fragmentó en lotes deterministas reanudables con presupuesto.
- Un error parcial podía producir `REVISION_OCR` y después regresar a
  `OCR_EN_PROCESO`. La ingesta remota ahora difiere la transición hasta completar
  evidencia y la máquina no retrocede.
- Preliberación no comprobaba toda la evidencia OCR. Se añadió un gate que falla
  cerrado antes de cualquier escritura.
- Una fila vacía podía requerir una identidad ficticia y un falso positivo podía
  dejar asistencia elegible. Se agregó resolución vacía terminal y neutralización
  trazable sin borrado.

## Riesgos y bloqueos

- PENDIENTE: decisión y autorización de directiva para Cloud Run o Cloud Vision,
  proyecto, región, facturación, privacidad y retención.
- PENDIENTE: adaptador IAM/ID token y verificación de Cloud Run privado.
- PENDIENTE: build Docker real. El host no tiene Docker, `pdfinfo` ni `pdftoppm`;
  la ruta PDF del worker se verificó con procesos inyectados.
- PENDIENTE: benchmark real de Apps Script, Drive y Sheets, incluyendo hard kill,
  cuotas, 400 archivos por hoja y reejecución del worker al reanudar.
- PENDIENTE: QA visual en navegador real.
- PENDIENTE: banco manuscrito autorizado y anonimizado. La exactitud actual no
  habilita autoaceptación.
- PENDIENTE: piloto sólo contra matriz simulada o copia autorizada; nunca XLSB
  productivo.

## Estado de entregables

- Decisión de arquitectura OCR: DOCUMENTADA.
- Worker Tesseract y contrato HTTP: IMPLEMENTADOS Y VERIFICADOS LOCALMENTE.
- Cliente/orquestador Apps Script: IMPLEMENTADOS Y VERIFICADOS CON MOCKS.
- Reanudación, revisión humana y gate OCR: IMPLEMENTADOS Y VERIFICADOS.
- Autenticación IAM y despliegue Cloud: PENDIENTES.
- Precisión manuscrita y piloto real: PENDIENTES.
- Matriz simulada y vertical de ambas rutas: VERIFICADAS.

## Siguiente paso

Presentar la decisión a directiva. Si Tesseract permanece como requisito,
autorizar un proyecto Google de prueba y privacidad para implementar IAM,
construir el contenedor, desplegar Cloud Run privado y medir primero con datos
sintéticos. Después se prepara un banco manuscrito anonimizado y se calibra sin
relajar los gates. Si directiva prefiere no operar Tesseract, sustituir el puerto
por Cloud Vision REST tras autorizar API, costo y tratamiento de datos.
