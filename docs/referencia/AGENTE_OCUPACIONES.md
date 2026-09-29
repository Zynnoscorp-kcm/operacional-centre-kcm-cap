# Agente de ocupaciones

Asigna a un trabajador nuevo la clave del Catálogo Nacional de Ocupaciones que
pide el recuadro «Ocupación específica» del DC-3. Cada caso se evalúa desde
cero: el agente no copia la clave que tienen otros trabajadores.

## Qué entra y qué sale

- **Entra:** puesto y centro de costos, en texto. Nada más. La puerta del
  servicio rechaza cualquier campo extra, y también cualquier texto que parezca
  un dato personal: números de cinco dígitos o más (también en grupos, como un
  NSS o un teléfono), correos o nombres con el formato del padrón. La detección
  mira la forma NFKC del texto, así que los dígitos de ancho completo no la
  burlan.
- **Sale:** un estado (`sugerida`, `revisar` o `sin_respuesta`), el código de 9
  o 10 dígitos con la descripción tomada del catálogo, la subárea que se deriva
  de ese código (por ejemplo `05.5`), una alternativa, la confianza, el motivo,
  la versión del agente, la huella de su configuración y la traza nodo por
  nodo.

## Cómo razona (LangGraph)

```
           ┌─ papel_principal:   subareas → ocupacion → validacion ─┐
  START ───┤                                                        ├─→ conciliacion → END
           └─ papel_verificador: subareas → ocupacion → validacion ─┘
```

Cada papel es un subgrafo, y los dos corren a la vez sin ver la respuesta del
otro. **Desde el 2026-09-29 la configuración declara un solo modelo:** el
papel del verificador no recibe modelo y no corre, y la conciliación sólo da
por `sugerida` la confianza alta del principal. El grafo conserva los dos
papeles para cuando se quiera volver a una segunda opinión.

1. **Subárea.** El modelo elige una o dos de las 55 subáreas del reverso del DC-3.
2. **Ocupación.** Elige un código entre las opciones de esa subárea: 46 en la
   mediana, con un tope de 260.
3. **Validación, sin modelo.** El código tiene que estar en la lista que se le
   mostró. Si no está, se le vuelve a pedir una vez, con el motivo.
4. **Conciliación, sin modelo.**
   - `sugerida`: con un solo modelo, confianza alta. Con verificador, los dos
     papeles eligieron el mismo código y ninguno con confianza baja.
   - `revisar`: cualquier otra combinación. No se escribe en el padrón.
   - `sin_respuesta`: ningún papel dejó propuesta.

**Límites de tiempo y fallas:**
- Cada caso tiene un plazo de 105 s, dentro de los 120 s de la función publicada.
- Ningún papel empieza una llamada si le quedan menos de 15 s, y cada llamada
  sólo recibe el tiempo que le queda al caso.
- Si un papel no alcanza o falla, el otro conserva su propuesta y el caso va a
  `revisar`.

## Proveedores (un solo modelo, OpenRouter, gratis, 2026-09-29)

Cada caso lo contesta un solo modelo. Ya no hay verificador: el departamento
pidió dejar de consultar dos modelos a la vez. Todo va por OpenRouter con la
misma llave, `KCM_IA_OPENROUTER_LLAVE`.

- **`nvidia/nemotron-3-super-120b-a12b:free`.** Lo sirve NVIDIA y admite
  esquema estricto. En la prueba del 2026-09-29 resolvió «*OPERARIO 2°» de
  Higiénicos en 19 s: 552081900, subárea 05.5, confianza alta.
- **Respaldo: Gemma 4, `google/gemma-4-31b-it:free` y después
  `google/gemma-4-26b-a4b-it:free`.** Sólo contesta cuando Nemotron no puede:
  su proveedor saturado, caída o demora. Tras una falla así, Nemotron se salta
  cinco minutos y Gemma recibe el tiempo completo.
  - No admite esquema estricto: se le pide JSON simple (`json_object`). Las
    instrucciones ya describen la forma y la cadena valida la respuesta igual
    que con Nemotron.
  - Lo sirve Google AI Studio con un cupo gratuito que comparten todos los
    usuarios de OpenRouter, uno por variante, y se satura a ratos. El
    2026-09-29 la de 31B respondió 429 («rate-limited upstream», fuente
    `upstream_provider_shared_pool`) mientras la de 26B contestaba; minutos
    después la de 26B también dio 429 y luego volvió a contestar. Por eso van
    las dos, y una variante con 429 se salta cinco minutos.
