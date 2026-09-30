import type { CatalogoDeOcupaciones, Ocupacion } from "./catalogo.ts";
import type { BloqueDeOpciones, Confianza, RespuestaDeOcupacion } from "./instrucciones.ts";

export interface PropuestaValidada {
  readonly codigo: string;
  readonly descripcion: string;
  readonly consecutivo: string;
  readonly subarea: string;
  readonly denominacionDeSubarea: string;
  readonly alternativa: { readonly codigo: string; readonly descripcion: string } | null;
  readonly confianza: Confianza;
  readonly motivo: string;
}

export interface PasoDeTraza {
  readonly nodo: string;
  readonly proveedor: string | null;
  readonly modelo: string | null;
  readonly milisegundos: number;
  readonly tokensDeEntrada: number | null;
  readonly tokensDeSalida: number | null;
  readonly nota: string;
}

export type EstadoDeSugerencia = "sugerida" | "revisar" | "sin_respuesta";

export interface Conciliacion {
  readonly estado: EstadoDeSugerencia;
  readonly sugerencia: PropuestaValidada | null;
  readonly principal: PropuestaValidada | null;
  readonly verificador: PropuestaValidada | null;
  readonly razon: string;
}

const RANGO_DE_CONFIANZA: Readonly<Record<Confianza, number>> = { alta: 2, media: 1, baja: 0 };

export function codigoLimpio(codigo: string): string {
  return codigo.replace(/[\s-]+/gu, "");
}

export function armarBloques(
  catalogo: CatalogoDeOcupaciones,
  subareas: readonly string[],
  maxOpciones: number,
): { readonly bloques: BloqueDeOpciones[]; readonly omitidas: string[] } {
  const bloques: BloqueDeOpciones[] = [];
  const omitidas: string[] = [];
  let total = 0;
  for (const clave of subareas) {
    const ocupaciones = catalogo.deSubarea(clave);
    if (bloques.length > 0 && total + ocupaciones.length > maxOpciones) {
      omitidas.push(clave);
      continue;
    }
    bloques.push({
      subarea: clave,
      denominacion: catalogo.subarea(clave)?.denominacion ?? "",
      ocupaciones,
    });
    total += ocupaciones.length;
  }
  return { bloques, omitidas };
}

export function codigosMostrados(bloques: readonly BloqueDeOpciones[]): ReadonlySet<string> {
  return new Set(
    bloques.flatMap((bloque) => bloque.ocupaciones.map((ocupacion) => ocupacion.codigo)),
  );
}

export function subareasValidas(
  catalogo: CatalogoDeOcupaciones,
  propuestas: readonly string[],
  maxSubareas: number,
): string[] {
  return [...new Set(propuestas.map((clave) => clave.trim()))]
    .filter((clave) => catalogo.subarea(clave) !== undefined)
    .slice(0, maxSubareas);
}

export function propuestaDesde(
  catalogo: CatalogoDeOcupaciones,
  ocupacion: Ocupacion,
  respuesta: RespuestaDeOcupacion,
): PropuestaValidada {
  const codigoAlterno = codigoLimpio(respuesta.alternativa);
  const alterna =
    codigoAlterno && codigoAlterno !== ocupacion.codigo
      ? catalogo.ocupacion(codigoAlterno)
      : undefined;
  return {
    codigo: ocupacion.codigo,
    descripcion: ocupacion.descripcion,
    consecutivo: ocupacion.consecutivo,
    subarea: ocupacion.subarea,
    denominacionDeSubarea: catalogo.subarea(ocupacion.subarea)?.denominacion ?? "",
    alternativa: alterna ? { codigo: alterna.codigo, descripcion: alterna.descripcion } : null,
    confianza: respuesta.confianza,
    motivo: respuesta.motivo.trim(),
  };
}

export function conciliarPropuestas(entrada: {
  readonly principal: PropuestaValidada | null;
  readonly verificador: PropuestaValidada | null;
  readonly hayVerificador: boolean;
  readonly fallaDelPrincipal: string;
  readonly fallaDelVerificador: string;
}): Conciliacion {
  const { principal, verificador, hayVerificador } = entrada;

  if (!principal && !verificador) {
    const fallas = [entrada.fallaDelPrincipal, entrada.fallaDelVerificador].filter(Boolean);
    return {
      estado: "sin_respuesta",
      sugerencia: null,
      principal: null,
      verificador: null,
      razon: fallas.length > 0 ? fallas.join("; ") : "ningún modelo dejó propuesta",
    };
  }
  if (principal && !hayVerificador) {
    return {
      estado: principal.confianza === "alta" ? "sugerida" : "revisar",
      sugerencia: principal,
      principal,
      verificador: null,
      razon:
        principal.confianza === "alta"
          ? "confianza alta, sin verificador configurado"
          : `confianza ${principal.confianza}, sin verificador configurado`,
    };
  }
  if (principal && verificador) {
    const coinciden = principal.codigo === verificador.codigo;
    const menor =
      RANGO_DE_CONFIANZA[principal.confianza] <= RANGO_DE_CONFIANZA[verificador.confianza]
        ? principal.confianza
        : verificador.confianza;
    return {
      estado: coinciden && menor !== "baja" ? "sugerida" : "revisar",
      sugerencia: principal,
      principal,
      verificador,
      razon: coinciden
        ? menor === "baja"
          ? "principal y verificador coinciden, pero con confianza baja"
          : "principal y verificador coinciden"
        : principal.subarea === verificador.subarea
          ? `no coinciden en la ocupación (principal ${principal.codigo}, verificador ${verificador.codigo}); sí en la subárea ${principal.subarea}`
          : `no coinciden: principal ${principal.codigo}, verificador ${verificador.codigo}`,
    };
  }
  if (principal) {
    return {
      estado: "revisar",
      sugerencia: principal,
      principal,
      verificador: null,
      razon: `sin verificación: ${entrada.fallaDelVerificador || "el verificador no respondió"}`,
    };
  }
  return {
    estado: "revisar",
    sugerencia: verificador,
    principal: null,
    verificador,
    razon: `sólo respondió el verificador; el principal falló: ${entrada.fallaDelPrincipal || "sin propuesta"}`,
  };
}
