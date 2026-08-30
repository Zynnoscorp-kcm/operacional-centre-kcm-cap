/**
 * Nombre corto de la planta.
 *
 * La matriz escribe `ECATEPEC I` y `ECATEPEC II`; en el piso, en los formatos y
 * en la conversación son la 1 y la 2. La pantalla muestra el número y
 * el título del dato conserva el nombre completo, así que nadie pierde el
 * original.
 *
 * Lo que no sea una de esas dos —hoy `MANTTO INGENIERIA`, mañana lo que traiga
 * el archivo— se muestra tal cual. Traducir a ciegas convertiría un valor
 * desconocido en un número inventado, y un número de planta equivocado en la
 * ficha de un trabajador es peor que un nombre largo.
 */

const ROMANOS: Readonly<Record<string, string>> = { I: "1", II: "2", "1": "1", "2": "2" };

/** `ECATEPEC`, con o sin acento, con o sin `PLANTA` delante, y su ordinal. */
const ECATEPEC = /^(?:PLANTA\s+)?ECATEPEC\s*[-\s]?\s*(I{1,2}|[12])$/u;

export function shortPlantName(plant: string | null | undefined): string {
  const original = (plant ?? "").trim();
  if (original === "") return "";

  const normalizado = original
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toUpperCase()
    .replace(/\s+/gu, " ");

  const coincidencia = ECATEPEC.exec(normalizado);
  const ordinal = coincidencia?.[1];
  if (ordinal === undefined) return original;

  return ROMANOS[ordinal] ?? original;
}
