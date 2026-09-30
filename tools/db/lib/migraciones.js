import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const DIRECTORIO = "database/migrations";

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

export const OMITIDAS = new Set(["0026_marca_corrida_piloto.sql"]);

export const SIN_TRANSACCION = new Set(["0035_procedencia_roster_alta.sql"]);

export const REPARACION_DE_DATOS = new Set(["0037_reglas_dnc_a_identidad_de_matriz.sql"]);

export async function listarMigraciones(directorio = DIRECTORIO) {
  const archivos = (await readdir(directorio))
    .filter((nombre) => nombre.endsWith(".sql"))
    .sort()
    .filter((nombre) => !OMITIDAS.has(nombre));

  if (!archivos.length) throw new Error(`No hay migraciones en ${directorio}`);
  return archivos;
}

export function nombreDeRegistro(archivo) {
  return archivo.replace(/\.sql$/u, "");
}

export function versionDeArchivo(archivo) {
  return archivo.slice(0, 4).padEnd(14, "0");
}

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

export async function yaAplicadas(client) {
  await asegurarHistorial(client);
  const { rows } = await client.query(
    "SELECT name FROM supabase_migrations.schema_migrations WHERE name IS NOT NULL",
  );
  return new Set(rows.map((fila) => fila.name));
}

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

export async function declararContrasenaDeApp(client, contrasena) {
  if (!contrasena) return false;
  await client.query("SELECT set_config('kcm.app_password', $1, false)", [contrasena]);
  return true;
}
