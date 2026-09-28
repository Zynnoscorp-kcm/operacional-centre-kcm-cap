/**
 * La bitácora vista desde el dominio.
 *
 * Envuelve al puerto por dos razones. La primera es que los dos servicios de
 * carga —matriz y padrón— necesitan exactamente la misma comparación contra la
 * carga anterior, y escribirla dos veces garantizaría que se separaran; la
 * segunda es que registrar debe ser inofensivo: ninguna de las dos cargas
 * puede fallar porque su asiento no se haya podido escribir, así que el error se
 * traga aquí, una sola vez, y no en cada llamada.
 *
 * Nada de esto persiste el archivo. Lo que se compara es su huella y su nombre,
 * que es todo lo que hace falta para responder «¿esto ya lo cargamos?» sin
 * guardar medio megabyte de padrón ni tres de matriz en ningún lado.
 */

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

  /**
   * Escribe el asiento y nunca propaga el fallo.
   *
   * Devuelve lo escrito por si quien llama quiere enseñarlo, pero ningún camino
   * del dominio depende de que haya devuelto algo: una carga aplicada sigue
   * estando aplicada aunque su asiento se haya perdido.
   *
   * Quien llama la espera. Publicada en un alojamiento sin servidor, lo que
   * sigue corriendo después de responder puede congelarse con la instancia, y
   * el asiento se perdería sin que nadie lo notara. Como nunca lanza, esperarla
   * no pone en riesgo la carga.
   */
  async registrar(asiento: AsientoDeCarga): Promise<CargaRegistrada | undefined> {
    try {
      return await this.#puerto.registrar(asiento);
    } catch {
      return undefined;
    }
  }

  /** La última carga aplicada de esta fuente; nada si nunca hubo o la bitácora no responde. */
  async ultimaAplicada(tipo: TipoDeCarga): Promise<CargaRegistrada | undefined> {
    try {
      return await this.#puerto.ultimaAplicada(tipo);
    } catch {
      return undefined;
    }
  }

  /** Los últimos hechos de las dos fuentes. Vacío si la bitácora no responde. */
  async listar(limite: number): Promise<readonly CargaRegistrada[]> {
    try {
      return await this.#puerto.listar(limite);
    } catch {
      return [];
    }
  }

  /**
   * Qué se cargó la última vez de esta fuente y en qué se parece a lo que hay
   * ahora en revisión.
   *
   * Devuelve `undefined` cuando nunca hubo una carga aplicada, que es distinto
   * de «no cambió nada»: la primera carga de la historia no tiene contra qué
   * compararse y la pantalla debe decir eso y no un cero.
   */
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
      // Se compara sin distinguir mayúsculas ni espacios de orilla: el nombre
      // lo teclea una persona en `KCM_CONFIG` y un espacio de más no es un
      // archivo distinto.
      cambioDeNombre: anterior.archivo.trim().toUpperCase() !== archivo.trim().toUpperCase(),
      diasDesde: Math.max(0, Math.floor(transcurrido / MILISEGUNDOS_POR_DIA)),
    };
  }
}
