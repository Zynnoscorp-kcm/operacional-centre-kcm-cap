# Acta · «Liberar de todos modos» no hacía nada · 2026-09-30

- Evidencia: 8 `POST /api/release/execute` sin lote nuevo ni asiento en bitácora para KC-0004; el único lote (08:31 UTC) tiene `fase = PENDIENTE`, `estado = CONFLICTO`, `completado_en` puesto.
- Causa: `replaceBatch` escribe PENDIENTE cuando la fase es CONFLICTO (el enum no la tiene) y `#mapBatch` leía la fase tal cual; `release()` veía un lote no terminal y lanzaba «Existe un lote de liberación pendiente; reintente con su requestId original».
- Arreglo: `#mapBatch` devuelve CONFLICTO cuando el estado es CONFLICTO (el HMAC se firmó con CONFLICTO, así que además vuelve a cuadrar).
- Evidencia: `tests/regresiones/lote-en-conflicto.test.ts` falla antes y pasa después; 785 pruebas de plataforma sin fallas.
