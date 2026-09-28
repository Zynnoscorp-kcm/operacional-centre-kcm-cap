/**
 * Formas del informe de sincronía entre la matriz y el padrón.
 *
 * El puerto devuelve conteos crudos; aquí viven las tres cosas que el conteo no
 * dice por sí solo: cuánto se parecen las dos fuentes, qué cuenta como
 * diferencia y cuándo se puede afirmar que están sincronizadas. Están en el
 * dominio y no en la consulta a propósito —son la regla, no el acopio— y por eso
 * se pueden ejercitar sin base.
 */

import type {
  CampoCotejado,
  ConteoDeCampo,
  FuenteDeMatriz,
  MuestraDeCotejo,
  UniversoCotejado,
} from "../../ports/sincronia.port.ts";

/**
 * Cuántos casos se enseñan de cada campo. El resto es cifra.
 *
 * Doce, igual que el barrido de la matriz, y por el mismo motivo: revisar una
 * pestaña cuesta unos kilobytes y no una copia del padrón en cada visita. Si
 * hay más de doce trabajadores con el mismo campo discrepante, el problema no
 * se diagnostica leyendo la lista completa sino mirando de dónde salió.
 */
export const MUESTRA_DE_SINCRONIA = 12;

/**
 * El veredicto, que es lo que la pantalla contesta antes que nada.
 *
 * Tres estados y no dos porque «no son idénticos» y «no coinciden» son cosas
 * distintas. Una matriz que escribe `JOSÉ` donde el padrón guarda `JOSE`
 * describe al mismo trabajador con el mismo dato; una que dice otro puesto, no.
 * Fundirlas en un solo «hay diferencias» obligaría a abrir el detalle cada vez
 * para averiguar si hay algo que hacer.
 */
export type VeredictoDeSincronia = "IDENTICOS" | "EQUIVALENTES" | "CON_DISCREPANCIAS";

/** Un campo ya evaluado: sus conteos, su similitud y sus casos. */
export interface CampoDelInforme extends ConteoDeCampo {
  /** Trabajadores presentes en los dos lados. Es el denominador de la similitud. */
  readonly comparados: number;
  /**
   * Cuántos no coinciden: discrepantes más las dos ausencias. Los equivalentes
   * no entran, que es lo que separa este número de «cuántos no son idénticos».
   */
  readonly diferencias: number;
  /**
   * Proporción de 0 a 1 de trabajadores en que las dos fuentes dicen lo mismo,
   * contando como iguales a los equivalentes. Es 1 cuando no hay nada
   * comparable, que es la lectura honesta de un campo sin denominador.
   */
  readonly similitud: number;
  readonly muestras: readonly MuestraDeCotejo[];
}

export interface InformeDeSincronia {
  /** ISO 8601. La pantalla se dibuja corriendo el análisis, así que es «ahora». */
  readonly corridoEn: string;
  readonly fuente: FuenteDeMatriz;
  readonly universo: UniversoCotejado;
  readonly campos: readonly CampoDelInforme[];
  readonly veredicto: VeredictoDeSincronia;
  /**
   * Suma de diferencias de todos los campos más los trabajadores que sólo están
   * en un lado. Es la cifra que responde «¿hay algo que atender?».
   */
  readonly diferenciasTotales: number;
  /** Cuántos pares campo-trabajador difieren sólo en forma. */
  readonly equivalentesTotales: number;
  /** Similitud sobre los siete campos a la vez, con el mismo criterio. */
  readonly similitudGlobal: number;
}

/** Rótulo humano de cada campo. Vive con el tipo para que no se desincronicen. */
export const NOMBRE_DE_CAMPO: Readonly<Record<CampoCotejado, string>> = {
  nombre: "Nombre completo",
  fechaAlta: "Fecha de alta",
  tipoNomina: "Tipo de nómina",
  puesto: "Puesto",
  area: "Área",
  departamento: "Departamento",
  planta: "Planta",
};
