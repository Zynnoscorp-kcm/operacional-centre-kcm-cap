# Cliente VBA para matriz y liberaciones

Estado: **IMPLEMENTADO EN CÓDIGO, ANALIZADO ESTÁTICAMENTE Y VERIFICADO CON
PRUEBAS SINTÉTICAS; PENDIENTE DE IMPORTAR Y COMPILAR EN EXCEL PARA WINDOWS**.

> **Adenda vigente E11 (2026-08-03).** El destino operativo ya no es Apps
> Script. Node expone el mismo formulario POST en
> `https://<FQDN>/api/v1/vba-bridge`. La única línea que cambia en
> `KCM_CONFIG` es `ENDPOINT = https://<FQDN>/api/v1/vba-bridge`. El valor de
> `KCM_VBA_BRIDGE_TOKEN` es ahora la credencial individual emitida en `/excel`,
> ligada a principal + perfil Windows + equipo, revocable y caducable; no es un
> token compartido. El guion de compilación y humo está en
> [VALIDACION_EXCEL_WINDOWS.md](../operacion/VALIDACION_EXCEL_WINDOWS.md).

## Decisión

Se usa **un solo libro controlador `.xlsm`**, con módulos VBA separados. Corre en
**Excel para Windows y Excel para Mac** con el mismo código; lo único que cambia
entre los dos vive en `KcmPlataforma`:

| Módulo | Responsabilidad |
|---|---|
| `KcmPlataforma` | **el puerto**: lo único que depende del sistema operativo. Enviar el POST, calcular SHA-256, sortear identificador, fechar en UTC, guardar y leer la credencial, abrir el navegador y conceder acceso a un archivo en macOS |
| `KcmCodec` | UTF-8, base64 estándar y web-safe, codificación porcentual y hexadecimal, en VBA puro |
| `KcmDiccionario` | módulo de clase: el mapa de clave a valor que sustituye a `Scripting.Dictionary` |
| `KcmReleaseSync` | descarga liberaciones efectivas, hace preflight y escribe el XLSB |
| `KcmMatrixSync` | crea `HC_SNAPSHOT_V1` y transmite los cambios |
| `KcmBridgeHttp` | el protocolo: cuerpo, reintento idempotente, regla de HTTPS, respuesta y TSV |
| `KcmBridgeCore` | configuración, normalización, JSON, lecturas en bloque y ledger oculto |
| `KcmCoordinator` | ciclo completo y ejecución programada |
| `KcmConfigButtons` | botones de `KCM_CONFIG`; sin lógica propia |
| `KcmPanel` | **la cara del libro**: hoja `KCM_PANEL` con el estilo de la consola, campos rotulados y botones agrupados |
| `KcmMatrixPanel` | verificación, **barrido** y transmisión de la matriz, etapa por etapa, en `KCM_ESTADO` |
| `KcmPadronSync` | **barrido del padrón semanal**: entrega el `sem NN CAP.xlsx` sin interpretarlo |
| `KcmOrdenBarrido` | recoge los barridos encargados desde la plataforma; vigilancia opcional |
| `KcmAsistente` | puesta en marcha guiada de un equipo: credencial, ruta y detección de columnas |
| `KcmPruebas` | la autoprueba: ocho etapas que ejercitan el puerto y escriben su reporte |

No son macros monolíticas ni dos instalaciones. Comparten configuración y
transporte, pero un fallo del snapshot no revierte una liberación ya guardada.

### Una sola frontera de plataforma

El compilador de cada sistema compila **sólo su rama** de un `#If`: un error
escrito dentro de `#If Mac` no se manifiesta al compilar en Windows, ni al revés.
Esa asimetría es la que gobierna el diseño, y de ella sale una regla dura: **el
código que depende del sistema operativo vive en `KcmPlataforma` y en ningún otro
módulo**. `npm run lint:vba` falla si aparece un `#If Mac` fuera de ahí, y
`tests/unit/vba-client-contract.test.js` lo fija también desde las pruebas. La
única excepción declarada es `KcmDiagHash`, el diagnóstico temporal, que existe
justamente para interrogar lo que cada sistema hace distinto.

Cuanto más chica sea esa superficie, más dice la prueba hecha en un sistema sobre
el otro. Por eso tres dependencias de Windows no se resolvieron con una rama más
sino **eliminándolas**: `Scripting.Dictionary`, `ADODB.Stream` y
`Msxml2.DOMDocument` no existen en Excel para Mac y además son COM que las
políticas corporativas pueden bloquear en Windows. Se sustituyeron por
`KcmDiccionario` y `KcmCodec`, que corren igual en los dos.

**La emisión DC-3 no vive aquí.** La resuelve el generador Node
(`npm run dc3:generate`), que hace el cruce, valida identidad, lleva su propio
ledger y compone el PDF de una página; ver [DC3_AUTOMATIZACION.md](DC3_AUTOMATIZACION.md).
Dos rutas de emisión compartiendo la plantilla oficial podrían emitir dos
constancias del mismo curso al mismo trabajador, cada una con su propio folio, y
ningún ledger vería a la otra. El cliente VBA conserva sólo lo que exige estar
del lado de Excel: escribir en el XLSB maestro y leerlo.

