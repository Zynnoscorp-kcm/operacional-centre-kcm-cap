# El ciclo de los datos

Protocolo acordado con el departamento el 2026-08-18. Gobierna **cómo entra y
cómo sale** la información de las cuatro fuentes declaradas en
[`FUENTES_DE_VERDAD.md`](../referencia/FUENTES_DE_VERDAD.md), que sigue siendo el contrato de
**qué** dato manda. Aquel dice de dónde sale cada campo; éste dice en qué
momento, quién lo dispara, qué se denuncia antes de escribir y cómo se prueba
que el día cerró.

---

## El ciclo, tal como el departamento lo opera

Cerrado con el departamento el 2026-08-19. Todo lo demás en este documento existe
para sostener esto, y nada de lo que sigue puede contradecirlo.

**Inicio de semana.** Se sube el **padrón semanal** desde la plataforma, en
`/padron`. No pasa por el cliente VBA: los bytes viajan y el extractor vive en el
servidor.

**Se conecta la matriz.** El cliente VBA declara cuál es el libro y transmite la
**actualización diaria completa**.

**La plataforma avisa.** Queda registrada una apertura esperando revisión, y la
consola lo anuncia: se abre el **panel de control de cambios** con todo lo que
esa carga traería. Nada se escribe hasta que alguien lo revisa y aplica.

**Empiezan las liberaciones.** Quiosco, sesiones, preliberación y liberación, en
la plataforma, como siempre.

**La VBA pregunta qué hay que inyectar.** Recibe, sesión por sesión, **cuál es y
cuántas fechas va a inyectar**. El operador **acepta o declina cada sesión**. Las
aceptadas se inyectan en el libro con su marcador; las declinadas se quedan en la
cola con su motivo.

**Cada media hora, o cada cinco o diez lotes inyectados, se pulsa la
actualización ligera.** Sube las fechas nuevas, no retira nada y no abre ninguna
pantalla: **las fechas se reflejan en la base de manera discreta.** No es la
actualización diaria y no debe confundirse con ella.

**Al terminar la jornada, sólo si la matriz se va a reemplazar**, se pulsa
**Desactivar matriz**: el panel suelta el libro actual y queda en blanco para
recibir el de mañana. Si mañana se sigue trabajando el mismo archivo, no se pulsa
nada.

---

## Los cuatro hechos que fijan el diseño

Decididos con el departamento el 2026-08-18. Todo lo que sigue se deriva de
ellos; si alguno cambia, este protocolo hay que rehacerlo.

1. **La matriz es una sola, en copias sucesivas.** La copia de mañana se hace de
   la matriz con la que se cerró hoy. El archivo cambia de nombre a diario; el
   libro es el mismo linaje. **Consecuencia: el nombre del archivo no es
   identidad y no puede usarse como tal.**
2. **Las fechas se capturan en los dos lados.** La plataforma libera, y además
   puede haber ediciones a mano en la matriz sobre esas mismas fechas.
   **Consecuencia: el desacuerdo es operación normal, no anomalía. Un ciclo que
   se detenga ante el primer desacuerdo se detiene todos los días.**
3. **La subida la dispara una persona, no un reloj.** El capacitador pulsa
   *Actualizar* cuando lo considera —del orden de una vez por hora—. **No hace
   falta vigilancia automática ni latido por temporizador.**
4. **La copia del día trae cambios estructurales, y entre ellos bajas.** Altas,
   cambios de puesto y **trabajadores retirados del libro**. **Consecuencia: hay
   dos cargas de naturaleza distinta y no pueden tratarse igual.** Una mueve
   estructura y otra sólo mueve fechas.

## Lo que ya está construido y este protocolo no toca

Conviene decirlo antes, porque casi toda la mecánica ya existe:

- La **reconciliación por procedencia**
  (`plataforma/src/domain/importacion-matriz/reconciliador.ts`): una fecha
  `SESSION_RELEASE` nunca es alterada ni retirada por una importación; una
  `XLSB_IMPORT` se corrige, se retira y se reactiva en su misma fila.
- El **barrido gobernado** (`MATRIX_SCAN_V1` → `/matriz`): leer no escribe, y lo
  que la pantalla anuncia sale del mismo motor que aplicaría la carga.
- El **historial append-only** (`operacion.historial_capacitacion_cambio`): toda
  sobrescritura conserva valor anterior, actor, motivo y procedencia **antes** de
  escribir.
- El **puente de liberaciones**: la plataforma registra el efecto, el cliente VBA
  lo materializa con el código de la sesión en la nota de cada celda (`KC-0001`),
  calcula SHA del libro y acusa.
- La **bitácora de cargas** (`sistema.bitacora_auditoria` vía `BitacoraDeCargas`): los cuatro
  hechos —encargada, revisada, aplicada, rechazada— quedan asentados.

Lo que falta no es maquinaria. Es **gobierno**: cinco huecos concretos que en el
ciclo descrito arriba dejan de ser teóricos.

---

## Los cinco huecos

### 1. La matriz no tiene identidad, sólo nombre y hora

