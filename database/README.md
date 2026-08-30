# Esquema PostgreSQL — Plataforma KCM Cap

> [!CAUTION]
> **LA BASE CONTIENE DATOS DE PRUEBA.** Corrida **PILOTO-2026-08-03** abierta
> desde el 2026-08-03. Debe reconstruirse antes de cargar el padrón real:
> ver [RESET.md](RESET.md).
> Compruébalo con `SELECT * FROM kcm_lectura.estado_piloto();`

Este directorio contiene la definición DDL formal y versionada para la base de datos PostgreSQL de la plataforma KCM en Supabase, construida conforme al encargo de la **EJECUCIÓN {4}** del plan de construcción.

> [!CAUTION]
> **PRECONDICIÓN DE CIERRE Y PROHIBICIÓN DURADERA:**
> **NINGUNA MIGRACIÓN SE APLICA NI SE HACE PUSH SIN CONFIRMACIÓN EXPLÍCITA DEL DEPARTAMENTO.**
> Este paquete de DDL está diseñado para revisión, validación estática y auditoría previa.

---

## 1. Arquitectura de Esquemas

El diseño separa estrictamente el almacenamiento de dominio de la superficie de lectura autorizada:

```
┌────────────────────────────────────────────────────────┐
│                      PostgreSQL                        │
├────────────────────────────┬───────────────────────────┤
│        Esquema kcm         │    Esquema kcm_lectura    │
│  (Dominio y Persistencia)  │  (Superficie de Lectura)  │
├────────────────────────────┼───────────────────────────┤
│ • 32 tablas de dominio     │ • Funciones SECURITY      │
│ • RLS DENY-BY-DEFAULT      │   DEFINER                 │
│ • Triggers de inmutabilidad│ • Proyección estricta     │
│ • Acceso directo bloqueado │ • 0 fuga de PII           │
└────────────────────────────┴───────────────────────────┘
```

1. **`kcm` (Dominio):**
   - Aloja las 32 tablas del modelo operativo, padrón, matriz, agenda, DC-3 y auditoría.
   - **RLS Deny-by-Default:** El 100% de las tablas tienen `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY` activadas sin políticas permisivas para clientes.
   - El acceso directo está completamente revocado para roles `anon` y `authenticated`.

2. **`kcm_lectura` (Superficie de Lectura):**
   - Único punto de entrada para consultas desde la API / UI.
   - Implementa funciones `SECURITY DEFINER` con `search_path = ''` que proyectan únicamente los campos autorizados para cada caso de uso.
   - Garantiza que la agenda compartida nunca exponga datos del solicitante y que las consultas de cumplimiento excluyan `DATOS_INSUFICIENTES` del cálculo de porcentajes.

---

## 2. Mapa de Migraciones

