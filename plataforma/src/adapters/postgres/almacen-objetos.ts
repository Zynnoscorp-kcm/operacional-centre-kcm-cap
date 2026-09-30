import type { ObjectStorePort } from "./preliberacion.ts";
import type { SqlExecutor } from "./matriz.ts";

export class PostgresObjectStore implements ObjectStorePort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async put(path: string, content: Uint8Array, contentType: string): Promise<void> {
    await this.#db.query(
      `INSERT INTO sistema.archivo (ruta, contenido, tipo_mime)
            VALUES ($1, $2, $3)
       ON CONFLICT (ruta) DO UPDATE
              SET contenido = EXCLUDED.contenido,
                  tipo_mime = EXCLUDED.tipo_mime,
                  actualizado_en = now()`,
      [path, Buffer.from(content), contentType],
    );
  }

  async get(path: string): Promise<Uint8Array | null> {
    const { rows } = await this.#db.query<{ contenido: Buffer }>(
      "SELECT contenido FROM sistema.archivo WHERE ruta = $1",
      [path],
    );
    const fila = rows[0];
    return fila ? new Uint8Array(fila.contenido) : null;
  }
}
