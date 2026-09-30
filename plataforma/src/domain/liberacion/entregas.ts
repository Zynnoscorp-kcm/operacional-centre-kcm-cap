import type { MatrixDelivery, MatrixDeliveryPort } from "../../ports/entregas-matriz.port.ts";
import { DomainError } from "../comun/errores.ts";

export const MAXIMO_DE_ENTREGAS = 100;

export class MatrixDeliveryService {
  readonly #repository: MatrixDeliveryPort;

  constructor(deps: { readonly repository: MatrixDeliveryPort }) {
    this.#repository = deps.repository;
  }

  list(limit = MAXIMO_DE_ENTREGAS): Promise<readonly MatrixDelivery[]> {
    const tope = Math.min(Math.max(Math.trunc(limit), 1), MAXIMO_DE_ENTREGAS);
    return this.#repository.listDeliveries(tope);
  }

  async hide(input: {
    readonly batchId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<MatrixDelivery> {
    const entrega = await this.#repository.findDelivery(input.batchId);
    if (!entrega) {
      throw new DomainError("ENTREGA_NO_ENCONTRADA", "Esa entrega ya no está en el tablero.");
    }
    if (entrega.state !== "ENTREGADA") {
      throw new DomainError(
        "ENTREGA_SIN_CONFIRMAR",
        "Sólo se pueden quitar las entregas que Excel ya confirmó. " +
          "Ésta todavía no tiene acuse de todas sus fechas.",
      );
    }
    await this.#repository.hideDelivery(input);
    return entrega;
  }
}
