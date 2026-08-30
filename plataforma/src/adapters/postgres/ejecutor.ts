/**
 * `SqlExecutor` sobre `pg`.
 *
 * Es la única pieza del árbol que conoce el controlador de PostgreSQL: los
 * repositorios reciben la interfaz, no el pool, y por eso siguen siendo
 * verificables sin base.
 *
 * Dos decisiones que no son de estilo:
 *
 * 1. `search_path` fijo en cada conexión. Los repositorios escriben
 *    `kcm.tabla` calificado, pero una conexión sin `search_path` declarado deja
 *    que el valor del rol decida qué resuelve un nombre sin esquema. Se fija al
 *    conectar, una vez por conexión física.
 * 2. `transaction` entrega el mismo cliente. Sin eso, dos consultas de una
 *    misma transacción podrían salir por conexiones distintas del pool y el
 *    `BEGIN` no cubriría a la segunda: exactamente el fallo que un journal
 *    idempotente no puede permitirse.
 */

import pg from "pg";

import type { SqlExecutor } from "./matriz.ts";

const { Pool } = pg;

/**
 * Las columnas `date` llegan como `Date` y se desplazan al formatearlas con la
 * zona local. Una fecha de capacitación es un día del calendario, no un
 * instante: se lee tal cual viene, en texto.
 */
pg.types.setTypeParser(1082, (value: string) => value);
/** `bigint` como número: los conteos del dominio caben de sobra en un `double`. */
pg.types.setTypeParser(20, (value: string) => Number(value));

class ClientExecutor implements SqlExecutor {
  readonly #client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.#client = client;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const result = await this.#client.query(sql, params);
    return { rows: result.rows as T[] };
  }

  /**
   * Anidar transacciones no abre otra: el bloque exterior ya delimita el efecto.
   * Devolver aquí un `BEGIN` nuevo produciría un aviso del servidor y, peor, un
   * `COMMIT` interior que confirma trabajo que el exterior aún podía revertir.
   */
  transaction<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class PostgresExecutor implements SqlExecutor {
  readonly #pool: pg.Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({
      connectionString,
      // El `search_path` viaja como parámetro de arranque de la conexión. Fijarlo
      // con un `query` en el evento `connect` lo lanzaba sin esperar, y `pg`
      // avisaba de una consulta encimada sobre un cliente ocupado.
      options: "-c search_path=kcm,kcm_lectura,public",
      // Supabase termina TLS con una cadena que el almacén del sistema no
      // siempre trae. La conexión sigue cifrada; lo que no se verifica es la
      // autoridad, y el destino es un host fijo declarado en la configuración.
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });

    // Sin este manejador, un corte de red en una conexión ociosa del pool
    // emite un `error` sin escuchas y tumba el proceso entero.
    this.#pool.on("error", () => undefined);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const result = await this.#pool.query(sql, params);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const resultado = await fn(new ClientExecutor(client));
      await client.query("COMMIT");
      return resultado;
    } catch (error) {
      // El ROLLBACK puede fallar si la conexión ya murió; el error original es
      // el que explica qué pasó y es el que debe propagarse.
      try {
        await client.query("ROLLBACK");
      } catch {
        /* la conexión ya no admite órdenes */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Comprueba que la base responde y que el esquema del dominio está aplicado. */
  async verificar(): Promise<{ esquemaListo: boolean; pilotoAbierto: boolean }> {
    const { rows } = await this.query<{ tablas: number; piloto: number }>(
      `SELECT
         (SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'kcm' AND c.relkind = 'r')::int AS tablas,
         (SELECT count(*) FROM kcm.corrida_piloto WHERE cerrada_en IS NULL)::int AS piloto`,
    );
    const fila = rows[0];
    return {
      esquemaListo: (fila?.tablas ?? 0) > 0,
      pilotoAbierto: (fila?.piloto ?? 0) > 0,
    };
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