- **El tope diario es de la cuenta, no del modelo.** Con las 50 peticiones del
  día agotadas, Gemma tampoco contesta: el respaldo cubre a Nemotron cuando
  falla él, no cuando se acaba el cupo de la cuenta.

Gemini directo en Google AI Studio se probó en la configuración el mismo día y
se retiró antes de publicarse: el departamento pidió Gemma por OpenRouter, con
la misma llave. Dots y Qwen, los verificadores anteriores, salieron de la
configuración.

**Qué viaja en cada petición a OpenRouter:**
- `reasoning: { effort: "high", exclude: true }`: el modelo razona antes de
  contestar, pero ese razonamiento no regresa en la respuesta.
- `provider: { require_parameters: true }`: OpenRouter sólo enruta a
  proveedores que respetan el esquema pedido.
- Tope de salida de 16 000 tokens. El razonamiento cuenta dentro de ese tope;
  si la respuesta llega cortada, el adaptador lo reporta.

**Cupo gratuito de OpenRouter:**
- 20 peticiones por minuto y 50 por día.
- Cada caso usa dos peticiones —subáreas y ocupación—, así que alcanzan para
  unos 25 casos diarios, con Gemma incluida.
- Una compra única de 10 dólares en créditos sube el tope a 1 000 por día.

**Prueba real del 2026-09-26** (*OPERARIO 2°, HIGIENICOS): los dos modelos
coincidieron en 552081900 «Operador máquina fabricación artículos papel»,
subárea 05.5, con confianza alta. Estado `sugerida`; 31 s en total.

## Clasificación por lotes (sólo evaluación)

Desde el 2026-09-28 el libro de Excel ya no clasifica: su botón y las acciones
`OCCUPATION_PLAN_V1` y `OCCUPATION_STEP_V1` se retiraron, y la pantalla
`/ocupaciones` consulta un caso por petición. El grafo por lotes se conserva
para evaluar con `npm run ia:ocupaciones -- --lote`; lo que sigue describe cómo
funciona, y lo que dice del verificador sólo aplica si se vuelve a configurar
uno.

El grafo usa el mismo agente, pero con varios casos por petición. El plan gratuito da 50 peticiones al día: un caso suelto gasta cuatro,
y en lote la prueba real gastó 10 con 8 combinaciones. Quien lo usa sólo pulsa
el botón; las divisiones las hace el grafo del lote:

```
START → planificacion ─┬─ Send(tanda) × n ─→ tanda ─→ planificacion …
                       ├─ sin trabajo pendiente ─→ conciliacion → END
                       └─ sin tiempo para otra tanda ─→ END   (Excel vuelve a llamar)
```

**Tope por corrida:** 30 combinaciones, lo que cabe en el cupo de un día con
margen para reintentos. Si hay más, entran primero las que cubren a más
trabajadores. Las demás no se tocan: sus celdas siguen vacías, y la siguiente
corrida, que parte de la copia, las vuelve a encontrar. En el padrón de la
semana 31 hay 1 683 trabajadores sin clave en 219 combinaciones, y las primeras
30 cubren a 1 264.

**Lo que cuida la precisión:**
- **Un caso por combinación.** Los faltantes con el mismo puesto y centro de
  costos son una sola pregunta, porque para el modelo son la misma entrada.
  Nunca se copia la clave de alguien que ya la tiene.
- **Tandas chicas y agrupadas.** Las subáreas van de 20 casos en 20. La
  ocupación va en grupos de hasta 4 casos que comparten subárea, así que cada
  petición compara pocas opciones y pocos casos.
- **Cada caso por separado.** Las instrucciones piden resolver cada caso por su
  cuenta y no copiar la respuesta de uno a otro; es el riesgo propio del lote.
