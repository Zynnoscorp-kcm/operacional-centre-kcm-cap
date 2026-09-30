import { DomainError } from "../comun/errores.ts";
import type { PadronLeido } from "../padron/tipos.ts";
import type { CasoEnLote } from "./instrucciones.ts";
import { leerCaso } from "./servicio.ts";

export interface FilaPorEscribir {
  readonly hoja: string;
  readonly fila: number;
  readonly numero: string;
  readonly columna: string;
  readonly columnaDelNumero: string;
  readonly caso: string;
}

export interface PlanDeClasificacion {
  readonly casos: readonly CasoEnLote[];
  readonly filas: readonly FilaPorEscribir[];
  readonly conClave: number;
  readonly conTextoNoClave: number;
  readonly omitidos: number;
  readonly hojasSinColumna: readonly string[];
  readonly pendientes: { readonly casos: number; readonly trabajadores: number };
}

function normal(texto: string): string {
  return texto.normalize("NFC").replace(/\s+/gu, " ").trim().toUpperCase();
}

export function planearClasificacion(
  padron: PadronLeido,
  casosPorCorrida = Number.POSITIVE_INFINITY,
): PlanDeClasificacion {
  const hojas = padron.diagnostics.sheets ?? [];
  const columnas = new Map<string, { clave: string; numero: string }>();
  const hojasSinColumna: string[] = [];
  for (const hoja of hojas) {
    const clave = hoja.columns.find((columna) => columna.field === "cnoKey");
    const numero = hoja.columns.find((columna) => columna.field === "employeeId");
    if (clave?.present && clave.columnName && numero?.columnName) {
      columnas.set(hoja.sheetName, { clave: clave.columnName, numero: numero.columnName });
    } else {
      hojasSinColumna.push(hoja.sheetName);
    }
  }
  if (columnas.size === 0) {
    throw new DomainError(
      "PADRON_SIN_COLUMNA_DE_OCUPACION",
      "El padrón no trae la columna CLAVE DE OCUPACION en ninguna hoja de activos.",
    );
  }

  const casos: CasoEnLote[] = [];
  const casoPorEntrada = new Map<string, string>();
  const filas: FilaPorEscribir[] = [];
  let conClave = 0;
  let conTextoNoClave = 0;
  let omitidos = 0;

  for (const empleado of padron.employees) {
    const hoja = empleado.sourceSheet ?? "";
    const columna = columnas.get(hoja);
    if (!columna) continue;
    if (empleado.cnoKey) {
      conClave += 1;
      continue;
    }
    if (empleado.issues.includes("INVALID_CNO_KEY")) {
      conTextoNoClave += 1;
      continue;
    }
    if (!empleado.sourceRow) {
      omitidos += 1;
      continue;
    }

    let caso;
    try {
      caso = leerCaso({
        puesto: empleado.position,
        centroDeCostos: empleado.costCenterName ?? "",
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      omitidos += 1;
      continue;
    }

    const entrada = `${normal(caso.puesto)}\u0000${normal(caso.centroDeCostos)}`;
    let id = casoPorEntrada.get(entrada);
    if (!id) {
      id = `C${String(casos.length + 1).padStart(3, "0")}`;
      casoPorEntrada.set(entrada, id);
      casos.push({ id, ...caso });
    }
    filas.push({
      hoja,
      fila: empleado.sourceRow,
      numero: empleado.employeeId,
      columna: columna.clave,
      columnaDelNumero: columna.numero,
      caso: id,
    });
  }

  if (casos.length <= casosPorCorrida) {
    return {
      casos,
      filas,
      conClave,
      conTextoNoClave,
      omitidos,
      hojasSinColumna,
      pendientes: { casos: 0, trabajadores: 0 },
    };
  }
  const trabajadores = new Map<string, number>();
  for (const fila of filas) trabajadores.set(fila.caso, (trabajadores.get(fila.caso) ?? 0) + 1);
  const cuantos = (caso: CasoEnLote) => trabajadores.get(caso.id) ?? 0;
  const entran = new Set(
    casos
      .toSorted((a, b) => cuantos(b) - cuantos(a))
      .slice(0, casosPorCorrida)
      .map((caso) => caso.id),
  );
  const filasQueEntran = filas.filter((fila) => entran.has(fila.caso));
  return {
    casos: casos.filter((caso) => entran.has(caso.id)),
    filas: filasQueEntran,
    conClave,
    conTextoNoClave,
    omitidos,
    hojasSinColumna,
    pendientes: {
      casos: casos.length - entran.size,
      trabajadores: filas.length - filasQueEntran.length,
    },
  };
}
