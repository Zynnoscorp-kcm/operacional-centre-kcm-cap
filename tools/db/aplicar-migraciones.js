#!/usr/bin/env node
/**
 * Aplica a una base las migraciones que le falten.
 *
 * Es incremental: consulta `supabase_migrations.schema_migrations` y sólo corre
 * lo que no esté registrado. Correrlo dos veces seguidas no hace nada la segunda
 * vez, que es lo que permite que el contenedor de desarrollo lo ejecute en cada
 * arranque sin pensarlo.
 *
 * Para reconstruir desde cero —tirar los esquemas y volver a levantarlos— el
 * guion es `reset-piloto.js`, no éste.
 *
 * Variables:
 *   KCM_ADMIN_DATABASE_URL  obligatoria. Rol con permiso de crear esquemas y
 *                           roles; `kcm_app` no puede ni debe poder.
 *   KCM_APP_PASSWORD        contraseña con la que `0029` crea `kcm_app`. Sólo
 *                           se usa si el rol todavía no existe.
 *
 * Banderas:
 *   --local     aplica antes `database/seed/00-compatibilidad-supabase.sql`, que crea
 *               los roles que Supabase da por hechos y un PostgreSQL normal no.
 *   --semilla   aplica después `database/seed/semilla-sintetica.sql`.
 *   --dry-run   dice qué haría y no toca la base.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";

import {
  DIRECTORIO,
  REPARACION_DE_DATOS,
  aplicarMigracion,
  declararContrasenaDeApp,
  exigirUrlDePostgres,
  listarMigraciones,
  nombreDeRegistro,
  yaAplicadas,
} from "./lib/migraciones.js";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const COMPATIBILIDAD = "database/seed/00-compatibilidad-supabase.sql";
const SEMILLA = "database/seed/semilla-sintetica.sql";

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const local = args.has("--local");
  const conSemilla = args.has("--semilla");

  const url = exigirUrlDePostgres(process.env.KCM_ADMIN_DATABASE_URL);

  const archivos = await listarMigraciones();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const aplicadas = await yaAplicadas(client);
    const pendientes = archivos.filter((a) => !aplicadas.has(nombreDeRegistro(a)));

    if (!pendientes.length && !conSemilla) {
      console.log(`Sin cambios: las ${archivos.length} migraciones ya estan aplicadas.`);
      return;
    }

    if (dryRun) {
      console.log(`Aplicadas: ${aplicadas.size}. Pendientes: ${pendientes.length}.`);
      for (const nombre of pendientes) console.log(`  + ${nombre}`);
      if (local) console.log(`  + ${COMPATIBILIDAD} (compatibilidad local)`);
      if (conSemilla) console.log(`  + ${SEMILLA} (semilla sintetica)`);
      return;
    }

    if (local) {
      // Va antes que todo: `0017` y `0018` conceden permisos a `anon` y
      // `authenticated`, y sin esos roles la migracion falla con "role does not
      // exist" en una base que no sea de Supabase.
      console.log(`Compatibilidad local: ${COMPATIBILIDAD}`);
      await client.query(await readFile(COMPATIBILIDAD, "utf8"));
    }

    await declararContrasenaDeApp(client, process.env.KCM_APP_PASSWORD);

    const reparaciones = [];
    for (const archivo of pendientes) {
      process.stdout.write(`  ${archivo} ... `);
      await aplicarMigracion(client, archivo, DIRECTORIO);
      console.log("ok");
      if (REPARACION_DE_DATOS.has(archivo)) reparaciones.push(archivo);
    }

    if (conSemilla) {
      console.log(`Semilla sintetica: ${SEMILLA}`);
      await client.query(await readFile(SEMILLA, "utf8"));
    }

    console.log(`\nListo. ${pendientes.length} migraciones aplicadas.`);

    if (reparaciones.length) {
      console.log(
        "\nAviso: se aplicaron migraciones de reparacion de datos ligadas a la\n" +
          "corrida piloto. Sus UPDATE no encuentran fila en una base nueva, asi que\n" +
          "el reapuntamiento de QMS y BPM y el alias BPM quedan pendientes a mano:\n" +
          reparaciones.map((n) => `  - ${n}`).join("\n"),
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
