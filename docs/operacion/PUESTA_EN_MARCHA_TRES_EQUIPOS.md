# Puesta en marcha: tres equipos, un solo escritor

Este documento se escribió para que la instalación pueda hacerla **una persona
sola, en la oficina, sin experiencia previa en Excel ni en VBA**, mientras quien
conoce el sistema acompaña por mensaje desde fuera. No supone conocimientos de
macros, ni de rutas de red, ni de variables de entorno.

Si algo no coincide con lo que ve en pantalla, **deténgase y pregunte**. Nada de
lo que hay aquí tiene prisa, y ningún paso de este documento borra información.

---

## 1. Qué va a quedar montado

Tres computadoras usan la plataforma. **Sólo una escribe en la matriz.**

| | Los tres equipos | El equipo de escritura |
|---|---|---|
| Navegador contra la plataforma | sí | sí |
| Revisar, preliberar, dejar sesiones listas | sí | sí |
| Excel con el libro puente | no | sí |
| Credencial `PUENTE_VBA` | no | **sí, una sola en toda la instalación** |
| Escribe fechas en la matriz | no | sí |

La regla de un solo escritor no es una recomendación: **es la credencial la que
la sostiene**. Un equipo sin credencial del puente no puede escribir en la
matriz aunque tenga Excel y el archivo delante, porque el servidor rechaza la
llamada. Mientras exista una sola credencial con alcance `PUENTE_VBA`, hay un
solo escritor posible.

Por eso el orden importa: la credencial se emite **una vez**, para **un equipo**,
y no se reparte. Si alguna vez hay que cambiar de máquina, se revoca la anterior
y se emite otra; nunca dos a la vez.

---

## 2. Antes de empezar (esto se prepara desde fuera de la oficina)

Quien acompaña remotamente deja listo:

1. **La plataforma publicada y despierta.** Está en un plan gratuito que duerme
   el servicio cuando nadie lo usa: la primera pantalla del día puede tardar
   cerca de un minuto en abrir. No es una falla; es el arranque.
2. **Una cuenta de consola** para cada persona que vaya a usar la plataforma.
   Se dan de alta con `tools/db/alta-cuenta-consola.js`; la plataforma verifica
   cuentas pero no las crea.
3. **La carpeta `excel/` completa** enviada a la laptop de escritura, en un
   lugar fácil de encontrar, por ejemplo `Escritorio\KCM`. Son los quince
   módulos de `clients/excel/vba/` —catorce `.bas` y el módulo de clase
   `KcmDiccionario.cls`— y, si la laptop es una Mac, también `clients/excel/mac/`, cuyo
   instalador de un paso hay que ejecutar una vez.
4. **Una copia del XLSB de la matriz**, no el original. La primera conexión se
   hace siempre contra una copia.

Lo único que **no** se prepara por adelantado es la credencial: se emite durante
la instalación, porque el secreto se muestra una sola vez y no debe viajar por
mensajería.

---

## 3. En el equipo de escritura, paso a paso

### Paso 1 — Abrir la plataforma y comprobar que entra

Abra el navegador y entre a la plataforma con la cuenta que le dieron. Si tarda,
espere: es el arranque del punto anterior.

### Paso 2 — Emitir la credencial de este equipo

Vaya a la pantalla **`/excel`**. En «Emitir credencial por equipo» llene:

