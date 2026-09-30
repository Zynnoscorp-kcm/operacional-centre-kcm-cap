import { DomainError } from "../comun/errores.ts";
import type { PadronLeido } from "../padron/tipos.ts";
import type { ClasificadorPorLotes, ResultadoDeCaso } from "./lote.ts";
import { planearClasificacion, type PlanDeClasificacion } from "./plan.ts";

export interface AvanceDeLaPuerta {
  readonly terminado: boolean;
  readonly consultas: number;
  readonly casos: number;
  readonly conPropuesta: number;
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
    readonly casosPorCorrida: number;
  }) {
    this.#extraer = deps.extraer;
    this.#lotes = deps.lotes;
    this.#casosPorCorrida = deps.casosPorCorrida;
  }

  planear(archivo: Buffer): Promise<{ readonly plan: PlanDeClasificacion; readonly lote: string }> {
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
