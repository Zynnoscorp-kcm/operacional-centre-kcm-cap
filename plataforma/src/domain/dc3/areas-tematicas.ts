/**
 * El nombre de las áreas temáticas en uso, del catálogo de la STPS.
 *
 * La base guarda la clave de cada curso y, desde la migración 0040, también su
 * nombre. Cuando sólo trae la clave, el nombre sale de aquí: es catálogo
 * público y se imprime igual en cualquier equipo. Una clave que no esté aquí ni
 * en la base se imprime sola, y la constancia cuenta ese recuadro como
 * incompleto.
 */
export const AREAS_TEMATICAS_STPS: Readonly<Record<string, string>> = {
  "3131": "Apoyo a la calidad",
  "3132": "Recursos humanos",
  "6000": "Seguridad",
};

/** El nombre del área temática: el de la base o, si falta, el del catálogo. */
export function nombreDeAreaTematica(clave: string | null, nombre: string | null): string {
  return (nombre ?? "").trim() || (AREAS_TEMATICAS_STPS[(clave ?? "").trim()] ?? "");
}
