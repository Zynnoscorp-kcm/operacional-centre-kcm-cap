/**
 * Padrón semanal sobre PostgreSQL.
 *
 * Las tres sentencias de escritura son las mismas de
 * `scripts/ingest-roster.js`, con `unnest` para que mil setecientos cambios
 * viajen en tres consultas y no en tres mil. Van dentro de una transacción:
 * media carga aplicada sería peor que ninguna, porque la CURP escrita sin su
 * registro de inducción no se nota hasta que alguien intenta emitir el DC-3.
 *
 * La identidad del curso de Inducción se resuelve en la consulta, por su
 * clave. El script la trae como UUID literal; aquí no, porque un identificador
 * a mano en el código de la aplicación es una bomba de tiempo el día que la
 * base se reconstruya.
 */

import type {
  EscriturasDePadron,
  FilaDePadronBase,
  InduccionPropuesta,
  PuestoDelCatalogo,
  ResultadoDeEscritura,
  RosterRepositoryPort,
} from "../../ports/padron.port.ts";
import type { SqlExecutor } from "./matriz.ts";

/** Se resuelve por clave dentro de cada consulta; nunca por UUID a mano. */
const INDUCCION =
  "(SELECT capacitacion_id FROM kcm.capacitacion WHERE clave_curso = 'INDUCCION_EMPRESA')";

interface FilaTrabajador {
  trabajador_id: string;
  numero_trabajador: string;
  curp: string | null;
  fecha_alta: string | null;
  puesto: string | null;
  area: string | null;
  tipo_nomina: string | null;
  planta: string | null;
  clave_ocupacion: string | null;
  activo: boolean;
}

