# Diccionario de la matriz de competencias

## Alcance y fuente vigente

El análisis se ejecutó en modo de solo lectura sobre
`referencias/Matriz de Competencias 24 Julio_.xlsb`. El original se conserva
fuera de Git y no se convirtió a XLSX ni a Google Sheets.

- XLSB SHA-256:
  `0915c4bbe1541d0e92131f9ecb7212d08dbb3e58c2def191542a2de1b8cdfdaa`.
- Tamaño: `3,232,872` bytes.
- Libro: 8 hojas y 40 relaciones externas declaradas.
- Extractor reproducible: `npm run extract:hc`.
- Salida: snapshot privado `HC_SNAPSHOT_V1` dentro de
  `referencias/privado/`, con permisos `0600`.

El hash, tamaño, fecha de modificación e inode del XLSB coincidieron antes y
después de la extracción. El snapshot contiene datos personales y no se
adjunta, rastrea ni reproduce en documentación o fixtures.

## Hoja HC verificada

Los encabezados están en la fila 3 y los trabajadores comienzan en la fila 4.
La extracción vigente recuperó, sin publicar valores individuales:

| Métrica | Resultado |
|---|---:|
| Trabajadores únicos | 1,686 |
| Cursos operativos (`J:AJ`) | 27 |
| Fechas trabajador-curso | 9,363 |
| Celdas con fórmula | 4,100 |
| Fórmulas con valor cacheado | 4,100 |
| Errores de fórmula | 0 |
| Celdas combinadas | 7 |
| Diagnósticos u omisiones bloqueantes | 0 |

El extractor no ejecuta fórmulas, macros ni vínculos. Lee únicamente el valor
almacenado por Excel; por eso los nombres y demás campos dependientes se
trasladan como valores. Que exista caché completa permite importar el snapshot,
pero no prueba que los sistemas externos estén actualizados: Excel sigue siendo
el responsable de recalcular el maestro antes de una extracción autorizada.

| Columna | Campo | Regla operativa |
|---|---|---|
| B | `employeeId` (`No.`) | Identidad estable; texto de cinco dígitos |
| C | `displayName` | Valor de consulta; nunca identidad |
| D | `hireDate` | Fecha civil `YYYY-MM-DD` en el snapshot |
| E | `payrollType` | Valor laboral |
| F | `position` | Valor laboral |
| G | `department` | Valor laboral |
| H | `area` | Valor laboral |
| I | `plant` | Valor laboral |
| J:AJ | Cursos y fechas | 27 columnas actualmente aprobadas |

El rango de cursos no se amplía automáticamente. Una columna posterior a `AJ`
requiere ejecutar el extractor con `--last-course-column`, revisar los
diagnósticos y aprobar su correspondencia antes de importar. Un encabezado
detectado fuera del límite produce `COURSE_RANGE_TRUNCATED` y bloquea el
snapshot, por lo que no se omite silenciosamente.

La estructura es aplicable, pero hay calidad laboral pendiente de decisión:
12 valores vacíos en cada uno de `hireDate`, `position`, `department`, `area` y
`plant`; 5 en `payrollType`; y una fecha fuente posterior al instante de
extracción. Son agregados sin identidades y no se clasificaron como corrupción
del archivo.

## Identidades y mapeo

- El trabajador se identifica exclusivamente por `employeeId`.
- El extractor calcula un `sourceKey` determinista desde el contexto normalizado
  del encabezado; la letra de columna sólo queda como trazabilidad.
- La plataforma persiste un `trainingId` estable en `HC_CURSOS`.
- Un movimiento de columna conserva `sourceKey`. Un renombre que cambie esa
  clave requiere un `courseMappings` explícito hacia un `trainingId` activo de
  `CAPACITACIONES`, ya conocido en `HC_CURSOS` o aprobado como curso nuevo.
- Si `CAPACITACIONES` ya contiene cursos activos al iniciar, el primer mapeo
  debe cubrir los 27 cursos; omitirlo falla cerrado para no duplicar IDs.
- Un encabezado, fila o columna física nunca sustituye esas identidades.

## Traslado operativo

1. Ejecutar `npm run extract:hc`; no abrir ni escribir el XLSB desde el sistema.
2. Revisar hashes, conteos y diagnósticos sanitizados.
3. Cargar el snapshot JSON en una carpeta Drive restringida y ejecutar desde
   el editor `importKcmOperationalHcSnapshotFromDrive_()`, con los mapeos de
   curso aprobados cuando corresponda. La ruta pública
   `importOperationalHcSnapshot` queda reservada para operaciones posteriores
   autenticadas y nunca recibe el snapshot desde DevTools.
4. El servicio actualiza `HC_TRABAJADORES`, `HC_CURSOS`, `HC_REGISTROS` y
   `HC_IMPORTACIONES`, y luego reconstruye la única hoja visible `HC`.
5. Las liberaciones de sesiones agregan fechas a `HC_REGISTROS` sólo después de
   revalidar identidad, asistencia, examen, autorización y ausencia de una
   liberación previa.
6. Ningún flujo sobrescribe una fecha existente. Una discrepancia termina en
   conflicto auditable.

La escritura directa al XLSB o a una conversión de la matriz permanece
deshabilitada. La frontera transaccional es el ledger normalizado
`HC_REGISTROS`; `HC` es una proyección completa y reconstruible.
