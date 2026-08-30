/**
 * La rejilla de horarios de la jornada.
 *
 * Vive aquí y no en cada pantalla porque la agenda pública y la creación de
 * sesiones tienen que ofrecer los mismos bloques: si una ofrece 09:10 y la
 * otra no, la sesión que se cree a esa hora no empata con ninguna reservación y
 * la sala queda apartada a una hora distinta de la que dice la sesión.
 */

/** Primer bloque de la jornada, en minutos desde medianoche. */
export const INICIO_DE_JORNADA = 7 * 60;

/** Último bloque de la jornada, en minutos desde medianoche. */
export const FIN_DE_JORNADA = 20 * 60;

/**
 * El paso es de media hora y no de cinco minutos porque la agenda de salas se
 * lleva en bloques de treinta: ofrecer 09:10 sería ofrecer un horario que la
 * reservación tendría que redondear igualmente.
 */
export const BLOQUE_EN_MINUTOS = 30;

/** `540` → `"09:00"`. */
export function comoHora(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${String(hora).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

/** Las horas de la jornada como texto `HH:MM`, de inicio a fin inclusive. */
export function horasDeLaJornada(
  desde: number = INICIO_DE_JORNADA,
  hasta: number = FIN_DE_JORNADA,
): readonly string[] {
  const horas: string[] = [];
  for (let valor = desde; valor <= hasta; valor += BLOQUE_EN_MINUTOS) horas.push(comoHora(valor));
  return horas;
}