- **Lotes distintos por modelo.** El verificador recorre los casos en orden
  inverso, así que sus lotes no repiten los del principal.
- **Validación por caso.** Un caso que falta en la respuesta, o con un código
  fuera de la lista, se vuelve a preguntar con el motivo, hasta dos intentos.
  El motivo que ve el modelo es una frase fija; el código inválido va a la
  razón del caso.
- **Forma validada en la cadena.** Una respuesta con JSON de otra forma cuenta
  como falla de ese modelo y pasa al respaldo, igual que una que no es JSON.
- **Respaldo con enfriamiento.** Si Nemotron no contesta a tiempo o se queda
  sin cupo, se salta cinco minutos y Gemma recibe el tiempo completo. Con menos de
  15 s por delante no se empieza ningún modelo.
- **Fallas del proveedor.** No gastan los intentos de los casos. Tras cada una,
  la tanda espera 5, 10 y 20 s antes de devolver el turno, así que un parpadeo
  del proveedor no tira al papel; tras tres fallas seguidas, el papel se da por
  caído y sus casos van a `revisar`.
- **Tandas que fallan se parten.** La siguiente tanda de esos casos es de la
  mitad: 20, 10, 5 y 2 en la subárea; 4, 2 y 1 en la ocupación. Un caso que
  estuvo en cuatro tandas fallidas se da por fallido, así que una petición que
  siempre falla ya no se repite sin fin. Un 413 es de la petición, no del
  proveedor, y no acerca al papel a caerse.
- **Sin llamadas a medias.** Una tanda sólo empieza si le quedan los 70 s de
  una llamada completa. Si el fin del paso la cortara, la petición ya habría
  gastado cupo y contaría como falla del proveedor sin serlo.
- **Mismas reglas de conciliación que un caso suelto.** Si los modelos
  discrepan en la ocupación pero coinciden en la subárea, la razón lo dice.

**Prueba real del 2026-09-26** con las 8 combinaciones más frecuentes del
padrón: 10 peticiones y 150 s.
- Primera corrida: 0 sugeridas. Los dos modelos discrepaban entre sinónimos de
  papel («fabricar papel», «convertidora», «dobladora»), y el tope de 6 000
  tokens cortaba el JSON de algunas tandas.
- Se agregó el criterio de planta (máquinas de papel contra líneas de
  conversión), se subió el tope a 16 000 y se bajaron las tandas a 4.
- Resultado: 4 sugeridas (las líneas de conversión en 552081900 «Operador
  máquina fabricación artículos papel») y 4 a revisar, que son ambiguas de
  verdad (p. ej., «Operador» en «Gerencia de Mantto.»).

## La pantalla `/ocupaciones`

Sección «Ocupaciones» del lateral, entre Cargas y DC-3. Recibe el padrón
semanal y devuelve una copia con la clave de ocupación llena en los
trabajadores activos que no la traían. La copia se revisa antes de aplicarla
desde `/padron`; nada se escribe en la base desde esta pantalla.

**La conduce el navegador, un caso por petición (2026-09-29).** La función
publicada corta cada petición a los 120 s y un caso tarda cerca de medio
minuto. La versión anterior mandaba el avance en una sola petición larga: la
plataforma la cortaba en el tercer caso («Task timed out after 120 seconds» en
el registro de Vercel del 2026-09-29) y la barra se quedaba en «Caso 2 de 15».
Ahora el guion `ocupaciones.js` hace tres pasos, ninguno con estado en el
servidor:

1. `POST /api/ocupaciones/plan` con el padrón: devuelve los casos (puesto,
   centro de costos y trabajadores que cubre cada uno). Tope de 15 casos por
   corrida, primero los que cubren a más trabajadores.
2. `POST /api/ocupaciones/sugerir` por cada caso, de uno en uno.
3. `POST /api/ocupaciones/escribir` con el mismo padrón y las claves
   sugeridas: el servidor vuelve a planear con el archivo y sólo escribe una
   clave si su caso coincide en número, puesto y centro de costos y si existe
   en el catálogo; si una no cuadra, no escribe ninguna. La respuesta es el
   Excel, con las celdas escritas en la cabecera `x-kcm-celdas-escritas`.