`extractedAt` es el reloj de la PC en el momento de la lectura, no una propiedad
del contenido. Si la copia de mañana se hace por error de la matriz de anteayer,
el `extractedAt` es de mañana, así que pasa el control de obsolescencia y se ve
como la matriz más reciente. Con alcance `FULL` eso **retira** todas las fechas
que la copia vieja no trae, en silencio.

Peor: el control de obsolescencia ni siquiera corre en la ruta de revisión.
`reconcileSnapshot` llama a `validateSnapshot(snapshot)` sin el segundo
argumento, así que la pantalla de `/matriz` dibuja la revisión completa y el
fallo aparece hasta que alguien pulsa *Aplicar*.

### 2. Un solo desacuerdo detiene la carga entera

`bloqueado: reconciliado.conflicts.length > 0`. Una fecha tecleada a mano que
contradiga una sesión liberada bloquea **todo**: las altas, las correcciones, los
cambios de puesto. Con el hecho 2 declarado arriba, la carga se detendría casi
todos los días, y una carga que se detiene todos los días es una carga que la
gente deja de correr.

### 3. Las dos cargas se tratan hoy como si fueran la misma

El barrido tiene `scope: "FULL"` fijo en el código, así que **la actualización
intradía puede retirar fechas**. No debe: a media mañana lo que se está leyendo
es un libro que alguien tiene abierto y está editando, y un guardado intermedio o
una celda borrada para volver a teclearla se leerían como «el maestro retiró esta
fecha». Retirar es un acto de la apertura, no de la actualización.

### 4. Nadie puede demostrar que las liberaciones bajaron

`pendientesEnMaestro` —las fechas que la plataforma liberó y la matriz todavía no
tiene— se cuenta en cada revisión y se pierde con ella: la revisión vive en la
memoria del proceso Node. No hay forma de contestar, antes de hacer la copia de
mañana, «¿bajaron todas las liberaciones de hoy al libro que voy a copiar?». Y
ésa es exactamente la pregunta que hay que contestar antes de copiar, porque lo
que no bajó ya no se recupera solo.

### 5. El empate de captura deja la liberación colgada para siempre

La plataforma libera una fecha. Antes de que el puente la escriba, alguien teclea
otra en esa misma celda. La política `NO_OVERWRITE` del destino hace lo correcto
—no pisa— y **aborta el lote**. El efecto queda en `PENDIENTE_ACUSE` y ahí se
queda: cada reintento vuelve a encontrar la celda ocupada. No existe hoy ninguna
ruta que resuelva ese empate.

---

## El sello: cómo la plataforma reconoce la copia del día

Una celda oculta en el libro, con nombre definido `KCM_SELLO`, que contiene un
texto opaco emitido por la plataforma:

```text
KCM_SELLO_V1|<importacion_id>|<sha256_snapshot>|<aplicado_en>
```

**Por qué importa aquí.** El hecho 1 dice que la copia de mañana se hace de la
matriz de hoy. Una copia hereda el sello de su original, así que la carga de
apertura puede comprobar algo que hoy es indemostrable: **que esta copia
desciende del libro con el que se cerró ayer**. Si alguien copió de la carpeta
equivocada, el sello lo dice antes de que el control de cambios muestre
cuatrocientas fechas «desaparecidas» que en realidad nunca se perdieron.

**Cómo circula.** La respuesta a cada carga aplicada devuelve el sello nuevo, y
el cliente lo escribe en la celda. No agrega ningún guardado: viaja en el
siguiente guardado que el libro tenga de todos modos. Es una celda oculta e
inerte; ninguna fórmula la lee.

**Qué contesta.** Toda carga reporta el sello que encontró, y con eso la
plataforma clasifica el libro antes de mirar una sola fecha:

- **Descendiente directo** — el sello coincide con el vigente. Es la matriz al
  día. Único caso en que una apertura puede dar bajas y retirar fechas.
- **Rezagado** — el sello es uno que la plataforma emitió antes. Este libro se
  perdió N cargas. Se admite **sólo como actualización**, nunca retira, y la
  pantalla nombra cuáles cargas se perdió.
- **Sin sello** — la celda está vacía. O es la siembra, o es una copia hecha
  antes de que existiera el sello. Se admite como actualización, y una
  **adopción** explícita de una persona lo promueve a descendiente.
- **Ajeno** — el sello no es ninguno que esta plataforma haya emitido. **No es la
  matriz.** Se rechaza entero; no se mezcla.

---

## Las dos cargas

El hecho 4 obliga a partir en dos lo que hoy es un solo acto. No se distinguen
por la hora sino por **qué tienen permiso de mover**.

Esa misma partición decide ahora **dónde corre cada una**. La ligera es pequeña
—unas quince al día, del orden de quinientas fechas— y viaja a la plataforma
publicada como cualquier otra petición. La completa sube el libro entero, y eso
no cabe en un alojamiento que corta en 4.5 MB: se corre desde el equipo del
departamento, apuntando el `ENDPOINT` del cliente a su propia máquina. Lo mismo
vale para el padrón del lunes. Las constancias DC-3 se emiten desde cualquier
instancia.

