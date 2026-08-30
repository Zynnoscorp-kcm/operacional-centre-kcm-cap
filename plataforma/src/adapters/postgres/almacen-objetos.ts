/**
 * `ObjectStorePort` sobre PostgreSQL.
 *
 * Reemplaza a `FileObjectStore` allí donde el proceso no tiene disco que
 * sobreviva a un redespliegue. La evidencia y su apuntador en `kcm.evidencia`
 * pasan a vivir en el mismo lugar, así que dejan de poder desincronizarse.
 *
 * No hay saneamiento de ruta como en el adaptador de disco, y no es un olvido:
 * ahí la ruta se concatenaba contra el sistema de archivos y un `..` escapaba
 * de la carpeta. Aquí la ruta es el valor de una columna en una consulta
 * parametrizada; no se interpreta ni resuelve contra nada.
 */

import type { ObjectStorePort } from "./preliberacion.ts";
import type { SqlExecutor } from "./matriz.ts";

export class PostgresObjectStore implements ObjectStorePort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  /**
   * Regenerar un reporte sustituye su contenido en lugar de fallar por llave
   * duplicada: el dominio ya trata la ruta como identidad estable del objeto.
   */
  async put(path: string, content: Uint8Array, contentType: string): Promise<void> {
    await this.#db.query(
      `INSERT INTO kcm.objeto_almacenado (ruta, contenido, tipo_mime)
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
      "SELECT contenido FROM kcm.objeto_almacenado WHERE ruta = $1",
      [path],
    );
    const fila = rows[0];
    // Un objeto ausente es una respuesta válida del puerto, igual que en disco.
    return fila ? new Uint8Array(fila.contenido) : null;
  }
}
