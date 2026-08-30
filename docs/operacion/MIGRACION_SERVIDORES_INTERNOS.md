# Migración a servidores internos

Documento de decisión para el área de sistemas. Describe **qué exige la
plataforma para correr dentro de la red de la planta**, qué está ya resuelto y
qué habría que decidir. No propone un calendario ni da la migración por
acordada.

Hoy la plataforma corre en Render (plan gratuito, contenedor Docker) contra
PostgreSQL alojado en Supabase. Ninguna de las dos cosas es un requisito del
diseño.

---

## 1. Lo corto: qué tan acoplado está

**Poco.** Los dos puntos que suelen atar una aplicación a su proveedor no la
atan aquí:

- **La base es PostgreSQL a secas.** La aplicación se conecta con `pg` por una
  cadena `postgresql://` en `KCM_DATABASE_URL`. No usa el SDK de Supabase, ni
  PostgREST, ni su capa de autenticación, ni su almacenamiento de archivos. Los
  adaptadores viven en `plataforma/src/adapters/postgres/` y hablan SQL por el
  mismo `SqlExecutor` contra cualquier PostgreSQL.
- **No hay almacenamiento de objetos externo.** Las evidencias viven en la
  propia base (`PostgresObjectStore`), precisamente para no depender de un disco
  que sobreviva al redespliegue ni de un bucket.

Las dependencias de ejecución son **dos**: `fastify` y `pg`. Todo lo demás es
de desarrollo.

**Esto no es una promesa: ya está probado.** El archivo `infra/compose.yaml` de la
raíz levanta la plataforma completa contra un `postgres:17-bookworm` normal,
aplicando **las mismas migraciones del árbol, sin una sola modificación**. Es el
entorno de desarrollo de todos los días. Migrar es, en lo esencial, hacer eso
mismo con datos reales y una operación seria detrás.

---

## 2. Lo que hay que provisionar

**PostgreSQL 17.** No una versión menor. El esquema usa `EXCLUDE ... USING gist`
para el invariante de traslape de salas y dominios con `CHECK`; una versión
anterior no es equivalente. La referencia es la 17.6, que es la que corre hoy.

Dos extensiones, ambas del paquete `contrib` estándar:

- `btree_gist`, que habilita el `EXCLUDE` de salas. Sin ella el invariante se
  cae a un bloqueo aplicativo, que es peor.
- `pgcrypto`, para `digest()` en las claves derivadas del ledger DC-3.

Las migraciones las crean en un esquema llamado `extensions`, que ya se declara
con `CREATE SCHEMA IF NOT EXISTS` por si el destino no lo trae.

**Node 24 o superior**, o Docker. Hay imagen: `infra/docker/Dockerfile`.

**Salida HTTPS hacia la plataforma desde las tres computadoras**, y nada más. El
cliente VBA exige TLS con una única excepción, `127.0.0.1` y `localhost`; un
nombre de equipo o una IP interna en claro se rechazan. Si la plataforma va a
publicarse en la red interna, **necesita certificado**, aunque no salga a
Internet.

---

## 3. Roles y seguridad por fila

Este punto merece atención porque es donde una migración descuidada pierde la
garantía principal.

Todas las tablas de `kcm` tienen **RLS forzada y sin políticas permisivas**: la
lectura no ocurre contra las tablas sino contra funciones `SECURITY DEFINER` del
esquema `kcm_lectura`, que proyectan sólo las columnas autorizadas. La
aplicación se conecta con el rol **`kcm_app`, creado `NOBYPASSRLS`**. No es un
detalle de configuración: si alguien conecta la aplicación con un superusuario
«mientras se estabiliza», la seguridad por fila deja de existir y nadie lo nota,
porque todo sigue funcionando.

Las migraciones dan por existentes tres roles que Supabase crea solo: `anon`,
`authenticated` y `service_role`. Un PostgreSQL recién instalado no los tiene y
`0017`/`0018` fallan con «role does not exist». Ya está resuelto:
`database/seed/00-compatibilidad-supabase.sql` los crea como `NOLOGIN`, y lo aplica
`tools/db/aplicar-migraciones.js --local`. Existen sólo para ser destinatarios de
un `GRANT` y para que el deny-by-default tenga a quién negarle acceso.

---

## 4. Variables de entorno

Obligatorias en cuanto hay base:

