/**
 * Puerto de la bitácora de cargas.
 *
 * Tres operaciones y ninguna más: escribir un hecho, leer los últimos y
 * preguntar por la última carga aplicada de una fuente. La tercera existe
 * separada de la segunda a propósito: la pantalla de historial quiere los
 * últimos hechos de las dos fuentes mezclados, y la revisión en curso quiere
 * una sola fila —la última aplicada de su propia fuente— y no puede pagar
 * traerse el historial entero para filtrarlo en memoria en cada visita.
 *
 * Registrar nunca debe tumbar una carga. Si el asiento no se puede escribir, la
 * implementación lo reporta por el registro del servidor y devuelve `undefined`:
 * perder la bitácora de una carga es malo, pero abortar una carga que ya escribió
 * mil setecientas filas porque su asiento falló es peor y deja la base a medias.
 */

import type { AsientoDeCarga, CargaRegistrada, TipoDeCarga } from "../domain/cargas/tipos.ts";

export interface LoadLogPort {
  /** Escribe el asiento. Devuelve `undefined` si no se pudo, sin lanzar. */
  registrar(asiento: AsientoDeCarga): Promise<CargaRegistrada | undefined>;
  /** Los últimos hechos de las dos fuentes, del más reciente al más antiguo. */
  listar(limite: number): Promise<readonly CargaRegistrada[]>;
  /** La última carga con efecto de esa fuente, o `undefined` si nunca hubo. */
  ultimaAplicada(tipo: TipoDeCarga): Promise<CargaRegistrada | undefined>;
}