| Archivo | Contenido / Alcance | Invariantes Principales |
|---|---|---|
| [`0001_fundamentos.sql`](migrations/0001_fundamentos.sql) | Esquemas, extensiones (`btree_gist`, `pgcrypto`), dominios y enums. | `numero_trabajador` como texto de 5 dígitos; `impedir_modificacion()`. |
| [`0002_auditoria.sql`](migrations/0002_auditoria.sql) | Ledgers `auditoria` y `errores`. | Append-only inmutable mediante trigger. |
| [`0003_acceso.sql`](migrations/0003_acceso.sql) | Actores, roles, concesiones, secretos y credenciales de equipo. | Hashes Argon2id; secretos separados para quiosco y sala. |
| [`0004_catalogos.sql`](migrations/0004_catalogos.sql) | Capacitaciones, alias aprobados, departamentos, áreas y puestos (CNO). | Estructura en 2 niveles; alias con aprobador; CNO bloqueante para DC-3. |
| [`0005_trabajadores.sql`](migrations/0005_trabajadores.sql) | Padrón `trabajador` y `atributo_declarado`. | Escolaridad declarada por omisión (prohibida en reglas); categoría derivada. |
| [`0006_desconocidos.sql`](migrations/0006_desconocidos.sql) | Admisión de cursos, trabajadores y campos desconocidos. | Admisión con origen y aprobador; compatibilidad hacia adelante. |
| [`0007_importacion_matriz.sql`](migrations/0007_importacion_matriz.sql) | Ingesta de matriz (`lote_importacion`, `registro_hc`, `historial_sobrescritura_fecha`). | Autoridad XLSB; reconciliación por procedencia; **sobrescritura sí, borrar no**. |
| [`0008_sesiones.sql`](migrations/0008_sesiones.sql) | Encabezados de sesión de capacitación. | Códigos de sesión públicos; control de estados de sesión. |
| [`0009_quiosco_asistencias.sql`](migrations/0009_quiosco_asistencias.sql) | Asistencias y journal durable de quiosco (`registro_quiosco`). | Reserva de identidad previa; auto-reparación; exclusión con motivo. |
| [`0010_preliberacion.sql`](migrations/0010_preliberacion.sql) | Evidencias y revisión de preliberación (`revision_preliberacion`). | Inmutabilidad de evidencias; consolidación de cotejo y exámenes. |
| [`0011_liberacion.sql`](migrations/0011_liberacion.sql) | Lotes de liberación y liberaciones individuales (`liberacion`). | Atomicidad, idempotencia por clave compuesta, HMAC en journal. |
| [`0012_destinos_mapeo.sql`](migrations/0012_destinos_mapeo.sql) | Destinos declarados y mapeos de columnas con política. | **No existe escritura a un archivo no declarado**; preflight de encabezados. |
| [`0013_puente_vba.sql`](migrations/0013_puente_vba.sql) | Acuses del puente VBA (`acuse_liberacion_vba`). | Ledger inmutable de aplicación en XLSB. |
| [`0014_agenda_salas.sql`](migrations/0014_agenda_salas.sql) | Catálogo de 7 salas y reservas con prevención física de traslapes. | Exclusión GiST `horario &&`; cancelación como transición. |
| [`0015_reglas_dnc.sql`](migrations/0015_reglas_dnc.sql) | Reglas DNC en dos niveles y snapshot de cumplimiento. | 6 estados oficiales; `REFORZAR` de 1ª clase; `DATOS_INSUFICIENTES` aislado. |
| [`0016_dc3.sql`](migrations/0016_dc3.sql) | Metadatos oficiales STPS y ledger de constancias DC-3. | Máximo una constancia por par trabajador/curso; bloqueo por metadatos. |
| [`0017_seguridad_rls.sql`](migrations/0017_seguridad_rls.sql) | Activación forzada de RLS deny-by-default en las 32 tablas. | Cobertura total de seguridad y revocación de permisos públicos. |
| [`0018_vistas_lectura.sql`](migrations/0018_vistas_lectura.sql) | Funciones de lectura proyectadas bajo `kcm_lectura`. | Superficie mínima expuesta; anonimización de agenda y ficha del trabajador. |
| [`0019_verificacion_cobertura.sql`](migrations/0019_verificacion_cobertura.sql) | Bloque anónimo de verificación y aserciones. | Comprueba automáticamente el 100% de RLS y triggers de inmutabilidad. |
| [`0020_correccion_marcar_actualizacion.sql`](migrations/0020_correccion_marcar_actualizacion.sql) | Corrección del trigger de marca de actualización. | Admite `actualizado_en` y `actualizada_en`; incluye aserción ejecutable. |
| [`0021_datos_operativos_dc3.sql`](migrations/0021_datos_operativos_dc3.sql) | Patrón, áreas temáticas, periodo de ejecución, nómina del solicitante de sala y foto. | Un solo patrón vigente; clave de área temática validada contra catálogo. |
| [`0022_semilla_configuracion_dc3.sql`](migrations/0022_semilla_configuracion_dc3.sql) | Semilla entregada por Capacitación el 2026-08-03. | Ningún curso queda aprobado: lo pendiente se siembra nulo. |
| [`0023_vistas_operacion.sql`](migrations/0023_vistas_operacion.sql) | Lectura de ficha, cursos por trabajador, asistencia y preparación DC-3. | Antigüedad derivada, nunca almacenada. |
| [`0024_duracion_induccion.sql`](migrations/0024_duracion_induccion.sql) | Duración de la Inducción: 3 horas en tres días. | Cambio auditado. |
| [`0025_puente_vba_persistencia.sql`](migrations/0025_puente_vba_persistencia.sql) | Credencial completa, nonces, acuses de conflicto, snapshot, eventos DC-3 y pull de liberaciones. | `PUENTE_VBA` sólo con recurso `bridge`; un acuse efectivo por clave idempotente. |
| [`0026_marca_corrida_piloto.sql`](migrations/0026_marca_corrida_piloto.sql) | Declara la base como entorno de prueba. **No se reaplica tras el reset.** | Una corrida abierta a la vez; el aviso vive en el comentario del esquema. |

| `0027_alineacion_dominio_sesion_asistencia.sql` | Alineación de sesión y asistencia con el dominio. | — |
| `0028_journal_liberacion_completo.sql` | Journal de liberación completo. | Fases recuperables. |
| `0029_rol_aplicacion_sin_bypass_rls.sql` | Rol `kcm_app` sin BYPASSRLS y una política por tabla. | La app deja de conectarse como `postgres`; el acceso queda enumerado y revocable. |
| `0030_journal_liberacion_marca_firmada.sql` | Marca de tiempo firmada en el journal. | Integridad HMAC en la reanudación. |
| `0031_permisos_nonce_puente_app.sql` | `INSERT`/`DELETE` sobre `kcm.nonce_puente` para `kcm_app`. | **Sin esto el puente VBA falla con `INTERNAL_ERROR`.** |
| `0032_credenciales_excel_sin_vencimiento.sql` | `expira_en` admite `NULL`. | Credencial permanente sin relajar revocación ni nonce. |
| `0033_almacen_objetos.sql` | Evidencias en `bytea` dentro de la base. | Sobreviven a un alojamiento sin disco persistente. |
| `0034_unificacion_identidad_dc3.sql` | Metadato legal reapuntado a la identidad de la matriz. | Desbloquea la emisión DC-3. |
| `0035_procedencia_roster_alta.sql` | Procedencia `ROSTER_ALTA`. | La inducción no se confunde con una fecha de matriz. |
| `0036_vista_cobertura_dnc.sql` | Vistas `cobertura_dnc` y `resumen_dnc_trabajador`. | Requisito por área subiendo a departamento. |
| `0037_reglas_dnc_a_identidad_de_matriz.sql` | Reapunta QMS y BPM; alias `BPM`. | **Reparación de datos ligada al piloto: no es replayable en una base nueva.** |
| `0038_directorio_consola.sql` | Directorio de acceso a la consola y sus políticas. | Contraseña sólo como derivación scrypt; retiro por revocación. |
| `0039_correccion_duracion_induccion.sql` | Corrección de la duración de la Inducción. | Cambio auditado. |

