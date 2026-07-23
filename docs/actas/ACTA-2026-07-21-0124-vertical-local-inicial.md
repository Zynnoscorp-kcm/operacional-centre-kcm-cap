# ACTA-2026-07-21-0124 - Vertical local inicial

## Identificacion

- Fecha: 2026-07-21 01:24:06 CST (America/Mexico_City, UTC-06:00).
- Objetivo: cerrar la primera vertical local, probada y auditable desde captura
  digital/OCR hasta liberacion idempotente sobre matriz simulada.
- Commit: no existe; todos los cambios permanecen sin confirmar.

## Resumen de la solicitud

Se solicito iniciar la construccion real con OCR como ruta critica, analizar el
formato y matriz de referencia, unificar ambas rutas, implementar Apps Script y
HTML Service, conciliar examenes, impedir liberaciones indebidas, probar
idempotencia/concurrencia y conservar evidencia documental sin PII.

## Recap cronologico

1. Se completo la preparacion registrada en el acta de arranque.
2. Se definieron contratos v1 y maquinas de estado comunes.
3. En paralelo se construyeron OCR, nucleo/liberacion y plataforma Apps Script.
4. OCR produjo un mapa exacto/normalizado de 40 filas por cinco casillas, fixture
   PNG sintetico, validacion de archivos, proveedor simulado, revision y metricas.
5. El nucleo implemento padron/repositorios en memoria, ambas rutas, examen,
   elegibilidad, auditoria, matriz simulada, no overwrite e idempotencia.
6. Apps Script implemento roles servidor, token HMAC de quiosco, repositorios en
   lote, Drive, OCR, preliberacion, examenes, LockService, gateway y UI accesible.
7. La integracion final corrigio duplicados OCR para marcar todas sus ocurrencias,
   agrego validacion del encabezado de matriz y correlacion global por requestId.
8. Se ejecuto la aceptacion completa y se actualizo el estado vivo.

## Materiales inspeccionados

- DOCX, PDF, PNG y logo bajo `referencias/formato/`.
- XLSB original y XLSX convertido bajo `referencias/privado/matriz/`.
- Fotografia privada local unicamente para identificar riesgos generales; ningun
  valor personal se traslado a fixtures, codigo, actas o resultados.
- Documentacion oficial consultada: cuotas, web apps, LockService, HTML Service,
  Cloud Vision OCR, cuotas y precios.

## Archivos creados o modificados

- Raiz: `.gitignore`, `AGENTS.md`, `PROMPT_MAESTRO.xml`, `README.md`,
  `package.json` y `package-lock.json`.
- `src/shared/`: contratos y estados.
- `src/ocr/`: geometria, validacion, normalizacion simulada, proveedor,
  postproceso, revision, fixtures y metricas.
- `src/core/`: repositorios, auditoria, examenes, elegibilidad, gateway y release.
- `src/apps-script/`: manifest, servidor, repositorios, servicios y UI.
- `tests/`: unitarias, integracion, concurrencia, vertical y lote de 500.
- `scripts/`: analizador de matriz, lint, demo, metricas y carga.
- `docs/`: arquitectura, modelo, matriz, seguridad, pruebas, operacion, plantilla,
  estado vivo y actas.

## Decisiones y supuestos

- Contrato `1.0.0` y zona horaria `America/Mexico_City`.
- IDs de trabajador como cadenas `^\d{5}$`; ceros iniciales conservados.
- Fecha de matriz en ISO `yyyy-mm-dd`; la referencia muestra `dd/mm/yyyy`, pero
  el adaptador aplica formato estable y zona horaria al escribir una copia.
- `NO_OVERWRITE` es la unica politica habilitada.
- El mapeo real exige hoja, columna, encabezado esperado, fila de encabezado y
  version antes de escribir.
- Cloud Vision es una opcion desacoplada, no activada.

## Comandos relevantes