La consecuencia operativa es acotada y conviene decirla sin adornos: si ese
equipo está apagado, ese día no hay barrido completo ni padrón nuevo. Las
pantallas, el quiosco, la agenda y las actualizaciones de fechas siguen vivas.

### La actualización ligera — a voluntad del capacitador, sólo fechas

La dispara una persona desde el panel VBA, cada media hora o cada cinco a diez
lotes inyectados. Su alcance es
**`DELTA` siempre**. Sube las fechas que el libro tiene ahora y hace dos cosas:

- **Aplica sola** lo seguro: una fecha nueva sobre un par sin registro, una
  corrección sobre un registro `XLSB_IMPORT`, la reactivación de uno retirado.
- **Confirma** las liberaciones: todo par cuya fecha en el libro coincide con la
  de la base queda marcado como bajado al maestro. Eso es lo que hace que el
  número de cierre del día signifique algo.

Lo que la actualización **no** hace, nunca:

- no da de baja a nadie ni retira una sola fecha;
- no acepta una columna de curso nueva —se registra como candidata con
  `recordCandidateCourse` y sus fechas quedan aparcadas, porque una columna nueva
  suele ser un renombre que la resolución de alias no alcanzó, y aceptarla en
  silencio bifurca la identidad de una capacitación—;
- no aplica cambios de estructura por encima de una banda declarada: si aparecen
  más trabajadores o menos de los que había, eso es materia de apertura y se
  denuncia en vez de aplicarse.

No exige que nadie la revise. Ése es el punto: si exigiera revisión, el
capacitador dejaría de pulsarla.

### La actualización diaria completa — revisada, la única que retira

Se corre sobre el libro del día —copia nueva o el mismo de ayer— después de
meterle los cambios estructurales y antes de empezar a operar. Alcance `FULL`, **control de cambios completo en
pantalla**, y un botón. Es el único momento del ciclo en que un trabajador puede
darse de baja y una fecha ausente puede retirarse, y **sólo se ofrece si el sello
dice que la copia es descendiente directo**.

---

## El control de cambios

Es lo que la actualización diaria completa enseña **antes de escribir nada**, y
es la pieza que el departamento pidió explícitamente. Todo sale del mismo motor
que aplicaría la carga, así que lo que la pantalla anuncia es lo que va a pasar.

**La regla es: todo cambio se enumera, sea discrepante o no.** No es un informe
de excepciones. Si la matriz trae algo distinto de lo que la base tiene, aparece
—aunque no haya nada que decidir—. Lo que **no** se enumera es la coincidencia:
un par cuya fecha en el libro es la que la base ya tenía no es un cambio, es un
no-evento, y enumerarlo llenaría el informe con cincuenta mil filas inertes que
esconderían las cuarenta que importan. Las coincidencias se cuentan; los cambios
se listan.

De ahí salen las dos naturalezas:

- **No discrepante.** La matriz trae algo que la base no tiene y nada en la base
  lo contradice: un trabajador nuevo, una fecha sobre una celda que estaba
  vacía, un puesto que cambió. **Se aplica**, y queda constancia de que se
  aplicó.
- **Discrepante.** La base tiene un valor y la matriz trae otro, y la base tiene
  procedencia o autoridad que impide pisarlo: una fecha `SESSION_RELEASE`
  contradicha, una baja propuesta, un curso nuevo que puede ser un renombre.
  **Exige decisión** antes de aplicarse.

**No son dos sistemas.** El control de cambios es el registro completo; la
bandeja de divergencias de la sección siguiente es su vista filtrada por
`discrepante = true`. Una sola tabla, dos pantallas.

### Las clases

**Personal.** Cuántos trabajadores trae el libro y cuántos tiene la base.
Quiénes son los **nuevos**, con número de nómina. Quiénes **están activos en la
base y ya no aparecen en el libro** —los que se quitaron a mano—, cada uno por su
número. Y el neto: entraron tantos, salieron tantos.

**Adscripción.** Quién cambió de puesto, de área, de departamento, de tipo de
nómina o de planta, con el valor de antes y el de ahora. Si el puesto nuevo no
está en el catálogo se dice, porque sin él el DC-3 de esa persona se queda sin
clave de ocupación.

**Fechas.** Cuatro clases:

- **La matriz trae una fecha que la base no tiene.** Lo normal: alguien la
  tecleó. No discrepante. Se da de alta.
- **La base tiene una fecha que la matriz ya no trae.** Hay que separarlo en dos
  por procedencia: si es `XLSB_IMPORT`, alguien la borró en Excel y se retira —no
  discrepante, pero se enumera una por una, porque un retiro es un borrado—; si
  es `SESSION_RELEASE`, **es una liberación que no bajó o que alguien borró**, es
  discrepante, no se retira jamás y sigue contando como pendiente en maestro.
- **Las dos tienen fecha y no coinciden.** Discrepante.
- **Las dos coinciden.** No es un cambio. Se cuenta, se marca como confirmada en
  maestro, y no ocupa una fila del informe.

**Columnas.** Cursos nuevos, cursos renombrados y cursos que la base conoce y
este libro ya no trae como columna. Los tres son discrepantes: una columna nueva
suele ser un renombre que la resolución de alias no alcanzó.

