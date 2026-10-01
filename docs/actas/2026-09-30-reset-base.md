# Acta · Base reconstruida · 2026-09-30

- Pedido: reset de Supabase para cargar la matriz y el padrón definitivos.
- Respaldo previo con el rol de la aplicación: 46 tablas, 13 737 filas, JSON por tabla en `referencias/privado/respaldo-reset-2026-09-30/` (ignorado por Git).
- `DROP SCHEMA` de lectura, organizacion, catalogo, operacion, matriz, dnc, dc3, seguridad, sistema y comun; registros `00%` borrados de `supabase_migrations.schema_migrations`.
- Migraciones 0001–0046 reaplicadas en orden con el MCP de Supabase (sin 0026). Sin contraseña de admin local; un rol temporal con permisos de `postgres` no fue posible (Supabase no concede `postgres`) y se eliminó. Desviaciones: 0037 lleva una guarda `EXISTS` en el alias BPM (sin ella el INSERT viola la llave foránea en una base nueva); se omitieron los avisos informativos de 0040 y 0042 y el `UPDATE` de 0041, que no tienen filas sobre qué actuar.
- Verificación de `RESET.md`: 0 trabajadores; corrida piloto nula; comentario de `comun` sin aviso; `kcm_app` con login y sin BYPASSRLS; 0 tablas sin política; nonce con INSERT y DELETE; vistas `lectura.cobertura_dnc` y `lectura.resumen_dnc_trabajador`; 45 migraciones; 7 salas; patrón; 3 configuraciones DC-3.
- Restaurado: `seguridad.credencial_consola` (Maricela0000, Pablo0000, Stephanie0000, mismos hashes), `seguridad.secreto` (PIN 2026 de quiosco y apertura), `seguridad.credencial_equipo` (KCM-OFFICE-01, mismo hash). Asiento `BASE_RECONSTRUIDA` en bitácora.
- Incidente: `PostgresExecutor.verificar` consultaba `sistema.corrida_piloto` y toda petición respondió 500 tras el reset (~10 min). Arreglo con `to_regclass` (commit `7b52b4d`), probado con y sin la tabla, publicado; acceso y pantallas principales en 200.
- Pendiente tras cargar matriz y padrón: `matriz.destino` y `matriz.mapeo_columna` (sin mapeo no hay liberación), configuración DC-3 y alias de QMS y LOTO sobre las identidades de la matriz, alias BPM y las 128 reglas DNC; todo está en el respaldo.
