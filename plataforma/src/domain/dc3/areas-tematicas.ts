export const AREAS_TEMATICAS_STPS: Readonly<Record<string, string>> = {
  "3131": "Apoyo a la calidad",
  "3132": "Recursos humanos",
  "6000": "Seguridad",
};

export function nombreDeAreaTematica(clave: string | null, nombre: string | null): string {
  return (nombre ?? "").trim() || (AREAS_TEMATICAS_STPS[(clave ?? "").trim()] ?? "");
}
