# ACTA-2026-07-21-1143 - Cierre de vertical OCR local

## Identificación

- Identificador: `ACTA-2026-07-21-1143-cierre-vertical-ocr-local`.
- Fecha: 2026-07-21 11:43 CST, America/Mexico_City (UTC-06:00).
- Objetivo: completar la ruta OCR local con datos sintéticos y mocks, desde el
  raster hasta revisión, evidencia recuperable y liberación simulada.
- Solicitud: continuar bajo el objetivo de completar el OCR, sin desplegar,
  activar servicios con costo ni utilizar información personal real.
- Commit: no existe; el repositorio continúa sin un commit inicial.

## Resultado

La vertical OCR local quedó IMPLEMENTADA Y VERIFICADA para el banco sintético:
normalización, homografía, 40 filas, 200 casillas, proveedor conservador,
validación, revisión, 400 evidencias, trabajo recuperable, preliberación,
conciliación y liberación idempotente sobre matriz simulada. La precisión
manuscrita, Google real y el piloto permanecen PENDIENTES.

No se desplegó Apps Script, no se escribió en Drive/Sheets reales, no se habilitó
Cloud Vision y no se usó la fotografía privada como fixture o evidencia.

## Recap cronológico

1. Se auditó el estado anterior: Tesseract, normalización real y UI de revisión
   ya existían, pero faltaban productor persistente, journal y mejor baseline.
2. Se implementó un almacén local de evidencia con transacción, mutex,
   idempotencia, metadatos inmutables y copias defensivas.
3. `ReviewEvidenceProducer` conectó los 40 candidatos con 200 casillas y creó
   variantes visual/procesada: 400 evidencias sin exponer buffers en el DTO.
4. Se implementó `OcrJobOrchestrator` con clave documento/hash/versión,
   deduplicación concurrente, estados, auditoría, reintento con backoff, conteos
   íntegros, conflicto de contenido y errores sanitizados.
5. La integración real demostró rollback tras 17 escrituras y recuperación en
   el segundo intento con un único lote de 400 evidencias.
6. Se implementó `GlyphTemplateDigitsProvider`, aislado de verdad y padrón,
   limitado a confianza 0.93 y con banco inyectable validado de 300 plantillas.
7. Se comparó Glyph contra Tesseract sobre los mismos dos escenarios. Se detectó
   que la métrica histórica corría posiciones cuando faltaba una casilla; la
   métrica central se corrigió para comparar contra la casilla original.
8. Se probó un negativo no numérico y se impidió elevar por configuración el
   tope de confianza a 0.94 o 1.0.
9. Se sondeó Vision.framework en macOS: devolvió vacío en 50/50 recortes
   procesados y 50/50 visuales; no se integró.
10. Apps Script recibió `storeOcrCropEvidenceBatch`, Drive privado, metadatos en
    Sheets, journal, ScriptLock, IDs/nombres deterministas y reanudación.
11. La revisión principal detectó dos fallos de integridad del adaptador Google:
    PNG truncado con dimensiones `NaN` y filtrado silencioso de referencias
    corruptas. Ambos se corrigieron antes de efectos y quedaron en regresión.
12. Se regeneraron los dos reportes OCR, se verificaron sus hashes, se ejecutó
    la suite completa, demo, carga, geometría, lint y auditoría de dependencias.
13. Se actualizaron arquitectura, operación, modelo, seguridad, plan de pruebas,
    README, estado vivo e índice de actas.

## Materiales inspeccionados

- Plantilla pública: `referencias/formato/Formato_Control_Asistencia_OCR.png`.
- Geometría: `src/ocr/config/template-geometry.js` y
  `docs/PLANTILLA_OCR.md`.
- Banco exclusivamente sintético producido por
  `src/ocr/testing/distorted-fixture.js`.
- Reportes bajo `artifacts/ocr-public/`.
- Código Apps Script local y mocks; ningún recurso Google conectado.

La fotografía y matrices bajo `referencias/privado/` no fueron usadas como
entrada OCR, salida, captura ni fuente de valores en esta ejecución.

## Archivos creados

- `src/ocr/adapters/glyph-template-provider.js`.
- `src/ocr/evidence/in-memory-evidence-store.js`.
- `src/ocr/evidence/review-evidence-producer.js` y `index.js`.
- `src/ocr/jobs/in-memory-job-repository.js`.
- `src/ocr/jobs/ocr-job-orchestrator.js`.
- `src/apps-script/services/OcrCropEvidenceService.gs`.
- `scripts/compare-local-ocr-providers.js`.
- `scripts/vision-digit-ocr.swift` como experimento no integrado.
- Pruebas nuevas de proveedor, productor, trabajo, integración y Apps Script.
- `artifacts/ocr-public/local-provider-comparison-v1/metrics.json` y hash.
- Esta acta.

## Archivos modificados principales

- `src/ocr/index.js`, `src/ocr/metrics.js`.
- `src/apps-script/repositories/DriveEvidenceRepository.gs`.
- `src/apps-script/repositories/SheetsRepository.gs`.
- `src/apps-script/server/00_Config.gs`, `Router.gs`.
- `package.json`, `README.md`.
- `docs/ARQUITECTURA.md`, `MODELO_DATOS.md`, `OCR_LOCAL.md`,
  `OPERACION.md`, `PLAN_PRUEBAS.md`, `PLANTILLA_OCR.md`,
  `SEGURIDAD_Y_PRIVACIDAD.md`, `ESTADO_PROYECTO.md` e índice de actas.

## Decisiones y supuestos

