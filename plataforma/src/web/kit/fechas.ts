/**
 * Fechas como se leen en pantalla.
 *
 * `2026-01-13` es como se guarda, no como se lee: el día y el mes se confunden
 * y el guion obliga a contar. Toda la consola enseña «13 ene 2026».
 */

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/**
 * Un instante (`2026-09-26T01:30:00Z`) cae en otro día en la planta que en UTC,
 * que es el reloj del servidor en la nube: entre las seis de la tarde y la
 * medianoche de la Ciudad de México, UTC ya va en mañana. Una fecha sola
 * (`2026-09-25`) no tiene hora y se deja como está.
 */
function enPlanta(iso: string): { dia: string; hora: string } {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return { dia: iso, hora: "" };
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return { dia: iso.slice(0, 10), hora: iso.slice(11, 16) };
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const buscar = (tipo: string): string => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return {
    dia: `${buscar("year")}-${buscar("month")}-${buscar("day")}`,
    hora: `${buscar("hour")}:${buscar("minute")}`,
  };
}

/** Un instante como se lee en la planta: «25 sep 2026 · 19:42». */
export function momento(iso: string | null | undefined): string {
  if (!iso) return "—";
  const { dia, hora } = enPlanta(iso);
  return hora ? `${fechaCorta(dia)} · ${hora}` : fechaCorta(dia);
}

/** `2026-01-13` → «13 ene 2026». Sin fecha, una raya. Un instante se lee en la planta. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [anio = "", mes = "", dia = ""] = enPlanta(iso).dia.split("-");
  const nombre = MESES_CORTOS[Number(mes) - 1];
  if (!nombre || !dia) return iso;
  return `${String(Number(dia))} ${nombre} ${anio}`;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

/** `2026-09-24` → «jueves 24 de septiembre de 2026», para encabezados. */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "—";
  const fecha = enPlanta(iso).dia;
  const [anio = "", mes = "", dia = ""] = fecha.split("-");
  const nombre = MESES[Number(mes) - 1];
  if (!nombre || !dia) return iso;
  const diaDeLaSemana = DIAS[new Date(`${fecha}T12:00:00Z`).getUTCDay()] ?? "";
  return `${diaDeLaSemana} ${String(Number(dia))} de ${nombre} de ${anio}`.trim();
}
