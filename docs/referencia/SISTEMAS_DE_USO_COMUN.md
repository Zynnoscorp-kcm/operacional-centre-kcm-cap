# Sistemas de uso común: separación de la plataforma central

- **Creado**: 2026-08-23 CST
- **Estado**: ESTRATEGIA PROPUESTA — nada implementado, ninguna migración aplicada
- **Decide**: el departamento de capacitación, con sistemas para la capa de red

Este documento propone **cómo publicar la agenda de salas y el quiosco de
registro en las computadoras comunes de la planta sin publicar con ellas la
plataforma central**. No es un plan de despliegue con fechas: es la estrategia y
sus costos, para que la decisión se tome sabiendo qué se está decidiendo.

---

## 1. Qué se separa

**Se vuelve de uso común exactamente dos pantallas**, las únicas que hoy están
declaradas para gente de fuera del departamento:

- **`/agenda`** — disponibilidad de las siete salas y autoservicio de
  reservación, con contraseña de agenda para escribir. La consulta no expone
  identidades: sala, fecha, horario y `RESERVADA`.
- **`/quiosco`** — registro de asistencia en sala, con PIN de quiosco para
  desbloquear la estación y PIN de apertura para abrir sesión.

**Se queda central todo lo demás, sin excepción**: portada, sesiones,
preliberación, liberación, padrón, barrido de matriz, historial de cargas,
DC-3, consola interna, `/salas` administrativa, `/excel` y la emisión de
credenciales, y el endpoint del puente `/api/v1/vba-bridge`.

La línea no es «lo que no tiene datos personales». Es **lo que una persona ajena
al departamento tiene que poder hacer parada frente a una computadora
compartida**. Todo lo demás es trabajo de tres personas en tres equipos, y no
gana nada con estar publicado en la planta.

---

## 2. Por qué hoy no está separado

Hoy la separación existe, pero es **una condición en tiempo de ejecución dentro
de un solo proceso**: `plataforma/src/server/guardia.ts` deja pasar sin sesión una
lista blanca —`/acceso`, `/salir`, `/healthz`, `/quiosco`, `/agenda`,
`/api/rooms/availability`, `/api/v1/vba-bridge`, más los prefijos `/assets/`,
`/api/kiosk/` y `/api/excel/power-query/`— y redirige lo demás a la puerta.

Eso es correcto y está bien escrito. Lo que no da es **frontera**:

- **Un solo origen.** El navegador de una máquina de planta tiene a un URL de
  distancia `/padron`, `/preliberacion`, `/consola-interna` y `/excel`. Están
  cerradas, pero están ahí: responden `303` a `/acceso`, no `404`. La pantalla
  de acceso queda expuesta a toda la planta, y con ella el único formulario de
  contraseña que existe.
- **Una sola sesión.** Si alguien del departamento entra a la consola desde una
  computadora común —para resolver algo rápido— deja una cookie de sesión en una
  máquina que no es suya y que nadie bloquea. La cookie es `HttpOnly`,
  `SameSite=Lax`, `Path=/` y **sin atributo `Domain`**, así que no viaja entre
  anfitriones; el problema no es que se filtre, es que se queda.
- **Un solo rol de base.** El proceso se conecta con `kcm_app`, que tiene
  `SELECT, INSERT, UPDATE` sobre **todas** las tablas de `kcm`. El quiosco y la
  agenda corren con el mismo permiso que el padrón y la matriz. Un defecto en la
  ruta más expuesta alcanza, en principio, a la tabla más sensible.
- **Un solo secreto.** El proceso carga `KCM_RELEASE_INTEGRITY_SECRET`, que
  autentica el journal de liberación, aunque el quiosco no lo use nunca.

Ninguna de estas cuatro cosas es un defecto del código actual: son consecuencias
de que hay **un** despliegue. La estrategia consiste en que haya dos.

