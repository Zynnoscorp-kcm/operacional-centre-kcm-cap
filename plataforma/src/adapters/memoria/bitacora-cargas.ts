/**
 * Bitácora de cargas en memoria.
 *
 * Es la que corre en la suite y en cualquier arranque sin base. Conserva la
 * misma semántica que la de PostgreSQL en lo único que el dominio observa: el
 * orden de inserción manda —no la marca de tiempo, que en una prueba con reloj
 * fijo es la misma para todos los asientos— y `listar` devuelve del más reciente
 * al más antiguo.
 *
 * El tope existe para que una corrida larga sin base no crezca sin fin. Es
 * generoso a propósito: el historial que la pantalla enseña son decenas de
 * asientos, no miles.
 */

import { randomUUID } from "node:crypto";

import type { AsientoDeCarga, CargaRegistrada, TipoDeCarga } from "../../domain/cargas/tipos.ts";
import type { Clock } from "../../ports/reloj.port.ts";
import type { LoadLogPort } from "../../ports/bitacora-cargas.port.ts";

const TOPE = 500;

export class MemoryLoadLog implements LoadLogPort {
  readonly #clock: Clock;
  /** Del más antiguo al más reciente; `listar` la invierte. */
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
