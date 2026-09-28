# Constancias DC-3

Estado al 24 de septiembre de 2026: **la emisión vive en la consola**, en `/dc3`,
y emite cualquier instancia —la del equipo del departamento o la publicada— con
una sola bitácora. Cuentan los cursos desde el **1 de enero de 2026**; los de
años anteriores se consultan y se emiten aparte. No hay emisión por lote ni
generador de línea de comandos: el procesamiento es por filtros sobre la lista,
o completo sobre todo lo que la lista enseña.

## Decisión de arquitectura

- **Una sola ruta de emisión.** El 2026-08-01 se eliminó `KcmDc3` del cliente
  VBA: dos rutas sobre la misma plantilla podían producir dos constancias del
  mismo curso al mismo trabajador sin que ninguna viera a la otra. El
  2026-09-24 se retiró también el generador por lote de Node, con su ledger en
  disco, por la misma razón: lo que emitía no aparecía en la bitácora de la
  consola y la bandeja lo seguía contando como pendiente.
- **Una sola bitácora.** Cada emisión es un asiento en `sistema.bitacora_auditoria`
  (`accion = 'DC3_EMITIDA_INDIVIDUAL'`, `entidad_id = 'nomina:curso'`,
  `estado_nuevo` `EMITIDA` o `EMITIDA_PARCIAL`), con la cuenta de quien emitió y
  el número de la solicitud. Es la tabla que no se reescribe; ninguna pantalla
  la edita.
- **Cualquier instancia emite.** La razón social, las firmas y las leyendas van
  horneadas en `packages/dc3/pdf/leyendas-oficiales.js`, y los logotipos del
  membrete viven dentro de la plataforma (`plataforma/src/web/pdf/membrete/`).
  Ya no hay configuración privada que falte en la nube.
- **Sin migraciones.** Todo lee de las tablas existentes —`organizacion.trabajador`,
  `operacion.historial_capacitacion`, `dc3.curso_configuracion`, `sistema.bitacora_auditoria`— y escribe sólo
  en la bitácora.

## El documento que se entrega es un PDF

La plantilla oficial es una hoja de cálculo. Impresa arrastra la cuadrícula, las
celdas combinadas y el reverso con los catálogos de consulta, que no son parte
de la constancia que recibe el trabajador. Por eso el PDF no se convierte desde
la hoja: se compone. `packages/dc3/pdf/` lo escribe sin dependencias, con las
fuentes base que todo lector incluye. Del archivo oficial se conservan sus
leyendas —título, encabezados, etiquetas de cada campo, razón social y RFC del
patrón, protesta de decir verdad, pies de firma e instrucciones—, horneadas y
comparadas contra el borrador oficial donde está presente.

- El anverso se imprime completo en una página; el reverso de consulta no se
  imprime nunca.
- El nombre de curso largo se ajusta hasta dos renglones; si algo no cupiera,
  el compositor falla en vez de recortar texto legal.
- El PDF no hereda rutas, autores ni fecha de generación: la misma constancia
  produce exactamente los mismos bytes. Por eso la vista previa es la constancia
  que se emite y la reimpresión es la que se entregó.
- La razón social va corregida en las leyendas horneadas —el borrador la trae
  con errata— y la prueba que compara contra el borrador la excluye a propósito.
- El logotipo del sindicato sólo va en las constancias del personal
  sindicalizado (NS).

## De dónde sale cada dato

| Recuadro | Fuente |
|---|---|
| Nombre, CURP, puesto | Padrón semanal (`organizacion.trabajador`) |
| Ocupación específica | Clave de ocupación del trabajador, columna «Clave de ocupación» del padrón |
| Curso, duración, área temática, agente capacitador | Catálogo de cursos DC-3 (`dc3.curso_configuracion`) |
| Fecha del curso | Ver la regla del corte |
| Término del periodo | Fecha del curso más `dias_periodo` del curso |
| Razón social, RFC, firmas | Leyendas horneadas del formato oficial |