- Completar OCR en esta etapa significa vertical local ejecutable y auditable
  con sintéticos/mocks; no significa aprobar precisión manuscrita o producción.
- La aceptación automática permanece deshabilitada de hecho: Glyph no puede
  superar 0.93, mientras los gates son 0.94 por dígito y 0.96 total.
- La exactitud por dígito usa la casilla original; `rawDigits` sigue sirviendo
  para exactitud del número completo y formato de cinco caracteres.
- Los binarios nunca se guardan en Sheets ni se devuelven en listados.
- El adaptador local usa rollback real; Apps Script usa journal y reutilización
  porque Drive y Sheets no ofrecen una transacción conjunta.
- Se admite un máximo de 200 pares por llamada, pero se recomienda fragmentar
  por renglones hasta medir cuotas reales.

## Comandos y resultados reales

- `npm test`: 127/127 aprobadas, 0 fallos, 0 omitidas; repetición final 10.494 s.
- `npm run lint`: 104 archivos aprobados.
- `npm run demo`: 40 filas, 200 recortes, dos liberaciones efectivas, una
  exclusión por examen faltante y cero efectos en el reintento.
- `npm run test:load`: 500 registros, 13 sesiones, 500 escrituras, 2,026 eventos,
  90.104 ms y 5,549.16 registros/s.
- `npm run metrics:normalization`: tres escenarios y 600 casillas; todos pasan.
- `npm run evidence:ocr`: reporte Tesseract regenerado.
- `node scripts/compare-local-ocr-providers.js --write-report`: comparación
  regenerada.
- `shasum -a 256 -c metrics.sha256` en ambos directorios: `OK`.
- `npm audit --omit=dev`: 0 vulnerabilidades conocidas.

## Métricas OCR

| Métrica | Tesseract 5.5.2 | Glyph conservador |
|---|---:|---:|
| Número completo | 24/48 (50.0%) | 48/48 (100%) |
| Dígito por casilla | 214/240 (89.17%) | 240/240 (100%) |
| Ocupado/blanco | 80/80 (100%) | 80/80 (100%) |
| Autoaceptados | 0 | 0 |
| Revisión manual | 48/48 (100%) | 48/48 (100%) |
| Tiempo total de comparación | 36.526 s | 8.162 s |

- Construcción del banco Glyph: 132.33 ms.
- Construcción con banco reutilizado: media 0.062 ms, máximo 0.344 ms, 25 muestras.
- Negativo no numérico: 0/1 aceptaciones falsas y `REVISION_REQUERIDA`.
- La tasa formal de aceptación falsa no es estimable con cero autoaceptados.
- Estas cifras sólo representan Helvetica Neue sintética.

## Evidencias

- `artifacts/ocr-public/local-bank-v1/metrics.json`.
- Hash: `14a947a1d89101eccac66cfe39a7d46a4cf2933134fa617af41d2872801ac37a`.
- `artifacts/ocr-public/local-provider-comparison-v1/metrics.json`.
- Hash: `ea9fe3a4ab2780f0e32934ad8bcb4509e07033080e1943ccf80b5a0e6a520b3e`.
- Pruebas de integración: `tests/integration/ocr-job-evidence-flow.test.js` y
  `tests/integration/ocr-review-evidence-vertical.test.js`.
- Pruebas Apps Script: `tests/unit/apps-script-crop-producer.test.js`.

## Errores y correcciones

- El comparador inicialmente pasaba un banco que el constructor ignoraba. Se
  añadió inyección explícita, validación de diez dígitos y prueba de identidad.
- La métrica de dígito basada en cadena reportaba 185/240; al comparar la casilla
  original, la misma salida Tesseract contiene 214/240 aciertos.
- Un PNG con sólo la firma podía superar la comprobación por comparaciones con
  `NaN`. Se exige encabezado mínimo y dimensiones enteras finitas.
- Referencias existentes malformadas se filtraban silenciosamente. Ahora causan
  `CONFLICT` antes de crear archivo o reservar lote.
- Ejecuciones parciales de subagentes encontraron `listen EPERM` en su sandbox;
  la verificación final del agente principal ejecutó el preview y 127/127 sin
  ese fallo.
- Vision.framework no reconoció las casillas del banco y quedó descartado.

## Riesgos y bloqueos

- PENDIENTE: banco manuscrito autorizado y anonimizado.
- PENDIENTE: validación real de Drive, Sheets, Workspace, cuotas y recuperación.
- PENDIENTE: QA visual en navegador real.
- PENDIENTE: rasterizador PDF multiplataforma y composición EXIF para overlays.
- PENDIENTE: autorización/costo si se decide probar Cloud Vision.
- PENDIENTE: piloto contra copia de matriz; nunca contra XLSB productivo.

## Estado de entregables

- Pipeline raster, geometría y segmentación: VERIFICADO LOCAL.
- Reconocimiento local conservador: VERIFICADO EN BANCO TIPOGRÁFICO.
- Evidencia 40 x 5, productor y orquestador recuperable: VERIFICADO LOCAL.
- Apps Script productor: IMPLEMENTADO Y VERIFICADO CON MOCKS.
- Preliberación, exámenes y matriz simulada: VERIFICADO LOCAL.
- OCR manuscrito y Google real: PENDIENTE.

## Siguiente paso

Obtener autorización para crear un banco de sólo dígitos manuscritos sobre la
plantilla nueva, anonimizarlo y ejecutar el comparador sin cambiar umbrales. En
paralelo, desplegar a recursos Google de prueba, fragmentar recortes por
renglones y validar cuotas, recuperación y QA visual antes de cualquier piloto.
