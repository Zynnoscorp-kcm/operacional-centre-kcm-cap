import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");
const repositorySource = await readFile(path.join(ROOT, "repositories/SheetsRepository.gs"), "utf8");
const HEADERS = Object.freeze(["id", "name", "status", "note"]);

function matrixCopy(rows) {
  return rows.map((row) => row.slice());
}

function createSheet(initialRows, {
  collisionRow = null,
  collisionFormulaRow = null,
  initialFormulas = [],
  onRangeRead = null
} = {}) {
  const cells = matrixCopy(initialRows);
  const formulas = initialRows.map((row, rowIndex) =>
    row.map((_, columnIndex) => initialFormulas[rowIndex]?.[columnIndex] ?? "")
  );
  const writes = [];
  const formats = [];

  function ensureSize(rowCount, columnCount) {
    while (cells.length < rowCount) cells.push([]);
    while (formulas.length < rowCount) formulas.push([]);
    for (let row = 0; row < rowCount; row += 1) {
      while (cells[row].length < columnCount) cells[row].push("");
      while (formulas[row].length < columnCount) formulas[row].push("");
    }
  }

  function sliceGrid(grid, row, column, rowCount, columnCount) {
    ensureSize(row + rowCount - 1, column + columnCount - 1);
    return Array.from({ length: rowCount }, (_, rowOffset) =>
      Array.from({ length: columnCount }, (_, columnOffset) =>
        grid[row - 1 + rowOffset][column - 1 + columnOffset] ?? ""
      )
    );
  }

  function range(row, column, rowCount, columnCount) {
    return {
      getValues() {
        if (onRangeRead) onRangeRead({ row, column, rowCount, columnCount });
        if (collisionRow === row) {
          return Array.from({ length: rowCount }, () =>
            Array.from({ length: columnCount }, (_, index) => index === 0 ? "concurrent" : "")
          );
        }
        return sliceGrid(cells, row, column, rowCount, columnCount);
      },
      getFormulas() {
        if (collisionFormulaRow === row) {
          return Array.from({ length: rowCount }, () =>
            Array.from({ length: columnCount }, (_, index) => index === 0 ? "=NOW()" : "")
          );
        }
        return sliceGrid(formulas, row, column, rowCount, columnCount);
      },
      getDisplayValue() {
        assert.equal(rowCount, 1);
        assert.equal(columnCount, 1);
        return String(sliceGrid(cells, row, column, 1, 1)[0][0] ?? "");
      },
      setValues(values) {
        assert.equal(values.length, rowCount);
        assert.ok(values.every((valueRow) => valueRow.length === columnCount));
        ensureSize(row + rowCount - 1, column + columnCount - 1);
        values.forEach((valueRow, rowOffset) => {
          valueRow.forEach((value, columnOffset) => {
            cells[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            formulas[row - 1 + rowOffset][column - 1 + columnOffset] = "";
          });
        });
        writes.push({ row, column, rowCount, columnCount, values: JSON.parse(JSON.stringify(values)) });
        return this;
      },
      setNumberFormat(format) {
        formats.push({ row, column, rowCount, columnCount, format });
        return this;
      }
    };
  }

  const sheet = {
    getDataRange() {
      return range(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
    },
    getLastRow() {
      let last = 0;
      for (let row = 0; row < Math.max(cells.length, formulas.length); row += 1) {
        const values = cells[row] ?? [];
        const rowFormulas = formulas[row] ?? [];
        if (values.some((value) => value !== "") || rowFormulas.some((value) => value !== "")) last = row + 1;
      }
      return last;
    },
    getLastColumn() {
      return Math.max(HEADERS.length, ...cells.map((row) => row.length));
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      assert.equal(typeof row, "number", "la suite focal usa rangos numericos");
      return range(row, column, rowCount, columnCount);
    }
  };

  return { sheet, cells, formulas, writes, formats };
}

function createHarness(rows, options, runtime = {}) {
  const state = runtime.state ?? createSheet(rows, options);
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    String,
    KcmConfig: {
      HEADERS: { TEST: [...HEADERS] },
      property: () => "spreadsheet-synthetic"
    },
    KcmValidation: {
      fail,
      forSheet(value) {
        return typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value;
      }
    },
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, "spreadsheet-synthetic");
        return { getSheetByName: (name) => name === "TEST" ? state.sheet : null };
      }
    },
    LockService: runtime.lockService ?? {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined })
    }
  });
  new vm.Script(repositorySource, { filename: "SheetsRepository.gs" }).runInContext(context);
  return { ...state, repository: context.KcmSheetsRepository };
}

