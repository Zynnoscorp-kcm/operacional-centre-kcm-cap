import type {
  CandidateCourse,
  CandidateWorker,
  CourseCatalogEntry,
  HcRecord,
  HcRecordHistory,
  ImportBatch,
  MatrixSnapshot,
  WorkerCatalogEntry,
} from "../domain/importacion-matriz/tipos.ts";

export interface AtomicBatchOperations {
  readonly workersToUpsert: readonly WorkerCatalogEntry[];
  readonly coursesToUpsert: readonly CourseCatalogEntry[];
  readonly recordsToInsert: readonly HcRecord[];
  readonly recordsToUpdate: readonly HcRecord[];
  readonly historyEntriesToInsert: readonly HcRecordHistory[];
  readonly workersSeen?: readonly string[];
}

export interface MatrixRepositoryPort {
  findBatchByRequestId(requestId: string): Promise<ImportBatch | null>;
  findBatchById(importId: string): Promise<ImportBatch | null>;
  getLatestCompletedBatch(): Promise<ImportBatch | null>;
  saveBatch(batch: ImportBatch): Promise<void>;
  updateBatch(batch: ImportBatch): Promise<void>;

  getWorkers(): Promise<WorkerCatalogEntry[]>;
  getCourses(): Promise<CourseCatalogEntry[]>;
  getHcRecords(): Promise<HcRecord[]>;
  getHcRecordHistory(): Promise<HcRecordHistory[]>;

  applyBatchAtomic(batch: ImportBatch, ops: AtomicBatchOperations): Promise<void>;

  recordCandidateCourse(candidate: CandidateCourse): Promise<void>;
  recordCandidateWorker(candidate: CandidateWorker): Promise<void>;
}

export interface XlsbExtractOptions {
  readonly sheetName?: string;
  readonly lastCourseColumn?: string | number;
}

export interface XlsbExtractorPort {
  extractFromBuffer(buffer: Buffer, options?: XlsbExtractOptions): Promise<MatrixSnapshot>;
}