**Magnitud.** La apertura no rechaza por conteos —los cambios estructurales son
justamente su contenido— pero sí **destaca** cuando la variación pasa de una
banda declarada: una copia que perdió el veinte por ciento de los trabajadores
casi nunca es una baja masiva, casi siempre es la copia equivocada.

**Ninguna baja se aplica sola.** El motor propone; una persona confirma. Aquí
hay una tensión que conviene decir en voz alta: `FUENTES_DE_VERDAD.md` declara al
**padrón semanal** como la fuente de mayor autoridad sobre la existencia de una
persona, y sus hojas de bajas están deliberadamente fuera del alcance. La matriz
no es autoridad de existencia. Por eso quitar a alguien del libro **propone** una
baja y no la ejecuta: quien confirma deja actor y motivo en la auditoría, y el
padrón de la semana siguiente la corrobora o la desmiente.

### La pantalla

Definida con el departamento el 2026-08-19. Vive en `/matriz` para la apertura en
curso, y en `/matriz/cambios/{importacionId}` para consultar una pasada —que
ahora es posible, porque el lote persiste—.

**La consola avisa sola.** Cuando la actualización diaria completa llega, el lote
queda en `VALIDADO` esperando decisión, y eso es todo lo que hace falta para el
aviso: cualquier pantalla de la consola muestra la banda «hay una apertura
esperando revisión» mientras exista un lote en ese estado. No hay sondeo ni
notificación que mantener; es una consulta de una línea en el dibujo de la
plantilla.

**El orden no es alfabético ni cronológico: es por consecuencia.** Lo que puede
hacer daño va arriba, lo rutinario abajo. Quien revisa esto lo hace con prisa a
primera hora, y lo que vea primero es lo único que va a mirar con atención.

**La cabecera** contesta antes que nada de qué libro se está hablando: nombre del
archivo, cuándo se leyó, y qué dice el sello —«es la matriz del día», «se perdió
tres cargas», «no es la matriz»—. Debajo, el neto de personal en una línea:
entraron tantos, salieron tantos, quedan tantos. Y el aviso de magnitud si la
variación pasó la banda declarada.

**1. Fechas registradas que la matriz ya no trae.** Primero por ser lo más grave,
y **partido en dos por procedencia**, que es la distinción que decide todo:

- Procedencia `SESSION_RELEASE`: **una liberación que no bajó al libro, o que
  alguien borró.** No se retira jamás. Se denuncia y sigue contando como
  pendiente en maestro.
- Procedencia `XLSB_IMPORT`: alguien la borró en Excel. Se retira si se confirma.

Cada fila: nómina, curso, la fecha que la base tiene, su procedencia y desde
cuándo. Sin la separación por procedencia este bloque sería una lista plana en la
que retirar una fila destruye una liberación y retirar la de al lado es correcto.

**2. Trabajadores faltantes.** Propuesta de baja, nunca efecto. Cada fila: nómina,
nombre, puesto y área, desde cuándo está en la base, y **cuántas fechas
registradas tiene** —dar de baja a alguien con doce cursos acreditados no es lo
mismo que dar de baja un alta de la semana pasada, y esa cifra es lo que lo hace
evidente sin abrir nada—. Se confirma en bloque o una por una.

**3. Fechas divergentes.** *Este bloque no estaba en la lista del departamento y
lo agrego, porque es el caso central del hecho 2*: las dos fuentes tienen fecha
para el mismo par y no coinciden. Es lo que produce que alguien teclee a mano una
fecha que la plataforma ya liberó distinta. Cada fila: nómina, curso, fecha en la
base con su procedencia, fecha en la matriz. Dos salidas, manda la matriz o manda
la plataforma, que son las de la bandeja de divergencias.

**4. Nueva columna o curso.** Nombre de la columna, su letra, cuántas fechas trae
y **a qué curso del catálogo se parece**, si la resolución de alias sugiere
alguno. La decisión no es aceptar o rechazar: es *«es un curso nuevo»* o *«es el
mismo que este otro, escrito distinto»*. Aceptar un renombre como curso nuevo
bifurca la identidad de una capacitación y deja la mitad del historial colgando
del curso muerto.

**5. Nuevos trabajadores.** Nómina, nombre, puesto, área, departamento y planta.
No es discrepante —se aplican todos— pero se listan uno por uno porque es la
única oportunidad de ver un número de nómina mal tecleado antes de que exista.
Se marca el que traiga un **puesto fuera del catálogo**, que deja a esa persona
sin clave de ocupación y por tanto sin DC-3.

**6. Cambios de puesto o área.** Nómina, campo, valor antes y valor ahora. El
mismo bloque lleva departamento, tipo de nómina y planta, que cambian por las
mismas razones y se revisan con la misma mirada. También se marca el puesto
nuevo que no esté en el catálogo.

**7. Fechas nuevas — en breve.** Sólo el conteo y su desglose por curso: ocho o
trece líneas, no las doscientas filas que trae un día normal. Es el bloque más
voluminoso y el menos informativo: son las fechas que alguien tecleó ayer y que
van a entrar sin que nadie tenga nada que decidir. El detalle existe detrás de un
enlace que pagina, para el día que haga falta auditar una.

