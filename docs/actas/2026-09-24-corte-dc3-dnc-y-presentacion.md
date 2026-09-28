# Acta · Corte del DC-3, ficha DNC y presentación de la consola

**24 de septiembre de 2026.** Rama `despliegue-nube-local`.

Continúa el acta [`2026-09-24-dc3-plataforma.md`](2026-09-24-dc3-plataforma.md)
y cierra lo que ahí quedó pendiente. El detalle del DC-3 vive en
[`DC3_AUTOMATIZACION.md`](../referencia/DC3_AUTOMATIZACION.md); el de la
presentación, en [`SISTEMA_DE_DISENO.md`](../referencia/SISTEMA_DE_DISENO.md).

## 1. Decisiones del departamento

- **Las constancias cuentan desde el 1 de enero de 2026**, con la posibilidad de
  revisar las de años anteriores.
- **Cualquier instancia emite**, la del equipo del departamento y la publicada.
- **Una sola bitácora.** La consola y el lote no pueden llevar registros
  separados.
- **No hay lotes.** El trabajo es procesamiento de datos con filtros, o completo
  sobre todo lo que la lista enseña.
- **Se retira el plazo legal** como criterio de prioridad.
- **El DNC por trabajador** se rediseña con la referencia CAPTA: menos
  información, la tipografía correcta y una línea de tiempo vertical.
- **Toda la consola** se escribe para un usuario del departamento, no para quien
  la programó.

## 2. DC-3

**El corte.** `domain/dc3/corte.ts` fija `2026-01-01`. La fecha de cada
constancia es la primera vez que el trabajador tomó el curso desde el corte; si
no lo ha tomado desde entonces, la más reciente anterior. La inducción usa la
fecha de alta. Pendiente es lo que tiene fecha desde el corte y no se ha
emitido; lo anterior se revisa con el filtro «Años anteriores» de la bandeja, de
la cobertura y del expediente, y se emite igual.

**Una sola ruta y una sola bitácora.** Se retiraron el generador por lote de
Node —`runner`, `planner`, el banco de vista previa, sus comandos `dc3:*` y el
ejemplo de configuración privada—, la tarea en segundo plano de la consola, su
tablero y la migración `0043`, que nunca se aplicó. Todo lo que se emite queda en
`kcm.auditoria`. El paquete `packages/dc3/` conserva el compositor del PDF y el
lector del padrón activo, que usa la carga del padrón.

**Cualquier instancia emite.** La razón social, las firmas y las leyendas van
horneadas; los logotipos del membrete se copiaron a
`plataforma/src/web/pdf/membrete/` y viajan con la plataforma. La duración, el
área temática y el agente salen sólo del catálogo de cursos en la base. Ya no
hay aviso de «aquí no se emite».

**Sin plazo.** Se retiraron el cálculo de días hábiles, el orden por plazo, la
faceta de vencidas y su columna en la cobertura. La bandeja abre en orden
alfabético; «Para repartir» agrupa por tipo de personal.

**Procesamiento completo.** «Emitir todas (N)» emite la lista entera con sus
filtros. La dirección de regreso ya no lleva las claves —dos mil no caben en una
dirección— sino el número de la solicitud, y la descarga las busca en la
bitácora. Topes medidos con constancias sintéticas: en el equipo local, 2000 en
un PDF (14 MB, 0.6 s) y 300 en ZIP; en la nube, 400 en un PDF (3 MB, bajo el
límite de 4.5 MB de la respuesta) y 15 en ZIP.

**Un detalle corregido.** Un curso con la clave del área temática en la base y
sin su nombre contaba como incompleto aunque la constancia imprimía el nombre
del catálogo de la STPS. La consulta y la pantalla usan ahora el mismo catálogo.

## 3. DNC por trabajador

- **La ficha** sigue la referencia: cabecera con la persona y sus cuatro cifras;
  a la izquierda la telaraña y la trayectoria; a la derecha los cursos del puesto
  y las constancias DC-3. Sin claves de curso, sin niveles de regla en inglés,
  sin estados en mayúsculas de sistema, con fechas legibles.
- **La telaraña** es plana y compara a la persona con la media de su área:
  cuántos compañeros de área tienen vigente cada curso. En la base es una
  consulta que reutiliza la evaluación DNC de los resúmenes; en memoria la
  calcula el motor. Si falla, la ficha sale igual, sin la referencia.
- **La trayectoria** es una línea de tiempo vertical: acreditaciones,
  constancias DC-3 y el ingreso. Se ven los ocho hitos más recientes y el resto
  se despliega.
- **Sin porcentajes de cumplimiento.** La regla de no publicarlos hasta aprobar
  reglas y poblaciones se respeta: el anillo y los globos dicen cuentas.
- **El directorio** tenía los encabezados corridos respecto de sus columnas.
  Ahora son seis columnas alineadas, el nombre lleva a la ficha y la fecha de
  ingreso se lee.
- **Cobertura por curso** es una barra apilada por curso, de menor a mayor
  avance, sin claves internas. **Cobertura DNC** perdió el comando de terminal y
  la jerga. **Departamentos** y **Comparativa de planta** enseñaban las mismas
  cifras en dos formatos: quedó una vista, y la dirección vieja redirige.

## 4. Presentación de la consola

- **Tipografía propia**: Manrope e IBM Plex Mono se sirven desde la plataforma,
  con su licencia OFL. Antes la hoja nombraba una familia que no viajaba y cada
  equipo dibujaba la suya.
- **La insignia del entorno** dice «Entorno de pruebas» y no aparece en
  producción.
- **Textos**: se retiraron nombres de tablas, comandos, variables de entorno,
  claves internas y notas técnicas de Inicio, Sesiones, Preliberación,
  Liberación, Cargas, Auditoría, Conexión Excel, Base de datos, la pantalla de
  error y el DC-3. Las fechas se escriben «24 sep 2026». Los avisos sin base
  dicen lo mismo en todas partes: «Sin conexión con la base de datos».
- **Excel y la VBA** ya no mencionan el lote DC-3.

## 5. Verificación

648 pruebas de plataforma y 112 unitarias en verde; typecheck, Prettier y las
guardas del proyecto, del VBA y de la imagen conformes; ESLint sigue en los 160
errores preexistentes de otros archivos. Recorrido en Chrome con padrones
sintéticos de la ficha, el directorio, las coberturas, departamentos, la bandeja
DC-3 con su periodo, el expediente, la cobertura y los datos del formato.

No se probó contra la base real: el proyecto de Supabase no respondió.

## 6. Pendiente

- **Probar contra la base** la consulta de la media del área y la del corte.
- **Los logotipos quedaron versionados** en el árbol, que es lo que permite
  emitir en la nube. Si no deben vivir en Git, la alternativa es un
  almacenamiento privado del alojamiento.
- La acción `DC3_REPORT_V1` del puente quedó sin uso desde que se retiró
  `KcmDc3`.
- Ningún `push` ni migración.
