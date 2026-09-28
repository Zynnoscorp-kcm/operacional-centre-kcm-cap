/**
 * Servicio del tablero de entregas.
 *
 * Es delgado a propósito: el estado de una entrega no se guarda en ninguna
 * columna, se deduce de los acuses que el cliente de Excel ya deja en su ledger.
 * Guardarlo aparte crearía una segunda verdad que habría que reconciliar, y la
 * primera vez que las dos discreparan nadie sabría cuál creer.
 *
 * Lo único que este servicio decide es qué se puede ocultar: sólo una entrega
 * confirmada. Ocultar una que sigue esperando a Excel la sacaría de la vista
 * justo mientras es la que hay que vigilar, y el tablero dejaría de servir para
 * lo que se hizo.
 */

import type { MatrixDelivery, MatrixDeliveryPort } from "../../ports/entregas-matriz.port.ts";
import { DomainError } from "../comun/errores.ts";

/** Tope del tablero. Es una bandeja de trabajo, no el historial: eso es auditoría. */
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

  /**
   * Quita del tablero una entrega ya confirmada.
   *
   * Se relee antes de ocultar y no se confía en lo que la pantalla creía: entre
   * que se dibujó el renglón y que alguien pulsó la equis pudo llegar —o no
   * llegar— el acuse, y el que decide es el estado de ahora.
   */
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