**Aplicar** está al final y **deshabilitado mientras quede un bloque discrepante
sin decidir** —el 1, el 2, el 3 y el 4—. Los bloques 5, 6 y 7 no bloquean nada:
se informan y se aplican.

**Todo se opera con formularios.** La política de contenido de la plataforma
prohíbe scripts, así que la paginación, las decisiones por fila y las decisiones
en bloque son envíos de formulario, como en la pantalla de preliberación. Y las
decisiones en bloque no son un lujo: nadie va a pulsar cuarenta veces para
confirmar cuarenta bajas.

### Dónde vive

**En la base, no en la memoria del proceso.** Un control de cambios que
desaparece cuando el servidor se duerme no es un control de cambios: es una
vista previa. Tiene que poder consultarse la semana que viene, cuando alguien
pregunte qué pasó el martes.

Una tabla, `matriz.cambio_detectado`, con una fila por cambio: el lote que lo
encontró, la clase, si es discrepante, el trabajador y la capacitación —por
número y clave de origen, porque un trabajador nuevo todavía no tiene `uuid`—, el
valor anterior y el nuevo, la procedencia del valor anterior, y el estado del
cambio: `PROPUESTO`, `APLICADO`, `RECHAZADO` u `OMITIDO`, con actor, motivo y
momento cuando alguien decide.

**Y se cuelga del ciclo de vida que ya existe.** `matriz.importacion` ya
recorre `RECIBIDO → PREPARADO → VALIDADO → APROBADO → CONFIRMADO`, con
`RECHAZADO` y `CONFLICTO` como salidas, y `batch-lifecycle.ts` ya implementa las
seis transiciones. **La ruta de barrido lo salta**: fabrica un `importId`
sintético —`barrido-${uuid}`— y guarda la revisión en memoria. La actualización
diaria completa deja de saltarlo. Ése es el trabajo, y es menos del que parece:
la maquinaria está construida y sin usar.

La actualización de fechas del intradía **también escribe sus filas**, colgadas
de su propio lote. Son pocas —decenas al día— y sin ellas el registro del día
quedaría con un hueco entre la apertura y el cierre.

### Qué se manda por el cable

El detalle completo puede ser de miles de filas el día de una reestructura, y el
egreso está vigilado. Por eso la pantalla manda **los conteos por clase siempre,
y el detalle paginado bajo demanda**: se abre la clase que se quiere revisar y se
traen sus filas, no las de todas. La exportación completa existe como descarga
explícita, no como carga inicial de la pantalla.

---

## La bandeja de divergencias

Sustituye al bloqueo total. Una tabla durable, `matriz.divergencia`, con una
fila por par en desacuerdo: trabajador, capacitación, fecha en la matriz, fecha
en la base, procedencia de la base, carga que la detectó, estado, y —al
resolverse— actor, motivo y momento.

**El resto de la carga se aplica.** Los pares en divergencia se excluyen del
lote; ni uno solo de los demás efectos se pierde por su culpa. Es el cambio de
fondo respecto de hoy, y es lo que hace que el ciclo sobreviva al hecho 2.

Una divergencia se cierra por tres caminos:

- **Se caduca sola.** Una carga posterior encuentra que la matriz ya coincide
  —normalmente porque el puente materializó la liberación entre una
  actualización y la siguiente—. Se marca `CADUCA` y nadie la tocó. **Éste va a
  ser el caso mayoritario**, y por eso la bandeja tiene que auto-cerrarse: una
  bandeja que sólo crece se vuelve invisible en una semana.
- **Manda la matriz.** Alguien decide que la fecha tecleada es la correcta. Se
  aplica como sobrescritura gobernada, con las cuatro condiciones que ya exige el
  modelo: política `OVERWRITE_WITH_HISTORY` en el destino declarado, motivo
  capturado, historial persistido antes que el valor, y valor anterior con su
  procedencia consultable.
- **Manda la plataforma.** La fecha liberada es la correcta. Se encola un efecto
  de puente que reescribe la celda, con la política elevada **para ese solo
  efecto**, con motivo, y dejando el valor anterior en `KCM_SOBRESCRITURAS`.

El empate de captura del hueco 5 entra por aquí: un lote que aborta por celda
ocupada **deja de ser un lote fallido y se vuelve una divergencia**, con las
mismas tres salidas. Deja de ser un callejón.

---

## La prueba de cierre: confirmado en maestro

Dos columnas en `operacion.historial_capacitacion`:

```sql
confirmado_en_maestro_en    timestamptz,
confirmado_por_importacion  uuid REFERENCES matriz.importacion (importacion_id)
```

Cada carga —la actualización también— las escribe para todo par cuya fecha en la
matriz coincide con la de la base. A partir de ahí existe **un número**, en una
consulta de una línea: cuántas fechas `SESSION_RELEASE` siguen sin aparecer en el
libro, y desde cuándo.

**Ese número es la condición para desactivar la matriz o copiarla.** En cero, el libro
que se va a copiar contiene todo lo que la plataforma liberó hoy y la copia nace
completa. Distinto de cero, copiar arrastra el hueco a mañana y a pasado; hay que
correr el puente otra vez antes de copiar, o resolver las divergencias que lo
estén impidiendo.

