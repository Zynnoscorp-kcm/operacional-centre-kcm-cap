# Sistema de diseño

Dónde vive el diseño de la plataforma, qué gobierna cada capa y cómo reusarlo.
No propone cambios: describe lo que hay.

El front **no son archivos `.html`**. El marcado se genera en el servidor desde
TypeScript; lo único que viaja como archivo es el CSS. Los `.html` que sí
existen en el árbol —`referencias/formato/`— son el
front viejo y maquetas de referencia, y no son lo que corre.

---

## 0. Qué cambió en el rediseño

La consola era un **panel de vidrio esmerilado centrado sobre un fondo de haces
diagonales**, con un rail plano de veinte entradas en seis grupos y una portada
que repetía ese menú en forma de recuadros. Hoy es un **tablero claro**: fondo
gris azulado, tarjetas blancas de esquina redonda, sombra baja, un menú lateral
de once secciones y el azul `#224C9F` reservado para lo que significa algo.

Lo que se retiró, y por qué:

| Se fue | Motivo |
|---|---|
| `barras.css` y los seis haces del fondo | Se leían por detrás de tablas de ocho y nueve columnas y obligaban a subir la opacidad de cada tarjeta |
| El vidrio del panel (`--panel-*`, `backdrop-filter`) | Mismo motivo: contraste comprado con opacidad. Sobrevive en **una sola pieza**: la telaraña del avance DNC |
| La retícula de funciones de la portada | Era el menú dibujado dos veces, con estados de proyecto en lugar de trabajo del día |
| Las quince entradas sueltas del rail | Las vistas hermanas pasaron a sub-pestañas dentro de su sección |
| `renderEscena()` | Nadie la llamaba; era la envoltura de la puerta anterior |
| La puerta calcada del quiosco | Cargaba `three.min.js` de un CDN, tipografías de Google y un `<style>` en línea |

**No se retiró ninguna función.** Las veinte pantallas del rail anterior siguen
existiendo y todas tienen puerta.

---

## 1. Las dos hojas, y en qué orden

`plataforma/src/web/assets/` tiene dos hojas que se concatenan **en este orden y no en
otro**, declarado en `plataforma/src/web/assets.ts`:

```js
const HOJAS = ["tokens.css", "base.css"];
```

| Hoja | Líneas | Qué gobierna |
|---|---:|---|
| `tokens.css` | 209 | El contrato: color, radio, ritmo, tipografía, densidad |
| `base.css` | 2 730 | El armazón y todos los componentes |

El orden importa porque `base.css` no contiene un solo color literal: todo lo
resuelve con `var(--…)`. Si `tokens.css` no entró antes, cada `var()` queda sin
resolver, y un `var()` sin resolver **invalida la declaración entera** — no cae
a un color por omisión, desaparece.

Se publican como **una sola hoja concatenada**, no como dos peticiones.

---

## 2. `tokens.css` — el contrato

Es la única fuente de valores visuales del árbol. Una vista que necesita un
color escribe una variable, nunca un literal, y una prueba lo comprueba: si
`#224c9f` aparece escrito a mano en `base.css`, `plataforma/tests/server.test.ts` falla.

Azul de marca `#224C9F`. Vive en cuatro sitios y en ninguno más: la sección
activa del menú, los botones de acción, los acentos de estado y la portada del
acceso. Todo lo demás es blanco, tinta `#0F1E3D` y una línea azul muy diluida.

Los grupos de variables son estos:

- **Tinta y texto** (`--kcm-ink`, `--kcm-muted`, `--kcm-line`)
- **Marca** (`--kcm-brand`, `--kcm-brand-dark`, `--kcm-brand-bright`,
  `--kcm-brand-sky` para el quiosco, el anillo de foco)
- **Estados**, en pares color/fondo: `--kcm-ok`, `--kcm-warn`, `--kcm-danger`
- **Superficies**: `--kcm-canvas` (el fondo de la página), `--kcm-surface`
- **Geometría**: `--kcm-radius` 20, `--kcm-radius-lg` 24, `--kcm-radius-sm` 12
- **Sombras**: dos capas —un filo de 1 px y una caída ancha muy diluida—, en
  azul y no en gris, porque sobre blanco un gris neutro ensucia
