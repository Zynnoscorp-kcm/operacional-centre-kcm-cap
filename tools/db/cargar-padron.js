#!/usr/bin/env node
/**
 * Ingesta del padrón semanal (`sem NN CAP.xlsx`) hacia `kcm.trabajador`.
 *
 * El archivo cambia cada lunes, así que la ruta es un argumento y nunca una
 * constante: la única cosa declarada es la *forma* —las hojas `SND ACTIVOS` y
 * `EMP ACTIVOS` y sus encabezados—, igual que la VBA declara la geometría de la
 * matriz en `KCM_CONFIG` en lugar de adivinarla. Un archivo nuevo con la misma
 * forma entra sin tocar código; uno con otra forma falla cerrado y dice cuál
 * encabezado no resolvió, que es justo lo que debe pasar.
 *
 * Aporta dos cosas que ninguna otra fuente tiene:
 *
 * 1. CURP. El DC-3 es documento oficial de la STPS y sin CURP no se emite.
 *    La matriz no la trae.
 * 2. Fecha de alta, que por regla del departamento es la fecha en que el
 *    trabajador tomó INDUCCIÓN A LA EMPRESA. De ahí salen los registros de
 *    inducción, con procedencia `ROSTER_ALTA` para que jamás se confundan con
 *    una fecha capturada en la matriz.
 *
 * Es idempotente: correrlo dos veces con el mismo archivo no cambia nada. No
 * borra ni da de baja a nadie —las bajas viven en otras hojas y su tratamiento
 * es una decisión del departamento, no un efecto colateral de una lectura—.
 *
 *   npm run db:padron -- <ruta.xlsx> [--aplicar]
 *
 * Sin `--aplicar` sólo reporta lo que haría.
 */

import { readFileSync } from "node:fs";
import pg from "pg";

import { extractActiveRosterFromBuffer } from "../../packages/dc3/roster-extractor.js";

/** Identidad del curso de inducción, ya unificada por la migración 0034. */
const INDUCCION_ID = "8be38c4f-c328-459e-9ddc-ddcd12ad4072";

/**
 * Igual que en `postgres-executor.ts`: una columna `date` llega como `Date` y
 * al formatearla se desplaza con la zona local. Aquí además rompía la
 * comparación contra la fecha del padrón, que es texto ISO, y hacía parecer que
 * el archivo corregía las 1 684 altas cuando no cambiaba ninguna.
 */
pg.types.setTypeParser(1082, (value) => value);

function parseArgs(argv) {
  const args = argv.slice(2).filter((a) => a !== "--aplicar");
  const aplicar = argv.includes("--aplicar");
  if (args.length !== 1) {
    process.stderr.write("Uso: npm run db:padron -- <ruta.xlsx> [--aplicar]\n");
    process.exit(2);
  }
  return { ruta: args[0], aplicar };
}