---

## El ciclo, de corrido

**El lunes** se sube el padrón semanal en `/padron`. Su revisión pasa por el
mismo control de cambios que la matriz, y lo que decida queda registrado igual.

**Cada mañana** se declara la matriz en el panel —si se desactivó la de ayer, se
elige el archivo nuevo— y se transmite la **actualización diaria completa**. La
consola avisa que hay una apertura esperando: el sello dice si el libro desciende
del de ayer, y el control de cambios enseña, antes de escribir nada, quién entró,
quién dejó de estar, qué puestos cambiaron, qué columnas aparecieron y las tres
clases de diferencia de fechas. Alguien lo revisa, decide las bajas propuestas y
aplica. La plataforma emite un sello nuevo.

**Durante el día** la plataforma opera y libera. La VBA pregunta qué hay que
inyectar y recibe la cola por sesión, con su código, su curso y cuántas fechas
trae; el operador acepta o declina cada una. Lo aceptado se escribe en el libro
con su marcador. Cada media hora, o cada cinco o diez lotes, se pulsa la
**actualización ligera**: suben las fechas nuevas, se marcan como confirmadas las
liberaciones que ya bajaron, y lo que no cuadra cae en la bandeja. **Nada se
retira y ninguna pantalla interrumpe.**

**Al terminar**, si mañana se va a trabajar sobre una copia nueva, se pulsa
*Desactivar matriz*. El botón comprueba primero que no queden liberaciones sin
bajar: soltar el apuntador con la cola llena perdería la referencia al archivo
que todavía las necesita. Con la cola en cero, suelta el libro y emite el sello
de cierre, que la copia de mañana hereda. Si mañana se sigue en el mismo archivo,
no se pulsa nada y el ciclo continúa donde estaba.

**La regla de operación que sostiene todo esto**, y que no es técnica sino
acordada: durante el día **no se teclea a mano en la matriz la fecha de un curso
que tenga una sesión abierta en la plataforma**. No hay forma de impedirlo desde
el código sin proteger celdas, que es intrusivo; pero sí hay forma de hacerlo
visible, y es la bandeja: esas fechas son exactamente las que aparecen ahí.

---

## El padrón semanal dentro del ciclo

**Sale del cliente VBA por completo.** Decisión del 2026-08-18: el padrón se
sube **desde la plataforma**, con el formulario de `/padron` que siempre ha
existido. `ROSTER_SCAN_V1` y `ROSTER_PATH` dejan de tener cliente. El motivo es
que ahí nunca hubo nada que ganar: los bytes viajan de todos modos y el extractor
vive en el servidor, así que la vía del puente sólo agregaba una segunda forma de
entregar el mismo archivo.

**Y usa el mismo control de cambios.** Decisión del 2026-08-19, y la respuesta a
si conviene hacerle un panel propio: no conviene, y sobre todo **no cuesta nada**.

El motivo es que el trabajo ya está hecho. La revisión del padrón lee el archivo
completo y el padrón completo de la base en una sola pasada, y compara en
memoria: `CuadreDePadron` ya trae una veintena de conteos y `MuestrasDeCuadre` ya
trae las muestras. Pintarlo con el componente del control de cambios y escribir
sus filas en `matriz.cambio_detectado` **no agrega una sola consulta**: la
comparación ya ocurrió. Lo único nuevo es un `INSERT` por lote, que es la
escritura más barata del ciclo.

Lo que sí gana es lo que hoy le falta. Sus bloques son distintos —CURP por
escribir, fechas de alta por corregir, inducciones nuevas, claves de ocupación,
puestos nuevos, y las divergencias de nómina y planta que denuncia y no escribe—
pero la forma es idéntica: clase, si es discrepante, valor antes, valor después,
decisión. Con eso las divergencias del padrón dejan de morirse con la pantalla
que las produjo, que es su defecto de fondo: **una divergencia que sólo vive en
su pantalla no es una divergencia, es un aviso.**

Dos reglas propias que conserva:

- **Orden.** La actualización diaria completa tiene que estar aplicada antes de
  revisar el padrón: el conteo de `desconocidos` no significa nada si la matriz
  que se comparó es de ayer. La pantalla muestra la edad de la última apertura.
- **Corrobora las bajas.** El padrón es la autoridad sobre quién está activo. Una
  baja confirmada en la apertura que el padrón de la semana siguiente sigue
  trayendo como activa es una denuncia propia, y de las importantes: significa
  que alguien se quitó del libro sin haber causado baja.

Los cursos unificados y la plantilla del DC-3 quedan fuera de este ciclo por
ahora, como se acordó. Son catálogos versionados con aprobador: entran por
decisión, no por archivo, y su cadencia es la del cambio de norma, no la del día.

---

## Lo que cuesta

Con la subida disparada por una persona y un solo proceso Node:

- **Cargas al día:** una apertura y del orden de ocho actualizaciones. No hay
  vigilancia por temporizador que sostener, así que desaparece el gasto de las
  288 consultas diarias que costaría un latido cada cinco minutos.
