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
