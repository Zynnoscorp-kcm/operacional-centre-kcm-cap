/**
 * Directorio de consola sobre PostgreSQL (`database/migrations/0038`).
 *
 * Dos cosas viven en la consulta y no en el servicio, a propósito: que la
 * comparación del nombre ignore mayúsculas y que una cuenta revocada
 * simplemente no exista. Son reglas de la tabla —el índice único parcial está
 * escrito sobre `lower(usuario)` con el mismo filtro— y repetirlas aquí es lo
 * que hace que no puedan divergir.
 */

import type { ConsoleDirectoryPort, CuentaDeConsola } from "../../ports/directorio-consola.port.ts";
import type { SqlExecutor } from "./matriz.ts";

interface FilaCuenta {
  credencial_id: string;
  usuario: string;
  nombre_visible: string;
  credencial_hash: string;
  sal: string;
}

export class SupabaseConsoleDirectory implements ConsoleDirectoryPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async buscarPorUsuario(usuario: string): Promise<CuentaDeConsola | undefined> {
    const { rows } = await this.#db.query<FilaCuenta>(
      `SELECT credencial_id, usuario, nombre_visible, credencial_hash, sal
         FROM seguridad.credencial_consola
        WHERE lower(usuario) = lower($1) AND revocada_en IS NULL
        LIMIT 1;`,
      [usuario],
    );
    const fila = rows[0];
    if (!fila) return undefined;
    return {
      credencialId: fila.credencial_id,
      usuario: fila.usuario,
      nombreVisible: fila.nombre_visible,
      credencialHash: fila.credencial_hash,
      sal: fila.sal,
    };
  }

  async registrarAcceso(credencialId: string, cuando: string): Promise<void> {
    await this.#db.query(
      `UPDATE seguridad.credencial_consola
          SET ultimo_acceso_en = $2
        WHERE credencial_id = $1 AND revocada_en IS NULL;`,
      [credencialId, cuando],
    );
  }
}
