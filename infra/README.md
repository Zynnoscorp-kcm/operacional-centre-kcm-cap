# Empaquetado y despliegue

Cómo se construye la imagen y cómo se levanta la pila local. Nada de aquí corre
dentro del contenedor: es el material que lo produce.

## Las dos imágenes

| | `docker/Dockerfile` | `docker/Dockerfile.dev` |
|---|---|---|
| Para | Desplegar | Desarrollar |
| Dependencias | Sólo `fastify` y `pg` (`--omit=dev`) | Todas, incluidas las de desarrollo |
| Código | `COPY`, enumerado archivo por archivo | Entra por bind mount |
| Contexto | El árbol menos lo que niega `.dockerignore` | Dos archivos |
| Se reconstruye | En cada despliegue | Cuando cambian las dependencias |

Las dos parten de `node:24.14.0-bookworm-slim`. Una diferencia de versión menor
entre ambas es la clase de deriva que hace que algo funcione en una laptop y no
en el despliegue.

Cada Dockerfile lleva su propio `<nombre>.dockerignore`; BuildKit usa el que
coincide con el nombre del archivo.

## La regla que mantiene honesta a la imagen de producción

El Dockerfile enumera archivo por archivo lo que entra. Es deliberado: un
`COPY packages ./packages` a secas escondería la dependencia. El costo es que
agregar un import hacia un módulo nuevo fuera de `plataforma/` rompe el
contenedor en el primer arranque.

`npm run check:imagen` adelanta ese fallo al momento de la verificación:
recorre el cierre de imports desde el punto de entrada y comprueba que todo
módulo alcanzable esté cubierto por algún `COPY`.

## La pila local

`compose.yaml` levanta PostgreSQL 17, aplica las migraciones con la semilla
sintética y arranca la plataforma con recarga al guardar. Se opera por `npm`:

```bash
npm run docker:up          # levantar
npm run docker:down        # detener
npm run docker:limpiar     # detener y borrar la base
npm run docker:reconstruir # reconstruir imágenes desde cero
npm run docker:consola     # una consola dentro del contenedor
npm run docker:psql        # psql contra la base local
```

El contexto de construcción es la raíz del repositorio, un nivel arriba de este
archivo. Por eso los servicios declaran `context: ..`.

El detalle está en
[`docs/operacion/DESARROLLO_DOCKER.md`](../docs/operacion/DESARROLLO_DOCKER.md).

## Despliegue

`render.yaml` vive en la raíz del repositorio y no aquí, porque el proveedor lo
busca ahí. Apunta a `infra/docker/Dockerfile` y declara como secretos, sin
valor, la cadena de conexión y los dos secretos HMAC.
