# Decisiones de arquitectura

Las decisiones que gobiernan la plataforma, con el motivo que las sostiene y lo
que cuesta cambiarlas. Están ordenadas de la más estructural a la más local.

Quien vaya a modificar el sistema debería leer este documento antes que el
código: varias de estas decisiones parecen arbitrarias hasta que se conoce el
problema que resuelven, y casi todas tienen una prueba que falla si se revierten
por descuido.

---

## 1. Node 24 ejecutando TypeScript sin paso de compilación

**Decisión.** La plataforma corre los archivos `.ts` directamente. No hay
`dist/`, no hay `build`, y `tsc` queda únicamente como verificador de tipos.

**Motivo.** Desde Node 22.18 el runtime borra las anotaciones de tipo al cargar
el módulo, y en 24 está activo sin bandera. Lo que corre en producción es el
mismo archivo que se lee en el editor, lo que elimina la clase de defecto en que
el artefacto desplegado no corresponde al fuente.

**Consecuencia.** Sólo se admite sintaxis borrable: nada de `enum`, ni
propiedades declaradas en parámetros del constructor, ni `namespace`, y los
imports relativos llevan la extensión `.ts` escrita. `npm run typecheck`
es obligatorio en CI porque el runtime no comprueba tipos.

---

## 2. PostgreSQL a secas, sin acoplamiento al proveedor

**Decisión.** La aplicación habla con PostgreSQL 17 mediante `pg` y una cadena
de conexión. No usa el SDK de Supabase, ni PostgREST, ni su capa de
autenticación, ni su almacenamiento de archivos.

**Motivo.** El alojamiento es una decisión operativa reversible y no un
compromiso arquitectónico. Migrar a un servidor interno debe costar una cadena
de conexión y un volcado, no una reescritura.

**Consecuencia.** Las dependencias de ejecución son dos: `fastify` y `pg`. Los
adaptadores viven en `plataforma/src/adapters/postgres/` y ejecutan SQL contra
cualquier PostgreSQL. El entorno de desarrollo en contenedores levanta un
`postgres:17` normal con las mismas migraciones, sin una sola modificación.

Se exige la versión 17 y no una anterior: el esquema usa `EXCLUDE ... USING
gist` y dominios con `CHECK`. Requiere además `btree_gist` y `pgcrypto`, ambas
del paquete `contrib` estándar.

---

## 3. La autoridad sobre los datos está repartida, y no unificada

**Decisión.** El libro maestro de Excel conserva la autoridad sobre el historial
de capacitación. La base conserva la autoridad sobre la operación: sesiones,
asistencias, liberaciones, reservas y auditoría.

**Motivo.** Una migración que declarara la base como verdad única y congelara el
libro obligaría a apagar el instrumento con el que el departamento trabaja hoy,
antes de que la plataforma haya demostrado cubrirlo. La repartición permite
avanzar sin un corte.

**Consecuencia.** Existe reconciliación por procedencia y existe el puente que
sincroniza en ambos sentidos. Es más trabajo que una verdad única, y es
deliberado.

---

## 4. Cuatro fuentes de verdad, y ninguna más

**Decisión.** Todo lo que la plataforma muestra se deriva de la matriz de
competencias, el padrón semanal, el catálogo unificado de cursos y la
configuración legal del DC-3.

**Motivo.** Sin esta regla, cada pantalla nueva tiende a introducir un campo que
nadie sabe de dónde sale, y el sistema deja de ser auditable.

**Consecuencia.** Antes de agregar un campo a una pantalla hay que localizar de
qué fuente proviene, en `docs/referencia/FUENTES_DE_VERDAD.md`. Si no proviene
de ninguna, no se agrega. Cuando dos fuentes se contradicen, la divergencia se
denuncia en pantalla en lugar de resolverse por escritura silenciosa.

---

## 5. Seguridad por fila forzada, con lectura a través de funciones

**Decisión.** Todas las tablas del esquema `kcm` tienen `ROW LEVEL SECURITY`
forzada y sin políticas permisivas. La lectura no ocurre contra las tablas sino
contra funciones `SECURITY DEFINER` del esquema `kcm_lectura`, que proyectan
únicamente las columnas autorizadas. La aplicación se conecta con el rol
`kcm_app`, creado `NOBYPASSRLS`.

**Motivo.** Es la única garantía que sobrevive a un error de programación en una
consulta. Una política permisiva por omisión convierte cualquier descuido en una
fuga.

