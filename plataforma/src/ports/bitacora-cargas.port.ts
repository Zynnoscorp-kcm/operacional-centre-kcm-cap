import type { AsientoDeCarga, CargaRegistrada, TipoDeCarga } from "../domain/cargas/tipos.ts";

export interface LoadLogPort {
  registrar(asiento: AsientoDeCarga): Promise<CargaRegistrada | undefined>;
  listar(limite: number): Promise<readonly CargaRegistrada[]>;
  ultimaAplicada(tipo: TipoDeCarga): Promise<CargaRegistrada | undefined>;
}