**Un defecto sí apareció al revisar esto, y ya está reparado** (2026-08-23). El
freno de diez intentos de `/acceso` contaba por `request.ip`, y Fastify no tenía
declarado ningún proxy de confianza: publicada por túnel, esa dirección era la
del túnel para todo el mundo, así que el freno no era por equipo sino uno solo
para toda la planta —diez contraseñas mal escritas por cualquiera, sin mala
intención, cerraban la puerta cinco minutos al departamento incluido—. Se agregó
`KCM_TRUST_PROXY` como cuenta de saltos —nunca `true`, que confiaría en la
cadena que escribe el cliente— y la llave del freno pasó a ser equipo **y**
cuenta, porque las computadoras de planta salen por un mismo NAT y compartirían
dirección de todos modos.

---

## 3. La estrategia, en cuatro capas

Las capas son independientes y crecen en costo. La 1 sola ya vale la pena; las
cuatro juntas convierten la separación en una frontera real.

### Capa 1 — Perfil de publicación (código)

Se declara `KCM_PERFIL` con dos valores, `CENTRAL` —el de hoy, por omisión— y
`COMUN`. El perfil decide **qué rutas se registran**, no qué rutas responden.

Bajo `COMUN`, `buildServer` registra exactamente seis cosas: `/healthz`,
`/assets/*`, `/quiosco`, `/api/kiosk/*`, `/agenda` (GET y POST) y
`/api/rooms/availability`. Todo lo demás **no existe**: contesta `404` porque no
hay manejador, no `401` porque un guardia lo detuvo.

Tres consecuencias que valen más que la línea de código que cuestan:

1. **`/acceso` no existe en el anfitrión común.** No hay formulario de
   contraseña que atacar, y `ConsoleSessionCodec` ni siquiera se construye: en
   esa máquina **no se puede emitir una cookie de consola**. Deja de ser una
   regla de operación —«no entres a la consola desde la sala»— y pasa a ser algo
   que el servidor no sabe hacer.
2. **El puente desaparece de la planta.** `/api/v1/vba-bridge` sólo vive en
   `CENTRAL`. La regla de «un solo escritor», que hoy se sostiene porque sólo se
   emitió una credencial, gana un segundo candado que no depende de la
   disciplina de nadie.
3. **El secreto de liberación no viaja.** `main.ts` bajo `COMUN` exige
   `KCM_KIOSK_TOKEN_SECRET` y **no** `KCM_RELEASE_INTEGRITY_SECRET`, y construye
   sólo los dos repositorios que necesita —quiosco/sesiones y salas—.

**Dónde vive la definición.** La superficie común se declara **una sola vez**,
en un módulo nuevo `plataforma/src/server/perfiles.ts`, y la leen los dos que hoy
podrían separarse sin que nadie lo note: `buildServer`, para saber qué registrar,
y `guardia.ts`, para saber qué abrir bajo `CENTRAL`. Hoy la lista blanca del
guardia y la superficie pública son la misma idea escrita en un solo lugar; en
cuanto haya dos perfiles serían dos listas que se desincronizan la primera vez
que alguien agregue una ruta.

**Cómo se prueba.** Con una prueba que **fija la tabla de ruteo completa** bajo
cada perfil, comparando contra un listado literal. No «que `/padron` dé 404»,
sino «el conjunto de rutas registradas bajo `COMUN` es exactamente este». Una
ruta nueva que se cuele al perfil común rompe la prueba por existir, que es la
misma lógica de lista blanca que ya justifica `guardia.ts`.

### Capa 2 — Dos direcciones (red)

Dos nombres, dos certificados, un solo código y una sola base:

- **`capacitacion.<dominio-interno>` → perfil `CENTRAL`**, alcanzable sólo desde
  el segmento del departamento (tres equipos). Es donde vive la escritura.
- **`salas.<dominio-interno>` → perfil `COMUN`**, alcanzable desde toda la
  planta. Es lo único que se pone en las computadoras compartidas.

