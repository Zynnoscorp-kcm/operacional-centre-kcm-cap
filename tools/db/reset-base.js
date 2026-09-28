#!/usr/bin/env node
/**
 * Cierre de la corrida piloto: reconstruye todos los esquemas de la plataforma
 * desde cero (ver `ESQUEMAS`).
 *
 * No borra fila por fila. Auditoria, liberaciones, acuses e historial de
 * sobrescritura son append-only y sus triggers rechazan DELETE y TRUNCATE por
 * diseno, asi que el unico cierre valido es tirar los esquemas y reaplicar
 * las migraciones. Ver `database/RESET.md`.
 *
 * Exige `KCM_ADMIN_DATABASE_URL`: la cadena del rol `postgres` del proyecto,
 * no la de `kcm_app`. `kcm_app` es NOBYPASSRLS y no puede tirar un esquema ni
 * crear roles, que es exactamente el punto de que exista.
 *
 * Uso:
 *   npm run db:reset -- --dry-run   # lista el plan, no toca la base
 *   npm run db:reset -- --confirmo  # ejecuta
 */

import { createRequire } from "node:module";
import process from "node:process";

import {
  DIRECTORIO as DIR,
  OMITIDAS,
  REPARACION_DE_DATOS as REPARACION_DEL_PILOTO,
  SIN_TRANSACCION,
  aplicarMigracion,
  declararContrasenaDeApp,
  exigirUrlDePostgres,
  listarMigraciones,
} from "./lib/migraciones.js";

const require = createRequire(import.meta.url);

/**
 * Todo lo que crean las migraciones. `kcm` y `kcm_lectura` son los nombres que
 * tenian `comun` y `lectura` antes de `0043`: se incluyen para poder cerrar
 * tambien una base que se quedo antes de esa migracion.
 */
const ESQUEMAS = [
  "lectura",
  "organizacion",
  "catalogo",
  "operacion",
  "matriz",
  "dnc",
  "dc3",
  "seguridad",
  "sistema",
  "comun",
  "kcm_lectura",
  "kcm",
];
const ESQUEMAS_CON_TABLAS = ["organizacion", "catalogo", "operacion", "matriz", "dnc", "dc3", "seguridad", "sistema"];
const { Client } = require("pg");

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  if (!dryRun && !args.has("--confirmo")) {
    throw new Error(
      `Falta --confirmo. Esto destruye los esquemas ${ESQUEMAS.join(", ")} sin retorno.`,
    );
  }

  const url = exigirUrlDePostgres(process.env.KCM_ADMIN_DATABASE_URL);

  const archivos = await listarMigraciones();

  if (dryRun) {
    console.log(`Plan: DROP de ${ESQUEMAS.join(", ")}; luego ${archivos.length} migraciones.`);
    for (const n of archivos) {
      const marcas = [
        SIN_TRANSACCION.has(n) ? "sin transaccion" : null,
        REPARACION_DEL_PILOTO.has(n) ? "reparacion del piloto: revisar despues" : null,
      ].filter(Boolean);
      console.log(`  ${n}${marcas.length ? `  (${marcas.join("; ")})` : ""}`);
    }
    console.log(`Omitida: ${[...OMITIDAS].join(", ")}`);
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.log("Tirando esquemas...");
    await client.query(`DROP SCHEMA IF EXISTS ${ESQUEMAS.join(", ")} CASCADE`);

    // El historial de Supabase quedaria describiendo una base que ya no existe.
    await client.query(
      "DELETE FROM supabase_migrations.schema_migrations WHERE name LIKE '00%' OR name IN ('journal_liberacion_marca_firmada','permisos_nonce_puente_app','credenciales_excel_sin_vencimiento')",
    );

    // `kcm_app` es un rol de cluster y sobrevive al DROP, asi que `0029` salta
    // su CREATE ROLE y la contrasena vigente sigue sirviendo. Se declara de
    // todos modos por si alguien reconstruye contra una base donde el rol no
    // existe todavia.
    await declararContrasenaDeApp(client, process.env.KCM_APP_PASSWORD);

    const pendientes = [];
    for (const nombre of archivos) {
      process.stdout.write(`  ${nombre} ... `);
      await aplicarMigracion(client, nombre, DIR);
      console.log("ok");
      if (REPARACION_DEL_PILOTO.has(nombre)) pendientes.push(nombre);
    }

    const { rows } = await client.query(`
      SELECT
        (SELECT count(*) FROM organizacion.trabajador)                   AS trabajadores,
        (SELECT count(*) FROM sistema.bitacora_auditoria)                AS auditoria,
        to_regclass('sistema.corrida_piloto')::text                      AS corrida_piloto,
        obj_description('comun'::regnamespace)                           AS comentario_esquema,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'kcm_app')    AS kcm_app_bypassrls,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY ($1::text[]) AND c.relkind = 'r'
            AND NOT EXISTS (SELECT 1 FROM pg_policies p
                             WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                               AND 'kcm_app' = ANY (p.roles)))       AS tablas_sin_politica,
        has_table_privilege('kcm_app','seguridad.nonce','INSERT')        AS nonce_insert,
        has_table_privilege('kcm_app','seguridad.nonce','DELETE')        AS nonce_delete,
        to_regclass('lectura.cobertura_dnc')::text                       AS cobertura_dnc,
        to_regclass('lectura.resumen_dnc_trabajador')::text              AS resumen_dnc
    `, [ESQUEMAS_CON_TABLAS]);

    console.log("\nVerificacion:");
    console.table(rows[0]);

    const v = rows[0];
    const fallas = [];
    if (Number(v.trabajadores) !== 0) fallas.push("quedaron trabajadores");
    if (v.corrida_piloto !== null) fallas.push("sistema.corrida_piloto sigue existiendo");
    if (v.kcm_app_bypassrls !== false) fallas.push("kcm_app puede saltarse la RLS");
    if (Number(v.tablas_sin_politica) !== 0) fallas.push("hay tablas sin politica para kcm_app");
    if (!v.nonce_insert || !v.nonce_delete) fallas.push("faltan privilegios del nonce del puente");
    if (!v.cobertura_dnc || !v.resumen_dnc) fallas.push("faltan las vistas de cobertura DNC");

    if (fallas.length) {
      console.error("\nEL RESET NO QUEDO LIMPIO:");
      for (const f of fallas) console.error(`  - ${f}`);
      process.exitCode = 1;
      return;
    }

    console.log("\nBase reconstruida y limpia.");
    if (pendientes.length) {
      console.log(
        "Pendiente manual: rehacer el reapuntamiento de QMS y BPM contra las identidades\n" +
          "nuevas y volver a declarar el alias BPM, o la cobertura DNC reportara pendientes\n" +
          `falsos de planta entera (${pendientes.join(", ")}).`,
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
