import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DomainError } from "../../src/domain/comun/errores.ts";
import { planearClasificacion } from "../../src/domain/ocupaciones/plan.ts";
import type { EmpleadoDelPadron, PadronLeido } from "../../src/domain/padron/tipos.ts";

function empleado(
  numero: string,
  hoja: string,
  fila: number,
  puesto: string,
  centro: string,
  clave = "",
): EmpleadoDelPadron {
  return {
    employeeId: numero,
    displayName: "APELLIDO,APELLIDO,NOMBRE",
    position: puesto,
    curp: "",
    hireDate: "",
    cnoKey: clave,
    payrollType: hoja === "SND ACTIVOS" ? "NS" : "NQ",
    plant: "",
    costCenterName: centro,
    sourceSheet: hoja,
    sourceRow: fila,
    issues: [],
  };
}

function columna(field: string, columnName: string) {
  return { field, header: field, columnName, required: false, present: columnName !== "" };
}

function padron(
  empleados: EmpleadoDelPadron[],
  conColumna: Record<string, boolean> = { "SND ACTIVOS": true, "EMP ACTIVOS": false },
): PadronLeido {
  return {
    source: { sha256: "0".repeat(64), byteSize: 1 },
    employees: empleados,
    diagnostics: {
      employeeCount: empleados.length,
      readyEmployeeCount: empleados.length,
      issues: {},
      sheets: Object.entries(conColumna).map(([sheetName, con]) => ({
        sheetName,
        columns: [columna("employeeId", "A"), columna("cnoKey", con ? "Q" : "")],
        rowsWithIdentity: 0,
        acceptedRows: 0,
      })),
    },
  };
}

describe("Ocupaciones · plan del lote", () => {
  it("sólo toma faltantes, junta en un caso los de igual puesto y centro, y dice dónde escribir", () => {
    const plan = planearClasificacion(
      padron([
        empleado("28392", "SND ACTIVOS", 2, "*OPERADOR", "AGUA", "552081900"),
        empleado("28418", "SND ACTIVOS", 3, "*OPERADOR", "TOALLAS (CONVERSION)"),
        empleado("28425", "SND ACTIVOS", 4, "*operador ", "Toallas (conversion)"),
        empleado("28431", "SND ACTIVOS", 5, "*OPERARIO 1°", "HIGIENICOS"),
        empleado("17981", "EMP ACTIVOS", 2, "JEFE DE TURNO", "MAQUINA WADDING 05"),
      ]),
    );

    assert.equal(plan.conClave, 1);
    assert.deepEqual(
      plan.casos.map((caso) => [caso.id, caso.puesto, caso.centroDeCostos]),
      [
        ["C001", "*OPERADOR", "TOALLAS (CONVERSION)"],
        ["C002", "*OPERARIO 1°", "HIGIENICOS"],
      ],
    );
    assert.deepEqual(plan.filas, [
      {
        hoja: "SND ACTIVOS",
        fila: 3,
        numero: "28418",
        columna: "Q",
        columnaDelNumero: "A",
        caso: "C001",
      },
      {
        hoja: "SND ACTIVOS",
        fila: 4,
        numero: "28425",
        columna: "Q",
        columnaDelNumero: "A",
        caso: "C001",
      },
      {
        hoja: "SND ACTIVOS",
        fila: 5,
        numero: "28431",
        columna: "Q",
        columnaDelNumero: "A",
        caso: "C002",
      },
    ]);
    // Sin la columna no hay dónde escribir: la hoja se reporta, no se adivina.
    assert.deepEqual(plan.hojasSinColumna, ["EMP ACTIVOS"]);
  });

  it("una celda con texto que no es clave no se trata como vacía", () => {
    const conTexto = {
      ...empleado("28418", "SND ACTIVOS", 3, "*OPERADOR", "AGUA"),
      issues: ["INVALID_CNO_KEY"],
    };
    const plan = planearClasificacion(
      padron([conTexto, empleado("28425", "SND ACTIVOS", 4, "*OPERADOR", "AGUA")]),
    );
    assert.equal(plan.conTextoNoClave, 1);
    assert.deepEqual(
      plan.filas.map((fila) => fila.numero),
      ["28425"],
    );
  });

  it("deja fuera lo que no se puede preguntar sin exponer a alguien", () => {
    const plan = planearClasificacion(
      padron([
        empleado("28418", "SND ACTIVOS", 3, "28418", "AGUA"),
        empleado("28425", "SND ACTIVOS", 4, "*OPERADOR", ""),
        empleado("28431", "SND ACTIVOS", 5, "*OPERADOR", "AGUA"),
      ]),
    );
    assert.equal(plan.omitidos, 2);
    assert.equal(plan.casos.length, 1);
    assert.equal(plan.filas.length, 1);
  });

  it("con más casos de los que caben, entran los de más trabajadores y los demás esperan", () => {
    const plan = planearClasificacion(
      padron([
        empleado("28418", "SND ACTIVOS", 2, "*OPERADOR", "AGUA"),
        empleado("28425", "SND ACTIVOS", 3, "*OPERARIO 1°", "HIGIENICOS"),
        empleado("28431", "SND ACTIVOS", 4, "*OPERARIO 1°", "HIGIENICOS"),
        empleado("28440", "SND ACTIVOS", 5, "*MECANICO", "MAQUINA 5"),
        empleado("28452", "SND ACTIVOS", 6, "*ELECTRICO", "MAQUINA 5"),
      ]),
      2,
    );

    // C002 cubre a dos; entre C001, C003 y C004, con uno cada uno, gana el primero del padrón.
    assert.deepEqual(
      plan.casos.map((caso) => caso.id),
      ["C001", "C002"],
    );
    assert.deepEqual(
      plan.filas.map((fila) => [fila.fila, fila.caso]),
      [
        [2, "C001"],
        [3, "C002"],
        [4, "C002"],
      ],
    );
    assert.deepEqual(plan.pendientes, { casos: 2, trabajadores: 2 });
    assert.deepEqual(planearClasificacion(padron([])).pendientes, { casos: 0, trabajadores: 0 });
  });

  it("sin la columna en ninguna hoja, lo dice en vez de clasificar a ciegas", () => {
    assert.throws(
      () =>
        planearClasificacion(
          padron([empleado("28418", "SND ACTIVOS", 3, "*OPERADOR", "AGUA")], {
            "SND ACTIVOS": false,
            "EMP ACTIVOS": false,
          }),
        ),
      (error: unknown) =>
        error instanceof DomainError && error.code === "PADRON_SIN_COLUMNA_DE_OCUPACION",
    );
  });
});