El área temática se imprime «clave-nombre». Si la base trae la clave sin el
nombre, el nombre sale del catálogo de la STPS (`domain/dc3/areas-tematicas.ts`)
y el recuadro cuenta como completo. Lo que falte sale en blanco, y la pantalla
lo dice antes de emitir.

## La regla del corte

`domain/dc3/corte.ts` fija `CORTE_DE_CONSTANCIAS = "2026-01-01"`.

- **Cursos de la matriz.** La fecha de la constancia es la **primera** vez que
  el trabajador tomó el curso desde el corte. Si no lo ha tomado desde
  entonces, la **más reciente** anterior al corte, y esa constancia cuenta como
  de «años anteriores».
- **Inducción.** La fecha es la de alta del trabajador; un alta anterior al
  corte es de años anteriores.
- **Pendiente** es lo que tiene fecha desde el corte y no se ha emitido. Lo de
  años anteriores no cuenta como pendiente en la bandeja, en Inicio ni en la
  cobertura: se revisa con el filtro «Años anteriores» y se emite igual que lo
  demás.

La consulta calcula la fecha con un `LATERAL` sobre `operacion.historial_capacitacion`
(`min(...) FILTER (WHERE fecha >= corte)` y `max(...) FILTER (WHERE fecha <
corte)`), y el periodo filtra con `b.antes_del_corte`. Quien no tiene fecha no
se pierde en ningún periodo: aparece en «Sin registro del curso».

## El módulo de la consola

`/dc3` tiene barra propia —sus secciones, la cifra de lo que falta emitir desde
el corte y un buscador que lleva al expediente de una persona— y funciona sin
una línea de JavaScript: la política declara `default-src 'none'`.

| Sección | Ruta | Contesta |
|---|---|---|
| **Por emitir** | `/dc3` | Qué constancias falta emitir desde 2026, y los años anteriores aparte |
| **Emitidas** | `/dc3/historial` | Qué salió, cuándo y quién lo emitió; y la reimpresión |
| **Cobertura** | `/dc3/panel` | Cuánto falta por curso y por área |
| **Datos del formato** | `/dc3/datos` | Qué imprime cada curso y qué sale en blanco |
| Expediente | `/dc3/trabajador/:nomina` | Todo lo DC-3 de una persona: la ventanilla |
| Búsqueda | `/dc3/buscar?q=` | Nómina o nombre; una sola coincidencia lleva directo al expediente |

### La bandeja

Sin filtro pedido enseña **lo que falta emitir desde el corte**, en orden
alfabético; «Para repartir» agrupa por tipo de personal y cada grupo por
nómina. Los filtros de todos los días son opciones de un clic con su cifra
—situación, fecha del curso (desde 2026 o años anteriores), curso, emitidas o
no— y cada grupo cuenta con los demás puestos y el suyo quitado. Área y tipo de
personal van en un formulario pequeño. Lo que vale para toda la lista, como la
clave de ocupación que hoy falta a todo el padrón, se dice una vez arriba.

### Emitir

- **Una.** El botón abre la advertencia encima del renglón (un `popover`
  declarativo). El «sí» es `POST /dc3/constancia/:n/:c` y la respuesta es `303`
  a la misma lista, con el acuse puesto. El PDF baja solo con un
  `<meta http-equiv="refresh">` hacia `/dc3/documentos`, que responde como
  adjunto. Recargar no vuelve a emitir.
- **Las marcadas.** Al marcar el primer renglón aparece la barra de selección
  con la cifra de lo marcado —un contador de CSS— y dos salidas: un solo PDF,
  con la hoja de entrega delante si se pide, o un ZIP con un archivo por
  constancia.
- **Todas las de la lista.** «Emitir todas (N)» toma la lista entera con sus
  filtros y en su orden, sin marcar nada. Es el procesamiento completo: con el
  filtro de un curso, todas las constancias de ese curso.