Que sean anfitriones distintos y no rutas del mismo es lo que hace que la cookie
de consola —sin `Domain`— no pueda llegar al común aunque los dos cuelguen del
mismo dominio padre. **Esa ausencia de `Domain` pasa a ser un invariante**:
agregarlo algún día para «compartir sesión» desharía la separación entera.

HTTPS en los dos, aunque no salgan a Internet. No es sólo higiene: el cliente
VBA rechaza cualquier endpoint que no sea TLS salvo `localhost`, y ya está
documentado como requisito de la migración interna.

### Capa 3 — Rol de base propio

Es la capa que convierte la separación de URLs en contención real: el proceso
común se conecta con **`kcm_comun`**, un rol nuevo `LOGIN NOBYPASSRLS` con
permisos únicamente sobre lo que esas dos pantallas tocan.

El inventario sale de los dos adaptadores, no de una suposición. La agenda usa
`kcm.sala`, `kcm.reserva_sala` y `kcm.actor`. El quiosco usa `kcm.sesion`,
`kcm.asistencia`, `kcm.registro_quiosco`, `kcm.concesion`, `kcm.auditoria`,
`kcm.secreto_operacion`, `kcm.capacitacion`, `kcm.metadato_curso_dc`,
`kcm.actor`, `kcm.rol` y `kcm_lectura.obtener_sesiones_operativas()`.

**Y `kcm.trabajador`, que es el punto que hay que resolver a mano.** El quiosco
la lee para dos cosas: resolver `numero_trabajador → trabajador_id` en los dos
`INSERT`, y proyectar el número de vuelta en el `LEFT JOIN` de las listas de
asistencia. Darle `SELECT` sobre `kcm.trabajador` al rol común sería darle el
padrón entero a la máquina más expuesta de la instalación —justo lo que esta
separación existe para impedir—.

La salida es la que el esquema ya usa en todas partes: **dos funciones
`SECURITY DEFINER` en `kcm_lectura`**, una que resuelve un número de trabajador a
su identificador interno y otra que devuelve la asistencia de **una** sesión. El
rol común recibe `EXECUTE` sobre esas dos y **ningún `SELECT` sobre el padrón**.
Sigue funcionando igual, y el acuse genérico e indistinguible del quiosco —que
hoy es una decisión de la capa de aplicación— pasa a estar respaldado por lo que
el rol puede leer.

Esto es una migración nueva. **No se aplica sin confirmación del departamento**,
como cualquier otra.

### Capa 4 — La estación

Lo que falta para que una computadora compartida sea una estación y no un
navegador cualquiera:

**Los PINs dejan de ser ceros.** Hoy el quiosco y la agenda se sostienen con
`KCM_PILOT_KIOSK_PIN`, `KCM_PILOT_SESSION_PIN` y `KCM_PILOT_ROOM_PASSWORD`,
contraseñas planas y provisionales de la corrida piloto. `loadConfig` ya las
prohíbe con `KCM_ENV=production`, así que el perfil común **no puede arrancar en
producción con ellas**, y está bien que así sea. Los secretos definitivos viven
en `kcm.secreto_operacion`, que hoy está vacía; llenarla es requisito de esta
publicación, no un pendiente posterior.

**`KCM_PILOT_OPEN_ACCESS` se prohíbe bajo `COMUN`, en cualquier entorno.** Con
esa bandera encendida el quiosco no pide PIN y la agenda no pide contraseña: en
un anfitrión que alcanza toda la planta, eso es una sesión de capacitación que
cualquiera abre y una sala que cualquiera cancela. Debe fallar el arranque, no
advertirse en la bitácora.

**Identidad de estación.** Hoy `stationLabel` es texto libre que manda el
cliente. Para una instalación de varias máquinas conviene que cada estación
llegue con su etiqueta fija desde el acceso directo —`/quiosco?estacion=SALA-3`—
de modo que la bitácora diga en qué sala ocurrió cada registro sin depender de
que alguien lo escriba bien.

