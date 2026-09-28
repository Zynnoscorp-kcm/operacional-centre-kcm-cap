/**
 * La media del área de la ficha del trabajador.
 *
 * La telaraña pone a la persona contra su área: cuántos de sus compañeros de
 * área tienen vigente cada curso que les aplica. Se fija aquí cómo se calcula
 * en memoria, que la base la pide en una sola consulta acotada al área, y que
 * un fallo al medir el área no deja a nadie sin su ficha.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryWorkerSystemRepository } from "../../src/adapters/memoria/sistema-trabajador.ts";
import {
  type SqlClient,
  SupabaseWorkerSystemRepository,
} from "../../src/adapters/postgres/sistema-trabajador.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import { WorkerSystemService } from "../../src/domain/sistema-trabajador/servicio.ts";

const AREA = "GERENCIA DE MANTTO. ELECTRICO";
const HOY = "2026-09-24";

/** Dos compañeros del área de 01234; uno con QMS vigente y otro sin él. */
function repositorioConCompaneros(): MemoryWorkerSystemRepository {
  const repositorio = new MemoryWorkerSystemRepository();
  for (const [numero, nombre] of [
    ["02001", "COMPAÑERO CON QMS"],
    ["02002", "COMPAÑERO SIN QMS"],
  ] as const) {
    repositorio.setWorker({
      employeeId: parseWorkerNumber(numero),
      name: nombre,
      department: "GERENCIA DE MANTTO.",
      area: AREA,
      position: "TECNICO INSTRUMENTISTA",
      hireDate: "2020-01-01",
      active: true,
    });
  }
  repositorio.setTrajectory(parseWorkerNumber("02001"), [
    {
      recordId: "REC-QMS-02001",
      trainingId: "kcm-course:qms",
      courseName: "QMS",
      completionDate: "2026-06-01",
      provenance: "SESSION_RELEASE",
      recordedAt: "2026-06-01T12:00:00.000Z",
      actor: "SISTEMA",
    },
  ]);
  return repositorio;
}

describe("Ficha · la media del área", () => {
  it("en memoria, cuenta a los compañeros de área que tienen vigente cada curso", async () => {
    const servicio = new WorkerSystemService(repositorioConCompaneros());

    const perfil = await servicio.getWorkerProfile(parseWorkerNumber("01234"), HOY);

    const qms = perfil?.areaComparison?.find((curso) => curso.trainingId === "kcm-course:qms");
    assert.ok(qms, "falta QMS en la media del área");
    // Tres personas en el área —01234 y los dos compañeros—; sólo 02001 lo tiene vigente.
    assert.equal(qms.applicable, 3);
    assert.equal(qms.completed, 1);
  });

  it("con base, se pide en una consulta y se traduce al catálogo", async () => {
    const repositorio = new MemoryWorkerSystemRepository();
    const pedidas: string[] = [];
    const conBase = Object.assign(repositorio, {
      getAreaCourseCompletion: (numero: string) => {
        pedidas.push(numero);
        return Promise.resolve([
          { courseKey: "QMS", courseName: "QMS", applicable: 40, completed: 12 },
          { courseKey: "NO-EXISTE", courseName: "CURSO FANTASMA", applicable: 3, completed: 1 },
        ]);
      },
    });
    const servicio = new WorkerSystemService(conBase);

    const perfil = await servicio.getWorkerProfile(parseWorkerNumber("01234"), HOY);

    assert.deepEqual(pedidas, ["01234"]);
    const qms = perfil?.areaComparison?.find((curso) => curso.trainingId === "kcm-course:qms");
    assert.deepEqual(qms, { trainingId: "kcm-course:qms", applicable: 40, completed: 12 });
    // Un curso que el catálogo no reconoce no se dibuja: no hay eje donde ponerlo.
    assert.equal(perfil?.areaComparison?.length, 1);
  });

  it("si medir el área falla, la ficha sale igual, sin la referencia", async () => {
    const repositorio = Object.assign(new MemoryWorkerSystemRepository(), {
      getAreaCourseCompletion: () => Promise.reject(new Error("base caída")),
    });
    const servicio = new WorkerSystemService(repositorio);

    const perfil = await servicio.getWorkerProfile(parseWorkerNumber("01234"), HOY);

    assert.ok(perfil);
    assert.equal(perfil.areaComparison, undefined);
    assert.ok(perfil.courseEvaluations.length > 0);
  });

  it("la consulta se acota al área de la persona y reutiliza la evaluación DNC", async () => {
    let visto = { sql: "", params: [] as readonly unknown[] };
    const cliente: SqlClient = {
      query: (sql, params) => {
        visto = { sql, params: params ?? [] };
        return Promise.resolve({ rows: [] });
      },
    };

    await new SupabaseWorkerSystemRepository(cliente).getAreaCourseCompletion(
      parseWorkerNumber("01234"),
    );

    assert.match(visto.sql, /evaluado AS \(/u);
    assert.match(visto.sql, /JOIN organizacion\.trabajador yo ON yo\.numero_trabajador = \$1/u);
    assert.match(visto.sql, /t\.area_id IS NOT DISTINCT FROM yo\.area_id/u);
    assert.match(visto.sql, /count\(\*\) FILTER \(WHERE e\.estado = 'COMPLETADO'\)/u);
    assert.deepEqual(visto.params, ["01234"]);
  });
});
