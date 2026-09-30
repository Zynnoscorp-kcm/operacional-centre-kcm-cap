export interface PersonaDelCambio {
  readonly nomina: string;
  readonly nombre: string;
  readonly adscripcion: readonly string[];
  readonly nota?: string;
  readonly fechaDeBaja?: string;
  readonly soloAviso?: boolean;
}

export interface MovimientoDelCambio {
  readonly nomina: string;
  readonly nombre: string;
  readonly campo: string;
  readonly antes: string;
  readonly ahora: string;
  readonly soloAviso?: boolean;
}

export interface FechaDelCambio {
  readonly nomina: string;
  readonly nombre: string;
  readonly curso: string;
  readonly antes: string | null;
  readonly ahora: string | null;
}

export interface DetalleDeCambios {
  readonly altas: readonly PersonaDelCambio[];
  readonly bajas: readonly PersonaDelCambio[];
  readonly movimientos: readonly MovimientoDelCambio[];
  readonly fechas: readonly FechaDelCambio[];
  readonly fechasOmitidas: number;
}

export const FECHAS_DETALLADAS = 500;

export function adscripcion(...partes: readonly (string | null | undefined)[]): string[] {
  return partes.map((parte) => (parte ?? "").trim()).filter((parte) => parte !== "");
}
