/**
 * De un padrón leído, qué hay que clasificar y dónde se escribe cada respuesta.
 *
 * - **Faltantes:** los trabajadores activos con la celda de clave de ocupación
 *   vacía, en las hojas que tienen esa columna. Los que ya traen clave no se
 *   tocan.
 * - **Casos:** los faltantes con el mismo puesto y el mismo centro de costos
 *   son una sola pregunta, porque para el modelo son la misma entrada. Cada
 *   caso se evalúa desde cero; no se copia la clave de ningún trabajador que ya
 *   la tenga.
 * - **Filas:** por cada trabajador faltante, la hoja, el renglón, la columna
 *   donde va la clave y la columna del número, con el que Excel comprueba que
 *   escribe en la persona correcta.
 * - **Tope:** si hay más casos de los que caben en una corrida, entran primero
 *   los que cubren a más trabajadores y, a igual número, los que aparecen antes
 *   en el padrón. Los demás no se tocan: sus celdas siguen vacías y el plan de
 *   la siguiente corrida los vuelve a encontrar.
 *
 * Al modelo sólo viajan puesto y centro de costos, y pasan por la misma puerta
 * que un caso suelto: lo que parece un dato personal se queda fuera del lote.
 */

import { DomainError } from "../comun/errores.ts";
import type { PadronLeido } from "../padron/tipos.ts";
import type { CasoEnLote } from "./instrucciones.ts";
import { leerCaso } from "./servicio.ts";

export interface FilaPorEscribir {
  readonly hoja: string;
  readonly fila: number;
  readonly numero: string;
  /** Letra de la columna de la clave de ocupación en esa hoja. */
  readonly columna: string;
  /** Letra de la columna del número de trabajador, para comprobar antes de escribir. */
  readonly columnaDelNumero: string;
  readonly caso: string;
}

export interface PlanDeClasificacion {
  readonly casos: readonly CasoEnLote[];
  readonly filas: readonly FilaPorEscribir[];
  /** Trabajadores que ya traen clave: no se tocan. */
  readonly conClave: number;
  /** Celdas de clave con texto que no es una clave: tampoco se tocan, alguien las escribió. */
  readonly conTextoNoClave: number;
  /** Faltantes que no se pueden preguntar: sin puesto o centro de costos, o con algo que parece un dato personal. */
  readonly omitidos: number;
  /** Hojas de activos que no tienen la columna de clave de ocupación. */
  readonly hojasSinColumna: readonly string[];
  /** Lo que no cupo en esta corrida y queda para la siguiente. */
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
  // `toSorted` es estable: a igual número de trabajadores queda el orden del padrón.
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
