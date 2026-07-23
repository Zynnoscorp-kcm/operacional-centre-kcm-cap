import { assertEmployeeId } from "../shared/contracts.js";
import { domainError } from "./errors.js";
import { immutableCopy } from "./immutable.js";

function cellKey(employeeId, trainingId) {
  return `${assertEmployeeId(employeeId)}|${String(trainingId)}`;
}

export class SimulatedMatrixGateway {
  #cells = new Map();
  #writes = [];

  seedCell({ employeeId, trainingId, value }) {
    this.#cells.set(cellKey(employeeId, trainingId), String(value));
  }

  getCell({ employeeId, trainingId }) {
    return this.#cells.get(cellKey(employeeId, trainingId)) ?? null;
  }

  applyWrites(writes) {
    const normalized = writes.map((write) => ({
      employeeId: assertEmployeeId(write.employeeId),
      trainingId: String(write.trainingId),
      value: String(write.value),
      mappingVersion: String(write.mappingVersion),
      idempotencyKey: String(write.idempotencyKey)
    }));
    const duplicatedCells = new Set();
    for (const write of normalized) {
      const key = cellKey(write.employeeId, write.trainingId);
      if (duplicatedCells.has(key)) {
        throw domainError("DUPLICATE_MATRIX_WRITE", "El lote contiene dos escrituras para la misma celda");
      }
      duplicatedCells.add(key);
      if (this.#cells.has(key)) {
        throw domainError("MATRIX_VALUE_EXISTS", "La matriz ya contiene un valor y no se sobrescribira");
      }
    }
    for (const write of normalized) {
      this.#cells.set(cellKey(write.employeeId, write.trainingId), write.value);
      this.#writes.push(immutableCopy(write));
    }
    return normalized.length;
  }

  get writeCount() {
    return this.#writes.length;
  }

  listWrites() {
    return [...this.#writes];
  }
}