**Consecuencia.** Conectar la aplicación con un superusuario —por ejemplo
«mientras se estabiliza» durante una migración— destruye la garantía completa
sin que nada deje de funcionar y sin que nadie lo note. Es el error más caro que
se puede cometer con este esquema.

---

## 6. Los ledgers sólo se agregan

**Decisión.** Auditoría, liberaciones, acuses del puente, eventos DC-3 e
historial de sobrescritura rechazan `UPDATE`, `DELETE` y `TRUNCATE` mediante
disparadores.

**Motivo.** Un registro que se puede editar no es evidencia.

**Consecuencia.** No existe una limpieza selectiva de datos de prueba. Vaciar el
entorno significa tirar los dos esquemas y reconstruirlos; el procedimiento está
en `database/RESET.md`.

---

## 7. El número de trabajador es texto de cinco dígitos

**Decisión.** Se valida contra `^\d{5}$`, viaja como cadena en todos los
contratos y tiene su propio dominio en la base. Jamás se convierte a número.

**Motivo.** Los ceros a la izquierda son significativos. Una sola conversión
implícita a entero en cualquier punto del recorrido convierte `01234` en `1234`
y rompe la identidad de la persona en silencio.

**Consecuencia.** El verificador de proyecto falla si encuentra un literal
entero de cinco dígitos asignado a un identificador de trabajador. El mensaje de
rechazo no reproduce el valor recibido, para no filtrar identidades al registro.

---

## 8. Sobrescribir sí, borrar no

**Decisión.** Una fecha de capacitación puede sobrescribirse, pero sólo cuando
concurren tres condiciones: el destino declara la política
`OVERWRITE_WITH_HISTORY`, hay un motivo capturado, y el valor anterior queda
persistido con actor, momento y procedencia **antes** de escribir el nuevo.

**Motivo.** El departamento necesita corregir errores de captura; la auditoría
necesita que ninguna corrección sea indistinguible de una pérdida de dato.

**Consecuencia.** No hay operación de borrado en el dominio. Retirar una fecha
es un asiento más en el historial de sobrescritura.

---

## 9. La liberación es una saga con journal durable

**Decisión.** La liberación a la matriz avanza por fases recuperables
—`PENDIENTE`, `MATRIZ_APLICADA`, `DOMINIO_APLICADO`, `COMPLETADO`, con salida a
`CONFLICTO`—, revalidando el dominio antes de cada efecto y dejando un marcador
por efecto. El lote va autenticado con HMAC por fila y SHA-256 del plan
congelado.

**Motivo.** Los efectos caen en dos almacenes distintos y el acuse de la
escritura física llega después, por el puente. Una transacción no abarca eso.
Una interrupción a mitad de camino deja el lote incompleto, y sólo un journal
permite retomarlo exactamente donde quedó.

**Consecuencia.** Un reintento con el mismo `requestId` es una recuperación, no
una segunda escritura. El lote aborta entero ante un solo conflicto: no existe
liberación parcial. Es la parte del sistema donde un defecto pierde datos
reales, y por eso cada fase vuelve a comprobar lo que la anterior ya comprobó.

---

## 10. El libro maestro sólo lo escribe el cliente de Excel

**Decisión.** El proceso de Node nunca abre ni modifica el archivo XLSB. Calcula
el plan de escritura, lo deja en estado `PENDIENTE_ACUSE`, y el cliente VBA
aplica y acusa.

**Motivo.** El archivo vive en la red del departamento, lo tienen abierto
personas mientras se trabaja, y su formato binario no admite escritura
concurrente segura desde un proceso servidor.

**Consecuencia.** Existe un único escritor autorizado. Hoy eso se sostiene
porque sólo se emite una credencial de puente; los índices únicos garantizan una
credencial vigente por instalación, pero no impiden emitir una segunda con otro
identificador de cliente. Si la instalación crece, la regla debe volverse
estructural.

---

## 11. Render en servidor, sin JavaScript de cliente

**Decisión.** Las pantallas se componen en el servidor y se operan con
formularios. La política de contenido declara `default-src 'none'`, sin scripts
ni orígenes externos. Las gráficas se dibujan como SVG en el servidor.

**Motivo.** Elimina de raíz la superficie de scripting entre sitios, evita una
cadena de compilación de front, y hace que la plataforma funcione en las
máquinas de planta sin depender de la versión del navegador.

**Consecuencia.** No hay interacción que requiera JavaScript. Todo cambio de
estado es un envío de formulario, y la plantilla de HTML escapa por omisión:
interpolar un objeto lanza en lugar de imprimir `[object Object]`.