Varias constancias se leen en una consulta (`findCandidates`), se componen para
comprobar que salen y se asientan en un solo `INSERT` (`recordEmissions`): o
entran todas o ninguna. La dirección de regreso no lleva las claves —dos mil no
caben en una dirección— sino el **número de la solicitud** que las asentó;
`/dc3/documentos?solicitud=…` las encuentra en la bitácora
(`listRequestEmissionKeys`), en cualquier instancia.

La **hoja de entrega** (`web/pdf/relacion-dc3.ts`) enumera las constancias en
el mismo orden que las que la siguen, con una columna «Recibí: nombre y firma».

### Topes

| | Equipo local | Nube |
|---|---:|---:|
| Constancias por emisión, en un PDF | 2000 | 400 |
| En ZIP | 300 | 15 |
| Reimpresión | 2000 | 400 |

Medido con constancias sintéticas y hoja de entrega: 400 en un PDF pesan
3.0 MB y se componen en 0.2 s; 2000 pesan 14.2 MB en 0.6 s. En un PDF los
logotipos se guardan una vez (`buildPdf({ compartirImagenes: true })`); en un
ZIP cada archivo lleva los suyos, y 15 pesan 1.8 MB. La nube corta la respuesta
a los 4.5 MB, por eso allá los topes son menores. Una lista más larga que el
tope no se emite a medias: la pantalla lo dice, y filtrada por curso o por área
cabe en una sola emisión.

### Reimprimir

`GET /dc3/documentos?claves=…` compone de nuevo **sólo lo ya asentado** y no lo
vuelve a asentar: una reimpresión de lo que nunca se emitió sería una emisión
sin rastro. Una sola constancia sin hoja de entrega sale byte por byte igual que
al emitirla. Se reimprime desde el historial y desde el expediente.

### Quién emitió

Cada asiento lleva la cuenta de consola de quien emitió, leída de la sesión.
`USUARIO_CAPACITACION` queda sólo para el acceso abierto del piloto.

### Datos del formato

De sólo lectura: lo que imprime cada curso, la razón social, las firmas y el
membrete, la regla del corte, y lo que sale en blanco —trabajadores sin clave de
ocupación, CURP o puesto; las combinaciones de área y puesto sin clave— con un
CSV para completar la clave en el padrón (`/dc3/sin-ocupacion.csv`, sin CURP).

### Fuera del módulo

- **Inicio** pone en «Lo que toca ahora» las constancias por emitir desde el
  corte, con enlace a la bandeja.
- **La ficha del trabajador** reconoce lo emitido y enlaza al expediente DC-3.

## Privacidad

- Los CSV de la bandeja y de la ocupación no llevan CURP.
- Las respuestas con constancias van con `cache-control: no-store`.
- Las pruebas usan identidades sintéticas; el material de referencia con datos
  personales vive fuera de Git.

## Línea base observada

El conteo de agosto de 2026 sobre las referencias entregadas, con la regla del
corte, detectó 1,743 constancias potenciales desde 2026: 139 de inducción, 453
de QMS y 1,151 de LOTO, sobre 1,684 identidades activas completas. Es un
conteo de detección, no de constancias emitidas.

## Qué está verificado y qué no

Verificado: el compositor —una página, bytes deterministas, nombre largo en dos
renglones, leyendas horneadas contra el borrador oficial—; la bandeja, el
periodo, la emisión individual y múltiple, la descarga por número de solicitud,
la reimpresión, el expediente, la cobertura y los topes en los dos papeles, con
un padrón sintético.

No verificado: la emisión contra la base real, que sigue pausada.

## Alcance pendiente

- Que el padrón real traiga la clave de ocupación (hoy 0 de 1,685).
- Aprobar en el catálogo de cursos la duración, el área temática y el agente de
  los cursos que aún no los tengan.
- La acción `DC3_REPORT_V1` del puente VBA quedó sin uso desde que se retiró
  `KcmDc3`: ningún cliente la manda, y `dc3.evento_excel` no recibe asientos
  nuevos.