async function main() {
  const { ruta, aplicar } = parseArgs(process.argv);
  const url = process.env.KCM_DATABASE_URL;
  if (!url) {
    process.stderr.write("Falta KCM_DATABASE_URL.\n");
    process.exit(2);
  }

  const roster = extractActiveRosterFromBuffer(readFileSync(ruta));
  const { employees, diagnostics, source } = roster;
  process.stdout.write(
    `Padrón leído: ${diagnostics.employeeCount} activos, ` +
      `${diagnostics.readyEmployeeCount} sin incidencias. ` +
      `SHA-256 ${source.sha256.slice(0, 12)}…\n`,
  );

  const pool = new pg.Pool({
    connectionString: url,
    options: "-c search_path=kcm,public",
    ssl: { rejectUnauthorized: false },
    max: 4,
  });

  try {
    // El padrón entero cabe de sobra en memoria (menos de 2 000 filas) y una
    // sola lectura evita 1 686 viajes de ida y vuelta contra un presupuesto de
    // consultas que no los admite.
    const { rows: padron } = await pool.query(
      "SELECT trabajador_id, numero_trabajador, curp, fecha_alta FROM kcm.trabajador",
    );
    const porNumero = new Map(padron.map((t) => [t.numero_trabajador, t]));

    const cambiosCurp = [];
    const cambiosAlta = [];
    const induccion = [];
    const desconocidos = [];

    for (const e of employees) {
      const actual = porNumero.get(e.employeeId);
      if (!actual) {
        desconocidos.push(e.employeeId);
        continue;
      }
      if (e.curp && e.curp !== actual.curp) {
        cambiosCurp.push([actual.trabajador_id, e.curp]);
      }
      if (e.hireDate && e.hireDate !== actual.fecha_alta) {
        cambiosAlta.push([actual.trabajador_id, e.hireDate]);
      }
      if (e.hireDate) {
        // La clave lleva trabajador y fecha: si el departamento corrige un alta,
        // entra un registro nuevo en vez de sobrescribir en silencio el anterior.
        induccion.push([
          `roster-alta:${e.employeeId}:${e.hireDate}`,
          actual.trabajador_id,
          e.hireDate,
        ]);
      }
    }

    const faltantes = padron.filter((t) => !employees.some((e) => e.employeeId === t.numero_trabajador));

    process.stdout.write(
      `CURP por escribir: ${cambiosCurp.length}\n` +
        `Fechas de alta por corregir: ${cambiosAlta.length}\n` +
        `Registros de inducción candidatos: ${induccion.length}\n` +
        `En el padrón semanal pero no en la base: ${desconocidos.length}` +
        (desconocidos.length ? ` (${desconocidos.slice(0, 10).join(", ")}…)` : "") +
        `\nEn la base pero ausentes del padrón semanal: ${faltantes.length}` +
        ` (no se dan de baja aquí)\n`,
    );

    if (!aplicar) {
      process.stdout.write("\nSimulación. Repita con --aplicar para escribir.\n");
      return;
    }

    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");

      // `unnest` manda los tres lotes en tres sentencias en vez de en miles.
      if (cambiosCurp.length) {
        await cliente.query(
          `UPDATE kcm.trabajador t
              SET curp = v.curp, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS curp) v
            WHERE t.trabajador_id = v.id`,
          [cambiosCurp.map((c) => c[0]), cambiosCurp.map((c) => c[1])],
        );
      }
      if (cambiosAlta.length) {
        await cliente.query(
          `UPDATE kcm.trabajador t
              SET fecha_alta = v.alta, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::date[]) AS alta) v
            WHERE t.trabajador_id = v.id`,
          [cambiosAlta.map((c) => c[0]), cambiosAlta.map((c) => c[1])],
        );
      }
      // `registro_hc` lleva además un índice único
      // `(trabajador_id, capacitacion_id) WHERE VIGENTE`. La primera corrida no
      // lo notó porque no había ninguna inducción registrada; en cuanto el
      // departamento corrija una fecha de alta, la clave de idempotencia es
      // otra, el `ON CONFLICT` no aplica y la carga entera aborta. El
      // `NOT EXISTS` deja pasar sólo a quien no tiene registro vigente; la
      // fecha distinta se revisa aparte, en `/padron`.
      const { rowCount: inducidos } = await cliente.query(
        `INSERT INTO kcm.registro_hc
           (clave_idempotencia, trabajador_id, capacitacion_id, fecha_capacitacion,
            procedencia, estado_registro, version_mapeo)
         SELECT v.clave, v.id, $4::uuid, v.fecha,
                'ROSTER_ALTA'::kcm.procedencia_fecha, 'VIGENTE'::kcm.estado_registro_hc,
                'roster-v1'
           FROM (SELECT unnest($1::text[]) AS clave, unnest($2::uuid[]) AS id,
                        unnest($3::date[]) AS fecha) v
          WHERE NOT EXISTS (
                  SELECT 1 FROM kcm.registro_hc r
                   WHERE r.trabajador_id = v.id
                     AND r.capacitacion_id = $4::uuid
                     AND r.estado_registro = 'VIGENTE')
         ON CONFLICT (clave_idempotencia) DO NOTHING`,
        [
          induccion.map((r) => r[0]),
          induccion.map((r) => r[1]),
          induccion.map((r) => r[2]),
          INDUCCION_ID,
        ],
      );

      await cliente.query("COMMIT");
      process.stdout.write(
        `\nAplicado. CURP: ${cambiosCurp.length}. ` +
          `Altas: ${cambiosAlta.length}. Inducciones nuevas: ${inducidos}.\n`,
      );
    } catch (error) {
      await cliente.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  } finally {
    await pool.end();
  }
}

await main();
