/**
 * La puerta del botón «Clasificar faltantes».
 *
 * Dos actos, porque un padrón completo no cabe en una sola petición de la
 * plataforma publicada:
 *
 * 1. `planear` recibe el padrón tal cual, lo lee con el mismo extractor de
 *    siempre y devuelve dónde se escribirá cada clave y el estado inicial del
 *    lote.
 * 2. `avanzar` recibe ese estado, trabaja hasta que se le acaba el tiempo del
 *    paso y lo devuelve; Excel lo vuelve a mandar hasta que dice «terminado».
 *
 * El estado sólo lleva puestos, centros de costos y lo decidido: nombres, CURP y
 * números de trabajador se quedan en el libro, en Excel.
 */

import { DomainError } from "../comun/errores.ts";
import type { PadronLeido } from "../padron/tipos.ts";
import type { ClasificadorPorLotes, ResultadoDeCaso } from "./lote.ts";
import { planearClasificacion, type PlanDeClasificacion } from "./plan.ts";

export interface AvanceDeLaPuerta {
  readonly terminado: boolean;
  readonly consultas: number;
  readonly casos: number;
  /** Casos que ya tienen propuesta de al menos uno de los dos papeles. */
  readonly conPropuesta: number;
  /** El estado para el siguiente paso, en JSON. */
  readonly lote: string;
  readonly resultados: readonly ResultadoDeCaso[] | null;
}

export interface PuertaDeOcupacionesPort {
  planear(archivo: Buffer): Promise<{ readonly plan: PlanDeClasificacion; readonly lote: string }>;
  avanzar(lote: string): Promise<AvanceDeLaPuerta>;
}

export class PuertaDeOcupaciones implements PuertaDeOcupacionesPort {
  readonly #extraer: (archivo: Buffer) => PadronLeido;
  readonly #lotes: Pick<ClasificadorPorLotes, "iniciar" | "leer" | "avanzar">;
  readonly #casosPorCorrida: number;

  constructor(deps: {
    readonly extraer: (archivo: Buffer) => PadronLeido;
    readonly lotes: Pick<ClasificadorPorLotes, "iniciar" | "leer" | "avanzar">;
    /** Casos que entran a una corrida; lo que no cabe queda para la siguiente. */
    readonly casosPorCorrida: number;
  }) {
    this.#extraer = deps.extraer;
    this.#lotes = deps.lotes;
    this.#casosPorCorrida = deps.casosPorCorrida;
  }

  planear(archivo: Buffer): Promise<{ readonly plan: PlanDeClasificacion; readonly lote: string }> {
    // Igual que al previsualizar un padrón: un libro con otra forma es un
    // rechazo que se explica, no una falla interna que Excel reintentaría.
    let padron: PadronLeido;
    try {
      padron = this.#extraer(archivo);
    } catch (error) {
      throw new DomainError(
        "INVALID_ROSTER_FILE",
        `El archivo no tiene la forma del padrón semanal: ${(error as Error).message}`,
      );
    }
    const plan = planearClasificacion(padron, this.#casosPorCorrida);
    return Promise.resolve({ plan, lote: JSON.stringify(this.#lotes.iniciar(plan.casos)) });
  }

  async avanzar(lote: string): Promise<AvanceDeLaPuerta> {
    const avance = await this.#lotes.avanzar(this.#lotes.leer(lote));
    const { estado } = avance;
    const conPropuesta = estado.casos.filter(
      (caso) => estado.principal.propuestas[caso.id] ?? estado.verificador.propuestas[caso.id],
    ).length;
    return {
      terminado: avance.terminado,
      consultas: estado.consultas,
      casos: estado.casos.length,
      conPropuesta,
      lote: JSON.stringify(estado),
      resultados: avance.resultados,
    };
  }
}
