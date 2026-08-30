# Justificación Técnica del Esquema PostgreSQL

Este documento fundamenta las decisiones de diseño del esquema relacional implementado en `database/migrations/`, contrastándolo contra los contratos de `docs/MODELO_DATOS.md`, los invariantes de la Parte 1 y las directrices del Acta de las 16:48.

---

## 1. Mapeo de Entidades: Sheets / Contratos ➔ PostgreSQL

| Entidad / Hoja | Tabla PostgreSQL | Justificación y Reglas de Integridad |
|---|---|---|
| `AUDITORIA` | `kcm.auditoria` | Append-only ledger. Triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE` abortan cualquier alteración física. |
| `ERRORES` | `kcm.errores` | Append-only ledger para diagnóstico sanitizado sin fuga de credenciales. |
| `ACTORES / ROLES` | `kcm.actor`, `kcm.asignacion_rol` | RBAC estricto en servidor con 4 roles canónicos (`ADMINISTRADOR`, `CAPACITACION`, `AUDITOR`, `CAPACITADOR`). |
| `CONCESIONES / SECRETOS` | `kcm.concesion`, `kcm.secreto_operacion`, `kcm.credencial_equipo` | Hashes criptográficos Argon2id. Secretos separados para quiosco y sala con auditoría independiente. |
| `CAPACITACIONES` / `HC_CURSOS` | `kcm.capacitacion`, `kcm.alias_capacitacion` | Catálogo canónico con identificador estable (`trainingId`). Tabla de alias aprobados para reconciliación automática. |
| Estructura Organizacional | `kcm.departamento`, `kcm.area`, `kcm.puesto` | 24 departamentos y áreas para resolución en dos niveles del DNC. Puestos con mapeo CNO para DC-3. |
| `EMPLEADOS` / `HC_TRABAJADORES` | `kcm.trabajador` | Núcleo tipado con dominio `numero_trabajador` (texto 5 dígitos). Antigüedad derivada de `fecha_alta`. |
| Atributos Declarados | `kcm.atributo_declarado` | Escolaridad declarada por omisión (`Preparatoria`) y categoría derivada con vigencia y procedencia. |
| Desconocidos | `kcm.candidato_curso`, `kcm.candidato_trabajador`, `kcm.campo_declarado` | Flujo de admisión gobernado para compatibilidad hacia adelante sin duplicar identidades ni bloquear lotes. |
| `HC_IMPORTACIONES` | `kcm.lote_importacion` | Control de ciclo de vida del snapshot XLSB (`FULL` / `DELTA`) con estados y conteos auditables. |
| `HC_REGISTROS` | `kcm.registro_hc` | Réplica de matriz con procedencia (`XLSB_IMPORT` vs `SESSION_RELEASE`). Unicidad por par vigente. |
| `HC_REGISTROS_HISTORIAL` | `kcm.historial_sobrescritura_fecha` | Append-only ledger de cambios de fecha (**sobrescribir sí, borrar no**), registrando actor, motivo, fecha previa y procedencia. |
| `SESIONES` | `kcm.sesion` | Ciclo de vida de sesiones con código revocable, capacitador y control de autorización. |
| `ASISTENCIAS` | `kcm.asistencia` | Participación por trabajador y sesión. Elegibilidad condicionada por identidad, cotejo y examen. |
| `KIOSK_REGISTROS` | `kcm.registro_quiosco` | Journal transaccional del quiosco (`RESERVADO -> ASISTENCIA_CREADA -> COMPLETADO`) para auto-reparación. |
| `EVIDENCIAS` | `kcm.evidencia` | Metadatos de archivos con hash SHA-256 e inmutabilidad garantizada. |
| `PRELIBERACION_REVISION` | `kcm.revision_preliberacion` | Consolidación de cotejo, resultados de examen y reporte PDF previo a liberación. |
| `LIBERACION_LOTES` | `kcm.lote_liberacion` | Journal transaccional con HMAC (`journal_mac`) y fases recuperables. |
| `LIBERACIONES` | `kcm.liberacion` | Registro inmutable de fecha liberada con clave idempotente efectiva. |
| `MATRIZ_MAPEO` | `kcm.destino_matriz`, `kcm.mapeo_matriz` | Destinos autorizados y mapeo de columnas con encabezado esperado y política. Prohíbe escrituras no declaradas. |
| `VBA_LIBERACION_ACUSES` | `kcm.acuse_liberacion_vba` | Ledger inmutable de confirmaciones de escritura física en el XLSB por el cliente VBA. |
| `RESERVAS_SALAS` | `kcm.sala`, `kcm.reserva_sala` | 7 salas oficiales con prevención física de traslapes en PostgreSQL mediante constraint GiST. |
| Reglas DNC | `kcm.regla_dnc`, `kcm.evaluacion_dnc_snapshot` | Reglas en dos niveles (`DEPARTMENT` / `AREA`) con recurrencia, periodo de gracia y 6 estados oficiales. |
| DC-3 | `kcm.metadato_curso_dc3`, `kcm.documento_dc3` | Metadatos oficiales STPS y ledger de constancias con unicidad por trabajador/curso y bloqueo preventivo. |
| Superficie de Lectura | `kcm_lectura.*` | Funciones `SECURITY DEFINER` con proyección mínima y anonimización de datos privados. |

---

## 2. Cumplimiento de Invariantes y Reglas Estructurales

### 2.1. Número de Trabajador (`kcm.numero_trabajador`)
- **Regla:** Es texto de 5 dígitos y jamás se convierte a número.
- **Implementación:** Dominio `kcm.numero_trabajador` con constraint `CHECK (VALUE ~ '^\d{5}$')`. Impide a nivel de tipo de datos que se inserte un valor numérico o de longitud diferente.

### 2.2. Seguridad por Fila (RLS) Deny-by-Default
- **Regla:** Seguridad cerrada por omisión en el 100% de las tablas.
- **Implementación:** Migración `0017_seguridad_rls.sql` aplica `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY` sobre las 32 tablas de `kcm`, revocando permisos a `anon` y `authenticated`.

### 2.3. Prevención de Traslapes de Salas sin Bloqueo Aplicativo
- **Regla:** Dos reservaciones activas de la misma sala no pueden traslaparse en horario.
- **Implementación:** Migración `0014_agenda_salas.sql` utiliza la extensión `btree_gist` y define:
  ```sql
  CONSTRAINT reserva_sin_traslape_activo
    EXCLUDE USING gist (sala_id WITH =, horario WITH &&)
    WHERE (estado = 'ACTIVA')
  ```
  Esto delega la serialización atómica al motor de PostgreSQL, eliminando cualquier condición de carrera bajo concurrencia.

### 2.4. Inmutabilidad de Ledgers y Auditoría
- **Regla:** Los eventos y journals son append-only; no existe operación de edición o borrado.
- **Implementación:** Función `kcm.impedir_modificacion()` instalada como trigger `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE` en `auditoria`, `errores`, `historial_sobrescritura_fecha`, `liberacion` y `acuse_liberacion_vba`.

### 2.5. Reconciliación de Autoridad y Sobrescritura de Fechas
- **Regla:** El XLSB maestro es dueño del historial; SQL es dueño de la operación. Sobrescribir sí, borrar no.
- **Implementación:** `kcm.registro_hc` distingue `procedencia` (`XLSB_IMPORT` vs `SESSION_RELEASE`). Toda sobrescritura o corrección exige registrar el valor anterior en `kcm.historial_sobrescritura_fecha` con actor, motivo, momento y procedencia antes de modificar el valor vigente.

### 2.6. Atributos Declarados y Restricción de Escolaridad
- **Regla:** Escolaridad arranca con `Preparatoria` por omisión para todos, sin alimentar reglas ni porcentajes. Categoría se deriva de puesto.
- **Implementación:** `kcm.atributo_declarado` aísla los atributos con `declarado_por_omision = true` y procedencia `DECLARADO_POR_OMISION`. El enum `kcm.atributo_para_reglas` excluye estructuralmente a la escolaridad de las opciones seleccionables por el motor de reglas DNC.

---

## 3. Lo que no se tradujo (OCR Suspendido)

Conforme al Acta del 2026-08-02 16:48:
- Se eliminaron del alcance las tablas y contratos relacionados con Tesseract OCR (`OCR_DOCUMENTOS`, `OCR_RESULTADOS`, `OCR_RECORTES_LOTES`, compuerta OCR G6).
- Los estados de sesión `EVIDENCIA_RECIBIDA`, `OCR_EN_PROCESO` y `REVISION_OCR` fueron omitidos del enum `kcm.estado_sesion`.
- La máquina de estados opera directamente con `CERRADA -> PRELIBERACION -> LISTA_PARA_LIBERAR`.