**Lo que se ve y lo que se puede hacer:**
- La tarjeta de avance dice el caso en curso con su puesto y centro de costos,
  un reloj que cuenta sus segundos y cuánto falta, calculado con lo que han
  tardado los anteriores.
- Cancelar aborta la petición en vuelo y no pide más casos: en el servidor no
  queda nada gastando cupo.
- Tres casos seguidos sin respuesta detienen la corrida —casi siempre es el
  cupo del día— y se escribe lo que ya se obtuvo.
- Al terminar baja el archivo «… con ocupaciones.xlsx» y se listan los casos
  sin clave escrita: los que quedaron para revisar, con la propuesta y su
  confianza; los que no tuvieron respuesta, y los que no se consultaron.
- Cerrar o recargar a media corrida la detiene; el navegador pregunta antes.
- Sin JavaScript no hay clasificación: la pantalla lo dice.
- **Buscar en el catálogo:** por palabras, por el comienzo de la clave o por
  subárea, sin distinguir acentos. La búsqueda va en la dirección y no usa
  modelo ni gasta consultas: sigue funcionando aunque el agente esté apagado.

## Control y trazabilidad

- **Dónde vive cada cosa:**
  - Modelos, esfuerzo de razonamiento y topes: `plataforma/src/config/agente-ocupaciones.ts`.
  - Instrucciones y criterios del departamento: `plataforma/src/domain/ocupaciones/instrucciones.ts`.
  - Catálogo: `plataforma/src/domain/ocupaciones/catalogo-cno.tsv`, que se
    regenera con `npm run build:catalogo-ocupaciones -- --origen <libro de la STPS>`.
- **La huella:** cambiar cualquiera de esas piezas cambia la huella que llevan
  las sugerencias. Entran los modelos con sus topes de salida y de espera, los
  límites del caso, del lote y del respaldo, las cuatro instrucciones con sus
  esquemas y el catálogo. Un lote empezado con otra huella no se continúa.
- **El estado del lote regresa de Excel y se valida entero:** los casos pasan
  por la misma puerta que un caso suelto, no más de 30 y sin repetidos; las
  claves se comparan con el catálogo, que vuelve a dar su descripción; las
  subáreas sólo pueden ser del catálogo y los avisos, las frases que escribe la
  plataforma. Nada de lo que traiga llega al prompt sin pasar por ahí.
- **La traza no sale de la plataforma:**
  - No se usa LangSmith: con el agente encendido, la plataforma no arranca si
    `LANGSMITH_TRACING` o `LANGCHAIN_TRACING_V2` están activas.
  - Tampoco hay punto de control en la base, así que Supabase no recibe
    lecturas ni escrituras del agente.
- **Carga:** LangGraph y el catálogo se cargan la primera vez que se pide una
  sugerencia; ninguna otra pantalla paga ese peso.

## Uso

- Llave en el entorno: `KCM_IA_OPENROUTER_LLAVE`, la misma para Nemotron y
  Gemma. En Vercel va en Production, junto a las demás.
- Rutas, todas con sesión de consola: `POST /api/ocupaciones/plan` y
  `POST /api/ocupaciones/escribir` (multipart con `archivo`; la segunda con
  `codigos`), y `POST /api/ocupaciones/sugerir` con
  `{ "puesto": …, "centroDeCostos": … }`, un caso por petición.
- Prueba de un solo caso:
  `npm run ia:ocupaciones -- --puesto "*OPERARIO 2°" --centro "HIGIENICOS"`.
- Evaluación por lotes, como el botón:
  `npm run ia:ocupaciones -- --padron <sem NN CAP.xlsx> --limite 12 --lote`.
  Aplica la misma puerta y el tope de 30 combinaciones del lote.
- Evaluación contra la llenada manual:
  `npm run ia:ocupaciones -- --padron <sem NN CAP.xlsx> --limite 20 --salida resultados.csv`.
  - Escribe una fila por combinación de puesto y centro de costos, con la clave
    del padrón al lado.
  - Del padrón sólo lee esos dos campos.
