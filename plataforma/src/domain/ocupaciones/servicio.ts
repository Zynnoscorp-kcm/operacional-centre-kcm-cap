import { createHash } from "node:crypto";

import { DomainError } from "../comun/errores.ts";
import type { AgenteDeOcupaciones, ResultadoDelAgente } from "./agente.ts";
import { TEXTOS_DEL_AGENTE, type CasoDeOcupacion } from "./instrucciones.ts";

export type { CasoDeOcupacion } from "./instrucciones.ts";

export interface SugerenciaDeOcupacion extends ResultadoDelAgente {
  readonly caso: CasoDeOcupacion;
  readonly version: string;
  readonly huella: string;
}

export interface ServicioDeOcupacionesPort {
  readonly version: string;
  readonly huella: string;
  sugerir(entrada: unknown): Promise<SugerenciaDeOcupacion>;
}

const LARGO_MAXIMO = 120;
const CAMPOS: Readonly<Record<keyof CasoDeOcupacion, string>> = {
  puesto: "El puesto",
  centroDeCostos: "El centro de costos",
};

const NUMERO_LARGO = /\d(?:[ .\-/]?\d){4,}/u;
const NOMBRE_DEL_PADRON = /^[\p{L} .'-]+,[\p{L} .'-]+,[\p{L} .'-]+$/u;

function campo(valor: unknown, nombre: string): string {
  if (typeof valor !== "string") {
    throw new DomainError("CASO_INCOMPLETO", `${nombre} no viene como texto.`);
  }
  const limpio = valor.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (limpio === "") throw new DomainError("CASO_INCOMPLETO", `${nombre} viene vacío.`);
  if (limpio.length > LARGO_MAXIMO) {
    throw new DomainError(
      "CASO_DEMASIADO_LARGO",
      `${nombre} pasa de ${String(LARGO_MAXIMO)} caracteres.`,
    );
  }
  const comparable = limpio.normalize("NFKC");
  if (
    NUMERO_LARGO.test(comparable) ||
    comparable.includes("@") ||
    NOMBRE_DEL_PADRON.test(comparable)
  ) {
    throw new DomainError(
      "CASO_CON_DATO_PERSONAL",
      `${nombre} trae algo que parece un dato personal: un número de cinco dígitos o más, aunque ` +
        "venga en grupos, un correo o un nombre con la forma del padrón. Al modelo sólo viajan " +
        "puesto y centro de costos.",
    );
  }
  return limpio;
}

export function leerCaso(entrada: unknown): CasoDeOcupacion {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    throw new DomainError(
      "CASO_INCOMPLETO",
      "El caso tiene que ser un objeto con puesto y centro de costos.",
    );
  }
  const objeto = entrada as Record<string, unknown>;
  const extras = Object.keys(objeto).filter((clave) => !Object.hasOwn(CAMPOS, clave));
  if (extras.length > 0) {
    throw new DomainError(
      "CASO_CON_CAMPOS_DE_MAS",
      `Al agente sólo viajan puesto y centro de costos; el caso trae además: ${extras.join(", ")}.`,
    );
  }
  return {
    puesto: campo(objeto.puesto, CAMPOS.puesto),
    centroDeCostos: campo(objeto.centroDeCostos, CAMPOS.centroDeCostos),
  };
}

export function huellaDeConfiguracion(partes: {
  readonly version: string;
  readonly modelos: readonly string[];
  readonly limites: unknown;
  readonly catalogo: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...partes,
        textos: TEXTOS_DEL_AGENTE,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export class ServicioDeOcupaciones implements ServicioDeOcupacionesPort {
  readonly version: string;
  readonly huella: string;
  readonly #agente: Pick<AgenteDeOcupaciones, "clasificar">;

  constructor(deps: {
    readonly agente: Pick<AgenteDeOcupaciones, "clasificar">;
    readonly version: string;
    readonly huella: string;
  }) {
    this.#agente = deps.agente;
    this.version = deps.version;
    this.huella = deps.huella;
  }

  async sugerir(entrada: unknown): Promise<SugerenciaDeOcupacion> {
    const caso = leerCaso(entrada);
    const resultado = await this.#agente.clasificar(caso);
    return { caso, version: this.version, huella: this.huella, ...resultado };
  }
}
