# Entorno de desarrollo en contenedores

> [!IMPORTANT]
> **Verificado estáticamente; sin construir.** La máquina donde se redactó este
> entorno no tiene Docker instalado, así que las imágenes nunca se armaron. Lo
> que sí está comprobado, y corre en cada verificación, es que la imagen de
> producción contiene todo lo que el proceso importa (`npm run check:imagen`).
> La primera persona que ejecute `npm run docker:up` está haciendo la prueba de
> humo; lo que encuentre se corrige aquí. La lista de lo pendiente está al
> final.

Este documento cubre **desarrollo**. El despliegue es otra cosa y vive en
[`render.yaml`](../../render.yaml) y en `infra/docker/Dockerfile`.

---

## Para qué existe

Para que alguien que nunca vio el proyecto pueda modificar código el mismo día.
Sin instalar Node, sin instalar PostgreSQL, sin pedir una credencial y sin tocar
un solo dato real.

```bash
git clone <repositorio>
cd kcm-cap
npm run docker:up
```

Al terminar hay una plataforma navegable en <http://localhost:8787> con el
esquema completo, cuarenta trabajadores sintéticos y las reglas DNC suficientes
para ver los seis estados.

---

## Lo que este entorno no hace

> [!CAUTION]
> **No se cargan datos reales.** La base de este compose es local y se siembra
> con identidades inventadas. El padrón con CURP reales, el libro maestro y
> `referencias/privado/` están ignorados por Git, no viajan al contexto de
> construcción y no deben cargarse aquí.

Tampoco reemplaza al despliegue, ni ejecuta el ciclo del puente VBA: eso
necesita Excel, que no corre en un contenedor Linux.

---

## Las tres piezas

| Servicio | Qué es | Puerto |
|---|---|---|
| `base` | PostgreSQL 17, la versión de referencia del esquema | `127.0.0.1:55432` |
| `migraciones` | Aplica lo que falte y sale. Corre una vez por arranque | — |
| `plataforma` | Node 24 con `--watch` sobre el código montado | `127.0.0.1:8787` |

`plataforma` no arranca hasta que `migraciones` termina con éxito, así que nunca
se levanta el servidor contra una base a medio construir.

Los dos puertos se publican **sólo en loopback**. Nadie de la red alcanza tu
entorno de desarrollo por accidente.

---

## El primer arranque, paso a paso

```bash
npm run docker:up
```

1. `base` inicializa PostgreSQL y espera a responder `pg_isready`.
2. `migraciones` corre `tools/db/aplicar-migraciones.js --local --semilla`:
   - aplica `database/seed/00-compatibilidad-supabase.sql`, que crea los roles
     `anon`, `authenticated` y `service_role`. Las migraciones les conceden
     permisos por nombre y sin ellos `0017` y `0018` fallan con
     «role does not exist»;
   - aplica las migraciones de `database/migrations/` en orden, omitiendo `0026`, que
     es la que declara una corrida piloto;
   - aplica `database/seed/semilla-sintetica.sql`.
3. `plataforma` arranca `node --watch plataforma/src/main.ts`.

Tarda unos minutos la primera vez, casi todo en `npm ci`. Los arranques
siguientes son de segundos.

---

## Editar código

Se edita en el editor de siempre, en el repositorio de siempre. El contenedor
monta la carpeta y `node --watch` reinicia el proceso al guardar. No hay que
reconstruir nada ni entrar al contenedor.

Lo único que **no** viene del anfitrión es `node_modules`: vive en un volumen
propio porque el repositorio trae los binarios del sistema anfitrión y dentro
corre Linux.

---

## Correr pruebas y linters

```bash
npm run docker:consola          # una consola dentro del contenedor

# o directamente:
docker compose -f infra/compose.yaml exec plataforma npm run verify
```

El servicio monta el repositorio, así que corre el mismo código que editas.

---

## Las tres cosas que se rompen

### Cambié `package.json` y el contenedor no ve la dependencia nueva

`node_modules` es un volumen nombrado y **no se actualiza solo**. Docker lo
puebla la primera vez desde la imagen y después lo deja en paz, así que
reconstruir la imagen no basta.

```bash
npm run docker:limpiar
npm run docker:reconstruir
```

Esto también borra la base. Es lo correcto en desarrollo: se reconstruye sola en
el siguiente arranque.

### Agregué una migración y no se aplicó

`migraciones` es incremental: consulta `supabase_migrations.schema_migrations` y
salta lo ya registrado. Con el compose arriba:

```bash
docker compose -f infra/compose.yaml up migraciones
```

No hace falta borrar la base ni reiniciar la plataforma.

### El puerto 8787 o el 55432 ya están ocupados

Cambia el lado izquierdo del mapeo en `infra/compose.yaml`. El 55432 se eligió
precisamente para no chocar con un PostgreSQL instalado en la máquina.

---

## Reiniciar de cero

```bash
npm run docker:limpiar
npm run docker:up
```

Borra la base local y la vuelve a construir con la semilla. Es una operación
barata y sin consecuencias: aquí no hay nada que conservar.

---

## Entrar a la base

```bash
npm run docker:psql
# o desde el anfitrión, con cualquier cliente:
#   postgresql://postgres:postgres@127.0.0.1:55432/kcm
```

La contraseña está en claro en `infra/compose.yaml` a propósito. Esa base sólo escucha
en loopback y no contiene un solo dato real; un secreto de verdad ahí daría una
falsa sensación de frontera.

---

