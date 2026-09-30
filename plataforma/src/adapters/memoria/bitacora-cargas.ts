import { randomUUID } from "node:crypto";

import type { AsientoDeCarga, CargaRegistrada, TipoDeCarga } from "../../domain/cargas/tipos.ts";
import type { Clock } from "../../ports/reloj.port.ts";
import type { LoadLogPort } from "../../ports/bitacora-cargas.port.ts";

const TOPE = 500;

export class MemoryLoadLog implements LoadLogPort {
  readonly #clock: Clock;
  readonly #asientos: CargaRegistrada[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  registrar(asiento: AsientoDeCarga): Promise<CargaRegistrada | undefined> {
    const registrado: CargaRegistrada = {
      ...asiento,
      asientoId: randomUUID(),
      ocurridoEn: this.#clock.nowIso(),
    };
    this.#asientos.push(registrado);
    if (this.#asientos.length > TOPE) this.#asientos.shift();
    return Promise.resolve(registrado);
  }

  listar(limite: number): Promise<readonly CargaRegistrada[]> {
    return Promise.resolve([...this.#asientos].reverse().slice(0, limite));
  }

  ultimaAplicada(tipo: TipoDeCarga): Promise<CargaRegistrada | undefined> {
    for (let i = this.#asientos.length - 1; i >= 0; i -= 1) {
      const asiento = this.#asientos[i];
      if (asiento && asiento.tipo === tipo && asiento.hecho === "APLICADA") {
        return Promise.resolve(asiento);
      }
    }
    return Promise.resolve(undefined);
  }
}
