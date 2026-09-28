/**
 * Desde cuándo cuentan las constancias DC-3.
 *
 * El departamento lo fijó el 2026-09-24: la plataforma trabaja con las
 * constancias de cursos tomados desde el 1 de enero de 2026. Las de años
 * anteriores no desaparecen —se consultan y se emiten cuando alguien las pide—,
 * pero no se mezclan con el trabajo del día ni cuentan en sus cifras.
 *
 * Es una sola constante y vive aquí, no en una configuración por equipo: con
 * dos equipos emitiendo —el del departamento y el publicado—, un corte que
 * pudiera diferir entre ellos daría dos listas distintas de lo mismo.
 */
export const CORTE_DE_CONSTANCIAS = "2026-01-01";

/**
 * De qué periodo es una constancia, según la fecha de su curso.
 *
 * Si alguien tomó el curso varias veces, cuenta la primera fecha desde el
 * corte; sólo si no hay ninguna desde el corte cuenta la más reciente de antes.
 * Es la regla de «una constancia por trabajador y curso»: repetir el curso en
 * agosto no cambia la constancia que ya correspondía a febrero.
 */
export type PeriodoDc3 = "desde-corte" | "anteriores";
