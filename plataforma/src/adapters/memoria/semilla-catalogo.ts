/**
 * Catálogo de capacitaciones para la corrida en memoria.
 *
 * Con base conectada el catálogo sale de `catalogo.capacitacion`. Sin ella, el
 * repositorio en memoria sólo traía dos cursos sintéticos, así que el selector
 * de `/sesiones` ofrecía dos opciones y ninguna de las reales. Esta función lee
 * la misma semilla que alimenta a la base (`capacitaciones-seed.tsv`, generada
 * por `npm run build:catalog-seed`) para que la pantalla muestre el catálogo
 * verdadero.
 *
 * Si el archivo no existe —un clon sin `referencias/privado`— devuelve
 * `undefined` y el repositorio se queda con sus cursos sintéticos: la ausencia
 * de la semilla no puede impedir que la plataforma arranque.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { TrainingCatalogItem } from "../../domain/quiosco/tipos.ts";

const RUTA_POR_OMISION = "referencias/privado/capacitaciones-seed.tsv";

export function leerCatalogoDeSemilla(
  projectRoot: string,
  rutaRelativa: string = RUTA_POR_OMISION,
): readonly TrainingCatalogItem[] | undefined {
  const ruta = resolve(projectRoot, rutaRelativa);
  if (!existsSync(ruta)) return undefined;

  const lineas = readFileSync(ruta, "utf8").split("\n");
  const cursos: TrainingCatalogItem[] = [];

  // La primera línea es el encabezado (`trainingId  trainingName  active  version`).
  for (const linea of lineas.slice(1)) {
    if (linea.trim() === "") continue;
    const [trainingId, name, active] = linea.split("\t");
    if (!trainingId?.trim() || !name?.trim()) continue;
    cursos.push({
      trainingId: trainingId.trim(),
      name: name.trim(),
      active: (active ?? "").trim().toUpperCase() !== "FALSE",
    });
  }

  return cursos.length > 0 ? cursos : undefined;
}
