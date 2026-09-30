# Acta · Liberar con fechas previas sin cuello de botella · 2026-09-30

- Síntoma (KC-0004, Política de calidad): «La liberación sobrescribiría 2 fecha(s)», motivo obligatorio, pero no se podía liberar ni regresar.
- Causa: `ReleaseService.preview` sin motivo clasificaba `OVERWRITE_REASON_REQUIRED` (conflicto) y la atomicidad pasaba al resto a `ATOMIC_BATCH_ABORTED`; `included = 0` desactivaba el botón. Además `/api/release/execute` respondía JSON a un formulario.
- Las 2 fechas: 54859 (2026-06-06) y 54968 (2026-07-08), `XLSB_IMPORT` del 2026-08-03; la matriz actual sólo trae una. La copia de la plataforma se refresca con «Actualización completa» + aplicar en Control de cambios.
- Cambios: preview reevalúa con motivo provisional cuando sólo falta el motivo (`atomicBatchReady` sigue en falso hasta capturarlo); campo `required`; execute redirige en HTML (falta de motivo, conflicto, éxito → tablero de entregas); botón «Regresar a preliberación» (`/api/pre-release/return`); el atajo de preliberación manda a la validación de la sesión; `ReleaseService.existingDates` y panel «Ya tienen fecha de este curso» en el banco.
- Evidencia: typecheck limpio; 782 pruebas de plataforma sin fallas; nuevas en `liberacion-sobrescritura.test.ts` y `rutas/liberacion.test.ts`.
