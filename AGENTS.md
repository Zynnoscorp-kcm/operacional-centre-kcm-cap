# Reglas duraderas del proyecto

- El OCR es la ruta critica y permanece activo en paralelo con nucleo, plataforma y calidad.
- Antes de cambiar contratos, consulta `PROMPT_MAESTRO.xml` y `docs/MODELO_DATOS.md`.
- Nunca uses ni publiques datos personales reales. Fixtures, capturas, mensajes y actas usan datos sinteticos o enmascarados.
- `referencias/privado/` nunca se rastrea en Git. Los originales XLSB, fotos y evidencias son de solo lectura.
- Las pruebas locales usan mocks; nunca escriben sobre la matriz real ni requieren credenciales.
- Un registro solo es elegible con identidad validada, asistencia comprobada, examen confirmado, sesion autorizada y ausencia de liberacion previa.
- Toda liberacion debe ser atomica, idempotente, auditable y no sobrescribe fechas existentes por defecto.
- Comandos base: `npm install`, `npm test`, `npm run test:integration`, `npm run lint`, `npm run demo`, `npm run metrics:normalization`, `npm run test:load` y `npm run preview:ocr`.
- No se declara VERIFICADO sin una prueba ejecutada y evidencia registrada.
- Al cierre de cada ejecucion significativa actualiza `docs/ESTADO_PROYECTO.md` y crea un acta nueva en `docs/actas/`.