- **Lecturas de base:** hoy son tres por carga —trabajadores, cursos, registros—.
  A nueve cargas diarias son 27 lecturas, que sí caben. **Se recomienda de todos
  modos una caché en el proceso**, invalidada en cada escritura, igual que ya se
  hace con los planes del padrón. Coste declarado: repartir tráfico entre varios
  procesos Node exigiría bajar esa caché a la base antes. Con un proceso detrás
  del túnel —lo declarado hoy— no hace falta.
- **Escrituras:** sólo las que efectivamente cambian algo. Una actualización
  sobre un libro que nadie tocó desde la anterior escribe cero.

---

## La liberación, sesión por sesión

Cambio del 2026-08-19. Hasta aquí el puente descargaba lotes y los escribía. Ahora
**el operador decide en la VBA, sesión por sesión, qué se inyecta.**

*Ver cola de liberaciones* devuelve una lista legible: código de sesión, curso,
fecha y **cuántas fechas va a inyectar cada una**. No devuelve nombres. Con eso
delante, *Aceptar liberaciones* se opera por sesión: se acepta o se declina cada
una.

**Declinar no deshace la liberación.** Es la frontera de autoridad de todo el
puente y conviene decirla sin rodeos: **el puente materializa, no autoriza ni
desautoriza.** La liberación se decidió en la plataforma, con su preflight, su
journal autenticado y sus compuertas; Excel no es donde eso se revoca. Declinar
significa *no inyectar ahora*, exige motivo, y la sesión se queda en la cola para
ofrecerse de nuevo.

Lo que sí hace falta es que una declinación repetida no se pierda: a la tercera,
o marcada como *no inyectar*, **escala a la bandeja de divergencias** para que
alguien la resuelva desde la consola. Un lote que se declina todos los días sin
que nadie lo mire es exactamente el hueco que este ciclo existe para cerrar.

**El panel lleva la cuenta.** Cada lote inyectado incrementa un contador local;
al llegar a cinco —o cuando pasa media hora desde la última— la línea de estado
sugiere pulsar la actualización ligera. Sugiere, no ejecuta: el hecho 3 dice que
sube una persona, no un reloj.

---

## El panel del cliente VBA

Siete botones, tres grupos. Cerrado el 2026-08-19. El panel deja de ser un
tablero de acciones y pasa a **enseñar el ciclo en el orden en que se opera**.

**Conexión** — *Conectar este equipo* · *Verificar conexión exitosa*.

**La jornada** — *Realizar actualización diaria completa* · *Actualización de
fechas* · *Desactivar matriz*.

**Liberaciones** — *Ver cola de liberaciones* · *Aceptar liberaciones*.

Casi nada es código nuevo. *Realizar actualización diaria completa* es el actual
`MODO_BARRIDO` (`MATRIX_SCAN_V1`) declarado como apertura; *Actualización de
fechas* —la **ligera**— es el actual `MODO_TRANSMITIR` (`MATRIX_IMPORT_V1`) con
`DELTA` forzado. Ese `DELTA` es el cambio que importa: hoy ese botón puede
retirar fechas sin que nadie las vea, y quitarle ese permiso es lo que lo vuelve
seguro para pulsarlo ocho veces al día.

Lo que se retira del panel y por qué:

- ***Barrer padrón*** — el padrón se sube desde la plataforma.
- ***Vigilar barridos*** y ***Detener vigilancia*** — sin temporizador no hay qué
  vigilar. El motor se desconecta del panel; no se borra del código.
- ***Verificar matriz*** — sus cinco comprobaciones locales pasan a correr
  **dentro** de los dos botones de actualización, que es donde importan y donde
  nadie tiene que acordarse de pulsarlas.
- ***Guardar cambios*** y ***Recargar*** — ver abajo.
- ***Reparar instalación*** — se pliega dentro de *Conectar este equipo*: si
  falta `KCM_CONFIG`, el asistente la crea en vez de fallar.

**`MATRIX_PATH` deja de ser configuración y pasa a ser parte del acto.**
*Desactivar matriz* **borra la ruta**, y la mañana siguiente *Realizar
actualización diaria completa* la pide con el selector de Windows cuando está
vacía. Obliga a declarar cuál es el libro cuando el libro cambia, en lugar de
heredar en silencio el apuntador de ayer. Por eso sobran los dos botones que
editaban `KCM_CONFIG`.

**No es un botón de fin de día: es un botón de fin de libro.** Sólo se pulsa
cuando la matriz se va a reemplazar. Si mañana se sigue trabajando el mismo
archivo, no se toca nada y el panel conserva su configuración.

**Y no puede soltar la ruta a ciegas.** Si quedan liberaciones sin inyectar,
borrar el apuntador pierde la referencia al archivo que todavía las necesita.
Comprueba primero la cola y las fechas pendientes en maestro, y sólo con las dos
en cero suelta el archivo y emite el sello de cierre.

**El sello no tiene botón.** Se lee y se escribe dentro de las dos
actualizaciones, y *Verificar conexión exitosa* lo reporta junto con la conexión:
«este libro es la matriz del día» o «no lo es», que es la otra mitad de la
pregunta que ese botón contesta.

