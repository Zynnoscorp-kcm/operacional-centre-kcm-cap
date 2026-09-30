const ROMANOS: Readonly<Record<string, string>> = { I: "1", II: "2", "1": "1", "2": "2" };

const ECATEPEC = /^(?:PLANTA\s+)?ECATEPEC\s*[-\s]?\s*(I{1,2}|[12])$/u;

export function plantLabel(plant: string | null | undefined): string {
  const corto = shortPlantName(plant);
  return /^\d+$/u.test(corto) ? `Planta ${corto}` : corto;
}

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