- **Degradados** de marca, éxito y aviso
- **Ritmo**: `--kcm-space-1` a `--kcm-space-5`
- **Tipografía**: `--kcm-font`, `--kcm-font-mono`, `--kcm-font-display`
- **Densidad CAPTA**: `--capta-rotulo`, `--capta-texto`, `--capta-cifra`
- **Bento**: fondos de tarjeta, mosaico, bordes, capas y chips
- **Vidrio líquido** (`--vidrio-*`): fondo, borde, sombra, desenfoque y las dos
  manchas de color del reverso. Los usa **sólo** la telaraña del avance DNC

### Los dos temas

No es un tema claro y otro oscuro de la misma pantalla: **son dos pantallas
distintas** y la diferencia es deliberada.

`.tema-plataforma` es la consola de escritorio: papel, no pantalla. Hereda casi
todo de `:root`, porque **`:root` es hoy la plataforma**; la clase se conserva
porque el marcado la declara y porque deja un sitio donde afinar la consola sin
tocar la agenda pública.

`.tema-quiosco` es el negro de la sala. Lo usan el quiosco de registro y la
agenda pública del pasillo. Eso es lo que distingue de un vistazo una pantalla
de sala de una de escritorio. **La puerta de `/acceso` ya no está aquí**: desde
el rediseño es del mismo material que lo que abre.

Los `--bento-*` se declaran en `:root` y no sólo dentro de cada tema, y hay una
razón concreta: cuando vivían únicamente en `.tema-plataforma`, la agenda
pública —que corre en `.tema-quiosco`— dejaba cada `var()` sin resolver y se
caía el `background` completo de las tarjetas de sala.

La clase la pone `layout.ts` en el `<html>`, según el tema que pida la pantalla.

---

## 3. `base.css` — armazón y componentes

Las secciones, en el orden en que aparecen:

**Armazón**: `.consola` (la rejilla de dos columnas) · el menú lateral
(`.lateral`, `.lateral-enlace`, `.lateral-pie`) · el lienzo (`.lienzo`,
`.barra`, `.subpestanas`, `.contenido`).

**Componentes**: rótulos de sección al modo CAPTA · la tarjeta · la tira de
indicadores (KPI) · retículas de mosaicos · insignias · tablas con densidad
CAPTA · formularios · botones · avisos · listas de definición y fichas · textos
auxiliares.

**Pantallas propias**: adaptación a pantallas angostas · agenda pública de salas
—incluido el color de marca de cada sala— · la puerta de `/acceso` · fichas de
conteo · gráfica de telaraña del avance DNC · el tablero de inicio.

### El armazón, en dos piezas

```
┌──────────┬───────────────────────────────────────┐
│          │  .barra        título · estado · salir │
│ .lateral ├───────────────────────────────────────┤
│  244 px  │  .subpestanas  (sólo si la sección    │
│          │                 tiene vistas hermanas)│
│          ├───────────────────────────────────────┤
│          │  .contenido    la pantalla             │
└──────────┴───────────────────────────────────────┘
```

El lateral se queda en 244 px porque las tablas de esta consola tienen ocho y
nueve columnas y son ellas las que se quedaban sin sitio. Por debajo de 1080 px
deja de ser columna y pasa a ser una tira horizontal desplazable.

`align-self: start` en `.lateral` es lo que hace funcionar su `position: sticky`:
sin él la rejilla lo estira hasta la altura de la fila y no le queda recorrido
dentro del cual pegarse.

### La telaraña, que es la excepción

Es la única superficie de vidrio que queda: un disco translúcido con su reflejo
sobre dos manchas de color difuminadas. Se conserva porque ahí no hay una tabla
que leer por detrás sino una figura, y el relieve la ayuda en vez de estorbarla.

Su `viewBox` es ancho y **lleva los rótulos dentro**. Era cuadrado, con
`overflow: visible` y los nombres de curso colgando fuera del `<svg>`: los de la
izquierda se pintaban encima del menú lateral. Con diecisiete o dieciocho ejes
—lo normal en un técnico— los rótulos vecinos quedan a veinte grados, así que a
partir de nueve se alternan en dos anillos para no encimarse.