---

## Qué hay que cambiar en el código

En orden de dependencia, no de tamaño:

1. **`provenance-reconciler.ts`** — dejar de tratar el conflicto como excepción
   de lote: `reconcileSnapshot` debe **excluir** los pares en conflicto del resto
   de las operaciones, para que el lote se aplique sin ellos, y **emitir un
   cambio por cada diferencia**, discrepante o no, en vez de sólo los conflictos.
   Y `validateSnapshot` debe recibir el `latestExtractedAt` también en la ruta de
   revisión, no sólo en la de aplicación.
2. **`matrix-scan-service.ts`** — separar **apertura** de **actualización**.
   `scope` deja de ser `"FULL"` fijo: `DELTA` en la actualización, `FULL` en la
   apertura y sólo si el sello dice descendiente directo. `bloqueado` deja de ser
   `conflicts.length > 0` y pasa a ser el sello ajeno.
3. **La apertura deja de vivir en memoria.** Hoy fabrica un `importId` sintético
   —`barrido-${uuid}`— y guarda la revisión en el proceso. Debe crear un
   `matriz.importacion` real y recorrer las transiciones que
   `batch-lifecycle.ts` **ya implementa** y nadie usa:
   `RECIBIDO → PREPARADO → VALIDADO → APROBADO → CONFIRMADO`. La actualización de
   fechas puede seguir en memoria: se aplica sola y no espera a nadie.
4. **El control de cambios** — persistir una fila por cambio en
   `matriz.cambio_detectado`, con su clase, si es discrepante, valores antes y
   después, y el estado de la decisión. Las bajas entran como **propuesta**, no
   como efecto.
5. **Migración `0042_sello_cambios_y_divergencias.sql`** — `matriz.cambio_detectado`
   con sus enums de clase y estado, y las dos columnas de confirmación en
   `operacion.historial_capacitacion`. **No se aplica sin confirmación del departamento.**
6. **La cola de liberaciones por sesión** — *hecha a medias.* El resumen
   legible ya existe: `RELEASE_SESSIONS_V1` devuelve código de sesión, curso,
   fecha y cuántas fechas faltan, el subpanel `KCM_ENTRADAS` del libro lo
   enumera y `KcmApplyPendingReleases` acepta la decisión **por sesión**
   —escribir sólo las marcadas—. Falta el otro lado de la decisión:
   **`DECLINADA`** como estado que conserva motivo y devuelve la sesión a la
   cola, y la escalada a la bandeja en la tercera declinación. Hoy no escoger una
   sesión la deja pendiente sin dejar rastro de que alguien la miró y la dejó
   pasar.
7. **El padrón al mismo control de cambios** — `RosterIngestService` ya calcula
   todo el cuadre en memoria; sólo falta escribir sus filas y pintarlas con el
   mismo componente. Ninguna consulta nueva.
8. **Cliente VBA** — los siete botones de arriba; leer y escribir `KCM_SELLO` y
   reportarlo en cada carga; borrar `MATRIX_PATH` en *Desactivar matriz* y
   pedirlo en la apertura cuando esté vacío; el contador local de lotes que
   sugiere la actualización ligera; comprobar el sello **antes** de inyectar y
   devolver `LIBRO_NO_ES_LA_MATRIZ` en lugar de escribir en el archivo
   equivocado; convertir el aborto por celda ocupada en una divergencia en vez de
   un lote fallido. Retirar `ROSTER_SCAN_V1` y `ROSTER_PATH`.
9. **Pantallas** — el control de cambios con sus siete bloques, conteos por clase
   y detalle paginado bajo demanda; la banda de «apertura esperando revisión»; la
   bandeja de divergencias como vista filtrada, con las tres resoluciones; y el
   número de pendientes en maestro visible antes de desactivar la matriz.

Los puntos 1 a 4, 6 y 7 desbloquean el ciclo y **sólo el 5 toca la base**. El 5
exige autorización del departamento. El 8 exige Excel para Windows, que sigue
siendo un gate externo declarado.

---

## Lo que este ciclo no resuelve

- **No convierte a la plataforma en el único escritor.** Mientras se teclee en
  los dos lados habrá divergencias; el ciclo las hace visibles, resolubles y
  auto-caducables, no inexistentes. El horizonte limpio —que las fechas de los
  cursos que la plataforma opera las escriba sólo la plataforma— sigue siendo la
  decisión que más simplificaría todo esto, y no es técnica.
- **No decide una baja.** La propone y la audita. La autoridad sobre quién está
  activo sigue siendo el padrón, y el ciclo lo único que garantiza es que quitar
  a alguien del libro no pase inadvertido.
- **No protege contra un libro sin sello adoptado por error.** La banda de
  magnitud acota el daño; no lo impide. La adopción queda auditada con actor y
  motivo por esa razón.
- **No sobrevive a varios procesos Node.** La caché, las órdenes y las revisiones
  viven en memoria. Está declarado arriba y en `VBA_BRIDGE.md`.
- **No cubre el DC-3 ni los cursos unificados.** Se acordó dejarlos fuera. El día
  que entren, entran como catálogos con aprobador, no como archivos que se suben.
