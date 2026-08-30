# Las cuatro fuentes de verdad

Regla declarada por el departamento el 2026-08-18. **Todo lo que la plataforma
muestra o calcula sale de estas cuatro fuentes y de ninguna más.** El DNC, la
cobertura, los tableros, la ficha del trabajador y la constancia DC-3 son
derivaciones de ellas; ninguna función inventa un dato ni lo captura por su
cuenta.

Este archivo es el contrato. Antes de agregar un campo a una pantalla, buscar
aquí de qué fuente sale. Si no sale de ninguna, no se agrega.

Aquí se declara **qué** dato manda. El **cuándo** —con qué cadencia entra cada
fuente, cómo se reconoce la matriz del día, qué pasa cuando ella y la plataforma
escriben la misma fecha y cómo se prueba que el día cerró— está en
[`CICLO_DE_DATOS.md`](../arquitectura/CICLO_DE_DATOS.md).

---

## 1. La matriz de competencias (XLSB)

**Qué aporta:** el historial de capacitación —qué curso tomó cada trabajador y
cuándo, y por lo tanto qué le falta—, más la identidad laboral con la que opera
la plataforma: nombre, número de trabajador, área y puesto.

**Cómo entra:** el cliente VBA la lee en la PC donde vive, arma el snapshot y lo
transmite por el puente. Los bytes del libro no viajan. La revisión se ve en
`/matriz` antes de aplicarse.

**Es autoridad de:** las fechas de curso, el catálogo de cursos, el área, el
departamento, el puesto, el tipo de nómina y la planta.

## 2. El padrón semanal (XLSX)

**Qué aporta:** quién está activo, con CURP y fecha de alta, separado en
sindicalizados (`SND ACTIVOS`) y personal de confianza (`EMP ACTIVOS`). Es la
fuente de mayor autoridad sobre la existencia y la contratación de una persona,
porque viene de Recursos Humanos y se emite cada semana.

**Cómo entra:** el archivo completo viaja a la plataforma —aquí sí los bytes— y
lo interpreta el extractor del servidor, no la macro. La revisión se ve en
`/padron`.

**Es autoridad de:** la CURP y la fecha de alta —que por regla del departamento
es la fecha del curso de Inducción a la empresa— y la clave de ocupación cuando
el libro la trae.

**Lo que aporta y no se toma, con su motivo:**

- **RFC** (columna `R.F.C.`, presente en las dos hojas). Decisión del 2026-08-18:
  no se incorpora mientras ninguna función lo necesite. El DC-3 pide CURP, no
  RFC. La columna está en la fuente y se puede leer el día que haga falta.
- **IMSS, centro de costos, dirección, código postal, estado civil, sexo y
  antigüedad en años/meses/días.** Datos personales que ninguna función usa; la
  antigüedad además se deriva de la fecha de alta.
- **Las hojas de bajas** (`SND BAJAS`, `BAJAS EMP`). Decisión del 2026-08-18: se
  dejan fuera. Ninguna carga desactiva a nadie, y por lo tanto los porcentajes de
  cobertura siguen contando a quien ya causó baja.

**Cuidado con la columna `AREA`.** En el padrón trae tres valores para mil
seiscientas filas —`ECATEPEC I`, `ECATEPEC II`, `MANTTO INGENIERIA`— y es la
**planta**, no el área operativa. El área de la matriz tiene treinta y ocho
valores como `SERVILLETAS Y FACIALES`. Compararlas porque comparten rótulo
produciría mil seiscientas divergencias falsas. Se lee como `plant` y se
contrasta contra `kcm.trabajador.planta`.

## 3. Los cursos unificados

**Qué aporta:** qué curso es obligatorio para quién. Ocho cursos de calidad
asignados por departamento —128 pares en
`cursos_departamentos_unificado.tsv`— y trece cursos técnicos asignados por área
—de la exportación de CAPTA, `dnc_trabajadores 2.html`—.

**Cómo entra:** catálogo versionado con aprobador, compilado en `packages/dnc/`.

**Es autoridad de:** la obligación. La matriz dice qué se tomó; sólo esta fuente
dice qué había que tomar. Deducir la obligación de la matriz convertiría el
rezago en norma: un curso que nadie tomó parecería no aplicable y jamás
produciría un pendiente.

**Estado:** las 128 reglas de calidad están en la base; **las trece técnicas no
están cargadas**, aunque el motor las compila.

## 4. La configuración legal del DC-3

**Qué aporta:** duración en horas, clave de área temática sobre el catálogo de
178 claves, agente capacitador, los tres firmantes, y la razón social y el RFC
**del patrón** —no del trabajador—.

**Cómo entra:** captura humana en `referencias/privado/dc3-config.json` y en
`kcm.metadato_curso_dc3`. Es la única de las cuatro que no viene de un archivo
entregado: se decide y se escribe.

**Estado:** los tres cursos tienen duración y área temática; **falta el agente
capacitador** y ninguno está aprobado, así que no se puede emitir.

---

## Quién manda cuando dos fuentes hablan del mismo dato

Sólo ocurre en dos campos, y los dos están decididos:

| Campo | Manda | Por qué |
|---|---|---|
| Tipo de nómina (`NS`/`NQ`) | La matriz | La plataforma la consulta a diario; el padrón lo declara por hoja y la divergencia se avisa |
| Planta | La matriz | Igual que el anterior |

**La decisión no es que el padrón se ignore.** El padrón es la fuente de mayor
autoridad sobre cómo está contratada una persona, así que cuando las dos difieren
la revisión de `/padron` lo denuncia en una tabla propia, con número de nómina y
los dos valores. **Aplicar la carga no cambia ninguno de los dos campos.** Elegir
en silencio entre dos fuentes es exactamente lo que no debe hacer una carga.

## Lo que no sale de ninguna fuente, y por eso no existe

- **Foto del trabajador.** Ni la matriz ni el padrón la traen. La ficha no la
  muestra.
- **Escolaridad.** Sin fuente. Se declaró un valor por omisión que **nunca se
  cargó**: `kcm.atributo_declarado` está en cero filas. No alimenta ninguna regla
  ni ningún porcentaje.
- **Cualquier campo nuevo** entra por `kcm.campo_declarado`, que exige aprobación
  antes de que una regla pueda usarlo. Hoy está vacía.

## Lo que nace dentro de la plataforma y no es «fuente de verdad»

Las sesiones de capacitación, la asistencia del quiosco, los exámenes, las
exclusiones de preliberación, las reservas de sala y la auditoría **se generan
aquí**: son la operación del día, no datos de personal. La regla de las cuatro
fuentes gobierna quién es cada trabajador, qué tomó y qué debe tomar; no gobierna
lo que la plataforma registra mientras opera.

La frontera entre ambos mundos está en la liberación: una sesión liberada escribe
una fecha de curso con procedencia `SESSION_RELEASE`, y a partir de ahí ese dato
convive con los de la matriz bajo la reconciliación por procedencia.