Los degradados se declaran en `<defs>` con `class` y sin un solo color escrito:
los tonos los pone `base.css` con `stop-color: var(--…)`.

---

## 4. `layout.ts` — el armazón del documento

`plataforma/src/web/layout.ts` (333 líneas) emite el documento completo: `<!doctype>`,
`<html lang="es-MX">` con la clase del tema, el `<head>` con `charset` y
`viewport`, el menú lateral, la barra de título, la tira de sub-pestañas y el
contenido.

Ahí vive también la constante `MENU`: **once secciones en cuatro grupos**. Lo
que antes eran entradas hermanas del rail —las cinco vistas de trabajadores, las
dos cargas, las cuatro auditorías, las dos de base de datos— son hoy
`subpestanas` dentro de su sección. Una pantalla no las declara: pasa su
`rutaActiva` y el armazón resuelve qué sección encender y qué pestañas dibujar.

Los iconos son `<svg>` en línea escritos a mano, de 20×20 en `currentColor`. No
hay paquete de iconos: la política de contenido no admitiría uno por CDN, y un
`<svg>` en el marcado no es un script ni una hoja externa.

`pages/kiosk.ts` y `pages/agenda.ts` emiten su documento aparte: el quiosco y la
agenda no llevan menú ni barra de consola, porque quien entra ahí no administra
nada. Se llega a las dos desde el pie del lateral, bajo «Pantallas de sala».

El marcado se arma con la plantilla etiquetada de `plataforma/src/web/html.ts`, que
**escapa por omisión**. Interpolar texto es seguro sin pensarlo; publicar
marcado crudo exige escribir `rawHtml`, que es una palabra que se ve en la
revisión. Un valor de tipo no previsto —un objeto, una función— **lanza en vez
de imprimirse**, para que nadie vea `[object Object]` en pantalla ni serialice
un objeto de dominio entero.

---

## 5. La puerta de `/acceso`

Dos hojas que cubren la pantalla —la azul con la marca en blanco, la blanca con
las credenciales— y que al entrar se corren hacia sus orillas dejando ver la
consola. Lo que hay detrás no es la consola de verdad: es su silueta, cuatro
rectángulos con la geometría exacta del armazón, de modo que la página que carga
después cae encima sin salto.

El símbolo se pone en blanco con `filter: brightness(0) invert(1)`, que conserva
el canal alfa: no hace falta un segundo archivo que mantener.

`.puerta-hojas` recorta con `overflow: clip` y no con `hidden`, y la diferencia
se vio en pantalla: un contenedor `hidden` **sigue siendo desplazable por
programa**, y el navegador lo desplaza solo para no perder de vista el elemento
con el foco. Como el campo de usuario lleva `autofocus`, al correrse su hoja el
navegador arrastraba 720 px la página entera detrás de ella. `clip` no crea
contenedor de desplazamiento; el guion además suelta el foco antes de abrir,
para los navegadores que todavía no lo entienden.

`acceso.js` existe por una sola razón: un `POST` normal navega de inmediato y el
navegador descarta la página antes de pintar un cuadro del recorrido. El guion
retiene el envío el tiempo que dura la transición y lo suelta después. Sin él la
puerta no se anima y el formulario viaja como cualquier otro: **la animación es
adorno, la autenticación no depende de ella.**

---

## 6. Cómo se sirve

Las hojas se leen **una vez al arrancar**, se concatenan y se publican bajo una
dirección que lleva el hash del contenido:

```
/assets/kcm-<doce-letras>.css
```

Así el navegador cachea para siempre y un cambio de estilo invalida solo, sin
`@fastify/static` ni una dependencia más. Si una hoja falta, el proceso **no
arranca**, en vez de servir una pantalla sin estilo.

El alfabeto de la huella son **puras letras, sin dígitos**, y no es un capricho:
en hexadecimal la huella cae tarde o temprano en cinco dígitos seguidos —le pasó
a `kcm-7c58e02086d5.css`— y entonces la dirección de la hoja tiene la forma de
un número de nómina. La plataforma prohíbe publicar algo así en una pantalla, y
la prueba de la pantalla base lo comprueba con una expresión regular que no
puede distinguir una nómina de una casualidad.