**Se van las dependencias externas.** `/quiosco` y `/agenda` cargan
`three.min.js` desde `cdnjs.cloudflare.com` y tipografías desde Google Fonts.
Una computadora de planta detrás de un proxy sin salida degrada: el fondo de
haces cae a su ruta alterna y la tipografía a la del sistema —`haces.js` ya
comprueba `window.THREE` y no revienta—, pero la pantalla se ve distinta a como
se diseñó y depende de una red que no controlamos. Alojar las dos cosas bajo
`/assets/`, con hash en la dirección como el resto, permite además devolver la
política de contenido del perfil común a `default-src 'none'` con `'self'` y
nada más: **cero orígenes externos en la única superficie expuesta**.

**La máquina.** Navegador en modo quiosco, arranque automático en la URL de la
estación, sin barra de direcciones, sin impresión y sin gestor de descargas. Es
trabajo de sistemas y no del código, pero sin eso las tres capas anteriores
protegen un navegador desde el que se puede escribir cualquier otra dirección.

---

## 4. Lo que hay que tocar

Ordenado por archivo, para dimensionar. Nada de esto es una reescritura.

- **`plataforma/src/config/environment.ts`** — campo `perfil` en `AppConfig`, lectura de
  `KCM_PERFIL` con `leerEnumerado` y valor por omisión `CENTRAL`; rechazo de
  `KCM_PILOT_OPEN_ACCESS` bajo `COMUN`.
- **`plataforma/src/server/perfiles.ts`** *(nuevo)* — la superficie común declarada una
  vez: rutas exactas, prefijos y el motivo de cada una.
- **`plataforma/src/server/build-server.ts`** — una rama que, bajo `COMUN`, construye
  sólo los dos repositorios necesarios y registra sólo los bloques de rutas del
  perfil. Es el único archivo con cambio estructural. `/api/rooms/availability`
  vive hoy dentro de `registerRoomRoutes`, junto a la pantalla administrativa y a
  las escrituras: hay que sacarlo de ahí, o el perfil común arrastraría `/salas`
  y la cancelación de reservaciones.
- **`plataforma/src/server/guardia.ts`** — sus dos listas pasan a leerse de
  `perfiles.ts`; bajo `COMUN` no se registra, porque no hay nada que guardar.
- **`plataforma/src/main.ts`** — los secretos se exigen por perfil: el común pide el del
  quiosco y no el de liberación.
- **`plataforma/src/web/assets/`** — `three.min.js` y las tipografías alojadas, con su
  ruta por hash en `assets.ts` y `routes/assets.ts`.
- **`plataforma/src/web/pages/kiosk.ts` y `agenda.ts`** — `<link>` y `<script>` apuntando
  a `/assets/`; las dos políticas de contenido de ruta pierden
  `cdnjs.cloudflare.com`, `fonts.googleapis.com` y `fonts.gstatic.com`.
- **`database/migrations/00NN_rol_comun.sql`** *(nuevo)* — rol `kcm_comun`, sus
  `GRANT`, y las dos funciones `SECURITY DEFINER` que sustituyen al acceso
  directo a `kcm.trabajador`.
- **Pruebas** — la que fija la tabla de ruteo por perfil; una que compruebe que
  el perfil común no construye repositorio de padrón, matriz ni liberación; y
  una que verifique que ninguna página del perfil común referencia un origen
  externo.
- **Documentación** — `PUESTA_EN_MARCHA_TRES_EQUIPOS.md` gana la sección de las
  estaciones comunes; `MIGRACION_SERVIDORES_INTERNOS.md` gana el segundo proceso
  y el segundo rol en lo que hay que provisionar.

---

## 5. Orden de ejecución

Cuatro etapas. Cada una deja la plataforma en un estado publicable y ninguna
depende de que la siguiente ocurra.

1. **Perfil en código, un solo proceso.** Se agrega `KCM_PERFIL` y se levanta un
   segundo proceso `COMUN` en otro puerto de la misma máquina, contra la misma
   base y el mismo rol. Verificable en el acto: `/padron` da `404` en el común y
   `303` en el central. Aquí ya se puede poner la agenda en una computadora
   compartida por la red interna.
