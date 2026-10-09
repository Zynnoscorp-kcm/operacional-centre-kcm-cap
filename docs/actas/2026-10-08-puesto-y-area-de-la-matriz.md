# Acta · Trabajadores sin puesto ni área y padrón sólo desde Excel · 2026-10-08

- Evidencia: tras enviar matriz y padrón desde Excel, `organizacion.trabajador` tenía 1 684 filas con `puesto_id`, `departamento_id` y `area_id` en nulo, y los catálogos `puesto`, `departamento` y `area` vacíos (antes del reset los había llenado la carga piloto: 101 puestos, 23 departamentos, 38 áreas).
- Causa: el reconciliador de la matriz sí trae puesto, departamento y área en `workersToUpsert`, pero `SupabaseMatrixRepository.applyBatchAtomic` sólo insertaba nombre, alta, nómina, planta y activo. El repositorio en memoria guardaba el objeto completo, por eso ninguna prueba lo notó. El padrón no escribe puesto: sólo lo coteja.
- Arreglo: antes de escribir trabajadores, el adaptador da de alta en lote los puestos, departamentos y áreas que falten (por nombre exacto, `nombre_normalizado` con `normalizeText`) y liga cada trabajador a sus identificadores. Un área sin departamento queda sin ligar porque el catálogo la exige subordinada.
- Datos: `matriz.importacion_contenido` está vacío, así que no hay de dónde rellenar. Al publicar, un envío nuevo de la matriz desde Excel mostrará a todos «con cambios» de puesto y área en el panel; al aplicarlo quedan escritos.
- Padrón: se retiró la carga manual desde la plataforma (`POST /padron` responde 404, sin formulario ni selector de archivo). La pantalla queda como la del barrido de matriz: una leyenda que remite a **Padrón de la semana** en Excel hasta que llega una revisión al panel de cambios.
- Evidencia: `tests/regresiones/adscripcion-de-la-matriz.test.ts` falla antes y pasa después; 784 pruebas de plataforma y 118 de `npm test` sin fallas; ESLint limpio en los archivos tocados.
- Pendiente: emitir una credencial nueva de Excel y enviar matriz y luego padrón desde Excel.

## Limpieza para la demostración

- A petición del usuario se borraron, en una transacción, trabajadores (1 684), historial de capacitación (11 408) y su historial de cambios (9 730), la importación de matriz, los 26 cursos que había creado la matriz, los catálogos de puesto, departamento y área (vacíos), nonces del puente y los cinco asientos de bitácora de cargas. Los disparadores de solo agregar se desactivaron sólo dentro de la transacción; al cerrar quedan 0 deshabilitados.
- Se conservan cuentas de consola, PIN de quiosco y apertura, salas, patrón, áreas temáticas y la configuración DC-3 de Inducción, LOTO y QMS. Se asentó `DATOS_BORRADOS` en la bitácora.
- Se borró la credencial de Excel KCM-OFFICE-01 de `seguridad.credencial_equipo` y del llavero de macOS (servicio `KCM_VBA_BRIDGE_TOKEN`); `security find-generic-password` responde 44 (no existe).
- Los puestos y áreas no se restauran de ningún respaldo: los crea el barrido de la matriz con los nombres que traiga, incluidos los nuevos.
- Publicación: el token anterior de `~/.kcm-vercel-token` ya no tenía acceso al equipo (`Not authorized`); con el token nuevo del usuario se publicó `967d83e` en producción desde un clon limpio con `HOME` aislado. `/healthz` responde 200 en los tres dominios y el código fuente no se sirve (redirige al acceso).

## El padrón decía «1 683 no están en la base»

- Evidencia: tras enviar matriz y padrón, 0 trabajadores; `matriz.importacion` con un lote CONFIRMADO de 9 730 fechas sin ninguna fila escrita; en Vercel, `POST /matriz/aplicar` → «Task timed out after 120 seconds». El padrón cuadró contra una base vacía.
- Causa: `applyBatchAtomic` escribía fila por fila (~31 000 consultas: trabajadores, fechas, historial y un `resolverActor` por asiento). La carga del 09-30 ya había tardado ~105 s; con la adscripción rebasó el tope y la transacción se deshizo. Además `saveBatch` usaba otra conexión, fuera de la transacción, y dejó un lote confirmado huérfano que habría hecho pasar un reenvío por repetido.
- Arreglo: trabajadores, fechas nuevas, fechas corregidas e historial se escriben con un `INSERT … SELECT unnest(…)` (o `UPDATE … FROM unnest`) cada uno, con actores resueltos una vez por identificador; el lote se guarda dentro de la misma transacción. Las fechas vacías se guardan nulas.
- Evidencia: ensayo contra Supabase con la instantánea real de 1 686 trabajadores dentro de una transacción deshecha al final: 18 s, 54 consultas, 1 686 trabajadores, 1 674 con puesto, departamento y área (los 12 restantes vienen en blanco en la matriz), 100 puestos, 23 departamentos, 36 áreas, 9 363 fechas. Prueba de regresión ampliada (lote dentro de la transacción y consultas acotadas con 5 000 fechas); 785 pruebas de plataforma y 118 de `npm test` sin fallas. Publicado `e27384f`.
- Datos: se borraron el lote huérfano y la revisión de padrón hecha contra la base vacía; la base quedó otra vez en cero.

## Sincronía sin matriz

