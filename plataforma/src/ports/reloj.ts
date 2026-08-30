/**
 * Puerto de reloj.
 *
 * El dominio no lee la hora del sistema. E1 cerró con un defecto de esta
 * familia —una prueba atada al mes en curso— y la forma de no repetirlo es que
 * el tiempo entre como dependencia declarada.
 */

export interface Clock {
  /** Momento actual. */
  now(): Date;
  /** Momento actual en ISO 8601 con zona UTC, que es la forma canónica del proyecto. */
  nowIso(): string;
}