2. **Segunda dirección.** Nombre propio, certificado y alcance de red. Termina la
   exposición de `/acceso` y del puente hacia la planta.
3. **Rol de base y funciones de lectura.** La migración, aplicada con
   confirmación, y el cambio de cadena de conexión del proceso común. A partir de
   aquí la contención es del motor y no de la aplicación.
4. **La estación.** Secretos reales en `kcm.secreto_operacion`, etiqueta por
   estación, recursos alojados y el navegador en modo quiosco.

Una etapa 0 previa y trivial: **nada de esto se sostiene sobre la base sucia del
piloto**. La corrida abierta desde el 2026-08-03 tiene datos de prueba y hay que
reconstruirla antes de que una computadora de planta escriba una asistencia real.

---

## 6. Lo que cuesta

**Un segundo proceso que operar.** Dos servicios que arrancar, dos que vigilar,
dos que actualizar al mismo tiempo. Comparten binario y base, así que no se
desincronizan de versión, pero sí de disponibilidad: el común puede estar caído
sin que nadie del departamento se entere, porque nadie del departamento lo usa.
Un chequeo de `/healthz` por anfitrión, no uno solo.

**Un segundo juego de permisos que mantener.** Cada función nueva que toque el
quiosco o la agenda exigirá revisar si el rol común puede hacerla. Eso es el
precio de la contención y se paga cada vez, no una sola.

**Una decisión menos reversible sobre los secretos.** Publicar en la planta
obliga a llenar `kcm.secreto_operacion` de verdad. No es costo de esta estrategia
—hace falta igual— pero deja de poderse posponer.

---

## 7. Lo que queda por decidir

Tres cosas que no decide quien implementa.

**¿La sala puede abrir su propia sesión?** `POST /api/kiosk/launch` crea y abre
una sesión con sólo el PIN de apertura. Es la capacidad más fuerte del perfil
común: en un anfitrión que alcanza toda la planta, quien tenga ese PIN crea
sesiones de capacitación. Las dos salidas son legítimas —conservarlo, porque una
sala que no puede empezar sin la consola depende de que alguien conteste; o
quitarlo del perfil común y que las sesiones nazcan siempre en la consola—. Hoy
está conservado por omisión, que es la peor forma de decidirlo.

**¿La agenda pide contraseña o queda abierta a lectura y cerrada a escritura?**
Hoy consultar es libre y reservar pide `KCM_PILOT_ROOM_PASSWORD`. Con una sola
contraseña compartida en toda la planta, la bitácora dice `AGENDA_PUBLICA` y no
quién reservó; lo que identifica a la persona es lo que ella misma escribe en el
formulario. Si eso basta, no hay nada que cambiar; si no, hace falta algo más que
una contraseña, y eso es otra ejecución.

**¿Cuántas estaciones y dónde?** Determina si la etiqueta de estación se
configura a mano en cada acceso directo —razonable hasta cinco o seis— o si hace
falta darlas de alta en la base como se dan de alta las salas.

---

## 8. Cómo se verifica que quedó bien

Sin esto, «está separado» es una afirmación sin respaldo:

- La tabla de ruteo del perfil común, impresa y comparada contra el listado
  declarado. Es la única prueba que detecta una ruta que se coló.
- `curl` contra el anfitrión común a `/padron`, `/excel`, `/consola-interna`,
  `/preliberacion` y `/api/v1/vba-bridge`: los cinco, `404`.
- Una sesión de consola válida, con su cookie, enviada al anfitrión común: no
  abre nada, porque ahí no hay nada que abrir.
- El proceso común, conectado con `kcm_comun`, intentando `SELECT` sobre
  `kcm.trabajador` y sobre `kcm.registro_hc`: permiso denegado por el motor.
- Un registro completo de asistencia y una reservación, de punta a punta, desde
  una computadora común y con la red de planta —no desde la del departamento—.
- La pantalla del quiosco con la salida a Internet cortada: idéntica, porque ya
  no pide nada de fuera.