export class SupabaseRosterRepository implements RosterRepositoryPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async leerPadronBase(): Promise<readonly FilaDePadronBase[]> {
    const { rows } = await this.#db.query<FilaTrabajador>(
      // El área entra en esta consulta —no en una segunda— porque sólo sirve
      // para agrupar la clave de ocupación por `(puesto, área)` en la revisión,
      // y un viaje más por eso no se justifica.
      `SELECT t.trabajador_id, t.numero_trabajador, t.curp,
              t.fecha_alta::text AS fecha_alta, p.nombre AS puesto,
              a.nombre AS area, t.clave_ocupacion, t.tipo_nomina, t.planta, t.activo
         FROM kcm.trabajador t
         LEFT JOIN kcm.puesto p ON p.puesto_id = t.puesto_id
         LEFT JOIN kcm.area a ON a.area_id = t.area_id;`,
    );
    return rows.map((fila) => ({
      trabajadorId: fila.trabajador_id,
      numeroTrabajador: fila.numero_trabajador,
      curp: fila.curp,
      fechaAlta: fila.fecha_alta,
      puesto: fila.puesto,
      area: fila.area,
      tipoNomina: fila.tipo_nomina,
      planta: fila.planta,
      claveOcupacion: fila.clave_ocupacion,
      activo: fila.activo,
    }));
  }

  async leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    const { rows } = await this.#db.query<{ nombre: string; clave_cno: string | null }>(
      `SELECT nombre, clave_cno FROM kcm.puesto;`,
    );
    return rows.map((fila) => ({ nombre: fila.nombre, claveCno: fila.clave_cno }));
  }

  /**
   * La comparación se hace en la base: van los pares propuestos y vuelven
   * dos enteros. Traerse el ledger de inducciones para compararlo en Node sería
   * un cuarto de mega de egreso por cada revisión, y la respuesta cabe en dos
   * números.
   */
  async revisarInducciones(
    propuestas: readonly InduccionPropuesta[],
  ): Promise<{ nuevas: number; divergentes: number }> {
    if (propuestas.length === 0) return { nuevas: 0, divergentes: 0 };
    const { rows } = await this.#db.query<{ nuevas: number; divergentes: number }>(
      `WITH propuesta AS (
         SELECT unnest($1::uuid[]) AS trabajador_id, unnest($2::date[]) AS fecha
       ), vigente AS (
         SELECT trabajador_id, fecha_capacitacion
           FROM kcm.registro_hc
          WHERE capacitacion_id = ${INDUCCION}
            AND estado_registro = 'VIGENTE'
       )
       SELECT
         count(*) FILTER (WHERE v.trabajador_id IS NULL)::int AS nuevas,
         count(*) FILTER (
           WHERE v.trabajador_id IS NOT NULL AND v.fecha_capacitacion <> p.fecha
         )::int AS divergentes
         FROM propuesta p
         LEFT JOIN vigente v ON v.trabajador_id = p.trabajador_id;`,
      [propuestas.map((p) => p.trabajadorId), propuestas.map((p) => p.fecha)],
    );
    return { nuevas: rows[0]?.nuevas ?? 0, divergentes: rows[0]?.divergentes ?? 0 };
  }

  aplicar(escrituras: EscriturasDePadron): Promise<ResultadoDeEscritura> {
    return this.#db.transaction(async (cliente) => {
      if (escrituras.curp.length) {
        await cliente.query(
          `UPDATE kcm.trabajador t
              SET curp = v.curp, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS curp) v
            WHERE t.trabajador_id = v.id;`,
          [escrituras.curp.map(([id]) => id), escrituras.curp.map(([, valor]) => valor)],
        );
      }

      if (escrituras.altas.length) {
        await cliente.query(
          `UPDATE kcm.trabajador t
              SET fecha_alta = v.alta, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::date[]) AS alta) v
            WHERE t.trabajador_id = v.id;`,
          [escrituras.altas.map(([id]) => id), escrituras.altas.map(([, valor]) => valor)],
        );
      }

      let inducciones = 0;
      if (escrituras.inducciones.length) {
        // El `NOT EXISTS` es la mitad importante de esta sentencia: sin él, un
        // trabajador con inducción vigente y fecha corregida viola
        // `registro_hc_vigente_unico` y tumba la transacción completa. Con él,
        // sólo entra quien no tiene registro; la fecha distinta se informa en la
        // revisión y la decide el departamento, que es lo correcto para un
        // registro que sostiene un documento oficial.
        const { rows } = await cliente.query<{ clave_idempotencia: string }>(
          `INSERT INTO kcm.registro_hc
             (clave_idempotencia, trabajador_id, capacitacion_id, fecha_capacitacion,
              procedencia, estado_registro, version_mapeo)
           SELECT v.clave, v.id, ${INDUCCION}, v.fecha,
                  'ROSTER_ALTA'::kcm.procedencia_fecha,
                  'VIGENTE'::kcm.estado_registro_hc,
                  'roster-v1'
             FROM (SELECT unnest($1::text[]) AS clave, unnest($2::uuid[]) AS id,
                          unnest($3::date[]) AS fecha) v
            WHERE NOT EXISTS (
                    SELECT 1 FROM kcm.registro_hc r
                     WHERE r.trabajador_id = v.id
                       AND r.capacitacion_id = ${INDUCCION}
                       AND r.estado_registro = 'VIGENTE')
           ON CONFLICT (clave_idempotencia) DO NOTHING
           RETURNING clave_idempotencia;`,
          [
            escrituras.inducciones.map(([clave]) => clave),
            escrituras.inducciones.map(([, id]) => id),
            escrituras.inducciones.map(([, , fecha]) => fecha),
          ],
        );
        inducciones = rows.length;
      }

      // La clave de ocupación va al trabajador desde la migración `0041`:
      // varía según su puesto y su área, y consolidarla por puesto rechazaba las
      // dos claves de un puesto presente en dos áreas. La restricción
      // `trabajador_ocupacion_coherente` exige que la clave y su actor
      // aprobador existan o falten juntos —una clasificación legal la firma
      // alguien—, y el actor de la carga es ese alguien.
      let ocupaciones = 0;
      if (escrituras.ocupaciones.length) {
        const aprobador = await resolverActor(cliente, "padron.semanal");
        const { rows } = await cliente.query<{ trabajador_id: string }>(
          `UPDATE kcm.trabajador t
              SET clave_ocupacion = v.clave,
                  aprobado_ocupacion_por = $3::uuid,
                  aprobado_ocupacion_en = now(),
                  actualizado_en = now(),
                  version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS clave) v
            WHERE t.trabajador_id = v.id
              AND t.clave_ocupacion IS DISTINCT FROM v.clave
          RETURNING t.trabajador_id;`,
          [
            escrituras.ocupaciones.map(([id]) => id),
            escrituras.ocupaciones.map(([, clave]) => clave),
            aprobador,
          ],
        );
        ocupaciones = rows.length;
      }

      return {
        curp: escrituras.curp.length,
        altas: escrituras.altas.length,
        inducciones,
        ocupaciones,
      };
    });
  }
}

/** Misma resolución que usa el resto del árbol: el actor se crea si no existe. */
async function resolverActor(tx: SqlExecutor, identificador: string): Promise<string> {
  const { rows } = await tx.query<{ actor_id: string }>(
    `INSERT INTO kcm.actor (identificador, nombre_visible)
     VALUES ($1, $1)
     ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
     RETURNING actor_id;`,
    [identificador],
  );
  const actorId = rows[0]?.actor_id;
  if (actorId === undefined) throw new Error(`No fue posible resolver el actor ${identificador}`);
  return actorId;
}
