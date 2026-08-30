/**
 * Lectura y aplicación de las migraciones de `database/migrations/`.
 *
 * Da una sola forma de correr las migraciones. Dos guiones la usan:
 * `aplicar-migraciones.js`, que avanza una base incremental —el caso del
 * entorno de desarrollo—, y `reset-piloto.js`, que reconstruye desde cero.
 *
 * El historial se guarda en `supabase_migrations.schema_migrations`, la misma
 * tabla que usa Supabase, para que una base local y la remota se lean igual y
 * `list_migrations` sirva en las dos.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const DIRECTORIO = "database/migrations";

/**
 * Comprueba que la cadena sea una URL de PostgreSQL antes de intentar conectar.
 *
 * No es celo: `pg-connection-string` convierte cualquier cadena que no sea una
 * URL en `{ host: "base", database: "<la cadena>" }`. Y `base` es exactamente
 * el nombre del servicio de PostgreSQL en `compose.yaml`, así que dentro del
 * entorno de desarrollo una variable mal escrita sí resuelve y conecta a
 * algún sitio en vez de fallar. Es preferible detenerse aquí.
 */
export function exigirUrlDePostgres(url, nombreDeVariable = "KCM_ADMIN_DATABASE_URL") {
  if (!url) throw new Error(`Falta ${nombreDeVariable}.`);
  if (!/^postgres(ql)?:\/\//u.test(url)) {
    throw new Error(
      `${nombreDeVariable} no parece una URL de PostgreSQL: debe empezar con ` +
        "`postgresql://` o `postgres://`.",
    );
  }
  return url;
}

/**
 * `0026` declara la corrida piloto de Supabase: una fila viva, un comentario en
 * el esquema y una función que anuncian que la base trae datos de prueba. No se
 * reaplica nunca —ni en un reset ni en una base nueva— porque volvería a marcar
 * como piloto una base que no lo es.
 */
export const OMITIDAS = new Set(["0026_marca_corrida_piloto.sql"]);

/**
 * `0035` agrega un valor a un enum. PostgreSQL rechaza usar ese valor nuevo
 * dentro de la misma transacción que lo agregó, así que va sola y sin envolver.
 */
export const SIN_TRANSACCION = new Set(["0035_procedencia_roster_alta.sql"]);

/**
 * `0037` no es un cambio de esquema: son `UPDATE` contra UUID concretos de la
 * corrida piloto. En una base nueva no encuentran fila. Se aplica igual —para
 * que el historial quede completo— pero quien la corre debe saber que el
 * reapuntamiento de QMS y BPM queda pendiente a mano.
 */
export const REPARACION_DE_DATOS = new Set(["0037_reglas_dnc_a_identidad_de_matriz.sql"]);

/** Las migraciones del árbol, en orden numérico y sin las omitidas. */
export async function listarMigraciones(directorio = DIRECTORIO) {
  const archivos = (await readdir(directorio))
    .filter((nombre) => nombre.endsWith(".sql"))
    .sort()
    .filter((nombre) => !OMITIDAS.has(nombre));

  if (!archivos.length) throw new Error(`No hay migraciones en ${directorio}`);
  return archivos;
}

/** Nombre con el que una migración queda registrada en el historial. */
export function nombreDeRegistro(archivo) {
  return archivo.replace(/\.sql$/u, "");
}

/**
 * Versión de catorce dígitos. Supabase usa una marca de tiempo; aquí basta con
 * que ordene igual que el número de archivo, que es lo que la tabla usa como
 * llave primaria.
 */
export function versionDeArchivo(archivo) {
  return archivo.slice(0, 4).padEnd(14, "0");
}

/** Crea el esquema del historial si la base todavía no lo tiene. */
export async function asegurarHistorial(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations");
  await client.query(`
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version    text PRIMARY KEY,
      name       text,
      statements text[]
    )
  `);
}

/** Los nombres ya registrados, para no reaplicar. */
export async function yaAplicadas(client) {
  await asegurarHistorial(client);
  const { rows } = await client.query(
    "SELECT name FROM supabase_migrations.schema_migrations WHERE name IS NOT NULL",
  );
  return new Set(rows.map((fila) => fila.name));
}

/**
 * Aplica un archivo y lo registra. Devuelve el SQL ejecutado.
 *
 * El registro va en la misma transacción que el cambio siempre que se pueda: si
 * la migración falla a la mitad, su fila de historial tampoco debe quedar, o la
 * siguiente corrida la saltaría creyéndola aplicada.
 */
export async function aplicarMigracion(client, archivo, directorio = DIRECTORIO) {
  const sql = await readFile(path.join(directorio, archivo), "utf8");
  const version = versionDeArchivo(archivo);
  const nombre = nombreDeRegistro(archivo);

  const registrar = () =>
    client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name`,
      [version, nombre, [sql]],
    );

  if (SIN_TRANSACCION.has(archivo)) {
    await client.query(sql);
    await registrar();
    return sql;
  }

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await registrar();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return sql;
}

/**
 * Declara la contraseña que `0029` necesita para crear el rol `kcm_app`.
 *
 * La migración la lee de `current_setting('kcm.app_password')` y falla cerrada
 * sin ella: el secreto no vive en el árbol. Como es un ajuste de sesión, basta
 * declararlo una vez en el mismo cliente que aplica todo.
 *
 * Contra una base donde `kcm_app` ya existe —Supabase, o un reset, porque los
 * roles son de cluster y sobreviven al `DROP SCHEMA`— la migración salta el
 * `CREATE ROLE` y este ajuste no se usa.
 */
export async function declararContrasenaDeApp(client, contrasena) {
  if (!contrasena) return false;
  await client.query("SELECT set_config('kcm.app_password', $1, false)", [contrasena]);
  return true;
}
