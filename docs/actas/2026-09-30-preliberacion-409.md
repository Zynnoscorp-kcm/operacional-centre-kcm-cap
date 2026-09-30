# Acta · Liberar desde preliberación sin «Error 409» · 2026-09-30

- Síntoma: «Error 409 · La sesión no está en una etapa revisable» al liberar desde preliberación.
- Evidencia: registro de Vercel 06:47:16 UTC, `GET /preliberacion/<id>?aviso=Sesión revisada y liberada.` → 409 desde `openForStage`; la bitácora muestra la liberación completa de KC-0002 (`RELEASE_COMPLETED`, `LIBERADA_TOTAL`) un instante antes.
- Causa: `POST /api/pre-release/liberar` redirigía al banco de la sesión ya liberada.
- Arreglo: al liberar se vuelve a `/preliberacion?aviso=…`; `GET /preliberacion/:id` de una sesión no revisable redirige a la bandeja (sólo en HTML; la API conserva el 409).
- Prueba nueva en `plataforma/tests/rutas/preliberacion.test.ts`: falla antes del arreglo, pasa después (33/33).