- `KCM_DATABASE_URL` — cadena del rol `kcm_app`.
- `KCM_KIOSK_TOKEN_SECRET` y `KCM_RELEASE_INTEGRITY_SECRET` — secretos reales.
  `requireSecret` no admite valor por omisión y falla cerrado: un secreto con
  valor por omisión es un secreto publicado.

De operación: `KCM_ENV=production`, `KCM_HOST`, `KCM_PORT`, `KCM_LOG_LEVEL`,
`KCM_REQUEST_TIMEOUT_MS`. `KCM_ALLOW_PUBLIC_BIND=1` sólo si el proceso debe
escuchar fuera de loopback, que es el caso detrás de un balanceador y no lo es
detrás de un túnel.

Administrativa, sólo para dos guiones: `KCM_ADMIN_DATABASE_URL`, un rol capaz de
crear esquemas y roles. La aplicación nunca la usa.

**Ninguna `KCM_PILOT_*` sobrevive a la migración.** Son contraseñas planas de la
corrida piloto y `loadConfig` rechaza el arranque si alguna vive con
`KCM_ENV=production`. Esa es justamente la garantía de que no lleguen al
despliegue real.

---

## 5. Cómo se movería

El orden importa menos que el hecho de que cada paso es reversible hasta el
último.

1. **Levantar la base interna** y aplicar el esquema con
   `node tools/db/aplicar-migraciones.js --local`. Es incremental: consulta
   `supabase_migrations.schema_migrations` y sólo corre lo que falte, así que
   repetirlo no hace nada la segunda vez.
2. **Migrar los datos.** `pg_dump` del origen y restauración en el destino. No
   hay nada fuera de la base que mover: ni archivos, ni buckets, ni colas.
3. **Crear las cuentas de consola** con `tools/db/alta-cuenta-consola.js`. La
   plataforma verifica cuentas pero no las crea; sin este paso nadie entra.
4. **Publicar la aplicación** con certificado y comprobar `/healthz`.
5. **Repuntar los tres equipos**: en el de escritura basta volver a ejecutar
   `KcmAsistenteConexion` con el endpoint nuevo, y emitir de nuevo la credencial
   del puente, que va ligada a la instalación. Los otros dos sólo cambian la
   dirección del navegador.
6. **Dar de baja el origen** cuando la operación de una semana haya corrido
   entera contra el destino, no antes.

El punto 5 es la única parte que toca a las personas, y son minutos: está
descrita en [PUESTA_EN_MARCHA_TRES_EQUIPOS.md](PUESTA_EN_MARCHA_TRES_EQUIPOS.md).

---

## 6. Lo que se gana y lo que se pierde

**Se gana** que el dato deje de salir de la planta, que el arranque perezoso del
plan gratuito desaparezca —hoy la primera pantalla del día puede tardar cerca de
un minuto—, y control sobre respaldos y retención.

**Se pierde** lo que hoy es de alguien más: respaldos automáticos, parches del
motor, disponibilidad. Pasan a ser trabajo del área. Conviene decirlo
explícitamente porque es el costo real de la migración, y no aparece hasta el
primer disco lleno o el primer PostgreSQL sin actualizar.

---

## 7. Antes de decidir, dos cosas abiertas

Ninguna impide migrar; las dos conviene resolverlas en el mismo movimiento,
porque después cuesta más.

**El barrido de la matriz se aplica sin revisión.** Cuando la VBA transmite, el
servidor recibe el barrido completo y lo aplica en la misma llamada; lo que no
venga en el archivo se retira. Un libro incompleto pero coherente —un filtro
puesto, un rango recortado— no produce ningún conflicto y se aplica. El panel de
Excel avisa de los retiros, pero después de escribir. Las dos salidas posibles
están descritas en el análisis del puente: que el puente se detenga y alguien
apruebe desde la consola, o que se detenga sólo cuando el barrido retiraría
filas.

**Un solo escritor es una regla administrativa, no una restricción de la base.**
Los índices únicos garantizan una credencial vigente por `client_id` y por
combinación de principal, perfil y equipo, pero **nada impide emitir una segunda
credencial `PUENTE_VBA` con otro `client_id`** y tener dos equipos escribiendo.
Hoy se sostiene porque sólo se emite una. Si la instalación va a crecer, esto
merece volverse estructural.
