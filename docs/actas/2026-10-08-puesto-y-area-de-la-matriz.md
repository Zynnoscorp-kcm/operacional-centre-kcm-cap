# Acta · Trabajadores sin puesto ni área y padrón sólo desde Excel · 2026-10-08

- Evidencia: tras enviar matriz y padrón desde Excel, `organizacion.trabajador` tenía 1 684 filas con `puesto_id`, `departamento_id` y `area_id` en nulo, y los catálogos `puesto`, `departamento` y `area` vacíos (antes del reset los había llenado la carga piloto: 101 puestos, 23 departamentos, 38 áreas).
- Causa: el reconciliador de la matriz sí trae puesto, departamento y área en `workersToUpsert`, pero `SupabaseMatrixRepository.applyBatchAtomic` sólo insertaba nombre, alta, nómina, planta y activo. El repositorio en memoria guardaba el objeto completo, por eso ninguna prueba lo notó. El padrón no escribe puesto: sólo lo coteja.
- Arreglo: antes de escribir trabajadores, el adaptador da de alta en lote los puestos, departamentos y áreas que falten (por nombre exacto, `nombre_normalizado` con `normalizeText`) y liga cada trabajador a sus identificadores. Un área sin departamento queda sin ligar porque el catálogo la exige subordinada.
- Datos: `matriz.importacion_contenido` está vacío, así que no hay de dónde rellenar. Al publicar, un envío nuevo de la matriz desde Excel mostrará a todos «con cambios» de puesto y área en el panel; al aplicarlo quedan escritos.
- Padrón: se retiró la carga manual desde la plataforma (`POST /padron` responde 404, sin formulario ni selector de archivo). La pantalla queda como la del barrido de matriz: una leyenda que remite a **Padrón de la semana** en Excel hasta que llega una revisión al panel de cambios.
- Evidencia: `tests/regresiones/adscripcion-de-la-matriz.test.ts` falla antes y pasa después; 784 pruebas de plataforma y 118 de `npm test` sin fallas; ESLint limpio en los archivos tocados.
- Pendiente: publicar en Vercel y volver a enviar la matriz desde Excel.

## Limpieza para la demostración

- A petición del usuario se borraron, en una transacción, trabajadores (1 684), historial de capacitación (11 408) y su historial de cambios (9 730), la importación de matriz, los 26 cursos que había creado la matriz, los catálogos de puesto, departamento y área (vacíos), nonces del puente y los cinco asientos de bitácora de cargas. Los disparadores de solo agregar se desactivaron sólo dentro de la transacción; al cerrar quedan 0 deshabilitados.
- Se conservan cuentas de consola, PIN de quiosco y apertura, salas, patrón, áreas temáticas y la configuración DC-3 de Inducción, LOTO y QMS. Se asentó `DATOS_BORRADOS` en la bitácora.
- Se borró la credencial de Excel KCM-OFFICE-01 de `seguridad.credencial_equipo` y del llavero de macOS (servicio `KCM_VBA_BRIDGE_TOKEN`); `security find-generic-password` responde 44 (no existe).
- Los puestos y áreas no se restauran de ningún respaldo: los crea el barrido de la matriz con los nombres que traiga, incluidos los nuevos.
- Publicación: el token de `~/.kcm-vercel-token` ya no tiene acceso al equipo «kcm-sistema-de-capacitacion» (`Not authorized`); falta un token nuevo para publicar `967d83e`.
