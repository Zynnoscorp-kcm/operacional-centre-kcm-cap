import type {
  EscriturasDePadron,
  FilaDePadronBase,
  InduccionPropuesta,
  PuestoDelCatalogo,
  ResultadoDeEscritura,
  RosterRepositoryPort,
} from "../../ports/padron.port.ts";
import { DATOS_DEL_PADRON } from "../../ports/padron.port.ts";
import type { SqlExecutor } from "./matriz.ts";

const INDUCCION =
  "(SELECT capacitacion_id FROM catalogo.capacitacion WHERE clave_curso = 'INDUCCION_EMPRESA')";

interface FilaTrabajador {
  trabajador_id: string;
  numero_trabajador: string;
  nombre_completo: string | null;
  curp: string | null;
  fecha_alta: string | null;
  puesto: string | null;
  area: string | null;
  tipo_nomina: string | null;
  planta: string | null;
  clave_ocupacion: string | null;
  activo: boolean;
  rfc: string | null;
  nss: string | null;
  centro_costos_clave: string | null;
  centro_costos_nombre: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  estado_civil: string | null;
  sexo: string | null;
  visto_en_matriz: boolean | null;
}

export class SupabaseRosterRepository implements RosterRepositoryPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async leerPadronBase(): Promise<readonly FilaDePadronBase[]> {
    const { rows } = await this.#db.query<FilaTrabajador>(
      `SELECT t.trabajador_id, t.numero_trabajador, t.nombre_completo, t.curp,
              t.fecha_alta::text AS fecha_alta, p.nombre AS puesto,
              a.nombre AS area, t.clave_ocupacion, t.tipo_nomina, t.planta, t.activo,
              t.rfc, t.nss, t.centro_costos_clave, t.centro_costos_nombre, t.direccion,
              t.codigo_postal, t.estado_civil, t.sexo, t.visto_en_matriz
         FROM organizacion.trabajador t
         LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
         LEFT JOIN organizacion.area a ON a.area_id = t.area_id;`,
    );
    return rows.map((fila) => ({
      trabajadorId: fila.trabajador_id,
      numeroTrabajador: fila.numero_trabajador,
      nombre: fila.nombre_completo,
      curp: fila.curp,
      fechaAlta: fila.fecha_alta,
      puesto: fila.puesto,
      area: fila.area,
      tipoNomina: fila.tipo_nomina,
      planta: fila.planta,
      claveOcupacion: fila.clave_ocupacion,
      activo: fila.activo,
      rfc: fila.rfc,
      nss: fila.nss,
      centroCostosClave: fila.centro_costos_clave,
      centroCostosNombre: fila.centro_costos_nombre,
      direccion: fila.direccion,
      codigoPostal: fila.codigo_postal,
      estadoCivil: fila.estado_civil,
      sexo: fila.sexo,
      vistoEnMatriz: fila.visto_en_matriz ?? true,
    }));
  }

  async leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    const { rows } = await this.#db.query<{ nombre: string; clave_cno: string | null }>(
      `SELECT nombre, clave_cno FROM organizacion.puesto;`,
    );
    return rows.map((fila) => ({ nombre: fila.nombre, claveCno: fila.clave_cno }));
  }

  async revisarInducciones(
    propuestas: readonly InduccionPropuesta[],
  ): Promise<{ nuevas: number; divergentes: number }> {
    if (propuestas.length === 0) return { nuevas: 0, divergentes: 0 };
    const { rows } = await this.#db.query<{ nuevas: number; divergentes: number }>(
      `WITH propuesta AS (
         SELECT unnest($1::uuid[]) AS trabajador_id, unnest($2::date[]) AS fecha
       ), vigente AS (
         SELECT trabajador_id, fecha_capacitacion
           FROM operacion.historial_capacitacion
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
          `UPDATE organizacion.trabajador t
              SET curp = v.curp, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS curp) v
            WHERE t.trabajador_id = v.id;`,
          [escrituras.curp.map(([id]) => id), escrituras.curp.map(([, valor]) => valor)],
        );
      }

      if (escrituras.altas.length) {
        await cliente.query(
          `UPDATE organizacion.trabajador t
              SET fecha_alta = v.alta, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::date[]) AS alta) v
            WHERE t.trabajador_id = v.id;`,
          [escrituras.altas.map(([id]) => id), escrituras.altas.map(([, valor]) => valor)],
        );
      }

      let inducciones = 0;
      if (escrituras.inducciones.length) {
        const { rows } = await cliente.query<{ clave_idempotencia: string }>(
          `INSERT INTO operacion.historial_capacitacion
             (clave_idempotencia, trabajador_id, capacitacion_id, fecha_capacitacion,
              procedencia, estado_registro, version_mapeo)
           SELECT v.clave, v.id, ${INDUCCION}, v.fecha,
                  'ROSTER_ALTA'::comun.procedencia_fecha,
                  'VIGENTE'::comun.estado_historial,
                  'roster-v1'
             FROM (SELECT unnest($1::text[]) AS clave, unnest($2::uuid[]) AS id,
                          unnest($3::date[]) AS fecha) v
            WHERE NOT EXISTS (
                    SELECT 1 FROM operacion.historial_capacitacion r
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

      let ocupaciones = 0;
      if (escrituras.ocupaciones.length) {
        const aprobador = await resolverActor(cliente, "padron.semanal");
        const { rows } = await cliente.query<{ trabajador_id: string }>(
          `UPDATE organizacion.trabajador t
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

      const datos = escrituras.datos ?? [];
      for (const columna of DATOS_DEL_PADRON) {
        const deEsta = datos.filter(([, campo]) => campo === columna);
        if (deEsta.length === 0) continue;
        await cliente.query(
          `UPDATE organizacion.trabajador t
              SET ${columna} = v.valor, actualizado_en = now(), version = t.version + 1
             FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS valor) v
            WHERE t.trabajador_id = v.id;`,
          [deEsta.map(([id]) => id), deEsta.map(([, , valor]) => valor)],
        );
      }

      const reactivar = escrituras.reactivar ?? [];
      if (reactivar.length) {
        await cliente.query(
          `UPDATE organizacion.trabajador
              SET activo = true, fecha_baja = NULL
            WHERE trabajador_id = ANY($1::uuid[]);`,
          [reactivar],
        );
      }

      let bajas = 0;
      if (escrituras.enArchivo) {
        await cliente.query(
          `UPDATE organizacion.trabajador
              SET visto_en_padron = (numero_trabajador = ANY($1::text[]))
            WHERE visto_en_padron IS DISTINCT FROM (numero_trabajador = ANY($1::text[]));`,
          [escrituras.enArchivo],
        );
        const fechas = escrituras.fechasDeBaja ?? [];
        if (fechas.length) {
          await cliente.query(
            `UPDATE organizacion.trabajador t
                SET fecha_baja = v.fecha
               FROM (SELECT unnest($1::text[]) AS numero, unnest($2::date[]) AS fecha) v
              WHERE t.numero_trabajador = v.numero;`,
            [fechas.map(([numero]) => numero), fechas.map(([, fecha]) => fecha)],
          );
        }
        const { rows } = await cliente.query<{ trabajador_id: string }>(
          `UPDATE organizacion.trabajador
              SET activo = false
            WHERE activo AND NOT visto_en_padron AND NOT visto_en_matriz
          RETURNING trabajador_id;`,
        );
        bajas = rows.length;
      }

      return {
        curp: escrituras.curp.length,
        altas: escrituras.altas.length,
        inducciones,
        ocupaciones,
        datos: datos.length,
        bajas,
        reactivados: reactivar.length,
      };
    });
  }
}

async function resolverActor(tx: SqlExecutor, identificador: string): Promise<string> {
  const { rows } = await tx.query<{ actor_id: string }>(
    `INSERT INTO seguridad.actor (identificador, nombre_visible)
     VALUES ($1, $1)
     ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
     RETURNING actor_id;`,
    [identificador],
  );
  const actorId = rows[0]?.actor_id;
  if (actorId === undefined) throw new Error(`No fue posible resolver el actor ${identificador}`);
  return actorId;
}
