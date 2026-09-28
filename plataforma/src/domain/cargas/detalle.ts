/**
 * El detalle de un envío completo, persona por persona.
 *
 * Las cifras del cuadre dicen cuántos; esto dice quiénes, con nombre y
 * adscripción, para que la revisión se lea como un «antes y después» sin tener
 * que saber qué significa cada regla. Lo usan la matriz y el padrón, que miden
 * cosas distintas pero se leen igual: quién entra, quién ya no está, quién se
 * movió y qué fechas cambian.
 */

/** Una persona que entra o que ya no aparece. */
export interface PersonaDelCambio {
  readonly nomina: string;
  readonly nombre: string;
  /** Puesto, área y departamento que se conozcan, en ese orden. */
  readonly adscripcion: readonly string[];
  /** Qué le pasa, cuando no es obvio: «Se da de baja», «Sigue en la matriz». */
  readonly nota?: string;
  /** ISO `YYYY-MM-DD` de la baja declarada, para enseñarla junto a la nota. */
  readonly fechaDeBaja?: string;
  /** No se escribe: sólo se enseña. Se pinta en gris. */
  readonly soloAviso?: boolean;
}

/** Un dato de una persona que cambia de valor. */
export interface MovimientoDelCambio {
  readonly nomina: string;
  readonly nombre: string;
  readonly campo: string;
  readonly antes: string;
  readonly ahora: string;
  /** La otra fuente manda en este dato: la diferencia se enseña, no se escribe. */
  readonly soloAviso?: boolean;
}

/** Una fecha de capacitación que entra, cambia o se retira. */
export interface FechaDelCambio {
  readonly nomina: string;
  readonly nombre: string;
  readonly curso: string;
  /** Nula cuando la fecha es nueva. */
  readonly antes: string | null;
  /** Nula cuando la fecha se retira. */
  readonly ahora: string | null;
}

export interface DetalleDeCambios {
  readonly altas: readonly PersonaDelCambio[];
  readonly bajas: readonly PersonaDelCambio[];
  readonly movimientos: readonly MovimientoDelCambio[];
  readonly fechas: readonly FechaDelCambio[];
  /** Fechas que no caben en la revisión: la cifra completa sigue en el cuadre. */
  readonly fechasOmitidas: number;
}

/**
 * Cuántas fechas se detallan.
 *
 * La primera carga de un libro trae miles y guardarlas todas en la revisión
 * compartida engordaría cada lectura; las del día a día son decenas. Con
 * quinientas se ve completo lo normal y lo excepcional se resume.
 */
export const FECHAS_DETALLADAS = 500;

/** Quita los huecos: una adscripción sin área no deja «· ·» colgando. */
export function adscripcion(...partes: readonly (string | null | undefined)[]): string[] {
  return partes.map((parte) => (parte ?? "").trim()).filter((parte) => parte !== "");
}