## Estado de aplicación

Aplicadas **39 migraciones** en el proyecto Supabase, entre el **2026-08-03** y
el **2026-08-06**, con autorización del departamento. La aplicación inicial de
0001–0025 verificó 41 tablas, todas con RLS y FORCE RLS, 9 funciones en
`kcm_lectura`, sin advertencias de seguridad más allá del `rls_enabled_no_policy`
que el diseño deny-by-default produce a propósito. Hoy `kcm_app` existe sin
BYPASSRLS y las 43 tablas de dominio tienen su política `app_acceso_total`.

Dos defectos se detectaron y corrigieron durante la aplicación inicial: el
trigger de marca de actualización rompía cinco tablas (ver 0020) y `0018`
proyectaba `actor.nombre_completo`, columna que no existe.

### Deriva entre la base y el repositorio, corregida el 2026-08-06

Cinco migraciones se habían aplicado a Supabase **sin quedar como archivo** en
este directorio, de modo que el repositorio ya no podía reconstruir la base:
`0029`, `0035`, `0036`, `0037` y una segunda mitad de `0038` con sus políticas.
Se recuperaron del historial remoto y se escribieron aquí. Dos consecuencias que
conviene no repetir:

- **La de `0029` no se copió literal.** La versión aplicada lleva la contraseña
  de `kcm_app` escrita en claro dentro del SQL, y por tanto guardada en
  `supabase_migrations.schema_migrations`. El archivo la lee de
  `current_setting('kcm.app_password')` y falla cerrado sin ese `SET`. La
  contraseña que quedó expuesta en el historial remoto debería rotarse antes de
  operar con datos reales.
- **Las políticas de `0038` ya viven dentro de `0038_directorio_consola.sql`.**
  Remotamente fueron dos migraciones (`0038_directorio_consola` y
  `0038_directorio_consola_politicas`) porque se agregaron después; el archivo
  local es la versión consolidada y no necesita un `0038b`.

El procedimiento de reconstrucción está en
[RESET.md](RESET.md),
que hasta esta fecha decía reaplicar sólo `0001…0025`.

---

## 3. Cumplimiento de los 6 Pasos de la Ejecución 4

1. **Traducción fiel de `docs/MODELO_DATOS.md`:** Cada entidad, campo, relación y ciclo de vida fue trasladado con precisión de tipos de PostgreSQL.
2. **Seguridad por fila cerrada por omisión:** 32 de 32 tablas con RLS y FORCE RLS.
3. **Separación del núcleo tipado de atributos declarados:** `kcm.trabajador` conserva el núcleo laboral, mientras `kcm.atributo_declarado` gestiona escolaridad (marcada por omisión) y categoría (derivada de puesto) con procedencia y vigencia.
4. **Admisión de desconocidos desde la primera versión:** Cursos (`kcm.candidato_curso`), trabajadores (`kcm.candidato_trabajador`) y campos (`kcm.campo_declarado`) se reciben como candidatos con origen y resolución auditada.
5. **Historial de sobrescritura de fechas:** Tabla `kcm.historial_sobrescritura_fecha` registra valor anterior, valor nuevo, actor, motivo, momento y procedencia bajo trigger inmutable.
6. **Destinos de escritura declarados:** Tablas `kcm.destino_matriz` y `kcm.mapeo_matriz` prohíben escrituras fuera de libros autorizados y garantizan verificación preflight de encabezados.

## Cableado de la aplicación (2026-08-03)

`plataforma/src/main.ts` elige la persistencia en un solo lugar: con `KCM_DATABASE_URL`
construye los seis repositorios PostgreSQL; sin ella arranca en memoria y lo
anuncia por `stderr`. En producción la variable es obligatoria.

Adaptadores en uso: quiosco/sesiones, preliberación, matriz, sistema por
trabajador, Excel/puente VBA, liberación y agenda de salas. El almacén de
evidencias es `FileObjectStore` sobre `KCM_STORAGE_DIR`.

Pendiente antes del despliegue productivo: la aplicación se conecta como rol
`postgres`, que tiene `BYPASSRLS` y por tanto **anula el deny-by-default**. Hay
que emitir un rol de aplicación sin ese privilegio y con permisos enumerados.
