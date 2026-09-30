import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import {
  createImportBatch,
  transitionToApproved,
  transitionToConfirmed,
  transitionToPrepared,
  transitionToValidated,
} from "../../src/domain/importacion-matriz/ciclo-de-lote.ts";
import {
  InvalidBatchPhaseError,
  InvalidSnapshotError,
  MatrixConflictError,
  StaleSnapshotError,
} from "../../src/domain/importacion-matriz/errores.ts";
import { MatrixImportService } from "../../src/domain/importacion-matriz/servicio.ts";
import {
  generateTrainingId,
  reconcileSnapshot,
  validateSnapshot,
} from "../../src/domain/importacion-matriz/reconciliador.ts";
import type {
  CourseCatalogEntry,
  HcRecord,
  MatrixSnapshot,
  SnapshotCompletion,
  SnapshotCourse,
  SnapshotEmployee,
} from "../../src/domain/importacion-matriz/tipos.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";

function createSyntheticSnapshot(overrides: Partial<MatrixSnapshot> = {}): MatrixSnapshot {
  const employees: SnapshotEmployee[] = [
    {
      employeeId: parseWorkerNumber("10001"),
      displayName: "TRABAJADOR SINTETICO 1",
      hireDate: "2020-01-15",
      payrollType: "SINDICALIZADO",
      position: "*OPERARIO 1°",
      department: "GERENCIA DE MANTTO.",
      area: "GERENCIA DE MANTTO. ELECTRICO",
      plant: "PLANTA ORIZABA",
    },
    {
      employeeId: parseWorkerNumber("10002"),
      displayName: "TRABAJADOR SINTETICO 2",
      hireDate: "2021-03-20",
      payrollType: "SINDICALIZADO",
      position: "*OPERARIO 2°",
      department: "GERENCIA DE CALIDAD",
      area: "ASEGURAMIENTO DE CALIDAD",
      plant: "PLANTA ORIZABA",
    },
  ];

  const courses: SnapshotCourse[] = [
    {
      sourceKey: "hc-course:c1-qms",
      sourceColumn: "H",
      displayName: "BUENAS PRACTICAS DE MANUFACTURA",
      normalizedName: "BUENAS PRACTICAS DE MANUFACTURA",
    },
    {
      sourceKey: "hc-course:c2-loto",
      sourceColumn: "I",
      displayName: "BLOQUEO Y ETIQUETADO LOTO",
      normalizedName: "BLOQUEO Y ETIQUETADO LOTO",
    },
  ];

  const completions: SnapshotCompletion[] = [
    {
      employeeId: parseWorkerNumber("10001"),
      sourceKey: "hc-course:c1-qms",
      completionDate: "2025-06-10",
    },
    {
      employeeId: parseWorkerNumber("10002"),
      sourceKey: "hc-course:c2-loto",
      completionDate: "2025-07-15",
    },
  ];

  return {
    schemaVersion: "HC_SNAPSHOT_V1",
    source: {
      fileName: "Matriz_Sintetica.xlsb",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      byteSize: 123456,
      sheetName: "HC",
    },
    extractedAt: "2026-08-01T10:00:00.000Z",
    employees,
    courses,
    completions,
    diagnostics: {
      counts: {
        employeeCount: employees.length,
        courseCount: courses.length,
        completionCount: completions.length,
        skippedEmployeeCount: 0,
        skippedCourseCount: 0,
        skippedCompletionCount: 0,
        formulaCellCount: 10,
        formulaCachedValueCount: 10,
        formulaErrorCount: 0,
        externalLinkCount: 0,
        mergedCellCount: 0,
      },
      issues: [],
    },
    ...overrides,
  };
}

