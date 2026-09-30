import pg from "pg";

import type { SqlExecutor } from "./matriz.ts";

const { Pool } = pg;

pg.types.setTypeParser(1082, (value: string) => value);
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

  transaction<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class PostgresExecutor implements SqlExecutor {
  readonly #pool: pg.Pool;

  constructor(connectionString: string, opciones: { readonly maxConexiones?: number } = {}) {
    this.#pool = new Pool({
      connectionString,
      options: "-c search_path=comun,lectura,public",
      ssl: { rejectUnauthorized: false },
      max: opciones.maxConexiones ?? 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });

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
      try {
        await client.query("ROLLBACK");
      } catch {
        // Sin conexión no hay ROLLBACK posible; el error original es el que importa.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async verificar(): Promise<{ esquemaListo: boolean; pilotoAbierto: boolean }> {
    const { rows } = await this.query<{ tablas: number; piloto: number }>(
      `SELECT
         (SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'organizacion' AND c.relkind = 'r')::int AS tablas,
         (SELECT count(*) FROM sistema.corrida_piloto WHERE cerrada_en IS NULL)::int AS piloto`,
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
