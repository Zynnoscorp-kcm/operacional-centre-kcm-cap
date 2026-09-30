#!/usr/bin/env node

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
