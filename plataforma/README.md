# La plataforma

Node 24 con Fastify, TypeScript y render en servidor. Es lo único que se
despliega; todo lo demás del repositorio lo produce, lo prueba o lo documenta.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Levanta el servidor. |
| `npm run dev` | Igual, recargando al guardar. |
| `npm run test:plataforma` | Pruebas de la plataforma. |
| `npm run typecheck` | `tsc --noEmit` con configuración estricta. |
| `npm run lint` | ESLint con reglas que consultan tipos. |
| `npm run format:check` | Prettier en modo comprobación. |

`npm test` corre el banco de los módulos compartidos y no incluye estas
pruebas: son dos bancos separados, con dependencias distintas.

## Por qué no hay paso de compilación

Node borra los tipos de TypeScript al cargar el módulo desde la 22.18, y en 24
está activo sin bandera. Los `.ts` se ejecutan directos y `tsc` se usa sólo como
verificador (`--noEmit`). No hay `dist/`, no hay artefacto intermedio y lo que
corre en producción es el mismo archivo que se lee en el editor.

Eso impone una restricción real: sólo sintaxis borrable. Nada de `enum`, ni
propiedades declaradas en parámetros del constructor, ni `namespace`. Los
imports relativos llevan la extensión `.ts` escrita.

## Cómo está organizado

```
src/
├── domain/          las reglas del negocio. No conoce HTTP, ni Fastify, ni SQL.
├── ports/           los contratos que el dominio declara hacia afuera.
├── adapters/        las implementaciones de esos contratos.
│   ├── postgres/    persistencia real
│   └── memoria/     equivalentes en memoria, para pruebas y corridas locales
├── routes/          una ruta por archivo; traduce HTTP a llamadas de dominio.
├── web/             render en servidor.
│   ├── pages/       una pantalla por archivo
│   ├── kit/         plantilla con escape, etiquetas, horarios y marca
│   ├── assets/      hojas de estilo, guiones e imágenes
│   └── pdf/         compositor de PDF sin dependencias
├── server/          fábrica de Fastify, guardia de rutas, sesión y errores.
├── config/          lectura y validación del entorno.
└── observability/   bitácora con saneamiento de datos personales.
```

Las carpetas de capa están en inglés porque nombran la arquitectura; lo que hay
dentro está en español porque nombra el negocio.

**La dirección de las dependencias es una sola:** `web` y `routes` dependen de
`server` y `domain`; `domain` no depende de nadie. Un `import` de `domain` hacia
`server` o hacia `fastify` es un error de diseño, no un detalle de estilo.

Los adaptadores de `memoria/` no son un atajo de pruebas: la plataforma arranca
con ellos cuando no hay `KCM_DATABASE_URL`, lo que permite recorrerla completa
sin base. `main.ts` es el único lugar del árbol que decide cuál de los dos juegos
se usa.

## Cómo están organizadas las pruebas

```
tests/
├── dominio/         reglas de negocio, sin servidor
├── rutas/           endpoints y pantallas, con `inject()`
├── caracterizacion/ congelan comportamiento contra el núcleo de referencia
├── armazon/         configuración, servidor, guardia, HTML y bitácora
├── estilo/          que ninguna vista use una clase que la hoja no declare
├── regresiones/     defectos concretos que no deben volver
└── apoyo/           fixtures y declaraciones de tipo
```

## Garantías cubiertas por pruebas

- **El número de trabajador es texto de cinco dígitos.**
  `src/domain/numero-trabajador.ts` lo valida y nunca lo convierte a número; el
  mensaje de rechazo no reproduce el valor recibido.
- **La consola cierra por omisión.** `src/server/guardia.ts` deniega toda ruta
  que no esté en su lista blanca; una ruta nueva nace cerrada.
- **El HTML escapa por omisión.** Interpolar texto es seguro; publicar marcado
  crudo exige `rawHtml`. Un objeto interpolado lanza en vez de imprimirse.
- **La bitácora no publica datos personales.** El saneamiento vive en el
  transporte, no en quien escribe la línea: enmascara números de cinco dígitos,
  CURP y correos en cualquier cadena, incluida la ruta de la petición.
- **La configuración falla cerrado.** Un entorno desconocido, un puerto fuera de
  rango o un secreto ausente detienen el arranque.
- **Todo responde `no-store`** salvo la hoja de estilos, que va bajo su hash de
  contenido. Sin scripts y sin orígenes externos, por política de contenido.
- **Un error 5xx nunca filtra su causa.** Responde un texto fijo y el
  `requestId`; el detalle queda en la bitácora atado a ese identificador.

## Configuración

Las variables están documentadas en [`.env.example`](../.env.example). Ningún
secreto vive en el árbol.
