# Protocolo: la plataforma en internet y la computadora del departamento

Este documento está escrito para **usarse delante de la pantalla**, sin saber
nada de servidores ni de programación. Si algo no coincide con lo que ve,
**deténgase y pregunte**. Ningún paso de aquí borra información.

---

## 1. La idea, en una frase

La plataforma vive **en internet**, y desde cualquier computadora se hace todo
el trabajo, incluidos el barrido diario de la matriz y el padrón semanal. Un
archivo grande sale de Excel en partes, solo: no hay nada que encender ni
instalar en ninguna computadora.

---

## 2. Cómo saber dónde está parado

Arriba a la derecha de cada pantalla hay una etiqueta:

| Lo que dice la etiqueta | Dónde está |
|---|---|
| **En la nube** | En internet, desde cualquier equipo |
| **Equipo del departamento** | En la computadora de capacitación, encendida a mano |

---

## 3. El trabajo de todos los días

Todo se hace **desde cualquier computadora**, en la dirección publicada:

| Tarea | Cada cuándo |
|---|---|
| Quiosco, agenda de salas, sesiones, preliberación y liberación | Todos los días |
| Actualizaciones de fechas desde Excel | Varias veces al día |
| Barrido completo de la matriz | Una vez al día, en la mañana |
| Padrón semanal (`sem NN CAP.xlsx`) | Una vez a la semana, el lunes |
| Constancias DC-3 | Cuando se necesiten |

### La rutina de la mañana (barrido de la matriz)

1. Abra Excel con el libro puente, como siempre.
2. **Actualización completa**.
3. Abra la plataforma en **Matriz**, revise lo que cambiaría y pulse
   **Aplicar**. Puede hacerlo desde otra computadora: la revisión espera en la
   base de datos durante treinta minutos.

### La rutina del lunes (padrón)

1. Abra la plataforma en **Padrón**.
2. Suba el archivo `sem NN CAP.xlsx`.
3. Revise lo que cambiaría y pulse **Aplicar**.

---

## 4. Archivos grandes: envío en partes

Cada envío por internet cabe en unos **3 MB**. Hoy el barrido completo pesa unos
2 MB y el padrón menos de 1 MB, así que salen enteros. Si un día un archivo pasa
de ese tamaño, **Excel lo parte solo** y manda las partes una tras otra; la
plataforma las junta y lo procesa completo. No hay botón nuevo ni nada que
encender: se usan los mismos **Actualización completa**, **Barrer para
revisión** y **Padrón de la semana**.

Al terminar, Excel avisa cómo salió el envío:

- **«envío normal»**: salió en una sola pieza.
- **«envío en 3 partes»** (o las que hayan sido): salió partido y llegó completo.

Lo mismo queda escrito en la hoja de estado del libro. Cada parte se reintenta
sola; si aun así una no llega, Excel lo dice y basta pulsar el mismo botón otra
vez. Nunca queda nada a medias ni se duplica.

## Direcciones

| Uso | Dirección |
|---|---|
| Consola | `https://kcm-cap.vercel.app` |
| Quiosco de sala | `https://kcm-quiosco.vercel.app` |
| Agenda pública | `https://kcm-agenda.vercel.app` |

El quiosco y la agenda sólo muestran su pantalla: desde ellos no se llega a la
consola.

---

## 5. Mensajes que puede ver, y qué significan

| Lo que dice la pantalla | Qué significa | Qué hacer |
|---|---|---|
| «supera los 4 MB que acepta la plataforma publicada desde el navegador» | El padrón es demasiado grande para subirlo en la página | Mandarlo desde Excel con **Padrón de la semana**, que lo parte solo |
| «La plataforma no recibió todas las partes del envío» (en Excel) | Se cortó la conexión a la mitad | Repetir el mismo botón; no se duplica nada |
| «La revisión ya no está disponible» | Pasaron más de treinta minutos, o alguien ya la aplicó o descartó | Vuelva a barrer o a subir el archivo |

Ninguno de estos mensajes es un error del sistema ni deja nada a medias.

---

## 6. Lo que **no** cambió

- Sigue habiendo **un solo escritor** de la matriz; ver
  [`PUESTA_EN_MARCHA_TRES_EQUIPOS.md`](PUESTA_EN_MARCHA_TRES_EQUIPOS.md).
- Los datos viven en un solo lugar: internet y la computadora del departamento
  escriben en la misma base, así que nunca verá dos versiones distintas.