---

## 12. La puerta de la consola cierra por omisión

**Decisión.** Un enganche en `onRequest` deniega toda ruta que no esté en una
lista blanca explícita. Sin sesión, una pantalla redirige a `/acceso` con el
destino puesto y una ruta de máquina responde `401`.

**Motivo.** Una lista negra deja abierta cada ruta que alguien agregue mañana y
olvide anotar. La lista blanca falla del lado seguro: una ruta nueva nace
cerrada.

**Consecuencia.** Abrir una ruta exige declararlo en `plataforma/src/server/guardia.ts`
con su motivo. Lo que está abierto no es lo desprotegido: son las rutas que
traen su propio secreto —PIN de quiosco, contraseña de agenda, credencial de
equipo— o que no revelan nada.

---

## 13. El traslape de salas lo impide la base

**Decisión.** La exclusión de reservas superpuestas se declara con
`EXCLUDE ... USING gist` sobre el rango temporal, no con una comprobación en la
aplicación.

**Motivo.** Una comprobación aplicativa tiene una ventana entre la lectura y la
escritura. Dos personas reservando la misma sala en el mismo segundo la
atraviesan.

**Consecuencia.** La base requiere la extensión `btree_gist`. Cancelar una
reserva no la borra: cierra su vigencia.

---

## 14. Un solo cliente de Excel para Windows y macOS

**Decisión.** El cliente VBA es un único código. Todo lo dependiente del sistema
operativo vive detrás del módulo `KcmPlataforma`, y el analizador de VBA rechaza
un `#If Mac` fuera de ese puerto.

**Motivo.** El compilador de cada sistema compila sólo su rama, de modo que una
rama por sistema duplica el código sin que las pruebas de uno cubran al otro.
Una bifurcación sólo se justifica cuando no existe forma de escribir una sola
cosa que sirva para ambos.

**Consecuencia.** El diccionario y las codificaciones están reescritos en VBA
puro en lugar de apoyarse en componentes de Windows. En macOS el transporte usa
`curl` mediante `AppleScriptTask`, con `popen` como respaldo; en Windows,
WinHTTP. Probar en un sistema no demuestra nada sobre el otro: el libro trae una
autoprueba para eso.

---

## 15. Los datos personales se sanean en el transporte del registro

**Decisión.** El enmascarado de números de trabajador, CURP y correos ocurre en
el transporte de la bitácora, no en quien escribe la línea.

**Motivo.** Confiar en que cada llamada recuerde enmascarar garantiza que alguna
no lo haga. Situarlo en el transporte lo hace incondicional, incluida la ruta de
la petición.

**Consecuencia.** Los números que no son identidades se conservan, para no
inutilizar las métricas.

---

## 16. Las evidencias viven en la base, no en disco

**Decisión.** Los reportes PDF de preliberación se guardan en PostgreSQL y no en
el sistema de archivos del proceso.

**Motivo.** El alojamiento en contenedores no garantiza disco persistente entre
despliegues. Un archivo en disco desaparece en el siguiente ciclo, y el
apuntador queda señalando a nada.

**Consecuencia.** Si `KCM_STORAGE_DIR` se define, la plataforma vuelve al
almacén en disco. No debe definirse en un alojamiento sin volumen persistente.

---

## 17. El DNC se evalúa en dos niveles

**Decisión.** Las reglas de aplicabilidad se declaran por departamento y por
área, con vigencia y recurrencia, y producen seis estados de negocio.
`DATOS_INSUFICIENTES` queda aislado de la base de cálculo de los porcentajes.

**Motivo.** Hay cursos que aplican a un departamento entero y cursos técnicos
que sólo aplican a un área. Contar los casos sin dato suficiente como
incumplimiento produce una cobertura falsa hacia abajo, que es peor que no
reportarla.

**Consecuencia.** Los tres resúmenes se calculan en la base y no trayendo las
filas al proceso.

---

## 18. El reconocimiento óptico quedó retirado

**Decisión.** El reconocimiento de listas de asistencia escaneadas está
cancelado. El registro ocurre en el quiosco.

**Motivo.** La precisión alcanzable no justificaba la revisión manual que
requería, y el quiosco resuelve el mismo problema en el origen.

**Consecuencia.** Ni el motor ni sus dependencias nativas forman parte del
sistema. Si vuelve a plantearse, es un proyecto nuevo y no una reactivación.