test("updateMany modifica solamente las celdas objetivo y conserva huecos y columnas ajenas", () => {
  const harness = createHarness([
    [...HEADERS],
    ["a", "Persona A", "ANTERIOR", "conservar-a"],
    ["", "", "", ""],
    ["b", "Persona B", "ANTERIOR", "conservar-b"]
  ], {
    initialFormulas: [
      ["", "", "", ""],
      ["", "", "", "=FORMULA_A"],
      ["", "", "", ""],
      ["", "", "", "=FORMULA_B"]
    ]
  });

  const changed = harness.repository.updateMany("TEST", "id", [{ id: "b", status: "ACTUALIZADO" }]);

  assert.equal(changed.length, 1);
  assert.deepEqual(
    [changed[0].__rowNumber, changed[0].id, changed[0].name, changed[0].status, changed[0].note],
    [4, "b", "Persona B", "ACTUALIZADO", "conservar-b"]
  );
  assert.deepEqual(harness.cells[1], ["a", "Persona A", "ANTERIOR", "conservar-a"]);
  assert.deepEqual(harness.cells[2], ["", "", "", ""]);
  assert.deepEqual(harness.cells[3], ["b", "Persona B", "ACTUALIZADO", "conservar-b"]);
  assert.equal(harness.formulas[1][3], "=FORMULA_A");
  assert.equal(harness.formulas[3][3], "=FORMULA_B");
  assert.deepEqual(harness.writes, [{
    row: 4, column: 3, rowCount: 1, columnCount: 1, values: [["ACTUALIZADO"]]
  }]);
});

test("updateMany rechaza claves duplicadas en el lote antes de escribir", () => {
  const harness = createHarness([
    [...HEADERS],
    ["a", "Persona A", "ANTERIOR", "conservar"]
  ]);

  assert.throws(
    () => harness.repository.updateMany("TEST", "id", [
      { id: "a", status: "UNO" },
      { id: "a", status: "DOS" }
    ]),
    (error) => error.code === "DUPLICATE"
  );
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.cells[1][2], "ANTERIOR");
});

test("updateMany rechaza una tabla con claves duplicadas sin efectos parciales", () => {
  const harness = createHarness([
    [...HEADERS],
    ["a", "Persona A", "ANTERIOR", "primera"],
    ["a", "Persona B", "ANTERIOR", "segunda"]
  ]);

  assert.throws(
    () => harness.repository.updateMany("TEST", "id", [{ id: "a", status: "ACTUALIZADO" }]),
    (error) => error.code === "CONFLICT"
  );
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.cells.slice(1).map((row) => row[2]), ["ANTERIOR", "ANTERIOR"]);
});

test("updateMany valida todas las claves antes de aplicar la primera escritura", () => {
  const harness = createHarness([
    [...HEADERS],
    ["a", "Persona A", "ANTERIOR", "conservar"]
  ]);

  assert.throws(
    () => harness.repository.updateMany("TEST", "id", [
      { id: "a", status: "NO_DEBE_ESCRIBIRSE" },
      { id: "ausente", status: "NUEVO" }
    ]),
    (error) => error.code === "NOT_FOUND"
  );
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.cells[1][2], "ANTERIOR");
});

