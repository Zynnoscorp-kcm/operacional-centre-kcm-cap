# La voz de la plataforma

Cómo se escribe lo que se lee en pantalla: la consola, los avisos del libro de
Excel y los mensajes de error. No es una guía de estilo general; son las cuatro
reglas que ya estaban aplicadas y que `plataforma/tests/estilo/voz.test.ts`
vigila en lo que se puede vigilar.

El modelo es la pantalla de apagado. Dice: **«¿Apagar el servidor local?»**,
debajo **«Excel dejará de poder mandar el barrido de la matriz y el padrón»**,
y dos botones. Eso es todo lo que hace falta antes de pulsar.

---

## 1. Se dice lo que pasa, no lo que hay que hacer

La plataforma la usan varias personas del departamento, no una. Un texto que
habla de tú a tú —«pulse aquí», «vaya a esa computadora», «si no la tiene a mano,
deje esto vacío»— se lee como una nota escrita para quien estaba delante ese día:
el que la lee no es el que la recibió y nadie sabe si sigue valiendo.

| En vez de | Se escribe |
|---|---|
| «Pulse **Revisar** en el paso 1 para enumerar a los trabajadores» | «**Revisar**, en el paso 1, enumera a los trabajadores» |
| «Vaya a esa computadora, abra el navegador y suba ahí el archivo» | «En esa máquina la dirección es `http://localhost:8787/padron`» |
| «Guarde la revisión antes de pasarla a liberación» | «La revisión tiene que guardarse antes de pasarla a liberación» |
| «Copie la credencial ahora; no vuelve a mostrarse» | «La credencial se muestra aquí una sola vez» |

Cuando hay que nombrar una acción, se nombra **el control** y no a quien lo
pulsa: «El mismo botón devuelve el orden alfabético».

## 2. Una sola cosa, y la que decide

Lo que hay que saber antes de actuar cabe en un renglón. Lo que hay que hacer
después se dice después, cuando sirve de algo: la pantalla de apagado no explica
cómo encender hasta que ya está apagada.

Un párrafo de tres líneas donde bastaba una no es más completo, es más lento de
leer, y en una pantalla de planta, de pie y con prisa, no se lee entero.

## 3. Nada de ceremonias

Sin «¿Desea continuar?» debajo de un cuadro que ya tiene Sí y No. Sin
exclamaciones. Sin «no se preocupe». Sin «recuerde que». Un diálogo lleva
pregunta corta en el título, una línea de consecuencia y dos botones con el
verbo de lo que hacen: **Sí, apagar** / **No**, **Sí, emitir y descargar** /
**No, cancelar**.

## 4. Las palabras del trabajo, no las del programa

Quien lee tiene una matriz, un padrón, un libro y una sesión. No tiene
*snapshots*, ni *caches*, ni *subpaneles*. Esa regla estaba ya escrita en
`KcmAvisos.bas`, que es el único sitio del libro donde se abre un cuadro de
diálogo, junto con las otras cuatro que le dan forma a un aviso: título siempre,
desenlace en la primera línea, detalle aparte y plurales resueltos —«cuatro
liberaciones», nunca «4 liberacion(es)»—.

En los errores va primero lo que **no** ocurrió y sólo después la causa técnica,
rotulada y en su renglón.

---

## Las dos excepciones

**El quiosco de sala** (`quiosco.ts`, `quiosco.js`) sí habla con una persona
concreta que está de pie frente a la pantalla registrando su asistencia. Ahí
«escriba los cinco dígitos del número de trabajador» es exactamente lo que tiene
que decir, y la prueba lo deja fuera por escrito.

**Los manuales de `docs/operacion/`** están escritos para leerse delante de la
pantalla mientras se hace una tarea, y ahí el trato directo es lo que los hace
utilizables: «Siéntese en la computadora del departamento» es una instrucción a
una persona, no un texto de interfaz. Son documentos, no pantallas.