## Cómo se conecta la plataforma

Como `kcm_app`, el mismo rol sin `BYPASSRLS` que usa producción. Es deliberado:
así el entorno de desarrollo ejercita la seguridad por fila de verdad y un
permiso que falte aparece aquí y no en el despliegue. El rol lo crea la
migración `0029` con la contraseña que el compose pasa en `KCM_APP_PASSWORD`.

Los secretos `KCM_KIOSK_TOKEN_SECRET` y `KCM_RELEASE_INTEGRITY_SECRET` se
exigen en cuanto hay `KCM_DATABASE_URL`: `main.ts` los lee con `requireSecret`,
que falla cerrado. Por eso el compose los declara, con valores de juguete. Una
corrida en memoria —sin cadena de conexión— cae a las constantes de desarrollo
de `build-server.ts`, lo que es aceptable porque no persiste nada.

---

## Qué trae la semilla

`database/seed/semilla-sintetica.sql`, toda inventada:

- **5 departamentos** y **4 áreas**, incluida `GERENCIA DE MANTTO. ELECTRICO`,
  que es la que permite probar la regla DNC de nivel `AREA`.
- **7 puestos**.
- **40 trabajadores**, con números de nómina `90001`–`90040`. El rango `9xxxx`
  no se usa en la planta, así que una fila sintética nunca puede confundirse con
  una real.
  - los 9 primeros están en el área eléctrica: son la población de los cursos
    técnicos;
  - **del 29 al 40 quedan sin departamento a propósito**. Son los que el motor
    debe reportar como `DATOS_INSUFICIENTES` y dejar fuera de todo porcentaje.
    Sin ellos ese camino nunca se ejercita.
- **7 cursos** además de los tres de DC-3 que ya siembra la migración `0022`.
- El **alias `BPM`**, cuya omisión reportaría BPM como pendiente para la planta
  entera. Se siembra para que ese defecto no pueda reaparecer sin que alguien lo
  note en local.
- **Fechas de capacitación** repartidas para que aparezcan `COMPLETADO`,
  `REFORZAR` y `PENDIENTE`.
- **Reglas DNC** en los dos niveles.

Es idempotente: correrla dos veces no duplica nada.

### Acceso a las pantallas

El compose declara `KCM_PILOT_OPEN_ACCESS=1`, que es exactamente para esto:
ninguna pantalla pide contraseña ni PIN y se puede recorrer la plataforma
completa. `loadConfig` rechaza el arranque si esa bandera vive con
`KCM_ENV=production`.

No se siembra ninguna cuenta de `/acceso` porque PostgreSQL no implementa
scrypt —`pgcrypto` trae md5, sha, bf y xdes, no scrypt— y cualquier hash
calculado en SQL produciría una cuenta que parece existir y nunca deja entrar.
Quien quiera una nominal la crea con `npm run db:cuenta`.

---

## Las dos imágenes, y por qué son distintas

| | `infra/docker/Dockerfile` | `infra/docker/Dockerfile` |
|---|---|---|
| Para | Desarrollar | Desplegar |
| Dependencias | Todas, incluidas las de desarrollo | Sólo `fastify` y `pg` |
| Código | Entra por bind mount | `COPY`, enumerado archivo por archivo |
| Contexto | Dos archivos | El árbol menos lo que niega `.dockerignore` |
| Se reconstruye | Cuando cambian las dependencias | En cada despliegue |

Las dos parten de `node:24.14.0-bookworm-slim`. Una diferencia de versión menor
entre ambas es la clase de deriva que hace que algo funcione en una laptop y no
en el despliegue.

Cada Dockerfile lleva su propio `Dockerfile.dockerignore`; BuildKit usa el que
coincide con el nombre del archivo. El de desarrollo niega el contexto entero y
readmite `package.json` y `package-lock.json`, con dos efectos: la construcción
tarda segundos, y **el padrón y el libro maestro no cruzan jamás hacia el
constructor**.

### La regla que mantiene honesta a la imagen de producción

El Dockerfile de producción enumera archivo por archivo lo que entra. Eso hace
que agregar un import hacia un módulo nuevo fuera de `app/` rompa el contenedor
en el primer arranque, con `ERR_MODULE_NOT_FOUND`, en lugar de fallar en
silencio.

`npm run check:imagen` adelanta ese fallo: recorre el cierre de imports desde
`plataforma/src/main.ts` y comprueba que todo módulo alcanzable esté cubierto por algún
`COPY`, y que las dependencias de ejecución declaradas coincidan exactamente con
las importadas. Corre en cada verificación y en CI.

---

## Lo que falta probar

Nada de esto se ha ejecutado:

- [ ] `npm run docker:reconstruir` termina en las dos arquitecturas que se usan
      (`arm64` en las Mac, `amd64` en las laptops Windows con WSL2).
- [ ] Las migraciones se aplican contra un PostgreSQL 17 que no es el del
      proveedor. El riesgo concreto son los `GRANT` a `anon` y `authenticated`,
      que `00-compatibilidad-supabase.sql` intenta cubrir.
- [ ] La semilla pasa todos los `CHECK`: el formato de CURP, el dominio de cinco
      dígitos y `regla_dnc_nivel_coherente`.
- [ ] La plataforma arranca conectada como `kcm_app` y las pantallas cargan.
- [ ] En Linux, los archivos que escriba el contenedor quedan con el usuario
      correcto. La imagen corre como `node` (uid 1000); si el anfitrión usa otro
      uid habrá que ajustarlo.