describe("Reconciliación y ciclo de vida de importación de matriz", () => {
  describe("Validación de snapshots y diagnósticos", () => {
    it("acepta un snapshot sintético conforme y válido", () => {
      const snap = createSyntheticSnapshot();
      assert.doesNotThrow(() => validateSnapshot(snap));
    });

    it("rechaza un snapshot con esquema inválido o ausente", () => {
      const snap = createSyntheticSnapshot({
        schemaVersion: "HC_SNAPSHOT_V2" as unknown as "HC_SNAPSHOT_V1",
      });
      assert.throws(() => validateSnapshot(snap), InvalidSnapshotError);
    });

    it("rechaza un snapshot con hash sha256 no válido", () => {
      const snap = createSyntheticSnapshot({
        source: {
          fileName: "test.xlsb",
          sha256: "invalido",
          byteSize: 10,
          sheetName: "HC",
        },
      });
      assert.throws(() => validateSnapshot(snap), InvalidSnapshotError);
    });

    it("rechaza un snapshot que contiene errores de fórmula no resueltos", () => {
      const snap = createSyntheticSnapshot({
        diagnostics: {
          counts: {
            employeeCount: 2,
            courseCount: 2,
            completionCount: 2,
            skippedEmployeeCount: 0,
            skippedCourseCount: 0,
            skippedCompletionCount: 0,
            formulaCellCount: 5,
            formulaCachedValueCount: 5,
            formulaErrorCount: 2,
            externalLinkCount: 0,
            mergedCellCount: 0,
          },
          issues: [],
        },
      });
      assert.throws(() => validateSnapshot(snap), MatrixConflictError);
    });

    it("rechaza fórmulas sin valor calculado en caché", () => {
      const snap = createSyntheticSnapshot({
        diagnostics: {
          counts: {
            employeeCount: 2,
            courseCount: 2,
            completionCount: 2,
            skippedEmployeeCount: 0,
            skippedCourseCount: 0,
            skippedCompletionCount: 0,
            formulaCellCount: 10,
            formulaCachedValueCount: 8,
            formulaErrorCount: 0,
            externalLinkCount: 0,
            mergedCellCount: 0,
          },
          issues: [],
        },
      });
      assert.throws(() => validateSnapshot(snap), MatrixConflictError);
    });

    it("rechaza posibles inyecciones de fórmulas en datos de empleados", () => {
      const snap = createSyntheticSnapshot({
        employees: [
          {
            employeeId: parseWorkerNumber("10001"),
            displayName: "=CMD|' /C calc'!A0",
            hireDate: "2020-01-01",
            payrollType: "SIND",
            position: "OP",
            department: "DEP",
            area: "AREA",
            plant: "PLANT",
          },
        ],
      });
      assert.throws(() => validateSnapshot(snap), InvalidSnapshotError);
    });

    it("detecta y rechaza un snapshot con fecha anterior al estado vigente", () => {
      const snap = createSyntheticSnapshot({
        extractedAt: "2026-07-01T00:00:00.000Z",
      });
      const latestExtractedAt = "2026-08-01T00:00:00.000Z";
      assert.throws(() => validateSnapshot(snap, latestExtractedAt), StaleSnapshotError);
    });
  });

  describe("Máquina de estados de lote (5 fases)", () => {
    it("recorre las 5 fases en orden estricto", () => {
      const batch = createImportBatch({
        importId: "imp-1",
        requestId: "req-1",
        sourceSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        snapshotSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sourceFileName: "matriz.xlsb",
        sourceSheetName: "HC",
        sourceExtractedAt: "2026-08-01T10:00:00.000Z",
        createdBy: "actor@kcm.invalid",
      });

      assert.equal(batch.phase, "RECIBIDO");

      transitionToPrepared(batch, "FULL", batch.diagnostics, { totalEmployees: 2 });
      assert.equal(batch.phase, "PREPARADO");

      transitionToValidated(batch, batch.counts, false);
      assert.equal(batch.phase, "VALIDADO");

      transitionToApproved(batch, "auditor@kcm.invalid", "Aprobado por jefe");
      assert.equal(batch.phase, "APROBADO");
      assert.equal(batch.approvalActorId, "auditor@kcm.invalid");

      transitionToConfirmed(batch);
      assert.equal(batch.phase, "CONFIRMADO");
      assert.ok(batch.completedAt);
    });

    it("rechaza saltarse fases (e.g. confirmar directamente desde RECIBIDO)", () => {
      const batch = createImportBatch({
        importId: "imp-2",
        requestId: "req-2",
        sourceSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        snapshotSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sourceFileName: "matriz.xlsb",
        sourceSheetName: "HC",
        sourceExtractedAt: "2026-08-01T10:00:00.000Z",
        createdBy: "actor@kcm.invalid",
      });

      assert.throws(() => transitionToConfirmed(batch), InvalidBatchPhaseError);
      assert.throws(() => transitionToApproved(batch, "auditor", "motivo"), InvalidBatchPhaseError);
    });

    it("rechaza aprobar un lote en estado de CONFLICTO", () => {
      const batch = createImportBatch({
        importId: "imp-3",
        requestId: "req-3",
        sourceSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        snapshotSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sourceFileName: "matriz.xlsb",
        sourceSheetName: "HC",
        sourceExtractedAt: "2026-08-01T10:00:00.000Z",
        createdBy: "actor@kcm.invalid",
      });

      transitionToPrepared(batch, "FULL", batch.diagnostics, {});
      transitionToValidated(batch, { ...batch.counts, conflictCount: 1 }, true);
      assert.equal(batch.phase, "CONFLICTO");

      assert.throws(() => transitionToApproved(batch, "auditor", "motivo"), MatrixConflictError);
    });
  });

  describe("Reconciliación por procedencia y protección de fechas de plataforma", () => {
    it("aplica altas iniciales como VIGENTE con procedencia XLSB_IMPORT e historial ALTA", () => {
      const snap = createSyntheticSnapshot();
      const reconciled = reconcileSnapshot({
        snapshot: snap,
        existingWorkers: [],
        existingCourses: [],
        existingRecords: [],
        importId: "imp-init",
        requestId: "req-init",
        actorId: "sistema",
        scope: "FULL",
      });

      assert.equal(reconciled.counts.insertedCount, 2);
      assert.equal(reconciled.counts.correctedCount, 0);
      assert.equal(reconciled.counts.retiredCount, 0);
      assert.equal(reconciled.counts.conflictCount, 0);
      assert.equal(reconciled.recordsToInsert.length, 2);
      assert.equal(reconciled.historyEntriesToInsert.length, 2);

      const firstRecord = reconciled.recordsToInsert[0];
      const firstHistory = reconciled.historyEntriesToInsert[0];
      assert.ok(firstRecord);
      assert.ok(firstHistory);
      assert.equal(firstRecord.provenance, "XLSB_IMPORT");
      assert.equal(firstRecord.status, "VIGENTE");
      assert.equal(firstHistory.changeType, "ALTA");
    });

    it("corrige fechas del maestro (XLSB_IMPORT) registrando CORREGIDA en historial", () => {
      const snap = createSyntheticSnapshot();
      const trainingId1 = generateTrainingId("hc-course:c1-qms");
      const existingRecord: HcRecord = {
        recordId: "rec-1",
        idempotencyKey: "key-1",
        workerNumber: parseWorkerNumber("10001"),
        trainingId: trainingId1,
        completionDate: "2024-01-01",
        provenance: "XLSB_IMPORT",
        status: "VIGENTE",
        sessionId: null,
        releaseId: null,
        mappingVersion: "operational-hc-v1",
        batchId: null,
        marker: null,
        importId: "imp-old",
        requestId: "req-old",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        version: 1,
      };

      const existingCourse: CourseCatalogEntry = {
        trainingId: trainingId1,
        sourceKey: "hc-course:c1-qms",
        sourceName: "BUENAS PRACTICAS DE MANUFACTURA",
        normalizedName: "BUENAS PRACTICAS DE MANUFACTURA",
        aliases: [],
        active: true,
        firstSeenImportId: "imp-old",
        lastSeenImportId: "imp-old",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const reconciled = reconcileSnapshot({
        snapshot: snap,
        existingWorkers: [],
        existingCourses: [existingCourse],
        existingRecords: [existingRecord],
        importId: "imp-corr",
        requestId: "req-corr",
        actorId: "sistema",
        scope: "FULL",
      });

      assert.equal(reconciled.counts.correctedCount, 1);
      assert.equal(reconciled.recordsToUpdate.length, 1);
      const updatedRecord = reconciled.recordsToUpdate[0];
      const historyEntry = reconciled.historyEntriesToInsert[0];
      assert.ok(updatedRecord);
      assert.ok(historyEntry);
      assert.equal(updatedRecord.completionDate, "2025-06-10");
      assert.equal(historyEntry.changeType, "CORREGIDA");
      assert.equal(historyEntry.previousCompletionDate, "2024-01-01");
      assert.equal(historyEntry.completionDate, "2025-06-10");
    });

    it("invariante crítico: una fecha liberada por plataforma (SESSION_RELEASE) NUNCA se sobrescribe ni borra", () => {
      const snap = createSyntheticSnapshot();
      const trainingId1 = generateTrainingId("hc-course:c1-qms");

      const platformRecord: HcRecord = {
        recordId: "rec-platform-1",
        idempotencyKey: "platform-key-1",
        workerNumber: parseWorkerNumber("10001"),
        trainingId: trainingId1,
        completionDate: "2026-07-20",
        provenance: "SESSION_RELEASE",
        status: "VIGENTE",
        sessionId: "ses-123",
        releaseId: "rel-456",
        mappingVersion: "operational-hc-v1",
        batchId: null,
        marker: "SALIDA-SALA",
        importId: null,
        requestId: "req-rel",
        createdAt: "2026-07-20T10:00:00Z",
        updatedAt: "2026-07-20T10:00:00Z",
        version: 1,
      };

      const existingCourse: CourseCatalogEntry = {
        trainingId: trainingId1,
        sourceKey: "hc-course:c1-qms",
        sourceName: "BUENAS PRACTICAS DE MANUFACTURA",
        normalizedName: "BUENAS PRACTICAS DE MANUFACTURA",
        aliases: [],
        active: true,
        firstSeenImportId: "imp-1",
        lastSeenImportId: "imp-1",
        updatedAt: "2026-07-01T00:00:00Z",
      };

      const reconciled = reconcileSnapshot({
        snapshot: snap,
        existingWorkers: [],
        existingCourses: [existingCourse],
        existingRecords: [platformRecord],
        importId: "imp-conflict",
        requestId: "req-conflict",
        actorId: "sistema",
        scope: "FULL",
      });

      assert.equal(reconciled.counts.conflictCount, 1);
      assert.equal(reconciled.conflicts.length, 1);
      const conflict = reconciled.conflicts[0];
      assert.ok(conflict);
      assert.equal(conflict.existingProvenance, "SESSION_RELEASE");
      assert.equal(conflict.existingDate, "2026-07-20");
      assert.equal(conflict.snapshotDate, "2025-06-10");

      const updatedPlatform = reconciled.recordsToUpdate.find(
        (r) => r.recordId === "rec-platform-1",
      );
      assert.equal(updatedPlatform, undefined);
    });

    it("fecha de plataforma ausente en snapshot se marca pendingMaster y permanece VIGENTE", () => {
      const snap = createSyntheticSnapshot({
        completions: [
          {
            employeeId: parseWorkerNumber("10002"),
            sourceKey: "hc-course:c2-loto",
            completionDate: "2025-07-15",
          },
        ],
      });

      const trainingId1 = generateTrainingId("hc-course:c1-qms");
      const platformRecord: HcRecord = {
        recordId: "rec-platform-2",
        idempotencyKey: "platform-key-2",
        workerNumber: parseWorkerNumber("10001"),
        trainingId: trainingId1,
        completionDate: "2026-07-20",
        provenance: "SESSION_RELEASE",
        status: "VIGENTE",
        sessionId: "ses-123",
        releaseId: "rel-456",
        mappingVersion: "operational-hc-v1",
        batchId: null,
        marker: null,
        importId: null,
        requestId: "req-rel",
        createdAt: "2026-07-20T10:00:00Z",
        updatedAt: "2026-07-20T10:00:00Z",
        version: 1,
      };

      const reconciled = reconcileSnapshot({
        snapshot: snap,
        existingWorkers: [],
        existingCourses: [],
        existingRecords: [platformRecord],
        importId: "imp-pending",
        requestId: "req-pending",
        actorId: "sistema",
        scope: "FULL",
      });

      assert.equal(reconciled.counts.pendingMasterCount, 1);
      assert.equal(reconciled.counts.retiredCount, 0);
      assert.equal(reconciled.recordsToUpdate.length, 0);
    });

    it("retira fechas de matriz eliminadas en scope FULL y las reactiva si reaparecen", () => {
      const snapWithoutCompletion = createSyntheticSnapshot({
        completions: [
          {
            employeeId: parseWorkerNumber("10002"),
            sourceKey: "hc-course:c2-loto",
            completionDate: "2025-07-15",
          },
        ],
      });

      const trainingId1 = generateTrainingId("hc-course:c1-qms");
      const existingXlsbRecord: HcRecord = {
        recordId: "rec-xlsb-1",
        idempotencyKey: "xlsb-key-1",
        workerNumber: parseWorkerNumber("10001"),
        trainingId: trainingId1,
        completionDate: "2025-01-01",
        provenance: "XLSB_IMPORT",
        status: "VIGENTE",
        sessionId: null,
        releaseId: null,
        mappingVersion: "operational-hc-v1",
        batchId: null,
        marker: null,
        importId: "imp-1",
        requestId: "req-1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        version: 1,
      };

      const existingCourse: CourseCatalogEntry = {
        trainingId: trainingId1,
        sourceKey: "hc-course:c1-qms",
        sourceName: "BUENAS PRACTICAS DE MANUFACTURA",
        normalizedName: "BUENAS PRACTICAS DE MANUFACTURA",
        aliases: [],
        active: true,
        firstSeenImportId: "imp-1",
        lastSeenImportId: "imp-1",
        updatedAt: "2025-01-01T00:00:00Z",
      };

      const reconciledRetire = reconcileSnapshot({
        snapshot: snapWithoutCompletion,
        existingWorkers: [],
        existingCourses: [existingCourse],
        existingRecords: [existingXlsbRecord],
        importId: "imp-retire",
        requestId: "req-retire",
        actorId: "sistema",
        scope: "FULL",
      });

      assert.equal(reconciledRetire.counts.retiredCount, 1);
      const updateRec = reconciledRetire.recordsToUpdate[0];
      assert.ok(updateRec);
      assert.equal(updateRec.status, "RETIRADO");
      const retiredHistory = reconciledRetire.historyEntriesToInsert.find(
        (h) => h.changeType === "RETIRADA",
      );
      assert.ok(retiredHistory);
      assert.equal(retiredHistory.changeType, "RETIRADA");

      const retiredRecord: HcRecord = {
        ...existingXlsbRecord,
        status: "RETIRADO",
        completionDate: "",
      };

      const snapWithCompletionAgain = createSyntheticSnapshot();
      const reconciledReactivate = reconcileSnapshot({
        snapshot: snapWithCompletionAgain,
        existingWorkers: [],
        existingCourses: [existingCourse],
        existingRecords: [retiredRecord],
        importId: "imp-reactivate",
        requestId: "req-reactivate",
        actorId: "sistema",
        scope: "FULL",
      });

      assert.equal(reconciledReactivate.counts.reactivatedCount, 1);
      const reactRec = reconciledReactivate.recordsToUpdate[0];
      assert.ok(reactRec);
      assert.equal(reactRec.status, "VIGENTE");
      assert.equal(reactRec.completionDate, "2025-06-10");
      const reactivatedHistory = reconciledReactivate.historyEntriesToInsert.find(
        (h) => h.changeType === "REACTIVADA",
      );
      assert.ok(reactivatedHistory);
      assert.equal(reactivatedHistory.changeType, "REACTIVADA");
    });

    it("alcance DELTA no retira fechas ausentes (ausencia en extracto no es baja)", () => {
      const snapDelta = createSyntheticSnapshot({
        completions: [
          {
            employeeId: parseWorkerNumber("10002"),
            sourceKey: "hc-course:c2-loto",
            completionDate: "2025-07-15",
          },
        ],
      });

      const trainingId1 = generateTrainingId("hc-course:c1-qms");
      const existingXlsbRecord: HcRecord = {
        recordId: "rec-xlsb-1",
        idempotencyKey: "xlsb-key-1",
        workerNumber: parseWorkerNumber("10001"),
        trainingId: trainingId1,
        completionDate: "2025-01-01",
        provenance: "XLSB_IMPORT",
        status: "VIGENTE",
        sessionId: null,
        releaseId: null,
        mappingVersion: "operational-hc-v1",
        batchId: null,
        marker: null,
        importId: "imp-1",
        requestId: "req-1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        version: 1,
      };

      const reconciledDelta = reconcileSnapshot({
        snapshot: snapDelta,
        existingWorkers: [],
        existingCourses: [],
        existingRecords: [existingXlsbRecord],
        importId: "imp-delta",
        requestId: "req-delta",
        actorId: "sistema",
        scope: "DELTA",
      });

      assert.equal(reconciledDelta.counts.retiredCount, 0);
      assert.equal(reconciledDelta.recordsToUpdate.length, 0);
    });
  });

  describe("Servicio de importación y persistencia atómica (MatrixImportService)", () => {
    it("ejecuta una importación completa y confirma los cambios en memoria", async () => {
      const repository = new MemoryMatrixRepository();
      const service = new MatrixImportService(repository);

      const snapshot = createSyntheticSnapshot();
      const result = await service.importSnapshot({
        requestId: "req-service-1",
        snapshot,
        actorId: "auditor@kcm.invalid",
        scope: "FULL",
      });

      assert.equal(result.status, "COMPLETADO");
      assert.equal(result.repeated, false);
      assert.equal(result.counts.insertedCount, 2);

      const dbState = repository.getState();
      assert.equal(dbState.batches.length, 1);
      const savedBatch = dbState.batches[0];
      assert.ok(savedBatch);
      assert.equal(savedBatch.phase, "CONFIRMADO");
      assert.equal(dbState.workers.length, 2);
      assert.equal(dbState.courses.length, 2);
      assert.equal(dbState.records.length, 2);
      assert.equal(dbState.history.length, 2);
    });

    it("idempotencia: una solicitud repetida con el mismo requestId es un no-op seguro", async () => {
      const repository = new MemoryMatrixRepository();
      const service = new MatrixImportService(repository);
      const snapshot = createSyntheticSnapshot();

      const firstResult = await service.importSnapshot({
        requestId: "req-idempotent",
        snapshot,
        actorId: "auditor@kcm.invalid",
      });
      assert.equal(firstResult.status, "COMPLETADO");
      assert.equal(firstResult.repeated, false);

      const secondResult = await service.importSnapshot({
        requestId: "req-idempotent",
        snapshot,
        actorId: "auditor@kcm.invalid",
      });
      assert.equal(secondResult.status, "COMPLETADO");
      assert.equal(secondResult.repeated, true);

      const dbState = repository.getState();
      assert.equal(dbState.batches.length, 1);
      assert.equal(dbState.workers.length, 2);
      assert.equal(dbState.records.length, 2);
      assert.equal(dbState.history.length, 2);
    });

    it("detiene la aplicación y deja el lote en CONFLICTO si hay contradicción con la plataforma", async () => {
      const repository = new MemoryMatrixRepository();
      const trainingId1 = generateTrainingId("hc-course:c1-qms");

      await repository.applyBatchAtomic(
        {
          importId: "imp-seed",
          requestId: "req-seed",
          sourceSha256: "0000000000000000000000000000000000000000000000000000000000000000",
          snapshotSha256: "0000000000000000000000000000000000000000000000000000000000000000",
          sourceFileName: "seed",
          sourceSheetName: "HC",
          sourceExtractedAt: "2026-07-01T00:00:00Z",
          phase: "CONFIRMADO",
          scope: "FULL",
          counts: {
            totalEmployees: 1,
            totalCourses: 1,
            totalCompletions: 1,
            insertedCount: 1,
            correctedCount: 0,
            retiredCount: 0,
            reactivatedCount: 0,
            conflictCount: 0,
            pendingMasterCount: 0,
          },
          diagnostics: {
            counts: {
              employeeCount: 1,
              courseCount: 1,
              completionCount: 1,
              skippedEmployeeCount: 0,
              skippedCourseCount: 0,
              skippedCompletionCount: 0,
              formulaCellCount: 0,
              formulaCachedValueCount: 0,
              formulaErrorCount: 0,
              externalLinkCount: 0,
              mergedCellCount: 0,
            },
            issues: [],
          },
          createdBy: "sistema",
          createdAt: "2026-07-01T00:00:00Z",
          completedAt: "2026-07-01T00:00:00Z",
          rejectionReason: null,
          approvalActorId: null,
          approvalReason: null,
          version: 1,
        },
        {
          workersToUpsert: [],
          coursesToUpsert: [
            {
              trainingId: trainingId1,
              sourceKey: "hc-course:c1-qms",
              sourceName: "BUENAS PRACTICAS DE MANUFACTURA",
              normalizedName: "BUENAS PRACTICAS DE MANUFACTURA",
              aliases: [],
              active: true,
              firstSeenImportId: "imp-seed",
              lastSeenImportId: "imp-seed",
              updatedAt: "2026-07-01T00:00:00Z",
            },
          ],
          recordsToInsert: [
            {
              recordId: "rec-plat",
              idempotencyKey: "plat-key",
              workerNumber: parseWorkerNumber("10001"),
              trainingId: trainingId1,
              completionDate: "2026-07-20",
              provenance: "SESSION_RELEASE",
              status: "VIGENTE",
              sessionId: "ses-1",
              releaseId: "rel-1",
              mappingVersion: "operational-hc-v1",
              batchId: null,
              marker: null,
              importId: null,
              requestId: "req-rel-1",
              createdAt: "2026-07-20T00:00:00Z",
              updatedAt: "2026-07-20T00:00:00Z",
              version: 1,
            },
          ],
          recordsToUpdate: [],
          historyEntriesToInsert: [],
        },
      );

      const service = new MatrixImportService(repository);
      const conflictingSnapshot = createSyntheticSnapshot();

      await assert.rejects(
        () =>
          service.importSnapshot({
            requestId: "req-will-fail",
            snapshot: conflictingSnapshot,
          }),
        MatrixConflictError,
      );

      const dbState = repository.getState();
      const conflictingBatch = dbState.batches.find((b) => b.requestId === "req-will-fail");
      assert.ok(conflictingBatch);
      assert.equal(conflictingBatch.phase, "CONFLICTO");
      assert.equal(conflictingBatch.counts.conflictCount, 1);

      const platformRecord = dbState.records.find((r) => r.recordId === "rec-plat");
      assert.equal(platformRecord?.completionDate, "2026-07-20");
    });
  });
});
