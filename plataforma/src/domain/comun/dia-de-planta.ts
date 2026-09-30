export function hoyEnPlanta(ahora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const buscar = (tipo: string): string => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${buscar("year")}-${buscar("month")}-${buscar("day")}`;
}

export function sumarDias(iso: string, n: number): string {
  return new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
