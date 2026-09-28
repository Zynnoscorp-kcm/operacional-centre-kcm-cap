# Acta · DC-3 como plataforma dentro de la consola

**24 de septiembre de 2026.** Rama `despliegue-nube-local`.

Continúa el acta [`2026-09-24-modulo-dc3-y-voz.md`](2026-09-24-modulo-dc3-y-voz.md).
El detalle técnico vive en
[`DC3_AUTOMATIZACION.md`](../referencia/DC3_AUTOMATIZACION.md), sección «El
módulo de la consola».

## 1. Por qué no se sintió la mejoría anterior

El módulo había pasado de una pantalla a cuatro, pero el trabajo diario costaba
lo mismo. Se midió recorriendo la consola con un padrón sintético:

- **Emitir una constancia eran cuatro pasos** —botón, pantalla de advertencia,
  descarga, regreso— y el regreso reiniciaba la lista: perdía filtros y página.
- **La tanda bajaba un ZIP**, que para imprimir había que descomprimir y abrir
  archivo por archivo.
- **La persona salía partida** en un renglón por curso y repartida entre
  pestañas; no había una vista de lo que tenía una persona.
- **Las cuatro pantallas eran reportes con el mismo aspecto** que cualquier
  otra sección: nada decía que DC-3 era una aplicación.
- **Ruido fijo:** el aviso de la ocupación en cada pantalla, mosaicos que
  repetían las cifras de las pestañas, tres botones por renglón.
- **Defectos:** todas las emisiones se firmaban con `USUARIO_CAPACITACION` aunque
  hubiera sesión nominal; el historial enseñaba la hora en UTC, seis horas
  corrida; la ficha del trabajador leía una tabla que nada escribe y decía
  «pendiente de emisión» de constancias ya emitidas.

## 2. Decisiones

**El plazo legal ordena la bandeja.** La leyenda del formato fija veinte días
hábiles desde el término del curso. Se calcula con lunes a viernes menos los
descansos del artículo 74 de la LFT; las jornadas electorales no se descuentan
porque su fecha no se puede calcular, y el plazo sale un día más corto esos
años. Es el único dato «nuevo» y no se captura: sale de la fecha del curso, del
periodo del metadato y del calendario.

**La bandeja enseña lo que falta emitir.** `/dc3` sin filtros es pendientes;
«Todas» se pide. El orden por omisión es el del plazo.

**Preguntar sigue, pero no cuesta una pantalla.** La advertencia antes de
emitir —decisión de la sesión anterior— se conserva como `popover` encima del
renglón. La emisión vuelve con `303` a la misma lista y el PDF baja solo con un
`<meta refresh>` hacia una respuesta adjunta. La pantalla de confirmación queda
de respaldo.

**Una tanda es un solo PDF.** Con hoja de entrega delante —lista con columna de
firma de recibido— y los logotipos guardados una vez. El ZIP sigue como opción.

**Reimprimir sólo compone lo asentado.** Una reimpresión masiva de lo que nunca
se emitió sería una emisión sin rastro.

**Datos del formato es de sólo lectura.** La ocupación falta a todo el padrón y
se completa en la fuente, como manda la regla de las cuatro fuentes: la pantalla
da la lista por combinación de área y puesto y el CSV con la columna que espera
el padrón, pero no captura claves.

**Sin migraciones.** Todo lee de las tablas existentes y escribe sólo en
`kcm.auditoria`, como antes.

## 3. Movimientos

1. **Barra de módulo** con cinco secciones —Por emitir, Emitidas, Cobertura,
   Datos del formato, Lote—, la cifra de lo que falta emitir y un buscador que
   lleva al expediente.
2. **Bandeja** con filtros de un clic y su cifra, plazo por renglón, barra de
   selección que aparece al marcar y «Emitir la lista» cuando cabe en una tanda.
3. **Expediente por trabajador** (`/dc3/trabajador/:nomina`) y **búsqueda**.
4. **Emitidas**: filtros por periodo, curso, quién y cómo salió; agrupado por
   día en hora de la planta; reimpresión por renglón o en bloque; paginación.
5. **Cobertura**: avance de entrega por curso y por área, con lo vencido aparte.
6. **Datos del formato**: lo que imprime cada curso, origen de cada dato, huecos
   del padrón y calendario del plazo.
7. **Emisión en bloque**: una consulta para leer la tanda, un `INSERT` para
   asentarla. Cada asiento con la cuenta de la sesión.
8. **Compositor PDF**: la constancia se compone como página suelta sin cambiar
   un byte de la individual —verificado por huella SHA-256 antes y después—; el
   escritor comparte imágenes entre páginas sólo cuando se le pide, para no
   alterar los reportes de preliberación archivados por su huella.
9. **Fuera del módulo**: Inicio pone en la cola del día las constancias en
   plazo; la ficha del trabajador reconoce lo emitido y enlaza al expediente.

## 4. Verificación

638 pruebas de plataforma y 127 unitarias en verde; typecheck, Prettier, guardas
del proyecto, del VBA y de la imagen conformes. ESLint sigue en los 160 errores
preexistentes de los mismos diez archivos de otro frente; ninguno de este
trabajo. Recorrido en Chrome con padrón sintético: la advertencia abre sobre el
renglón, la emisión vuelve a la lista con el acuse y el PDF baja solo; marcar
tres renglones muestra la barra; la tanda baja un PDF de cuatro páginas con la
hoja de entrega.

No se probó contra la base real: Supabase sigue pausado.

## 5. Pendiente

- **Decidir el corte de la ventanilla.** El lote toma sólo cursos desde
  2026-01-01; la consola toma cualquier fecha, y para la inducción la fecha de
  alta de todo el padrón activo. Con la base real, la bandeja podría traer como
  «vencidas» constancias de inducción de años atrás. Existe el filtro «Desde el
  corte»; imponerlo es decisión del departamento.
- **La configuración privada no viaja a la nube**: allá no se emite, y la
  pantalla lo dice.
- **Lo que emite el lote no aparece en la bitácora de la consola.**
- Lo del acta anterior sigue en pie: la migración `0043` sin aplicar y ningún
  `push`.