`clients/excel/vba/` contiene además `KcmDiagHash`, que **no forma parte del cliente**: es
una herramienta de despliegue que aísla las etapas de `KcmFileSha256` y se
importa sólo mientras se diagnostica un fallo de huella. Ver
[Diagnóstico de la huella SHA-256](#diagnóstico-de-la-huella-sha-256).

## Flujo efectivo

```text
Plataforma: Liberar
       |
       v
Lote durable de liberación en Node
       |
       v
POST /api/v1/vba-bridge --credencial de equipo--> VBA en PC Windows
       |                                  |
       |                                  +--> XLSB maestro (política declarada)
       |                                  +--> snapshot HC_SNAPSHOT_V1
       v
acuse durable + réplica consultable de HC
```

La plataforma registra primero la liberación autorizada. El cliente sólo
materializa en Excel registros `SESSION_RELEASE` ya efectivos. Si Excel está
apagado, la plataforma muestra `pendiente de Excel`; no pierde la liberación.

## El panel del cliente

`KCM_CONFIG` es el formato interno del lector: nueve claves en mayúsculas y sin
acentos, donde nada dice que `FIRST_COURSE_COLUMN` es la primera columna de
cursos de la hoja `HC` ni que `ROSTER_PATH` cambia cada lunes. Sigue existiendo y
sigue siendo la verdad, pero ya no es donde trabaja una persona.

`KcmAbrirPanel` dibuja **`KCM_PANEL`**, con el mismo lenguaje visual de la
consola: banda de marca en `#224C9F`, lienzo `#EEF1F7` sin retícula, un campo por
clave con su rótulo legible y su ayuda al lado, y los botones repartidos en
cuatro grupos —configuración, revisar y cargar, liberaciones, vigilancia y
mantenimiento— en vez de una columna de once rectángulos iguales. Bajo la banda
hay una línea de estado que dice si el equipo puede operar o qué le falta,
comprobado **sin salir de la máquina**: dirección vacía, credencial sin declarar
en la variable de entorno, o una ruta que no apunta a ningún archivo.

Dos reglas gobiernan ese diseño, y las dos vienen del lector:

- **`KCM_CONFIG` no se toca.** `KcmConfigMap` recorre la columna A desde la fila
  2 y **falla cerrado ante una clave repetida**. Un título de sección o cualquier
  texto decorativo en esa columna se convertiría en clave, y dos secciones con el
  mismo nombre reventarían la lectura entera. Por eso el panel es una hoja
  aparte.
- **El panel no es la verdad.** `KcmPanelCargar` trae lo que hay en
  `KCM_CONFIG`; `KcmPanelGuardar` lo escribe de vuelta. Son dos botones
  explícitos y nada se sincroniza solo: un guardado al vuelo escribiría una ruta
  a medio teclear. Editar `KCM_CONFIG` a mano sigue funcionando, y **Recargar**
  lo trae a la vista.

`KcmPanelGuardar` valida antes de escribir, y sólo lo que se ha visto fallar: la
ruta pegada con las comillas que agrega el explorador de Windows, la columna
escrita como número en vez de letra, la bandera con un valor que no es `TRUE` ni
`FALSE` —que `KcmConfigFlag` rechaza cerrado— y la dirección sin `https://`.

El módulo es **aditivo**: no implementa lógica propia, sus botones llaman a las
mismas entradas públicas ya depuradas, y quitarlo entero deja el ciclo corriendo
desde `KCM_CONFIG` como antes.

## Análisis estático obligatorio

En este entorno no existe el editor VBA, así que la compilación no puede
ejecutarse aquí. `tools/check/vba.js` cubre la clase de fallo que sí es
detectable sin Excel y corre dentro de `npm run lint` y de `npm test`:

```bash
npm run lint:vba
```

Verifica literales de cadena cerrados con `""` como única forma de comilla
interna, continuaciones válidas y bajo el límite de 24 del editor, ausencia de
caracteres que VBA nunca acepta fuera de una cadena, bloques
`Sub`/`Function`/`Property`/`If`/`For`/`Do`/`With`/`Select`/`Type`/`#If`
balanceados, `Option Explicit`, variables declaradas realmente usadas y toda
referencia `Kcm*` resuelta contra una declaración del propio cliente —incluidos
los módulos de clase, cuyo nombre sale de `Attribute VB_Name`—.

Cuatro reglas más cubren fallos que de otro modo sólo aparecerían al compilar en
Excel, que es donde ya no hay evidencia local:

- **`#If Mac` sólo en el puerto.** Es la garantía de que la superficie
  dependiente del sistema no se mueva sin que nadie lo note. Únicos autorizados:
  `KcmPlataforma.bas` y `KcmDiagHash.bas`.
- **Ningún procedimiento con el nombre de su módulo.** VBA lo rechaza con
  "Name conflicts with existing module" y el proyecto entero deja de compilar.
- **`Exit Sub` en un `Sub` y `Exit Function` en una `Function`.** Salir con la
  palabra equivocada no compila, y es fácil de escribir al convertir uno en otro
  o al mover código entre procedimientos.
- **Un `.cls` conserva su encabezado `VERSION ... CLASS`.** Sin él, el editor lo
  importa como módulo normal y `New KcmDiccionario` deja de compilar.

Las cuatro se probaron introduciendo la violación a propósito y comprobando que
el linter la detecta.

**Las fuentes son ASCII puro y el linter lo exige.** `File > Import File`
interpreta el `.bas` con la página de códigos de Windows, no como UTF-8: una
vocal acentuada literal llegaría corrompida al módulo compilado. Los dos
caracteres que el código necesita se construyen con `ChrW$`: la eñe de la CURP
y la O acentuada de los nombres oficiales de curso.

## Frontera de despliegue vigente

El endpoint vive en la misma aplicación Node/Fastify y acepta únicamente las
ocho acciones del contrato: las cinco originales más `MATRIX_SCAN_V1`,
`ROSTER_SCAN_V1` y `SCAN_ORDERS_V1`, que son de sólo lectura. La plataforma emite una credencial por
instalación con alcance `PUENTE_VBA`; almacena sólo `scrypt(hash + salt)` y
revalida en cada llamada principal, perfil, equipo, alcance, recurso, caducidad
y revocación.

El secreto se muestra una sola vez y **no se guarda en el libro**: en Windows va
a la variable de usuario `KCM_VBA_BRIDGE_TOKEN` y en macOS al llavero del
sistema, con ese mismo nombre de servicio. Nunca se pega en el repositorio, en
una URL ni en un acta.

El servidor exige HTTPS en producción. Para la instalación:

- abrir `/excel` con una identidad administrativa autorizada y emitir la
  credencial del equipo;
- configurar `KCM_CONFIG.ENDPOINT` con
  `https://<FQDN>/api/v1/vba-bridge`;
- conservar el resto del contrato del cliente sin cambios.

El cliente habla directamente con la plataforma Node; no hay intermediario.

## Instalación en Excel

1. Crear un libro controlador vacío `KCM_Bridge.xlsm`; no insertar las macros
   dentro del XLSB maestro.
2. Importar desde el editor VBA los **quince** módulos del cliente que están en
   `clients/excel/vba/`: catorce `.bas` y el módulo de clase `KcmDiccionario.cls`, que se
   importa con el mismo `File > Import File`. `KcmDiagHash` no se importa en una
   instalación normal.
3. **Sólo en macOS**, instalar el guion del puente:

   ```bash
   bash clients/excel/mac/instalar-puente-mac.sh
   ```

   Copia `KcmPuente.applescript` a `~/Library/Application Scripts/com.microsoft.Excel/`,
   que es la única carpeta desde la que Excel puede invocarlo, y comprueba que
   estén las herramientas del sistema que el puente usa. Sin este paso el cliente
   **sigue funcionando** —cae solo a `popen` de `libSystem`—, pero entonces `curl`
   y `shasum` heredan la caja de arena de Excel; ver [Transporte](#transporte).
4. Compilar el proyecto (`Debug > Compile`) antes de ejecutar nada.
5. Ejecutar `KcmAutoprueba` y leer la hoja `KCM_ESTADO`: ocho etapas que
   comprueban entorno, reloj, identificadores, codificaciones, diccionario,
   huella, credencial y conexión sin escribir nada. Es lo que hay que devolver
   cuando un equipo no funciona.
6. Ejecutar `KcmAsistenteConexion`, que crea `KCM_CONFIG`, guarda la credencial,
   reconoce hoja y columnas leyendo el XLSB y termina verificando. Sustituye al
   paso manual de completar las siete claves a mano; ver
   [PUESTA_EN_MARCHA_TRES_EQUIPOS.md](../operacion/PUESTA_EN_MARCHA_TRES_EQUIPOS.md).
7. Ejecutar `KcmAbrirPanel` una vez: dibuja `KCM_PANEL` y deja a la vista lo
   que el asistente acaba de guardar. Es la hoja desde la que se opera de aquí
   en adelante.
8. Ejecutar por separado `KcmApplyPendingReleases` y `KcmTransmitirMatriz`
   sobre copias antes de habilitar `KcmRunFullCycle`.

### Actualizar un libro ya instalado

Los módulos son archivos de texto en el repositorio: cambiarlos aquí **no toca
ningún `.xlsm`**. Para llevar una versión nueva a un equipo que ya tiene el
cliente, en el editor VBA (`Alt+F11`):

1. Quitar el módulo viejo con el mismo nombre —clic derecho, `Remove`, y
   **`No`** cuando pregunte si exportarlo—. Importar sobre un módulo existente
   crea `KcmPanel1` y el proyecto deja de compilar por nombres duplicados.
2. `File > Import File` y elegir el `.bas`.
3. `Debug > Compile` y guardar el libro.

Con la entrega del 2026-08-19 el cliente **corre en los dos sistemas** y eso
cambia todos los módulos, así que la actualización es completa: quitar los que
haya y volver a importar los quince. Son nuevos `KcmPlataforma.bas`,
`KcmCodec.bas`, `KcmPruebas.bas` y `KcmDiccionario.cls`. Después, `KcmAbrirPanel`
una vez para redibujar la hoja —ahora trae el botón **Probar este equipo**—; es
idempotente y puede repetirse sin acumular botones.

**La credencial cambia de lugar en macOS.** En Windows sigue en las variables de
usuario; en macOS pasa al llavero del sistema. El asistente lo dice en pantalla y
la autoprueba informa dónde vive, de modo que nadie tenga que recordarlo.

Para una tarea programada puede copiarse
`excel/run-kcm-vba-cycle.vbs.example` fuera del repositorio y pasarle como
único argumento la ruta del controlador `.xlsm`. El argumento `True` ejecuta
el ciclo sin cuadros de diálogo.

## Configuración

`KCM_CONFIG` es la única coordenada del cliente. Se lee **una vez por
ejecución**: cada entrada pública llama `KcmResetCaches`, de modo que un cambio
entre dos ciclos surte efecto sin reabrir Excel y ningún bucle vuelve a
recorrer la hoja. Una clave repetida es ambigua y falla cerrado.

`EMPLOYEE_COLUMN` es la única columna que se declara. Los ocho atributos
laborales se leen por desplazamiento a su derecha, en el mismo orden que usa el
extractor Node: nombre, fecha de ingreso, nómina, puesto, departamento, área y
planta. Si esos ocho se traslapan con `FIRST_COURSE_COLUMN`, el snapshot falla
antes de leer.

`CLOSE_MASTER_AFTER_CYCLE` vale `TRUE` por omisión y sólo cierra la matriz
cuando fue el propio cliente quien la abrió. Una instalación anterior sin esa
clave conserva el mismo comportamiento.

Las rutas se escriben como las escribe cada sistema —`C:\\...` en Windows,
`/Users/...` en macOS— y el cliente no traduce entre ellas: un mismo `.xlsm`
copiado de un equipo a otro necesita que se le vuelvan a indicar. En macOS, la
primera vez que se usa una ruta nueva el sistema pide permiso para ese archivo;
concederlo una vez basta, y el asistente lo pide por adelantado para el `.xlsb`
que se elige en el cuadro de Abrir.

`ROSTER_PATH` es la ruta completa del `sem NN CAP.xlsx` de la semana en curso y
la usa **sólo** el barrido del padrón. Se instala vacía a propósito: cambia cada
semana y adivinarla mandaría un libro viejo. `SCAN_POLL_MINUTES` es el intervalo
de la vigilancia, opcional, cinco por omisión.

## Garantías de liberación

- La VBA procesa por `batchId` y hace preflight completo antes de escribir.
- Localiza al trabajador por nómina normalizada de cinco dígitos, con un índice
  en bloque por hoja y fila de encabezado.
- Verifica hoja, encabezado, columna, versión de mapeo y política declarada:
  `NO_OVERWRITE` o `OVERWRITE_WITH_HISTORY`. En el segundo caso persiste antes
  el valor anterior, actor y referencia del motivo en la hoja append-only
  `KCM_SOBRESCRITURAS`. El encabezado se compara **con conciencia de celdas
  combinadas** y recorriendo hacia arriba el mismo camino: una combinación
  vertical devolvía vacío y marcaba todo el lote como `HEADER_CONFLICT`.
- Una fórmula, un valor distinto, un error o un encabezado inesperado bloquean el
  lote. Una **nota** ya no: la celda se juzga por la fecha que contiene, no por
  lo que diga su comentario.
- Una hoja inexistente, una columna inválida o cualquier fallo imprevisto del
  preflight producen un acuse `ERROR` por fila en lugar de abortar el ciclo con
  un error de Excel sin explicación.
- El destino viaja como número de fila y de columna. La dirección textual queda
  sólo como dato de reporte: partirla por `!` rompía con un nombre de hoja que
  contuviera ese signo.
- Cada celda escrita recibe el marcador
  `KCM_VBA_V1|idempotencyKey|mappingVersion|completionDate`, y una celda con
  formato `General` recibe formato de fecha para no mostrar el número de serie.
- La nota que la celda ya tenía **se conserva**: el marcador se agrega debajo,
  en su propio renglón. Al volver a liberar esa celda se retira el marcador
  anterior y se escribe el nuevo, de modo que no se acumulan; el apunte humano
  sobrevive a todas las liberaciones.
- El modo de cálculo se restituye y el libro se recalcula **antes** de guardar:
  la matriz no queda archivada en cálculo manual para quien la abra después.
- Tras guardar, calcula SHA-256 del XLSB y sólo entonces envía `APPLIED` o
  `RECOVERED`. Desde ese punto el rollback queda desactivado: un fallo del acuse
  ya no puede borrar fechas guardadas y verificadas, porque la siguiente
  descarga vuelve a encontrar el lote y lo reporta como `RECOVERED`.
- Un corte después de escribir se recupera **por la fecha de la celda**; nunca se
  crea una segunda fecha ni se borra un valor preexistente. Antes se exigía además
  que la nota fuera idéntica al marcador, y eso convertía en conflicto un renglón
  ya aplicado al que alguien le había agregado una anotación.

## Sincronización hacia Sheets

La VBA lee `HC` mediante el modelo de objetos de Excel y transmite un
`HC_SNAPSHOT_V1` completo. El servidor reutiliza
`KcmOperationalHcService.importSnapshot`: valida hashes, catálogos, fechas,
duplicados y diagnósticos antes de reconstruir Sheets. Una instantánea nunca
escribe de vuelta al XLSB. El `requestId` deriva de la huella del libro, así que
retransmitir la misma matriz es un no-op del lado del servidor.

Toda la hoja se lee **en bloque**. Leer celda por celda costaba más de noventa
mil llamadas COM para 1,686 filas por 34 columnas.

Controles que hacen exacta la proyección:

- el bloque de datos se verifica libre de celdas combinadas con una sola
  consulta; una combinación desplazaría valores completos al leer el rango;
- `mergedCellCount` se calcula sobre la banda de encabezados en lugar de
  declararse cero;
- `sheetName` proviene de `MATRIX_SHEET`, no de un literal;
- **cualquier** celda de error del rango importado bloquea el snapshot y se
  nombra la primera por dirección. Contar sólo errores de fórmula dejaba pasar
  una constante de error escrita a mano, que se leería como celda vacía y
  perdería la fecha en silencio;
- un encabezado de capacitación después de `LAST_COURSE_COLUMN` bloquea el
  snapshot, igual que `COURSE_RANGE_TRUNCATED` en el extractor. Sin esa guarda,
  insertar una columna en medio del rango desplazaría el último curso fuera del
  límite y el servidor lo desactivaría en silencio;
- una identidad de curso mayor a 200 caracteres falla localmente con la columna
  responsable, en lugar de como `INVALID_IDENTIFIER` remoto.

## Barrido gobernado de la matriz

`MATRIX_IMPORT_V1` recibe y aplica en la misma petición. Con alcance `FULL` eso
significa que un ciclo retira las fechas que el maestro ya no trae **antes** de
que nadie haya visto cuáles: el panel las cuenta al final, cuando ya están
retiradas. Para el ciclo programado está bien —es exactamente lo que se le pide—
pero no sirve cuando alguien quiere mirar primero.

`MATRIX_SCAN_V1` parte ese acto en dos y **no escribe nada en el dominio**. El
cliente arma el mismo `HC_SNAPSHOT_V1`, byte por byte; el servidor lo confronta
contra SQL con el mismo motor de reconciliación que aplicaría la carga y guarda
una revisión. La escritura ocurre después, desde la pantalla **Barrido de
matriz** (`/matriz`), que exige sesión de consola.

La revisión contesta lo que hacía falta ver antes de aplicar:

- **qué columnas trae el libro**, con su letra, su nombre y cuántas fechas
  aporta cada una, y si cada una **coincide** con una capacitación de SQL, viene
  con **otro nombre** o es **nueva**;
- **cuántos trabajadores** trae, cuántos son nuevos y cuántos activos de la base
  ya no aparecen —que no se dan de baja: ausencia en un extracto no es baja—;
- **qué cambió** contra la matriz anterior: cambios de puesto, área y
  departamento, con número de nómina y valor antes y después;
- **qué fechas** se darían de alta, se corregirían, se retirarían o se
  reactivarían, y si alguna **contradice una sesión liberada**, en cuyo caso la
  revisión queda bloqueada y no puede aplicarse.

La clasificación de columnas sale de `resolveCourseMappings` y los conteos de
fechas de `reconcileSnapshot` —los dos del propio motor de importación—, así que
lo que la pantalla anuncia es lo que la aplicación hace y no una segunda
opinión que pueda diverger.

## Barrido gobernado del padrón semanal

La pantalla `/padron` ya partía el acto en dos desde su primera versión: subir el
archivo produce una revisión y sólo un botón la aplica. Lo que le faltaba era la
otra puerta —que el archivo llegue solo— y el detalle de **qué columnas trae el
libro**.

`ROSTER_SCAN_V1` es esa puerta. Y su diferencia con el barrido de matriz es
deliberada: **aquí viajan los bytes del XLSX**. La macro no abre el libro, no
busca encabezados y no interpreta una sola celda; lee el archivo, calcula su
huella y lo entrega. El servidor lo lee con `packages/dc3/roster-extractor.js`,
el mismo módulo que usan la subida manual y `tools/db/cargar-padron.js`.

El motivo es que no hay nada que ganar interpretándolo en Basic y sí una segunda
forma de equivocarse: las reglas de encabezados, CURP, fechas y desduplicación
entre hojas tendrían que existir dos veces, con el mismo problema de paridad que
la matriz sí tuvo que pagar. La matriz lo paga porque es un XLSB de decenas de
megas cuyos valores calculados sólo Excel entrega con fidelidad; el padrón es un
XLSX de medio mega.

El cuerpo es un JSON con `fileName`, `sha256` y `content` en base64, porque el
transporte del puente mueve texto UTF-8 en todas sus acciones y envolver el
archivo conserva esa invariante en lugar de abrirle una excepción binaria al
protocolo. La huella se compara contra la que calcula el servidor: es lo que
distingue «el libro cambió» de «el traslado lo corrompió», que desde el
extractor se ven igual.

La revisión enseña, además de lo que ya enseñaba:

- **las columnas detectadas hoja por hoja**, con el rótulo tal como está escrito
  en el libro y su letra —el archivo dice `FEC ALTA` donde la plataforma dice
  fecha de alta—, y el campo opcional ausente nombrado en lugar de en silencio;
- **quién cambió de puesto**, con número de nómina y valor antes y después, y si
  el puesto nuevo está en el catálogo. Antes era sólo una cuenta, y una cuenta no
  permite revisar ninguno.

`ROSTER_PATH` vuelve a `KCM_CONFIG` por esto. Se había retirado el 2026-08-01,
cuando la emisión DC-3 salió del cliente; ahora existe otra vez con otro motivo,
y `tests/unit/vba-client-contract.test.js` fija que sólo la conozcan el
instalador y el módulo de barrido.

## Las órdenes: una sola consulta para los dos barridos

`SCAN_ORDERS_V1` responde `matrixPending`, `matrixOrderId`, `rosterPending` y
`rosterOrderId`. Es la llamada que hace el vigilante en cada vuelta, así que es
la más frecuente del puente y la más barata: no toca la base más allá de la
credencial y el nonce. Preguntar por cada barrido en su propia acción habría
duplicado ese costo para siempre.

`MATRIX_SCAN_V1` y `ROSTER_SCAN_V1` sólo entregan carga; no tienen forma de
cuerpo vacío.

### Quién dispara los barridos

La plataforma **no puede abrir Excel**: el XLSB y el `sem NN CAP.xlsx` viven en
las PC del departamento y el puente siempre va de esas máquinas hacia el
servidor. Los botones de `/matriz` y `/padron` por tanto no ejecutan el barrido,
**lo encargan**, y la orden espera media hora. El cliente la recoge por
cualquiera de las dos vías:

- **A mano.** Los botones *Barrer matriz* (`KcmBarrerMatriz`) y *Barrer padrón*
  (`KcmBarrerPadron`) de `KCM_CONFIG` barren siempre, haya orden o no. El primero
  es lo que conviene pulsar en lugar de *Transmitir matriz* cuando alguien va a
  revisar lo que cambió; el segundo no tiene equivalente de «transmitir», porque
  no existe ninguna vía que aplique el padrón sin revisión.
- **Con vigilancia.** `KcmIniciarVigilancia` consulta cada `SCAN_POLL_MINUTES`
  minutos —cinco por omisión, piso de uno— con `Application.OnTime`, mientras
  Excel siga abierto. Es lo que hace que los botones de las pantallas se sientan
  inmediatos. Se detiene con `KcmDetenerVigilancia` o al cerrar Excel.

Si hay las dos órdenes se atienden las dos, y la matriz va primero a propósito:
un padrón cuyos números la matriz no conoce se queda fuera de la carga, así que
conviene que la matriz esté al día cuando el padrón se revise.

La vigilancia es **opcional a propósito**. Cada consulta cuesta la credencial,
el nonce y nada más, pero a cinco minutos son 288 llamadas al día contra un
presupuesto que se vigila; sin ella todo sigue funcionando y sólo cambia cuándo
aparece el resultado. Una instalación que no la active no necesita cambiar nada.

### Estado de la orden y de la revisión

Las dos viven en la memoria del proceso Node, no en la base, por la misma razón
que el plan del padrón semanal: persistir la revisión exigiría crear el lote de
importación, que es justamente lo que todavía no debe existir. Un reinicio del
servidor pierde ambas y obliga a barrer de nuevo, lo que cuesta una lectura de la
hoja y ninguna escritura. **Consecuencia declarada:** repartir tráfico entre
varios procesos Node exigiría bajarlas a la base antes; con un solo proceso
detrás del túnel —lo declarado hoy— no hace falta.

### Paridad de identidad

`sourceKey` decide el `trainingId`. Si el cliente derivara una identidad
distinta a la que produjo el extractor, HC daría de alta una capacitación nueva
y desactivaría la anterior; y `normalizedName` provocaría `CONFLICT` porque el
servidor lo recalcula.

El plegado de diacríticos ya no depende de `UCase$` ni de la configuración
regional de Windows: `KcmNormalizeLabel` recorre puntos de código y usa una
tabla que reproduce `toUpperCase()` seguido de NFD y descarte de marcas, la
regla exacta del servidor. `tests/unit/vba-hc-parity.test.js` reconstruye el
algoritmo desde el propio `.bas` y lo compara contra las dos implementaciones
reales, no contra una copia.

Una letra fuera de esa tabla —`Ø`, `Æ`, `Þ`, alfabetos no latinos, superíndices
o fracciones— **bloquea el snapshot** nombrando la celda y el punto de código,
en lugar de bifurcar la identidad en silencio. Los signos de puntuación y
símbolos que ambas reglas tratan como separador están enumerados por
intervalos, y la prueba verifica que ninguno de esos intervalos contenga un
carácter que el extractor convierta en letra o dígito.

## DC-3 retirada del cliente

El 2026-08-01 la emisión de constancias salió de este cliente y volvió al
generador Node, que ya la tenía resuelta de extremo a extremo. Se eliminó el
módulo `KcmDc3` completo y, con él, la lectura del padrón, el ledger
`KCM_DC3_LEDGER`, la copia de la plantilla oficial y la acción `DC3_REPORT_V1`
del lado del cliente.

El motivo no es de tamaño sino de unicidad: dos rutas de emisión sobre la misma
plantilla pueden producir dos constancias del mismo curso al mismo trabajador,
cada una con su propio folio, sin que ninguno de los dos ledgers vea a la otra.
La regla vigente —corte, cruce, metadatos legales y composición del PDF— es la de
[DC3_AUTOMATIZACION.md](DC3_AUTOMATIZACION.md).

Consecuencias para una instalación existente:

- `KCM_CONFIG` ya no necesita `ROSTER_ACTIVE_SHEET_1/2`, `CUTOFF_DATE`,
  `DC3_TEMPLATE_PATH`, `DC3_OUTPUT_PATH`, ni ninguna clave `DC3_*`. Las claves
  sobrantes son inertes: nadie las lee. **`ROSTER_PATH` sí volvió**, en
  2026-08-12 y por otro motivo: el barrido del padrón entrega ese archivo a la
  plataforma para revisión. Ni lo interpreta aquí ni emite nada con él.
- La hoja oculta `KCM_DC3_LEDGER` de una instalación anterior **no se borra**.
  Es evidencia de lo ya emitido y se conserva; el instalador simplemente dejó de
  crearla.
- `KcmRunFullCycle` tiene dos etapas: liberaciones y snapshot.
- El puente conserva `DC3_REPORT_V1` y la hoja `VBA_DC3_EVENTOS`.
  Ya nadie los invoca desde Excel; retirarlos es una decisión aparte, del lado
  del servidor, y no se tomó aquí.

## Transporte

**Lo que es igual en los dos sistemas** —y es casi todo—:

- Tres intentos con espera creciente ante fallo de red, HTTP 408, 429 o 5xx y
  ante un error del puente marcado como reintentable. El `requestId` se conserva
  para que el reintento sea un no-op; el nonce y `sentAt` se renuevan en cada
  intento porque el servidor rechaza un nonce repetido y una marca vencida.
- Codificación porcentual en tiempo lineal sobre un búfer de bytes preasignado.
  Concatenar byte por byte volvía cuadrático el costo y hacía inviable un cuerpo
  de varios megabytes. El base64 web-safe ya es no reservado, así que viaja sin
  recodificar.
- UTF-8, base64 y codificación porcentual son **VBA puro** (`KcmCodec`). Antes
  las hacían `ADODB.Stream` y `Msxml2.DOMDocument`, que no existen en macOS.
  Trabajan sobre los bytes UTF-16LE de la cadena, que VBA entrega con una sola
  copia de memoria: un recorrido de cinco millones de caracteres pasa así de
  minutos a un segundo. `tests/unit/vba-codec.test.js` transcribe esas rutinas a
  JavaScript instrucción por instrucción y las contrasta contra las de Node con
  cuatrocientas cadenas al azar, acentos y pares suplentes incluidos, porque el
  algoritmo sí se puede verificar aquí aunque el intérprete de VBA no exista.
- La ruta se valida con `GetAttr`, no con `Dir$`: `Dir$` omite los archivos
  ocultos y de sistema, comparte estado global con cualquier enumeración en
  curso y no distingue una carpeta de un archivo. Una ruta `https://` de
  OneDrive o SharePoint —la que devuelve `Workbook.FullName` cuando el libro
  vive sincronizado— se nombra como tal en lugar de reportarse como inexistente.
- El ledger local se escribe en un bloque y se guarda una vez. La versión
  anterior guardaba el libro controlador una vez por fila: quinientas
  liberaciones significaban quinientos guardados completos.

**Lo que cambia según el sistema**, todo dentro de `KcmPlataforma`:

| Función | Windows | macOS |
|---|---|---|
| Enviar el POST | `WinHttp.WinHttpRequest.5.1` | `curl` por `AppleScriptTask`, o por `popen` si el guion no está instalado |
| Huella SHA-256 | CNG (`bcrypt.dll`) y, de respaldo, CryptoAPI | `shasum -a 256` |
| Identificador | `CoCreateGuid` de `ole32` | 512 bytes de `/dev/urandom` repartidos de 32 en 32 |
| Fecha UTC | `GetSystemTime` de `kernel32` | hora local menos el desfase que informa `date +%z` |
| Credencial | variables de usuario (`HKCU`) | llavero del sistema, por `security` |
| Abrir el navegador | `FollowHyperlink` de Office | `open` |
| Acceso a un archivo | no aplica | `GrantAccessToMultipleFiles` |

**Por qué cada uno usa lo que usa.** En Windows se conserva WinHTTP a propósito:
las políticas corporativas bloquean con frecuencia que Office cree procesos hijo,
y ahí un `curl` por shell fallaría sin alternativa. Por lo mismo la huella se
calcula con la API criptográfica dentro del proceso de Excel y no lanzando
PowerShell. En macOS no existe ninguno de esos COM, y la vía que Microsoft dejó
abierta para salir de la caja de arena es `AppleScriptTask`.

**Las dos vías de macOS.** La principal es el guion instalado en
`~/Library/Application Scripts/com.microsoft.Excel/`, que corre **fuera** de la
caja de arena: `curl` alcanza la red y `shasum` puede leer una matriz guardada en
cualquier carpeta. Si el guion no está, se recurre a `popen` de `libSystem`, que
no exige instalar nada pero hereda la caja de arena; ahí la huella de un archivo
que viva fuera del contenedor se calcula sobre una copia dentro de él, que tiene
el mismo digest y se borra enseguida. La autoprueba dice cuál de las dos está en
uso.

**Ninguna de las dos arma una línea de shell concatenando texto.** El cliente
entrega un vector de argumentos separados por tabulador; el guion entrecomilla
cada uno con `quoted form of` y la vía de respaldo con comillas simples. Una ruta
con espacios, un endpoint pegado en `KCM_CONFIG` o un nombre de archivo con
punto y coma son datos, nunca sintaxis.

**El cuerpo viaja por archivo.** El snapshot de la matriz pesa megabytes y no
cabe en una línea de comandos: `curl` lo lee con `--data-binary` de un temporal y
escribe la respuesta en otro. Los dos viven en el temporal del contenedor de
Excel, que las dos vías saben leer, y se borran al terminar incluso cuando el
envío falla.

**Diagnóstico de Windows.** El fallo de un proveedor criptográfico se lee con
`Err.LastDllError`; `GetLastError` declarado no sirve en VBA, porque el motor
puede invocar APIs propias entre la llamada fallida y la lectura y devolver un
código que no corresponde al fallo.

## La autoprueba del libro

Este cliente se construye y se prueba en una Mac, y **probarlo ahí no demuestra
nada sobre la rama de Windows**: el compilador de cada sistema compila sólo la
suya. El análisis estático cubre lo que se puede saber leyendo el texto de las
dos ramas; lo que no puede saber es si un método de WinHTTP existe, si la
política del equipo permite macros o si hay un proxy interceptando TLS.

`KcmAutoprueba` cierra esa distancia de la única forma disponible: alguien del
departamento la ejecuta una vez en su equipo y devuelve el resultado. Está en el
botón **Probar este equipo** de `KCM_PANEL` y de `KCM_CONFIG`, y escribe ocho
renglones en `KCM_ESTADO`, que se selecciona y se copia de un toque:

| Etapa | Qué comprueba |
|---|---|
| 1. Entorno | sistema, versión de Excel, arquitectura del intérprete y vía de transporte en uso |
| 2. Reloj UTC | la marca de tiempo y a cuántas horas va la hora local. El servidor rechaza una petición fechada a más de cinco minutos, y ese rechazo llega disfrazado de credencial vencida |
| 3. Identificadores | tres sorteos distintos y bien formados |
| 4. Codificaciones | UTF-8, base64 web-safe y codificación porcentual contra sus valores conocidos, con acentos incluidos |
| 5. Diccionario | que distinga mayúsculas, reescriba y conserve el orden de inserción |
| 6. Huella y lectura | SHA-256 y lectura binaria de un archivo escrito ahí mismo, cuyo digest es público |
| 7. Credencial | si está y cuántos caracteres mide. Nunca su valor |
| 8. Conexión | `STATUS_V1` contra el servidor, que es de sólo lectura |

Ninguna etapa escribe en la base ni transmite nada salvo esa última consulta. Si
falta endpoint o credencial, las etapas correspondientes quedan en **AVISO** en
lugar de fallar.

## Diagnóstico de la huella SHA-256

Un fallo de `KcmFileSha256` tiene dos causas que no se parecen —que el sistema no
entregue SHA-256, o que el archivo no se pueda leer— y el mensaje de error las
resume en una sola línea. `KcmDiagHash` las separa. Es el segundo escalón después
de la autoprueba, para cuando la etapa 6 falla y hace falta saber por qué:

1. Importar `clients/excel/vba/KcmDiagHash.bas` y compilar.
2. En la ventana Inmediato, **sin signo de interrogación**:
   `KcmDiagSha256 "C:\ruta\completa\Matriz.xlsb"`.
3. Leer las tres etapas que imprime y quitar el módulo del proyecto.

La primera etapa calcula la huella de la cadena `abc`, cuyo valor es público y
fijo: si coincide, lo que resuelve la huella en ese equipo está sano y el
problema es de acceso al archivo. En Windows recorre la cadena de proveedores
criptográficos e informa el código real de cada fallo; en macOS informa por qué
vía se ejecuta y avisa si el guion no está instalado. La segunda examina la ruta
comprobación por comprobación —dirección web, atributos, `Dir$`, `Open`— en lugar
de resumirlas. La tercera repite la llamada real y muestra número y descripción
completos.

Aun así conviene comprobar la huella antes del primer
`KcmApplyPendingReleases` real: sin ella el lote se aplica y se guarda, pero el
acuse no puede enviarse y la liberación queda pendiente hasta la siguiente
descarga, que la reconoce como `RECOVERED`.

## Ruta de conexión

Revisión milimétrica del 2026-08-03, con el esquema ya aplicado en Supabase. El
contrato está completo de los dos lados; lo que faltaba era **dónde persiste el
servidor lo que el puente mueve**. La migración `0025` lo cerró:

- `kcm.credencial_equipo` no tenía `client_id`, `recurso` ni la sal del scrypt.
  El servidor autentica por `(clientId, alcance, recurso)`, así que ninguna
  credencial emitida podía volver a encontrarse; además `algoritmo` declaraba
  argon2id cuando el servicio deriva con scrypt. Un CHECK fija ahora que el
  alcance `PUENTE_VBA` sólo existe con el recurso `bridge`.
- `useNonce` no tenía tabla. `kcm.nonce_puente` hace del "un solo uso" una llave
  primaria y no una promesa del proceso.
- `acuse_liberacion_vba.sha256_xlsb` era obligatorio, de modo que un acuse de
  conflicto —`HEADER_MISMATCH`, `EXISTING_VALUE`, `DESTINATION_MISSING`— no podía
  registrarse: justo el caso que hay que revisar. Ahora se exige sólo en
  `APPLIED` y `RECOVERED`, con un índice único que impide dos acuses efectivos
  de la misma clave idempotente, y una columna `detalle` conserva el conflicto.
- `MATRIX_IMPORT_V1` conserva el snapshot entre vista previa y aprobación:
  `kcm.snapshot_importacion`.
- `STATUS_V1` lee eventos DC-3 del puente y la tabla no existía:
  `kcm.evento_dc3_vba`, append-only. El cliente ya no la alimenta; se conserva
  para no romper la lectura y para lo que reportara una instalación anterior.
- `RELEASE_PULL_V1` se resuelve con
  `kcm_lectura.obtener_liberaciones_pendientes(limite)`: liberaciones efectivas
  sin acuse aplicado, unidas al mapeo vigente y al destino activo, con las doce
  columnas del TSV en su orden. Una liberación sin mapeo activo **no se
  entrega**: escribir a un destino no declarado sigue prohibido.

Dos defectos del lado Node se corrigieron en la misma revisión: el puente
marcaba `retryable=false` en todo error, incluidos los internos y transitorios
—el cliente abandonaba un ciclo que un reintento habría completado—, y el
repositorio en memoria purgaba nonces con la hora del sistema en lugar del reloj
inyectado, de modo que el rechazo de replay se apagaba según la hora del día.

### Lo que todavía bloquea la persistencia

`plataforma/src/main.ts` construye el servidor sin repositorios, así que hoy **todo el
puente corre en memoria**: existen `SupabaseKioskSessionRepository`,
`SupabaseMatrixRepository`, `SupabasePreReleaseRepository` y
`SupabaseWorkerSystemRepository`, pero nadie los cablea, no hay `SqlExecutor`
instanciado, no hay variables `KCM_DATABASE_*` en `loadConfig` y no existe un
`SupabaseExcelRepository`. Consecuencia exacta: la credencial emitida en
`/excel` desaparece al reiniciar el proceso y ningún acuse llega a
`kcm.acuse_liberacion_vba`.

Eso no impide la **prueba de humo** del puente —el ciclo completo funciona en
memoria— pero sí impide declararlo operativo.

### Orden de conexión

**Fase 1 — humo, con el servidor en memoria.**

1. Levantar la plataforma: `npm run app:start` (o `node plataforma/src/main.ts`) con
   `KCM_ENV=development`. En producción el servidor exige HTTPS y `KCM_HOST`
   debe ser loopback: se publica por túnel nombrado.
2. Abrir `/excel` y emitir la credencial con estos valores exactos: `Client ID`
   idéntico al `CLIENT_ID` de la hoja `KCM_CONFIG` —por omisión
   `KCM-OFFICE-01`—, `Alcance` `PUENTE_VBA`, `Recurso` **`bridge`** (cualquier
   otro valor autentica siempre en falso), y una caducidad futura. El secreto
   se devuelve una sola vez, en la respuesta JSON del formulario.
3. En el equipo Windows, guardar ese secreto como variable de usuario
   `KCM_VBA_BRIDGE_TOKEN` (`setx KCM_VBA_BRIDGE_TOKEN "<secreto>"`) y **reabrir
   Excel**: el proceso lee el entorno al arrancar.
4. Crear `KCM_Bridge.xlsm` vacío, importar los quince módulos de `clients/excel/vba/`
   —`KcmBridgeCore`, `KcmBridgeHttp`, `KcmReleaseSync`, `KcmMatrixSync`,
   `KcmCoordinator`, `KcmConfigButtons`, `KcmPanel`, `KcmMatrixPanel`,
   `KcmPadronSync`, `KcmOrdenBarrido`, `KcmAsistente`; `KcmDiagHash` no— y
   `Debug > Compile`
   antes de ejecutar nada.
5. `KcmInstallBridge`, y completar en `KCM_CONFIG`: `ENDPOINT` con el valor que
   muestra `/excel`, `CLIENT_ID`, `MATRIX_PATH` a una **copia** del XLSB,
   `MATRIX_SHEET`, `EMPLOYEE_COLUMN`, `FIRST_COURSE_COLUMN` y
   `LAST_COURSE_COLUMN`. El cliente exige `https://` con una sola excepción:
   `http://127.0.0.1` y `http://localhost`, donde el tráfico no sale de la
   máquina. Un nombre de equipo o una IP de la red local en claro se rechazan,
   porque el token viaja en el cuerpo del POST.
6. Comprobar la huella antes del primer lote real:
   `KcmDiagSha256 "C:\ruta\Matriz.xlsb"` desde la ventana Inmediato con
   `KcmDiagHash` importado temporalmente. Sin huella el lote se aplica pero el
   acuse no puede enviarse.
7. Ejecutar `KcmApplyPendingReleases` y `KcmTransmitMatrixSnapshot` por
   separado, sobre copias, antes de habilitar `KcmRunFullCycle`.

**Fase 2 — persistencia real.** Requiere, en este orden: un `SqlExecutor` sobre
`pg` contra el proyecto Supabase; `KCM_DATABASE_URL` en `loadConfig`; un
`SupabaseExcelRepository` que implemente los trece métodos de `ExcelRepository`
contra las tablas de `0025` y la función de pull; y el cableado en `main.ts` que
hoy no existe. Sólo entonces la credencial sobrevive a un reinicio y el acuse
queda en el ledger.

**Fase 3 — datos.** El pull sólo entrega liberaciones con mapeo vigente, así que
antes de que el ciclo mueva algo hay que declarar el destino en
`kcm.destino_matriz` y una fila por curso en `kcm.mapeo_matriz` con hoja,
columna, encabezado esperado, fila de encabezado y política. Sin eso el puente
responde correctamente con cero pendientes.

## Límites pendientes

- No hay Excel para Windows en este entorno. El análisis estático no sustituye
  a `Debug > Compile` ni a una corrida contra COM. No se declara piloto
  verificado.
- No se modificó ningún original XLSB/XLSX y las pruebas no usaron datos reales.
- El `requestId` del acuse de liberación sigue siendo aleatorio de forma
  deliberada. Uno estable haría que un conflicto resuelto por una persona, y
  después aplicado con éxito, colisionara para siempre con el `ackId` del intento
  anterior. El servidor ya impide dos acuses efectivos distintos; el costo es que
  un reintento de un acuse de conflicto agrega una fila de historial.
- El libro `.xlsm` todavía debe crearse y desplegarse en el equipo autorizado.
- El puente conserva `DC3_REPORT_V1` y `VBA_DC3_EVENTOS` sin cliente que los
  invoque. Retirarlos del servidor es una decisión pendiente y aparte.