test("insertMany agrega un solo rango despues de la ultima fila y no pisa filas existentes", () => {
  const harness = createHarness([
    [...HEADERS],
    ["a", "Persona A", "ACTIVO", "existente"],
    ["", "", "", ""],
    ["b", "Persona B", "ACTIVO", "existente"]
  ]);
  const inserted = [
    { id: "c", name: "Persona C", status: "NUEVO", note: "uno" },
    { id: "d", name: "Persona D", status: "NUEVO", note: "dos" }
  ];

  assert.deepEqual(harness.repository.insertMany("TEST", inserted), inserted);
  assert.deepEqual(harness.cells[1], ["a", "Persona A", "ACTIVO", "existente"]);
  assert.deepEqual(harness.cells[3], ["b", "Persona B", "ACTIVO", "existente"]);
  assert.deepEqual(harness.writes, [{
    row: 5,
    column: 1,
    rowCount: 2,
    columnCount: 4,
    values: [
      ["c", "Persona C", "NUEVO", "uno"],
      ["d", "Persona D", "NUEVO", "dos"]
    ]
  }]);
});

test("insertMany rechaza un rango ocupado o con formula antes de formatear o escribir", () => {
  for (const options of [{ collisionRow: 3 }, { collisionFormulaRow: 3 }]) {
    const harness = createHarness([
      [...HEADERS],
      ["a", "Persona A", "ACTIVO", "existente"]
    ], options);

    assert.throws(
      () => harness.repository.insertMany("TEST", [{ id: "b", name: "Persona B", status: "NUEVO" }]),
      (error) => error.code === "CONFLICT"
    );
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.formats.length, 0);
    assert.deepEqual(harness.cells[1], ["a", "Persona A", "ACTIVO", "existente"]);
  }
});

test("replaceOne reemplaza el sobre completo con un unico setValues de fila", () => {
  const harness = createHarness([
    [...HEADERS],
    ["batch-a", "Persona A", "PENDIENTE", "mac-anterior"]
  ]);

  const result = harness.repository.replaceOne("TEST", "id", {
    id: "batch-a", name: "Persona A", status: "COMPLETADO", note: "mac-nuevo"
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    id: "batch-a", name: "Persona A", status: "COMPLETADO", note: "mac-nuevo"
  });
  assert.deepEqual(harness.writes, [{
    row: 2, column: 1, rowCount: 1, columnCount: 4,
    values: [["batch-a", "Persona A", "COMPLETADO", "mac-nuevo"]]
  }]);
});

test("insertMany serializa dos ejecuciones y evita perder un append intercalado", () => {
  let harnessB;
  let attempted = false;
  let interleavedError = null;
  const shared = createSheet([
    [...HEADERS],
    ["base", "Persona Base", "ACTIVO", "existente"]
  ], {
    onRangeRead({ row }) {
      if (row !== 3 || attempted || !harnessB) return;
      attempted = true;
      try {
        harnessB.repository.insertMany("TEST", [{ id: "event-b", name: "Evento B", status: "NUEVO" }]);
      } catch (error) {
        interleavedError = error;
      }
    }
  });
  let physicalOwner = "";
  function lockService(executionId) {
    return {
      getScriptLock: () => ({
        tryLock() {
          if (physicalOwner && physicalOwner !== executionId) return false;
          physicalOwner = executionId;
          return true;
        },
        releaseLock() {
          if (physicalOwner === executionId) physicalOwner = "";
        }
      })
    };
  }
  const harnessA = createHarness([], undefined, { state: shared, lockService: lockService("A") });
  harnessB = createHarness([], undefined, { state: shared, lockService: lockService("B") });

  harnessA.repository.insertMany("TEST", [{ id: "event-a", name: "Evento A", status: "NUEVO" }]);
  assert.equal(interleavedError?.code, "CONFLICT", "la segunda ejecucion reintenta en vez de sobrescribir");
  harnessB.repository.insertMany("TEST", [{ id: "event-b", name: "Evento B", status: "NUEVO" }]);

  assert.deepEqual(shared.cells.slice(2).map((row) => row[0]), ["event-a", "event-b"]);
});
