# Acta · Quién liberó, en Entregas a la matriz · 2026-09-30

- `MatrixDelivery.releasedBy`: `nombre_visible` de `seguridad.actor` unido por `matriz.liberacion_lote.creado_por`. Columna «Liberó» en el tablero.
- `routes/preliberacion.ts` y `routes/liberacion.ts` reciben el códec de sesión de consola y usan la cuenta de la cookie como actor (respaldo: `USUARIO_CAPACITACION`). Afecta bitácora de revisión, lote y ocultar entregas.
- Los lotes anteriores muestran `USUARIO_CAPACITACION`: así se asentaron.
- Evidencia: typecheck limpio; plataforma 777 pruebas por archivo, sin fallas; aserción nueva en `entregas-matriz.test.ts`.
