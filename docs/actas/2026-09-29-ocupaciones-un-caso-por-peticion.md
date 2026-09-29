# Acta · Ocupaciones: un caso por petición y un solo modelo

**29 de septiembre de 2026.** Rama `main`, subido a GitHub.

## La barra se quedaba en «Caso 2 de 15»

El registro de Vercel de las 00:29 (hora de México) dice por qué:
`POST /api/ocupaciones/clasificar` terminó con «Task timed out after 120
seconds». La clasificación viajaba en una sola petición que mandaba el avance
por Server-Sent Events; quince casos de cerca de medio minuto no caben en los
120 s de la función, la plataforma la cortó en el tercer caso y el guion no
distinguía un corte de una espera. Cancelar sólo cerraba la conexión: en una
máquina, el servidor seguía consultando los casos restantes y gastando cupo.

Ahora la corrida la conduce el navegador, un caso por petición:
`/api/ocupaciones/plan` → `/api/ocupaciones/sugerir` por cada caso →
`/api/ocupaciones/escribir`. Ninguna guarda estado en el servidor; la descarga
en memoria de antes podía caer en otra instancia y responder 404.

- La tarjeta enseña el caso en curso, un reloj que cuenta sus segundos y cuánto
  falta.
- Cancelar aborta la petición en vuelo y no pide más casos.
- Tres casos seguidos sin respuesta detienen la corrida y se escribe lo
  obtenido.
- Al terminar se listan los casos sin clave escrita, con la propuesta y la
  confianza de los que quedaron para revisar.
- `escribir` rehace el plan con el mismo archivo y no escribe nada si una clave
  no coincide en número de caso, puesto y centro de costos, o si no existe en
  el catálogo.
- El nombre del archivo viaja en `filename*`: el guion largo del nombre
  anterior no cabía en una cabecera HTTP.

## Un solo modelo

Nemotron 3 Super y, de respaldo, Gemma 4 (`gemma-4-31b-it:free` y después
`gemma-4-26b-a4b-it:free`), todo por OpenRouter con la misma llave. Gemma se
pide en JSON simple porque no admite esquema estricto; las instrucciones ya
describen la forma. Una primera versión de este día usaba Gemini directo en
Google AI Studio; el departamento aclaró que quería Gemma y se cambió antes de
publicar. Sin verificador sólo se escribe la confianza alta. Versión del agente
`2026-09-29.2`. Un caso gasta dos peticiones, así que el cupo diario de la
cuenta, 50, alcanza para unos 25; agotado, Gemma tampoco contesta.

## Pantalla

Se quitó la lista «Cómo funciona». La tarjeta de avance se oculta con
`hidden`: los `style=` en línea los descartaba la política de la pantalla y
rompían dos pruebas del sistema de diseño, que ya fallaban antes de este
cambio.

## Verificación

- `npm run test:plataforma`: 766 de 766. `npm test`: 117 de 117. `tsc` sin
  errores; ESLint y Prettier limpios en los archivos tocados.
- Consultas reales: Nemotron resolvió «*OPERARIO 2°» de Higiénicos en 19 s
  (552081900, confianza alta). Gemma 31B respondió 429 por saturación de su
  cupo compartido («rate-limited upstream»); Gemma 26B contestó JSON válido con
  los mismos parámetros que manda la plataforma, y minutos después también dio
  429. La clasificación completa con Gemma quedó sin probar por esa saturación.
- Chrome sin interfaz contra un servidor local con un agente falso, sin gastar
  cupo:
  - una corrida de cuatro casos bajó el Excel con las claves en las celdas
    correctas;
  - Cancelar en el caso 2 dejó el servidor en 2 llamadas, las mismas que ocho
    segundos después;
  - con el cupo agotado, la corrida se detuvo tras tres fallas: 4 llamadas para
    6 casos;
  - la consola del navegador no registró avisos.
- Sin probar en Vercel: el proyecto no está enlazado a GitHub (las
  publicaciones del 28 y 29 salieron de la CLI), así que el push no publica.

## Pendiente

- Publicar en Vercel con la CLI y probar la corrida con un padrón real.
