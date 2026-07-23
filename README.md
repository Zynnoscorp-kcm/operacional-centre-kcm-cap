# KCM Capacitacion OCR

Sistema versionable para registrar capacitaciones desde el quiosco de las
computadoras de la sala o desde una lista fisica procesada por OCR. Ambas rutas
convergen en cotejo, conciliacion de examenes y preliberacion. Los dos sistemas
se ejecutan localmente con datos sinteticos y mocks, sin credenciales ni
escrituras sobre recursos reales. La liberacion esta verificada contra
`MATRIZ_SIMULADA`; el commit a la matriz real falla cerrado hasta contar con un
gateway con precondicion atomica/CAS.

## Reglas esenciales

- El numero de trabajador siempre es texto de cinco digitos.
- Firma/asistencia sin examen fisico no habilita la matriz.
- OCR dudoso, duplicado, inexistente o ilegible requiere revision humana.
- Una fecha existente no se sobrescribe por defecto.
- `referencias/privado/` contiene material local de solo lectura y esta ignorado por Git.

## Ejecucion local

Requiere Node.js 22 o superior. `pngjs` y `jpeg-js` implementan la ruta raster;
`@napi-rs/canvas` genera exclusivamente fixtures tipograficos anonimizados. Las
versiones estan fijadas en `package-lock.json`.

```bash
npm install
npm test
npm run test:integration
npm run lint
npm run demo
npm run metrics:ocr
npm run metrics:normalization
npm run metrics:ocr:compare
npm run test:load
npm run smoke:ocr-worker
npm run preview:ocr
npm run preview:platform
```

`npm run demo` recorre captura digital y OCR sintetico con transformacion real de
pixeles, revision, cotejo, conciliacion de examenes, vista previa, liberacion
parcial y reintento idempotente. Para medir el adaptador local real se requiere
Tesseract y se ejecuta `npm run metrics:ocr:local`. El comparador
`npm run metrics:ocr:compare` mide esa referencia contra el proveedor local
tipografico conservador. `npm run evidence:ocr` y
`npm run evidence:ocr:compare` regeneran reportes sinteticos con hash.

`npm run preview:ocr` abre un servidor limitado a `127.0.0.1:4173` y conecta la
pantalla HTML de revision con los 200 recortes reales del banco sintetico. La UI
carga cinco pares visual/procesado por renglon y no habilita la confirmacion
hasta que las diez imagenes hayan terminado de cargar. No escribe en Google.

`npm run preview:platform` sirve en loopback el quiosco de sala con datos
sinteticos. Un numero valido, repetido o inexistente recibe exactamente el mismo
acuse generico; la pantalla no expone identidad, existencia ni ocupacion exacta
y no escribe en Google.

## Componentes

- `src/shared/`: contratos y maquinas de estado versionadas.
- `src/ocr/`: rasterizacion, homografia, segmentacion 40 x 5, Tesseract,
  proveedor tipografico conservador, proveedor REST, trabajos recuperables,
  evidencia, postproceso, validacion y revision.
- `src/core/`: dominio, repositorios en memoria, auditoria y `MatrixGateway`.
- `src/apps-script/`: proyecto V8, repositorios Google y HTML Service.
- `deploy/ocr-worker/`: frontera HTTPS contenedorizable para Tesseract,
  normalizacion 40 x 5 y 200 pares de recortes de revision.
- `src/ocr/review/` y `src/ocr/evidence/`: bundle sanitizado, referencias
  opacas, productor idempotente y resolvedor vinculado a documento, candidato,
  renglon y casilla.
- `tests/fixtures/synthetic/`: datos sin informacion personal real.
- `docs/`: arquitectura, matriz, seguridad, operacion, estado y actas.

El resultado y las limitaciones del banco OCR local estan documentados en
`docs/OCR_LOCAL.md`. La precision tipografica sintetica no representa letra
manuscrita ni habilita por si sola un piloto.

## Estado de despliegue

No se ha creado ni desplegado ningun proyecto de Google Apps Script, Sheet,
Drive, Cloud Run o Cloud Vision. Supabase no es una dependencia del sistema.
El adaptador real de `MatrixGateway` permite inspeccion, pero rechaza todo commit
porque Apps Script/Sheets no ofrece la precondicion atomica requerida para
garantizar `NO_OVERWRITE` frente a editores externos.
Consulta `docs/DECISION_DESPLIEGUE_OCR.md`, `docs/CONTRATO_OCR_REMOTO.md` y
`docs/OPERACION.md` para la decision, contratos y propiedades requeridas.