- **Client ID**: `KCM-OFFICE-01` (déjelo tal cual salvo que le indiquen otro).
- **Principal**: el usuario de la persona responsable.
- **Perfil Windows**: el nombre de usuario de Windows de esta laptop. Si no lo
  sabe, aparece al abrir el Explorador en `C:\Usuarios\`.
- **Equipo**: el nombre de la laptop.
- **Alcance**: `PUENTE_VBA`.
- **Recurso**: `bridge`, exactamente así. **Cualquier otro valor autentica
  siempre en falso** y la conexión fallará sin decir por qué.
- **Sin vencimiento** marcado, o una fecha futura si prefiere que caduque.

Pulse **Emitir**. La respuesta trae la credencial **una sola vez**. Déjela en
pantalla; la va a pegar en el paso 5 y después ya no podrá recuperarla.

> Si responde «Ya existe una credencial activa para este Client ID, alcance y
> recurso», es que este equipo ya fue conectado antes. No emita otra: o usa la
> que ya está guardada en la laptop, o revoca la anterior y emite una nueva.

Anote también, del mismo `/excel`, el renglón **«Endpoint VBA»**. Es una
dirección que termina en `/api/v1/vba-bridge`.

### Paso 3 — Crear el libro puente

Abra Excel y cree un libro nuevo. Guárdelo **en el escritorio** como
`KCM_Bridge.xlsm`, eligiendo el tipo **«Libro de Excel habilitado para macros
(*.xlsm)»**. Si lo guarda como `.xlsx` las macros se pierden al cerrar.

Las macros deben quedar habilitadas: si aparece una barra amarilla que dice
«ADVERTENCIA DE SEGURIDAD», pulse **Habilitar contenido**.

### Paso 4 — Importar los módulos

Con el libro abierto, pulse `Alt` + `F11`. Se abre el editor de VBA.

En el menú **Archivo → Importar archivo**, vaya a la carpeta donde están los
`.bas` e importe **ocho** de los nueve archivos, uno por uno:

`KcmBridgeCore`, `KcmBridgeHttp`, `KcmReleaseSync`, `KcmMatrixSync`,
`KcmCoordinator`, `KcmConfigButtons`, `KcmMatrixPanel` y `KcmAsistente`.

**`KcmDiagHash` no se importa**: es una herramienta de diagnóstico y sólo se usa
si alguien se lo pide expresamente.

Después, en el menú **Depuración → Compilar VBAProject**. Si no dice nada, está
bien: en VBA el silencio es el resultado correcto. Si aparece un error, tome una
captura y envíela antes de seguir.

Vuelva a Excel con `Alt` + `F11`.

### Paso 5 — Ejecutar el asistente

Pulse `Alt` + `F8`, elija **`KcmAsistenteConexion`** y pulse **Ejecutar**.

El asistente le pide cuatro cosas y averigua el resto solo:

1. **La dirección del servidor**: pegue el «Endpoint VBA» del paso 2.
2. **El Client ID**: el mismo del paso 2.
3. **La credencial**: péguela del paso 2. Se guarda como variable de usuario de
   Windows, no dentro del libro, y queda disponible en el acto — **no hace falta
   cerrar ni reabrir Excel**. Mientras la pega queda a la vista en pantalla:
   hágalo sin nadie detrás.
4. **El archivo de la matriz**: se abre un cuadro de «Abrir». Elija la **copia**
   del XLSB.

Enseguida el asistente lee la matriz y le muestra lo que reconoció: la hoja, la
columna del número de trabajador y el rango de columnas de cursos. Si le parece
correcto, acepte.

### Paso 6 — Leer el resultado

Al terminar, el asistente ejecuta la verificación y aparece una hoja nueva
llamada **`KCM_ESTADO`** con cinco renglones:

1. Configuración
2. Credencial
3. Archivo maestro
4. Forma de la hoja
5. Conexión

**Si los cinco dicen `CORRECTO`, el equipo está listo.** Tome una captura de esa
hoja y envíela: es la evidencia de la instalación.

Esta verificación **no escribe nada** en la base de datos. Puede repetirla
cuantas veces quiera mientras corrige algo, con el botón **Verificar matriz** que
quedó en la hoja `KCM_CONFIG`.

---

## 4. Si una etapa no dice CORRECTO

La hoja `KCM_ESTADO` nombra la etapa exacta. Búsquela aquí.

**1. Configuración — «Faltan claves».** El asistente se interrumpió antes de
terminar. Vuelva a ejecutar `KcmAsistenteConexion` desde el principio.

**2. Credencial — «No existe la variable de usuario».** La credencial no se
guardó. Vuelva a ejecutar el asistente y péguela cuando la pida. Si ya no la
tiene, hay que revocar la anterior en `/excel` y emitir otra.

**3. Archivo maestro — «dirección web de OneDrive o SharePoint».** La matriz
está en la nube y no en el disco. Sincronícela para que exista como archivo
local y vuelva a elegirla.

**3. Archivo maestro — «cambios sin guardar».** Alguien tiene la matriz abierta
y modificada. Guárdela y repita.

**4. Forma de la hoja — cualquier mensaje.** Aquí el detalle nombra la celda
exacta: una celda combinada, una celda con error, un número de trabajador
repetido o una fecha ilegible. **No lo corrija por su cuenta**: es la matriz de
producción; envíe el texto completo a quien la administra.

**4. Forma de la hoja — «viene prácticamente vacío».** El libro se leyó sin
error pero casi no trae datos. Casi siempre es un **filtro puesto** en la hoja o
un rango de cursos recortado. Quite el filtro y repita. **Este aviso importa
mucho**: transmitir así retiraría de la base las fechas que el archivo no trae.

**5. Conexión — «debe usar HTTPS».** La dirección se pegó incompleta. Cópiela de
nuevo de `/excel`.

**5. Conexión — la credencial no valida.** Revise que el **Client ID** del paso 2
y el del asistente sean idénticos, y que **Recurso** fuera exactamente `bridge`.

**5. Conexión — no responde.** Puede ser el arranque del servicio. Espere un
minuto y repita antes de suponer otra cosa.

---

## 5. La primera transmisión

Sólo cuando las cinco etapas digan `CORRECTO`, y todavía **contra la copia**:

Pulse el botón **Transmitir matriz** en la hoja `KCM_CONFIG`. Se repiten las
cinco comprobaciones y se agrega una sexta con el resultado: altas, fechas
corregidas, retiradas y reactivadas.

Preste atención a **retiradas**. Si el número no es cero, el panel lo dice
aparte y en ámbar. Un barrido completo retira de la base lo que el archivo ya no
trae, así que un número alto de retiros casi siempre significa que el archivo
estaba incompleto, no que hubiera que borrar nada. **Ante un retiro inesperado,
avise antes de repetir.**

Cuando la corrida contra la copia sea correcta, se repite el asistente eligiendo
esta vez el archivo definitivo.

---

## 6. La matriz compartida

Una vez conectado el equipo de escritura, la matriz se publica para que los
demás la consulten. Hay dos formas y **no son equivalentes**.

**Lo recomendable: que los otros dos equipos no abran la matriz.** La plataforma
ya expone los datos de HC como una réplica consultable, y para Excel existe una
salida de sólo lectura por Power Query en
`/api/excel/power-query/workers.csv`, con su propia credencial de alcance
`POWER_QUERY_LECTURA`. Quien sólo necesita consultar no necesita el archivo.

**Si aun así se comparte el XLSB en una carpeta de red**, entonces:

- El archivo compartido debe ser **una copia publicada**, no el maestro sobre el
  que escribe la VBA.
- Los demás lo abren **en sólo lectura**. Si alguien lo tiene abierto con
  permiso de escritura, la liberación del equipo escritor falla, porque necesita
  abrirlo para escribir.
- La copia publicada se regenera después de cada liberación, no antes.

El motivo es simple: dos personas escribiendo el mismo XLSB en una carpeta
compartida no producen un conflicto visible, producen **la última en guardar
gana**, y lo que se pierde son fechas de capacitación que ya nadie sabe que
existieron.

---

## 7. Antes de dar por buena la instalación

- Las cinco etapas en `CORRECTO`, con captura.
- Una transmisión completa contra copia, con el número de retiros entendido.
- En `/excel`, **una sola** credencial activa con alcance `PUENTE_VBA` en toda
  la instalación.
- Los otros dos equipos entran a la plataforma con su cuenta y **no** tienen el
  libro puente instalado.
- El libro `KCM_Bridge.xlsm` guardado, y la credencial **no** anotada dentro de
  él, ni en documentos, ni en capturas de pantalla.

---

## 8. Lo que queda pendiente de decisión

Dos cosas quedan abiertas a propósito, y las decide quien administra la
instalación, no quien la monta:

**El barrido se aplica sin revisión.** Hoy, cuando la VBA transmite, el servidor
lo aplica en la misma llamada. El panel muestra con detalle lo que ocurrió y
avisa de los retiros, pero no es una previa: cuando lo lee, ya está escrito. La
alternativa —que el puente se detenga y alguien apruebe desde la consola, o que
se detenga sólo cuando habría retiros— está descrita en el análisis del puente y
no se ha implementado porque cambia la operación diaria.

**La migración a servidores internos.** Ver
[MIGRACION_SERVIDORES_INTERNOS.md](MIGRACION_SERVIDORES_INTERNOS.md). Nada de lo
que se instala aquí la estorba: si la plataforma cambia de dirección, lo único
que hay que hacer en cada equipo es volver a ejecutar el asistente con el
endpoint nuevo.