- Causa: la sincronía coteja contra `matriz.importacion_contenido`, que sólo llenaba el flujo de importación anterior; el barrido desde Excel nunca guardaba la copia.
- Arreglo: al aplicar un barrido completo, la copia se guarda en la misma transacción que los datos.
- Evidencia: ensayo con la instantánea real deshecho al final: aplicar 19 s y la sincronía coteja a los 1 686 trabajadores. Prueba de regresión ampliada; 785 + 118 pruebas sin fallas. Publicado `636e285`.

## Segunda limpieza

- A petición del usuario, con la misma transacción de la primera limpieza: se borraron la credencial KCM-OFFICE-01, 4 nonces y 2 asientos de cargas (no había trabajadores, fechas ni importaciones). Quedan sólo cursos de DC-3 (3), salas, patrón, áreas temáticas, configuración DC-3, cuentas de consola y PIN; 0 disparadores deshabilitados. Credencial borrada también del llavero (`security` responde 44).

## DC-3 sin constancias de QMS y LOTO

- Causa: tras el reset del 09-30 la configuración DC-3 de QMS y LOTO venía de las migraciones sin agente capacitador (constancia incompleta) y la de LOTO apuntaba al curso semilla `hc-course:LOTO`, que ninguna columna de la matriz alimenta; las fechas de 2026 entran por la columna «2026» (`hc-course:2026/…-loto`). Era el pendiente «configuración DC-3 de QMS y LOTO» del reset.
- Arreglo en datos: la configuración de LOTO pasó al curso de la columna 2026 (como en el respaldo; la columna 2025 no emite), QMS y LOTO recuperaron su agente capacitador del respaldo y se borró el curso semilla LOTO vacío. Como la limpieza conserva los cursos con configuración DC-3, el próximo barrido vuelve a llenar ese mismo curso.
- Evidencia: listas con corte 2026: LOTO 1 149, QMS 449, Inducción 139; 5 y 3 sin CURP.

## Tercera limpieza

- Misma transacción que las anteriores: 0 trabajadores, fechas, importaciones y credenciales de Excel; quedan 3 cuentas, 2 PIN y la configuración DC-3 de Inducción, QMS y LOTO (ya ligada a la columna 2026, con agente). Credencial borrada del llavero; 0 disparadores deshabilitados.

## «No existe un mapeo vigente» y LOTO 2025 dentro de LOTO 2026

- Causa 1: `matriz.mapeo_columna` y `matriz.destino` sólo se habían cargado a mano en el piloto; nada en el código los crea y el reset los borró. Sin mapeo no se libera.
- Arreglo 1: al aplicar un barrido completo, el adaptador registra el destino `MATRIZ_HC` y mantiene un mapeo por curso (hoja, columna y encabezado de la copia; fila 3, como `tools/build/mapeo-matriz.js`; `OVERWRITE_WITH_HISTORY`, como el piloto). Si la columna o el encabezado cambian, el mapeo viejo se cierra y se abre uno nuevo. Se generó el mapeo de la carga actual desde su copia: 26 cursos, mismas columnas que el respaldo.
- Causa 2: la limpieza borra los cursos sin DC-3, entre ellos LOTO 2025. Al recargar, la columna M (2025) no encontró su clave y `resolveCourseMappings` la casó por nombre con el curso de LOTO 2026, ya reclamado por la columna L: un curso con las dos columnas, la clave cambiada a la de 2025 y 1 224 fechas mezcladas.
- Arreglo 2: un curso reclamado por clave exacta (o por mapeo) ya no se asigna por nombre a otra columna; el cambio de clave por nombre sigue funcionando cuando la clave vieja no viene. `tests/regresiones/columnas-con-el-mismo-nombre.test.ts` falla antes (2 de 3) y pasa después; 788 + 118 pruebas sin fallas. Publicado `be2087a`.
- Datos: la carga actual de LOTO está mezclada y su mapeo apunta a la columna M; hace falta limpiar y recargar, devolviendo antes la clave de la columna 2026 al curso con DC-3.

## Cuarta limpieza

- Antes de borrar se devolvió al curso con DC-3 de LOTO la clave de la columna 2026. Se borraron, además de lo de siempre, la sesión de prueba (asistencias, quiosco, preliberación), la reserva de sala, el mapeo y su destino, y todos los asientos de bitácora salvo configuración y metadatos DC-3 (incluidas 12 DC-3 emitidas individualmente, que sólo vivían en la bitácora). Credencial borrada de Supabase y del llavero; 0 disparadores deshabilitados.
- Ensayo con la instantánea real sobre la base limpia, deshecho al final: 8.8 s; LOTO 2026 (DC-3) en columna L con 1 151 fechas, LOTO 2025 aparte en M con 494, QMS (DC-3) en AB; 27 mapeos en 27 columnas distintas.

## Quinta limpieza y guion reutilizable · 2026-10-09

- Tras las pruebas del usuario (liberación con lote y acuses, sesión, asistencias, DC-3) se limpió con el guion nuevo `database/limpieza-demostracion.sql`, documentado en `database/RESET.md`. Además de lo anterior cubre liberaciones, lotes, acuses, constancias y eventos DC-3. Resultado: sólo quedan cuentas, PIN, salas, patrón, áreas temáticas, configuración DC-3 (LOTO en la clave 2026, con agentes) y 5 asientos de configuración; 0 disparadores deshabilitados; credencial borrada de Supabase y del llavero.
