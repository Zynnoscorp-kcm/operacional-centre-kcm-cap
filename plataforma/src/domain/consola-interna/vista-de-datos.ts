/**
 * Previsualizador de la base.
 *
 * Sirve para responder «¿qué hay realmente en la tabla?» sin abrir el panel de
 * Supabase, que exige la credencial de administrador del proyecto y da, junto
 * con la respuesta, la capacidad de editar y de tirar el esquema.
 *
 * Las tres cosas que lo hacen seguro
 *
 * 1. No acepta SQL. Nadie escribe una consulta: se elige una tabla de un
 *    catálogo y se pide una página. Un cuadro de texto que aceptara SQL, aunque
 *    prometiera rechazar lo que no fuera `SELECT`, sería un intérprete que hay
 *    que blindar contra su propio lenguaje.
 * 2. El nombre de la tabla se valida contra el catálogo del servidor, no
 *    contra una expresión regular. Lo que no está en `pg_class` no se consulta,
 *    y lo que está en la lista vedada tampoco.
 * 3. La lectura corre en una transacción `READ ONLY`. Es el cinturón sobre
 *    el tirante: aunque un cambio futuro colara una sentencia que escribe,
 *    PostgreSQL la aborta. La garantía la da el servidor, no la disciplina de
 *    quien edite este archivo después.
 *
 * Las tablas con secretos ni siquiera se listan, y la CURP y los marcadores de
 * journal se enseñan enmascarados. Ver `TABLAS_VEDADAS` y
 * `COLUMNAS_ENMASCARADAS`.
 */

import type { DataPreviewPort } from "../../ports/consola-interna.port.ts";
import { DomainError } from "../comun/errores.ts";
import {
  LIMITE_MAXIMO_DE_FILAS,
  LIMITE_POR_OMISION,
  type TablePreview,
  type TableSummary,
} from "./tipos.ts";

export class DataPreviewService {
  readonly #repository: DataPreviewPort;

  constructor(deps: { readonly repository: DataPreviewPort }) {
    this.#repository = deps.repository;
  }

  tables(): Promise<readonly TableSummary[]> {
    return this.#repository.listTables();
  }

  async preview(table: string, limit?: unknown, offset?: unknown): Promise<TablePreview> {
    const nombre = table.trim().toLowerCase();
    if (nombre === "") {
      throw new DomainError("TABLA_REQUERIDA", "Falta el nombre de la tabla.");
    }

    const vista = await this.#repository.previewTable(
      nombre,
      acotar(limit, LIMITE_POR_OMISION, 1, LIMITE_MAXIMO_DE_FILAS),
      acotar(offset, 0, 0, Number.MAX_SAFE_INTEGER),
    );

    // Inexistente y vedada dan el mismo error. Distinguirlas confirmaría por
    // el mensaje cuáles son las tablas que no se quieren enseñar.
    if (vista === null) {
      throw new DomainError(
        "TABLA_NO_DISPONIBLE",
        `La tabla «${nombre}» no está disponible para consulta.`,
      );
    }
    return vista;
  }
}

/**
 * Un parámetro fuera de rango se acota, no rechaza la petición: viene de un
 * enlace de paginación, y devolver un error por un `?offset=-1` sólo daría una
 * pantalla rota donde bastaba con la primera página.
 */
function acotar(valor: unknown, omision: number, minimo: number, maximo: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return omision;
  return Math.min(Math.max(Math.trunc(numero), minimo), maximo);
}
