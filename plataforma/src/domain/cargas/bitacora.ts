import type { Clock } from "../../ports/reloj.port.ts";
import type { LoadLogPort } from "../../ports/bitacora-cargas.port.ts";
import type {
  AsientoDeCarga,
  CargaRegistrada,
  ComparacionConLaAnterior,
  TipoDeCarga,
} from "./tipos.ts";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

export class BitacoraDeCargas {
  readonly #puerto: LoadLogPort;
  readonly #clock: Clock;

  constructor(puerto: LoadLogPort, clock: Clock) {
    this.#puerto = puerto;
    this.#clock = clock;
  }

  async registrar(asiento: AsientoDeCarga): Promise<CargaRegistrada | undefined> {
    try {
      return await this.#puerto.registrar(asiento);
    } catch {
      return undefined;
    }
  }

  async ultimaAplicada(tipo: TipoDeCarga): Promise<CargaRegistrada | undefined> {
    try {
      return await this.#puerto.ultimaAplicada(tipo);
    } catch {
      return undefined;
    }
  }

  async listar(limite: number): Promise<readonly CargaRegistrada[]> {
    try {
      return await this.#puerto.listar(limite);
    } catch {
      return [];
    }
  }

  async comparar(
    tipo: TipoDeCarga,
    sha256: string,
    archivo: string,
  ): Promise<ComparacionConLaAnterior | undefined> {
    let anterior: CargaRegistrada | undefined;
    try {
      anterior = await this.#puerto.ultimaAplicada(tipo);
    } catch {
      return undefined;
    }
    if (!anterior) return undefined;

    const transcurrido = this.#clock.now().getTime() - new Date(anterior.ocurridoEn).getTime();
    return {
      anterior,
      mismoArchivo: anterior.sha256 !== "" && anterior.sha256 === sha256,
      cambioDeNombre: anterior.archivo.trim().toUpperCase() !== archivo.trim().toUpperCase(),
      diasDesde: Math.max(0, Math.floor(transcurrido / MILISEGUNDOS_POR_DIA)),
    };
  }
}
