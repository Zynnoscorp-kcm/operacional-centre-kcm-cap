#!/usr/bin/env node

import { readFileSync } from "node:fs";
import pg from "pg";

import { extractActiveRosterFromBuffer } from "../../packages/dc3/roster-extractor.js";

const INDUCCION_ID = "8be38c4f-c328-459e-9ddc-ddcd12ad4072";

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
    options: "-c search_path=comun,public",
    ssl: { rejectUnauthorized: false },
    max: 4,
  });

  try {
    const { rows: padron } = await pool.query(
      "SELECT trabajador_id, numero_trabajador, curp, fecha_alta FROM organizacion.trabajador",
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

      if (cambiosCurp.length) {
        await cliente.query(
          `UPDATE organizacion.trabajador t
              SET curp = v.curp, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS curp) v
            WHERE t.trabajador_id = v.id`,
          [cambiosCurp.map((c) => c[0]), cambiosCurp.map((c) => c[1])],
        );
      }
      if (cambiosAlta.length) {
        await cliente.query(
          `UPDATE organizacion.trabajador t
              SET fecha_alta = v.alta, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::date[]) AS alta) v
            WHERE t.trabajador_id = v.id`,
          [cambiosAlta.map((c) => c[0]), cambiosAlta.map((c) => c[1])],
        );
      }
      const { rowCount: inducidos } = await cliente.query(
        `INSERT INTO operacion.historial_capacitacion
           (clave_idempotencia, trabajador_id, capacitacion_id, fecha_capacitacion,
            procedencia, estado_registro, version_mapeo)
         SELECT v.clave, v.id, $4::uuid, v.fecha,
                'ROSTER_ALTA'::comun.procedencia_fecha, 'VIGENTE'::comun.estado_historial,
                'roster-v1'
           FROM (SELECT unnest($1::text[]) AS clave, unnest($2::uuid[]) AS id,
                        unnest($3::date[]) AS fecha) v
          WHERE NOT EXISTS (
                  SELECT 1 FROM operacion.historial_capacitacion r
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
