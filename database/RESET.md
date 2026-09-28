# Reset del piloto

> [!CAUTION]
> **LA BASE DE SUPABASE CONTIENE DATOS DE PRUEBA.**
> Corrida abierta: **PILOTO-2026-08-03**.
> Ningún dato de esta corrida es productivo. **Debe reconstruirse antes de
> cargar el padrón real.**

## Cómo saber si sigue sucia

```sql
SELECT * FROM lectura.estado_piloto();
```

Si `hay_corrida_abierta` es `true`, la base es de prueba. La función devuelve
además cuántos trabajadores, sesiones, asistencias, registros HC, liberaciones,
acuses y eventos de auditoría hay dentro.

Las otras dos señales, para quien no conozca esa función:

- el comentario del esquema `comun` (antes `kcm`) lo grita en el panel de Supabase y en `\dn+`;
- `sistema.corrida_piloto` tiene una fila con `cerrada_en` nulo.

## Por qué no se borra fila por fila

Auditoría, liberaciones, acuses del puente, eventos DC-3 e historial de
sobrescritura son **append-only**: sus triggers rechazan `UPDATE`, `DELETE` y
`TRUNCATE`. Es deliberado —un ledger que se puede editar no es evidencia— y
significa que no existe un "limpiar las pruebas" selectivo.

El cierre correcto es tirar los esquemas y reconstruirlos.

## Procedimiento de cierre

1. Confirmar que nadie está usando la plataforma y detener el proceso Node.
2. Ejecutar:

```sql
DROP SCHEMA IF EXISTS lectura, organizacion, catalogo, operacion, matriz, dnc, dc3, seguridad, sistema, comun,
                     kcm_lectura, kcm CASCADE;  -- los dos últimos: nombres previos a 0043
```

3. Reaplicar **en orden numérico todas** las migraciones de `database/migrations/`,
   con tres excepciones y una precondición:

   - **No** reaplicar `0026`: esa migración es la que declara la corrida piloto.
   - **Antes** de `0029`, declarar la contraseña del rol de aplicación en la
     sesión: `SET kcm.app_password = '<contraseña de kcm_app>';`. Sin ese SET la
     migración falla cerrada a propósito, porque el secreto no vive en el árbol.
     Debe coincidir con la de `KCM_DATABASE_URL` o la plataforma no conecta.
   - `0035` altera un enum: si el motor la rechaza dentro de una transacción con
     otras, aplícala sola.
   - `0037` es una **reparación de datos ligada al piloto**, no un cambio de
     esquema: sus UUID no existen en una base reconstruida y sus `UPDATE` no
     encontrarán fila. La propia migración avisa. Tras el reset hay que rehacer a
     mano el reapuntamiento de QMS y BPM contra las identidades nuevas y volver a
     declarar el alias `BPM`, o la cobertura DNC reportará pendientes falsos de
     planta entera.

   > [!CAUTION]
   > Detenerse en `0025`, como decía este documento antes del 2026-08-06,
   > reconstruye una base **sin el rol `kcm_app` ni sus políticas** (`0029`) y
   > **sin los privilegios del nonce del puente** (`0031`). Eso reintroduce
   > exactamente el fallo que costó depurar el 2026-08-05: el puente VBA
   > respondiendo `INTERNAL_ERROR` antes de atender `RELEASE_PULL_V1`, con la
   > credencial correcta.

4. Verificar que quedó limpio:

```sql
SELECT count(*) FROM organizacion.trabajador;           -- 0
SELECT count(*) FROM sistema.bitacora_auditoria;        -- 1 (sólo la semilla)
SELECT obj_description('comun'::regnamespace);          -- sin aviso de piloto
SELECT to_regclass('sistema.corrida_piloto');           -- NULL
```

5. Comprobar que la plataforma y el puente VBA pueden conectar. Estas cuatro
   consultas fallan si el reset se detuvo antes de tiempo, y es la comprobación
   que no existía cuando el puente respondió `INTERNAL_ERROR`:

```sql
-- El rol existe y no puede saltarse la RLS.
SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'kcm_app';   -- t, f

-- Ninguna tabla de dominio quedó sin política para la aplicación
-- (`credencial_consola` tiene dos acotadas en lugar de `app_acceso_total`).
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('organizacion','catalogo','operacion','matriz',
                     'dnc','dc3','seguridad','sistema') AND c.relkind = 'r'
   AND NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                      AND 'kcm_app' = ANY (p.roles));               -- 0

-- El antifraude del puente: sin estos dos privilegios, toda solicitud VBA
-- falla con INTERNAL_ERROR aunque la credencial sea correcta.
SELECT has_table_privilege('kcm_app', 'seguridad.nonce', 'INSERT'),
       has_table_privilege('kcm_app', 'seguridad.nonce', 'DELETE');        -- t, t

-- Las vistas que consume /trabajadores/cobertura.
SELECT to_regclass('lectura.cobertura_dnc'),
       to_regclass('lectura.resumen_dnc_trabajador');                   -- no NULL
```

Tras el paso 3 la configuración real vuelve sola, porque vive en las
migraciones: patrón Kimberly Clark, las siete salas, las tres áreas temáticas y
los metadatos DC-3 de los tres cursos.

## Qué se pierde y qué no

Se pierde todo lo capturado durante el piloto: sesiones, asistencias del
quiosco, revisiones de preliberación, liberaciones, acuses del puente,
importaciones de matriz y su auditoría.

No se pierde nada del repositorio: migraciones, código y documentación son la
fuente. Si algo del piloto merece sobrevivir, se traduce a una migración
**antes** del reset; lo que quede sólo en la base, se va.
