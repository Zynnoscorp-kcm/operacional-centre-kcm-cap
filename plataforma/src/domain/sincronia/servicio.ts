import type { Clock } from "../../ports/reloj.port.ts";
import type { ConteoDeCampo, CotejoCrudo, SincroniaPort } from "../../ports/sincronia.port.ts";
import {
  MUESTRA_DE_SINCRONIA,
  type CampoDelInforme,
  type InformeDeSincronia,
  type VeredictoDeSincronia,
} from "./tipos.ts";

export interface SincroniaServiceDeps {
  readonly port: SincroniaPort;
  readonly clock: Clock;
}

export class SincroniaService {
  readonly #port: SincroniaPort;
  readonly #clock: Clock;

  constructor(deps: SincroniaServiceDeps) {
    this.#port = deps.port;
    this.#clock = deps.clock;
  }

  async cotejar(): Promise<InformeDeSincronia | null> {
    const crudo = await this.#port.cotejar(MUESTRA_DE_SINCRONIA);
    if (!crudo) return null;
    return this.#componer(crudo);
  }

  #componer(crudo: CotejoCrudo): InformeDeSincronia {
    const campos = crudo.campos.map((conteo) => evaluarCampo(conteo, crudo));

    const diferenciasDeCampo = campos.reduce((suma, campo) => suma + campo.diferencias, 0);
    const equivalentesTotales = campos.reduce((suma, campo) => suma + campo.equivalentes, 0);
    const diferenciasTotales =
      diferenciasDeCampo + crudo.universo.soloMatriz + crudo.universo.soloPadron;

    const comparados = campos.reduce((suma, campo) => suma + campo.comparados, 0);
    const coincidentes = campos.reduce(
      (suma, campo) => suma + campo.iguales + campo.equivalentes,
      0,
    );

    return {
      corridoEn: this.#clock.nowIso(),
      fuente: crudo.fuente,
      universo: crudo.universo,
      campos,
      veredicto: dictar(diferenciasTotales, equivalentesTotales),
      diferenciasTotales,
      equivalentesTotales,
      similitudGlobal: proporcion(coincidentes, comparados),
    };
  }
}

function evaluarCampo(conteo: ConteoDeCampo, crudo: CotejoCrudo): CampoDelInforme {
  const comparados =
    conteo.iguales +
    conteo.equivalentes +
    conteo.discrepantes +
    conteo.soloMatriz +
    conteo.soloPadron;

  return {
    ...conteo,
    comparados,
    diferencias: conteo.discrepantes + conteo.soloMatriz + conteo.soloPadron,
    similitud: proporcion(conteo.iguales + conteo.equivalentes, comparados),
    muestras: crudo.muestras.filter((muestra) => muestra.campo === conteo.campo),
  };
}

function proporcion(parte: number, total: number): number {
  return total === 0 ? 1 : parte / total;
}

function dictar(diferencias: number, equivalentes: number): VeredictoDeSincronia {
  if (diferencias > 0) return "CON_DISCREPANCIAS";
  return equivalentes > 0 ? "EQUIVALENTES" : "IDENTICOS";
}
