import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCourseMappings } from "../../src/domain/importacion-matriz/reconciliador.ts";
import type {
  CourseCatalogEntry,
  SnapshotCourse,
} from "../../src/domain/importacion-matriz/tipos.ts";

const NOMBRE = "SISTEMAS DE PROTECCION LOTO";

function columna(anio: string, letra: string): SnapshotCourse {
  return {
    sourceKey: `hc-course:${anio}/loto`,
    sourceColumn: letra,
    displayName: NOMBRE,
    normalizedName: NOMBRE,
  };
}

const delCatalogo: CourseCatalogEntry = {
  trainingId: "LOTO-2026",
  sourceKey: "hc-course:2026/loto",
  sourceName: NOMBRE,
  normalizedName: NOMBRE,
  aliases: [],
  active: true,
  firstSeenImportId: "",
  lastSeenImportId: "",
  updatedAt: "2026-10-08T00:00:00.000Z",
};

describe("Regresión · dos columnas con el mismo encabezado no comparten curso", () => {
  it("la columna que conserva su clave se queda con el curso y la otra abre uno nuevo", () => {
    const resuelto = resolveCourseMappings(
      [columna("2026", "L"), columna("2025", "M")],
      [delCatalogo],
    );
    assert.equal(resuelto.sourceKeyToTrainingId.get("hc-course:2026/loto"), "LOTO-2026");
    assert.notEqual(resuelto.sourceKeyToTrainingId.get("hc-course:2025/loto"), "LOTO-2026");
    assert.equal(resuelto.newCourses.length, 1);
    assert.equal(
      resuelto.updatedCourses.some((curso) => curso.sourceKey === "hc-course:2025/loto"),
      false,
    );
  });

  it("aunque la columna vieja venga primero en el libro", () => {
    const resuelto = resolveCourseMappings(
      [columna("2025", "L"), columna("2026", "M")],
      [delCatalogo],
    );
    assert.equal(resuelto.sourceKeyToTrainingId.get("hc-course:2026/loto"), "LOTO-2026");
    assert.notEqual(resuelto.sourceKeyToTrainingId.get("hc-course:2025/loto"), "LOTO-2026");
  });

  it("un encabezado que cambió de clave sigue reconociendo su curso por nombre", () => {
    const resuelto = resolveCourseMappings([columna("2027", "L")], [delCatalogo]);
    assert.equal(resuelto.sourceKeyToTrainingId.get("hc-course:2027/loto"), "LOTO-2026");
  });
});
