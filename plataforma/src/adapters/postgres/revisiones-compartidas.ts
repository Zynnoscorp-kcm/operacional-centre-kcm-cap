/**
 * Revisiones pendientes en `sistema.revision_pendiente` (migración `0044`).
 *
 * Una fila por tipo. La vigencia se decide en la consulta con `now()` de la
 * base y no con el reloj de cada instancia: dos instancias con relojes
 * desfasados no pueden discrepar sobre si una revisión sigue viva.
 */

import type {
  RevisionGuardada,
  RevisionesCompartidasPort,
  TipoDeRevision,
} from "../../ports/revisiones-compartidas.port.ts";
import type { SqlExecutor } from "./matriz.ts";

export class PostgresSharedReviewStore implements RevisionesCompartidasPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async guardar(
    tipo: TipoDeRevision,
    revision: { readonly id: string; readonly contenido: unknown; readonly venceEn: string },
  ): Promise<void> {
    await this.#db.query(
      `INSERT INTO sistema.revision_pendiente (tipo, revision_id, contenido, vence_en)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tipo) DO UPDATE
          SET revision_id = EXCLUDED.revision_id,
              contenido   = EXCLUDED.contenido,
              vence_en    = EXCLUDED.vence_en,
              guardada_en = now();`,
      [tipo, revision.id, JSON.stringify(revision.contenido), revision.venceEn],
    );
  }

  async vigente(tipo: TipoDeRevision): Promise<string | undefined> {
    const { rows } = await this.#db.query<{ revision_id: string }>(
      `SELECT revision_id
         FROM sistema.revision_pendiente
        WHERE tipo = $1 AND vence_en > now();`,
      [tipo],
    );
    return rows[0]?.revision_id;
  }

  async leer(tipo: TipoDeRevision): Promise<RevisionGuardada | undefined> {
    const { rows } = await this.#db.query<{ revision_id: string; contenido: unknown }>(
      `SELECT revision_id, contenido
         FROM sistema.revision_pendiente
        WHERE tipo = $1 AND vence_en > now();`,
      [tipo],
    );
    const fila = rows[0];
    return fila ? { id: fila.revision_id, contenido: fila.contenido } : undefined;
  }

  async retirar(tipo: TipoDeRevision, id: string): Promise<boolean> {
    const { rows } = await this.#db.query<{ tipo: string }>(
      `DELETE FROM sistema.revision_pendiente
        WHERE tipo = $1 AND revision_id = $2 AND vence_en > now()
       RETURNING tipo;`,
      [tipo, id],
    );
    return rows.length > 0;
  }

  async descartar(tipo: TipoDeRevision): Promise<void> {
    await this.#db.query(`DELETE FROM sistema.revision_pendiente WHERE tipo = $1;`, [tipo]);
  }
}
