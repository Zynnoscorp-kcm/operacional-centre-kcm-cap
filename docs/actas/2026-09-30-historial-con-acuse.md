# Acta · La fecha entra al historial sólo con el acuse de Excel · 2026-09-30

- Pedido del usuario: que nada se escriba en Supabase hasta que Excel confirme la escritura en la matriz.
- `adapters/postgres/liberacion.ts`: `applyWrites` inserta en `matriz.liberacion` (cola de `RELEASE_PULL_V1`) con `ON CONFLICT DO NOTHING`; ya no toca `historial_capacitacion`. `getHcRecord` devuelve primero lo encolado sin registro en el historial, para que `verifyApplied`, las reanudaciones y la siguiente liberación del mismo par lo vean como vigente.
- `adapters/postgres/excel.ts`: `appendReleaseAcks` llama a `materializarLiberacion` con cada acuse efectivo, en la misma transacción: asienta `SOBRESCRITA` (motivo y actor del lote) si había otra fecha vigente, retira la vigente e inserta la nueva. Idempotente por `clave_idempotencia`.
- `RELEASE_CONTEXT_V1`: la fecha esperada ahora es la vigente del historial (que no cambia hasta el acuse).
- El adaptador en memoria conserva el comportamiento anterior; las pruebas de dominio no cambian.
- Evidencia: typecheck limpio; 780 pruebas de plataforma sin fallas; `EXPLAIN` de cada consulta nueva; simulación en Supabase con lote sintético (54864/BPR): lo encolado aparece como pendiente, al materializar queda 2026-09-30 RETIRADO, 2026-10-01 VIGENTE y un cambio SOBRESCRITA; transacción revertida y comprobado que no quedó nada.
- Lo ya liberado antes del cambio (KC-0001, KC-0002) sigue en el historial como estaba.