La política de contenido de la consola es:

```
default-src 'none'; style-src 'self'; img-src 'self' data:;
font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'
```

**Sin `script-src`.** La consola no publica un solo guion, y de ahí salen varias
decisiones de diseño: la agenda resuelve la selección de horario con enlaces al
servidor en lugar de JavaScript, y ningún estilo puede ir en un atributo
`style`, porque `style-src 'self'` sin `'unsafe-inline'` lo descarta.

Tres pantallas tienen política propia y publican guion:

| Pantalla | Guion | Política |
|---|---|---|
| Quiosco de sala | `kiosk.js`, `haces.js` | `script-src 'self' https://cdnjs.cloudflare.com` |
| `/acceso` | `acceso.js` | `script-src 'self'` |

El símbolo de marca viaja por el mismo camino, con su propio hash. No se enlaza
desde Drive: `img-src 'self' data:` no lo permitiría, y la pantalla no debe
depender de que un tercero siga en línea.

Todo lo demás se sirve con `cache-control: no-store`. Con datos personales de
por medio, una caché es una copia que nadie declaró.

---

## 7. Lo que impide que se desarme

Dos reglas del sistema no producen un error cuando se rompen: producen un
elemento que se ve mal y que nadie relaciona con el cambio que lo causó. Por eso
las comprueban pruebas y no la vista.

`plataforma/tests/estilo-consola.test.ts` recorre el **código fuente** de todas las
pantallas y de `layout.ts`, y falla si:

1. una vista usa una clase que la hoja no declara —`insignia-cerrado` donde la
   hoja dice `insignia-inactivo` sale como HTML válido y aparece sin estilo—, o
2. una vista lleva estilo en un atributo `style`, que la política descarta.

`plataforma/tests/estilo-barridos.test.ts` hace lo mismo sobre la **salida ya
renderizada** de dos pantallas completas, que es donde se ven las clases armadas
por interpolación.

El quiosco de sala queda fuera de las dos, y por escrito: es una pantalla suelta
que no usa esta hoja y declara su propia política con `'unsafe-inline'`.

---

## 8. Cómo reusarlo fuera de la plataforma

Para una página suelta que deba verse como la plataforma —un reporte, un
documento, un tablero— basta con esto:

1. **Copiar `tokens.css` completo.** Es el contrato. Sin él nada resuelve.
2. **Elegir tema** poniendo `class="tema-plataforma"` o `class="tema-quiosco"`
   en el `<html>`. Sin clase se cae a `:root`, que hoy ya es la plataforma.
3. **Copiar de `base.css` sólo las secciones que se usen.** Los componentes son
   independientes entre sí; lo único transversal es el armazón (`.consola`,
   `.lateral`, `.lienzo`).
4. **Declarar `charset` y `viewport` en el `<head>`.** Es lo que le faltaba a
   `docs/DOCUMENTACION.html` y por eso se leía con símbolos en medio de las
   palabras: sin `charset` el navegador cae a windows-1252 y rompe cada acento.
5. **No inventar colores.** Si un valor no está en `tokens.css`, no está en el
   sistema.

> `docs/DOCUMENTACION.html` se generó contra el diseño anterior y todavía
> describe el panel de vidrio, los haces y `barras.css`. Al regenerarla hay que
> volver a declarar el `charset` o vuelve el mojibake.

---

## Resumen de rutas

- `plataforma/src/web/assets/tokens.css` — el contrato de valores
- `plataforma/src/web/assets/base.css` — armazón y componentes
- `plataforma/src/web/assets/haces.js`, `kiosk.js`, `acceso.js` — los tres guiones publicados
- `plataforma/src/web/assets.ts` — concatenación, hash y publicación
- `plataforma/src/web/layout.ts` — el armazón del documento, el menú y las sub-pestañas
- `plataforma/src/web/html.ts` — la plantilla que escapa por omisión
- `plataforma/src/web/pages/` — una pantalla por archivo
- `plataforma/src/routes/assets.ts` — la ruta `/assets/*`
- `plataforma/tests/estilo-consola.test.ts`, `estilo-barridos.test.ts` — las guardas del sistema
