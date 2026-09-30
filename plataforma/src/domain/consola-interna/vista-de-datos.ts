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

    if (vista === null) {
      throw new DomainError(
        "TABLA_NO_DISPONIBLE",
        `La tabla «${nombre}» no está disponible para consulta.`,
      );
    }
    return vista;
  }
}

function acotar(valor: unknown, omision: number, minimo: number, maximo: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return omision;
  return Math.min(Math.max(Math.trunc(numero), minimo), maximo);
}
