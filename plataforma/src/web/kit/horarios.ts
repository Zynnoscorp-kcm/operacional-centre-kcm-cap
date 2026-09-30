export const INICIO_DE_JORNADA = 7 * 60;

export const FIN_DE_JORNADA = 20 * 60;

export const BLOQUE_EN_MINUTOS = 30;

export function comoHora(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${String(hora).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

export function horasDeLaJornada(
  desde: number = INICIO_DE_JORNADA,
  hasta: number = FIN_DE_JORNADA,
): readonly string[] {
  const horas: string[] = [];
  for (let valor = desde; valor <= hasta; valor += BLOQUE_EN_MINUTOS) horas.push(comoHora(valor));
  return horas;
}
