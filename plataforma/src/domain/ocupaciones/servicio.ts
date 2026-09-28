/**
 * La puerta del agente de ocupaciones.
 *
 * Aquí se decide qué entra al agente, y por lo tanto qué puede llegar a un
 * proveedor externo: **dos textos, puesto y centro de costos, y nada más**. La
 * regla se aplica en el servidor y no se confía en quien llama:
 *
 * - un campo de más se rechaza en vez de ignorarse, para que un error de
 *   armado en Excel se vea el primer día y no viaje en silencio;
 * - un número de cinco dígitos o más (número de trabajador, NSS, CURP, RFC), un
 *   correo o un nombre con la forma del padrón («APELLIDO,APELLIDO,NOMBRE»)
 *   detienen el caso: son la huella de una columna equivocada.
 *
 * Cada sugerencia sale con la versión del agente y una huella de su
 * configuración —modelos, topes, instrucciones y catálogo—, para saber después
 * exactamente con qué se hizo.
 */

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

// Cinco dígitos o más, aunque vengan en grupos: «1234-56-7890-1» o «55 1234 5678»
// son un NSS y un teléfono. En los padrones de las semanas 29 y 31 ningún puesto
// ni centro de costos real tiene esa forma.
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
  // La detección mira la forma NFKC: así «２８３９２», con dígitos de ancho
  // completo, se ve como el número que es. El texto que viaja no cambia.
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

/** El caso tal como puede salir hacia un modelo, o un `DomainError` que dice por qué no. */
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

/**
 * Huella corta de todo lo que decide una respuesta. Dos sugerencias con la
 * misma huella se hicieron con los mismos modelos, topes, instrucciones y
 * catálogo.
 */
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
