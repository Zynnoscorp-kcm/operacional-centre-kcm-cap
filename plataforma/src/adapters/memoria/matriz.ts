/**
 * Adaptador de repositorio de matriz en memoria para pruebas unitarias y de integración rápida.
 *
 * Cumple exhaustivamente con el puerto MatrixRepositoryPort sin requerir PostgreSQL ni dependencias externas.
 */

import type {
  CandidateCourse,
  CandidateWorker,
  CourseCatalogEntry,
  HcRecord,
  HcRecordHistory,
  ImportBatch,
  WorkerCatalogEntry,
} from "../../domain/importacion-matriz/tipos.ts";
import type { AtomicBatchOperations, MatrixRepositoryPort } from "../../ports/importacion-matriz.port.ts";

export interface MemoryDatabaseState {
  batches: ImportBatch[];
  workers: WorkerCatalogEntry[];
  courses: CourseCatalogEntry[];
  records: HcRecord[];
  history: HcRecordHistory[];
  candidateCourses: CandidateCourse[];
  candidateWorkers: CandidateWorker[];
}

export class MemoryMatrixRepository implements MatrixRepositoryPort {
  private readonly batches: ImportBatch[] = [];
  private readonly workers: WorkerCatalogEntry[] = [];
  private readonly courses: CourseCatalogEntry[] = [];
  private readonly records: HcRecord[] = [];
  private readonly history: HcRecordHistory[] = [];
  private readonly candidateCourses: CandidateCourse[] = [];
  private readonly candidateWorkers: CandidateWorker[] = [];

  getState(): MemoryDatabaseState {
    return {
      batches: [...this.batches],
      workers: [...this.workers],
      courses: [...this.courses],
      records: [...this.records],
      history: [...this.history],
      candidateCourses: [...this.candidateCourses],
      candidateWorkers: [...this.candidateWorkers],
    };
  }

  findBatchByRequestId(requestId: string): Promise<ImportBatch | null> {
    const found = this.batches.find((b) => b.requestId === requestId);
    return Promise.resolve(found ? { ...found } : null);
  }

  findBatchById(importId: string): Promise<ImportBatch | null> {
    const found = this.batches.find((b) => b.importId === importId);
    return Promise.resolve(found ? { ...found } : null);
  }

  getLatestCompletedBatch(): Promise<ImportBatch | null> {
    const completed = this.batches
      .filter((b) => b.phase === "CONFIRMADO")
      .sort(
        (a, b) => new Date(b.sourceExtractedAt).getTime() - new Date(a.sourceExtractedAt).getTime(),
      );
    const latest = completed[0];
    return Promise.resolve(latest ? { ...latest } : null);
  }

  saveBatch(batch: ImportBatch): Promise<void> {
    const idx = this.batches.findIndex((b) => b.importId === batch.importId);
    if (idx >= 0) {
      this.batches[idx] = { ...batch };
    } else {
      this.batches.push({ ...batch });
    }
    return Promise.resolve();
  }

  updateBatch(batch: ImportBatch): Promise<void> {
    return this.saveBatch(batch);
  }

  getWorkers(): Promise<WorkerCatalogEntry[]> {
    return Promise.resolve(this.workers.map((w) => ({ ...w })));
  }

  getCourses(): Promise<CourseCatalogEntry[]> {
    return Promise.resolve(this.courses.map((c) => ({ ...c, aliases: [...c.aliases] })));
  }

  getHcRecords(): Promise<HcRecord[]> {
    return Promise.resolve(this.records.map((r) => ({ ...r })));
  }

  getHcRecordHistory(): Promise<HcRecordHistory[]> {
    return Promise.resolve(this.history.map((h) => ({ ...h })));
  }

  applyBatchAtomic(batch: ImportBatch, ops: AtomicBatchOperations): Promise<void> {
    // 1. Guardar/actualizar lote
    const batchIdx = this.batches.findIndex((b) => b.importId === batch.importId);
    if (batchIdx >= 0) {
      this.batches[batchIdx] = { ...batch };
    } else {
      this.batches.push({ ...batch });
    }

    // 2. Upsert trabajadores
    for (const w of ops.workersToUpsert) {
      const idx = this.workers.findIndex((x) => x.workerNumber === w.workerNumber);
      if (idx >= 0) {
        this.workers[idx] = { ...w };
      } else {
        this.workers.push({ ...w });
      }
    }

    // 3. Upsert cursos
    for (const c of ops.coursesToUpsert) {
      const idx = this.courses.findIndex((x) => x.trainingId === c.trainingId);
      if (idx >= 0) {
        this.courses[idx] = { ...c, aliases: [...c.aliases] };
      } else {
        this.courses.push({ ...c, aliases: [...c.aliases] });
      }
    }

    // 4. Actualizar registros existentes
    for (const r of ops.recordsToUpdate) {
      const idx = this.records.findIndex((x) => x.recordId === r.recordId);
      if (idx >= 0) {
        this.records[idx] = { ...r };
      }
    }

    // 5. Insertar nuevos registros
    for (const r of ops.recordsToInsert) {
      const idx = this.records.findIndex((x) => x.recordId === r.recordId);
      if (idx >= 0) {
        this.records[idx] = { ...r };
      } else {
        this.records.push({ ...r });
      }
    }

    // 6. Insertar historial append-only
    for (const h of ops.historyEntriesToInsert) {
      this.history.push({ ...h });
    }

    return Promise.resolve();
  }

  recordCandidateCourse(candidate: CandidateCourse): Promise<void> {
    this.candidateCourses.push({ ...candidate });
    return Promise.resolve();
  }

  recordCandidateWorker(candidate: CandidateWorker): Promise<void> {
    this.candidateWorkers.push({ ...candidate });
    return Promise.resolve();
  }
}
