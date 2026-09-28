# Herramientas de línea de comandos

Lo que se ejecuta a mano o desde CI, nunca dentro del servidor. Ninguna de estas
herramientas entra en la imagen de producción: `.dockerignore` niega la carpeta
entera.

Se invocan por `npm run`, no por ruta. Los guiones que tocan la base leen la
cadena de conexión de `.env` mediante `--env-file-if-exists`.

## `db/` — operación de la base

| Guion | Comando | Qué hace |
|---|---|---|
| `aplicar-migraciones.js` | `npm run db:migrar` | Aplica las migraciones que falten. Es incremental: consulta el historial y salta lo ya registrado. |
| `reset-base.js` | `npm run db:reset` | Reconstruye los dos esquemas desde cero. Destructivo; exige `--confirmo`. |
| `alta-cuenta-consola.js` | `npm run db:cuenta` | Crea una cuenta nominal de acceso a la consola. La plataforma verifica cuentas pero no las crea. |
| `cargar-padron.js` | `npm run db:padron` | Ingesta del padrón semanal. Con `--aplicar` escribe; sin él sólo reporta. |

`lib/migraciones.js` es el lector compartido: lo usan las dos primeras y es lo
que garantiza que una base local y una remota se lean igual.

Estos guiones necesitan un rol capaz de crear esquemas y roles
(`KCM_ADMIN_DATABASE_URL`), que es más de lo que la plataforma puede y debe
poder. La aplicación nunca los ejecuta.

## `build/` — generadores

| Guion | Comando | Qué produce |
|---|---|---|
| `semilla-catalogo.js` | `npm run build:semilla-catalogo` | El TSV de capacitaciones y empleados a partir de un snapshot. |
| `mapeo-matriz.js` | `npm run build:mapeo-matriz` | Las filas de `MATRIZ_MAPEO` propuestas desde un snapshot. |

Los dos escriben únicamente bajo `referencias/privado/`, que está fuera de Git.
Las constancias DC-3 no tienen generador de línea de comandos: se emiten desde
la consola.

## `check/` — verificaciones

| Guion | Comando | Qué comprueba |
|---|---|---|
| `proyecto.js` | `npm run check:proyecto` | Sintaxis de las fuentes que ESLint no cubre, que Git no rastree material privado y que ningún número de trabajador viaje como entero. |
| `vba.js` | `npm run check:vba` | Análisis estático del cliente de Excel: aquí no hay Excel para compilarlo. |
| `imagen.js` | `npm run check:imagen` | Que la imagen de producción contenga todo lo que el proceso importa, y que las dependencias declaradas coincidan con las usadas. |

Las tres corren en `npm run verify` y en CI.
