import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import { RosterIngestService } from "../../src/domain/padron/ingesta.ts";
import type {
  EmpleadoDelPadron,
  PadronLeido,
  RosterExtractorPort,
} from "../../src/domain/padron/tipos.ts";
import type {
  EscriturasDePadron,
  FilaDePadronBase,
  InduccionPropuesta,
  PuestoDelCatalogo,
  RosterRepositoryPort,
} from "../../src/ports/padron.port.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";

const clock: Clock = {
  now: () => new Date("2026-09-25T18:00:00.000Z"),
  nowIso: () => "2026-09-25T18:00:00.000Z",
};

function fila(numero: string, extra: Partial<FilaDePadronBase> = {}): FilaDePadronBase {
  return {
    trabajadorId: `00000000-0000-4000-8000-0000000${numero}`,
    numeroTrabajador: numero,
    nombre: `TRABAJADOR ${numero}`,
    curp: "AAAA800101HDFXXX01",
    fechaAlta: "2020-01-15",
    puesto: "OPERADOR",
    area: "CONVERTIDORA",
    claveOcupacion: null,
    tipoNomina: "NS",
    planta: "ECATEPEC I",
    activo: true,
    ...extra,
  };
}

function empleado(numero: string, extra: Partial<EmpleadoDelPadron> = {}): EmpleadoDelPadron {
  return {
    employeeId: numero,
    displayName: `TRABAJADOR ${numero}`,
    position: "OPERADOR",
    curp: "AAAA800101HDFXXX01",
    hireDate: "2020-01-15",
    cnoKey: "",
    payrollType: "NS",
    plant: "ECATEPEC I",
    issues: [],
    ...extra,
  };
}

class Repositorio implements RosterRepositoryPort {
  escrito: EscriturasDePadron | undefined;
  readonly base: readonly FilaDePadronBase[];
  constructor(base: readonly FilaDePadronBase[]) {
    this.base = base;
  }
  leerPadronBase() {
    return Promise.resolve(this.base);
  }
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    return Promise.resolve([{ nombre: "OPERADOR", claveCno: null }]);
  }
  revisarInducciones(_propuestas: readonly InduccionPropuesta[]) {
    return Promise.resolve({ nuevas: 0, divergentes: 0 });
  }
  aplicar(escrituras: EscriturasDePadron) {
    this.escrito = escrituras;
    return Promise.resolve({ curp: 0, altas: 0, inducciones: 0, ocupaciones: 0 });
  }
}

function servicio(
  base: readonly FilaDePadronBase[],
  leido: Omit<PadronLeido, "source" | "diagnostics">,
) {
  const repositorio = new Repositorio(base);
  const extractor: RosterExtractorPort = {
    extraer: () => ({
      source: { sha256: "d".repeat(64), byteSize: 10 },
      diagnostics: {
        employeeCount: leido.employees.length,
        readyEmployeeCount: leido.employees.length,
        issues: {},
      },
      ...leido,
    }),
  };
  return { repositorio, s: new RosterIngestService({ repository: repositorio, extractor, clock }) };
}

describe("Padrón completo · columnas personales", () => {
  it("compara y escribe cada columna que cambia, y una celda vacía no borra", async () => {
    const { repositorio, s } = servicio(
      [fila("00001", { rfc: "AAAA800101AB1", direccion: "CALLE 1", sexo: "F" })],
      {
        employees: [
          empleado("00001", {
            rfc: "AAAA800101AB2",
            nss: "12345678901",
            address: "",
            costCenterKey: "3100",
            sex: "F",
          }),
        ],
      },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 39 CAP.xlsx");
    await s.aplicar(plan.planId, "prueba");

    const columnas = (repositorio.escrito?.datos ?? []).map(([, columna, valor]) => [
      columna,
      valor,
    ]);
    assert.deepEqual(columnas, [
      ["rfc", "AAAA800101AB2"],
      ["nss", "12345678901"],
      ["centro_costos_clave", "3100"],
    ]);
    const campos = (plan.detalle?.movimientos ?? []).map((m) => m.campo);
    assert.deepEqual(campos, ["RFC", "IMSS", "Centro de costos"]);
    assert.equal(plan.cuadre.datosPorEscribir, 3);
  });
});

describe("Padrón completo · baja cuando falta en las dos fuentes", () => {
  it("da de baja sólo a quien tampoco estuvo en la última matriz", async () => {
    const { repositorio, s } = servicio(
      [
        fila("00001"),
        fila("00002", { vistoEnMatriz: false }),
        fila("00003", { vistoEnMatriz: true }),
      ],
      {
        employees: [empleado("00001")],
        terminations: [{ employeeId: "00002", terminationDate: "2026-09-12" }],
      },
    );
    const plan = await s.previsualizar(Buffer.from("x"), "sem 39 CAP.xlsx");

    assert.equal(plan.cuadre.bajas, 1);
    const [baja, sigue] = plan.detalle?.bajas ?? [];
    assert.equal(baja?.nomina, "00002");
    assert.equal(baja?.nota, "Se da de baja");
    assert.equal(baja?.fechaDeBaja, "2026-09-12");
    assert.notEqual(baja?.soloAviso, true);
    assert.equal(sigue?.nomina, "00003");
    assert.equal(sigue?.soloAviso, true);

    await s.aplicar(plan.planId, "prueba");
    assert.deepEqual(repositorio.escrito?.enArchivo, ["00001"]);
    assert.deepEqual(repositorio.escrito?.fechasDeBaja, [["00002", "2026-09-12"]]);
  });

  it("vuelve a activar a quien estaba de baja y regresa al padrón", async () => {
    const { repositorio, s } = servicio([fila("00001", { activo: false })], {
      employees: [empleado("00001")],
    });
    const plan = await s.previsualizar(Buffer.from("x"), "sem 39 CAP.xlsx");
    await s.aplicar(plan.planId, "prueba");
    assert.equal(repositorio.escrito?.reactivar?.length, 1);
    assert.equal(plan.cuadre.reactivados, 1);
  });
});

describe("Matriz completa · baja cuando falta en las dos fuentes", () => {
  it("anota quién vino y da de baja a quien tampoco está en el padrón", async () => {
    const repositorio = new MemoryMatrixRepository();
    const base = {
      displayName: "X",
      hireDate: null,
      payrollType: null,
      position: null,
      department: null,
      area: null,
      plant: null,
      active: true,
      sourceHash: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const semilla = repositorio as unknown as { workers: object[] };
    semilla.workers.push(
      { ...base, workerNumber: "00001", seenInRoster: true },
      { ...base, workerNumber: "00002", seenInRoster: false },
      { ...base, workerNumber: "00003", seenInRoster: true },
    );
    await repositorio.applyBatchAtomic({ importId: "i-1" } as never, {
      workersToUpsert: [],
      coursesToUpsert: [],
      recordsToInsert: [],
      recordsToUpdate: [],
      historyEntriesToInsert: [],
      workersSeen: ["00001"],
    });
    const trabajadores = await repositorio.getWorkers();
    const activo = (n: string) => trabajadores.find((w) => w.workerNumber === n)?.active;
    assert.equal(activo("00001"), true);
    assert.equal(activo("00002"), false);
    assert.equal(activo("00003"), true);
  });
});