- `npm install --ignore-scripts`.
- `npm test` y `npm run lint`.
- `npm run demo` y `npm run metrics:ocr`.
- `node scripts/run-load-test.js`.
- `node scripts/analyze-matrix.js`.
- `git check-ignore -v ...`, `git diff --check` y revision de estado Git.

## Pruebas y resultados reales

- Suite final: 38 pruebas aprobadas, 0 fallos, duracion Node ~396 ms.
- Lint/guardas: 60 archivos revisados, resultado OK.
- Vertical: rutas `[DIGITAL, OCR, OCR]`; ceros iniciales conservados; 40 filas,
  200 recortes; una correccion auditable; 2 examenes recibidos de 3; una exclusion
  individual; liberacion parcial con 2 escrituras; reintento con 0 escrituras.
- Concurrencia: dos instancias compartiendo repositorios y matriz produjeron un
  unico efecto.
- Fecha existente: conflicto y cero sobrescrituras.
- Apps Script: 7 pruebas estaticas/sintacticas aprobadas, incluido duplicado OCR,
  roles, lock, idempotencia, mapeo, UI y ausencia de binarios en Sheets.
- Carga: 500 registros sinteticos en 13 sesiones, 500 escrituras, 500 liberaciones
  efectivas, 2,026 eventos y 26.339 ms en la corrida final.

## Metricas OCR

Banco `SYNTHETIC_ONLY`, dos hojas y 80 renglones esperados:

- Exactitud de numero completo: 87.5% (7/8).
- Exactitud por digito: 97.5% (39/40).
- Aceptacion falsa: 0% (0/6 autoaceptados).
- Revision manual: 25% (2/8 numeros).
- Filas detectadas correctamente: 98.75% (79/80).
- Tiempo total: 182.222 ms; promedio: 91.111 ms/hoja.

Estas cifras validan instrumentacion y politica de rechazo en un proveedor
simulado; no miden un motor OCR real.

## Errores y correcciones

- `git init` fue bloqueado por sandbox; se obtuvo permiso minimo y se completo.
- El render DOCX canonico fallo por `ModuleNotFoundError: pdf2image`; no se
  instalaron dependencias. Se uso el PNG existente y analisis OOXML/PDF.
- El navegador integrado no estuvo disponible (`agent.browsers.list()` vacio);
  no se afirmo QA visual del HTML.
- La primera prueba del demo fallo porque esperaba el motivo generico
  `EXAMEN_NO_CONFIRMADO`; el dominio devolvio correctamente
  `EXAMEN_NO_ENCONTRADO`. Se corrigio la expectativa y la repeticion paso.
- La revision detecto y corrigio dos brechas Apps Script: primera ocurrencia de
  duplicado OCR potencialmente autoaceptada y falta de validacion de encabezado.

## Riesgos y bloqueos

- Transformacion real de pixeles y motor OCR real: PENDIENTE.
- Pruebas en Google Workspace/Sheets/Drive: PENDIENTE de recursos y autorizacion.
- Cloud Vision: PENDIENTE de autorizacion de API, facturacion y costo.
- Matriz ejemplo: 37 referencias externas; no apta para escritura directa.
- Regeneracion local del DOCX y QA visual UI: limitadas por herramientas ausentes.

## Estado de entregables

- Fase 0: sustancialmente VERIFICADA; nuevo render reproducible pendiente.
- Fase 1: vertical OCR simulada VERIFICADA; normalizacion de pixeles pendiente.
- Fases 2-3: nucleo y Apps Script IMPLEMENTADOS; integracion Google pendiente.
- Fase 4: carga local VERIFICADA; seguridad/concurrencia Google y piloto pendientes.

## Siguiente paso

Implementar normalizacion/segmentacion real de pixeles y validar con escaneos
anonimizados del formato nuevo. Despues, crear un entorno Google de prueba y
ejecutar la misma suite contra adaptadores reales y una copia autorizada de HC.

