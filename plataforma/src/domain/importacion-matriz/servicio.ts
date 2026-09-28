/**
 * Servicio de orquestación para la ingesta y reconciliación de la matriz XLSB.
 *
 * Coordina las cinco fases gobernadas:
 * 1. RECIBIDO: Captura de fuente/snapshot y comprobación de integridad y frescura.
 * 2. PREPARADO: Extracción y fijación del alcance declarado (FULL o DELTA).
 * 3. VALIDADO: Preflight de reconciliación por procedencia, detección de candidatos y novedades.
 * 4. APROBADO: Autorización formal por parte de un actor calificado.
 * 5. CONFIRMADO: Aplicación atómica e idempotente a las tablas del sistema.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  createImportBatch,
  transitionToApproved,
  transitionToConfirmed,
  transitionToPrepared,
  transitionToValidated,
} from "./ciclo-de-lote.ts";
import { MatrixConflictError } from "./errores.ts";
import { reconcileSnapshot, validateSnapshot } from "./reconciliador.ts";
import type {
  BatchApplicationResult,
  BatchValidationResult,
  CourseMapping,
  ImportBatch,
  ImportScope,
  MatrixSnapshot,
} from "./tipos.ts";
import type {
  MatrixRepositoryPort,
  XlsbExtractorPort,
} from "../../ports/importacion-matriz.port.ts";

export interface ImportSnapshotInput {
  readonly requestId: string;
  readonly snapshot: MatrixSnapshot;
  readonly actorId?: string | undefined;
  readonly scope?: ImportScope | undefined;
  readonly courseMappings?: readonly CourseMapping[] | undefined;
}

export class MatrixImportService {
  private readonly repository: MatrixRepositoryPort;
  private readonly extractor: XlsbExtractorPort | undefined;

  constructor(repository: MatrixRepositoryPort, extractor?: XlsbExtractorPort) {
    this.repository = repository;
    this.extractor = extractor;
  }

  /**
   * Recibe un snapshot o buffer y crea el lote en fase RECIBIDO.
   */
  async receiveBatch({
    source,
    requestId,
    actorId = "sistema@kcm.invalid",
    fileName = "Matriz_Maestra.xlsb",
    scope = "FULL",
  }: {
    source: Buffer | MatrixSnapshot;
    requestId: string;
    actorId?: string;
    fileName?: string;
    scope?: ImportScope;
  }): Promise<{ batch: ImportBatch; snapshot: MatrixSnapshot | null; repeated: boolean }> {
    // 1. Idempotencia: Verificar si la solicitud ya fue procesada
    const existing = await this.repository.findBatchByRequestId(requestId);
    if (existing && existing.phase === "CONFIRMADO") {
      return {
        batch: existing,
        snapshot: null,
        repeated: true,
      };
    }

    // 2. Extraer snapshot si es un Buffer
    let snapshot: MatrixSnapshot;
    if (Buffer.isBuffer(source)) {
      if (!this.extractor) {
        throw new Error("No se proporcionó extractor XLSB para procesar buffer binario");
      }
      snapshot = await this.extractor.extractFromBuffer(source);
    } else {
      snapshot = source;
    }

    // 3. Comprobar que no sea obsoleto frente al último lote completado
    const latestBatch = await this.repository.getLatestCompletedBatch();
    validateSnapshot(snapshot, latestBatch?.sourceExtractedAt ?? null);

    const snapshotSha256 = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

    // El identificador va tal cual a `lote_importacion.importacion_id`, que es una columna
    // `uuid`. Un prefijo legible lo volvia texto y Postgres rechazaba el lote entero con
    // "invalid input syntax for type uuid", ya recibido y validado, como falla interna.
    const importId = randomUUID();
    const batch = createImportBatch({
      importId,
      requestId,
      sourceSha256: snapshot.source.sha256,
      snapshotSha256,
      sourceFileName: snapshot.source.fileName || fileName,
      sourceSheetName: snapshot.source.sheetName || "HC",
      sourceExtractedAt: snapshot.extractedAt,
      createdBy: actorId,
      scope,
    });

    await this.repository.saveBatch(batch);
    return { batch, snapshot, repeated: false };
  }

  /**
   * Prepara el lote fijando alcance y diagnósticos (Fase PREPARADO).
   */
  async prepareBatch(
    batch: ImportBatch,
    snapshot: MatrixSnapshot,
    scope: ImportScope = "FULL",
  ): Promise<ImportBatch> {
    transitionToPrepared(batch, scope, snapshot.diagnostics, {
      totalEmployees: snapshot.employees.length,
      totalCourses: snapshot.courses.length,
      totalCompletions: snapshot.completions.length,
    });
    await this.repository.updateBatch(batch);
    return batch;
  }

  /**
   * Ejecuta el preflight de validación y reconciliación (Fase VALIDADO o CONFLICTO).
   */
  async validateBatch(
    batch: ImportBatch,
    snapshot: MatrixSnapshot,
    options: {
      actorId?: string | undefined;
      courseMappings?: readonly CourseMapping[] | undefined;
    } = {},
  ): Promise<BatchValidationResult> {
    const actorId = options.actorId ?? batch.createdBy;
    const existingWorkers = await this.repository.getWorkers();
    const existingCourses = await this.repository.getCourses();
    const existingRecords = await this.repository.getHcRecords();

    const reconciled = reconcileSnapshot({
      snapshot,
      existingWorkers,
      existingCourses,
      existingRecords,
      importId: batch.importId,
      requestId: batch.requestId,
      actorId,
      scope: batch.scope,
      courseMappings: options.courseMappings ?? [],
    });

    const hasConflicts = reconciled.conflicts.length > 0;
    transitionToValidated(batch, reconciled.counts, hasConflicts);
    await this.repository.updateBatch(batch);

    // Identificar cursos o trabajadores desconocidos
    const existingCourseKeys = new Set(existingCourses.map((c) => c.sourceKey));
    const existingWorkerIds = new Set(existingWorkers.map((w) => w.workerNumber));

    const unknownCourses = snapshot.courses.filter((c) => !existingCourseKeys.has(c.sourceKey));
    const unknownWorkers = snapshot.employees.filter((e) => !existingWorkerIds.has(e.employeeId));

    return {
      phase: batch.phase as "VALIDADO" | "CONFLICTO" | "RECHAZADO",
      counts: reconciled.counts,
      conflicts: reconciled.conflicts,
      unknownCourses,
      unknownWorkers,
      issues: snapshot.diagnostics.issues,
    };
  }

  /**
   * Aprueba el lote validado (Fase APROBADO).
   */
  async approveBatch(
    batch: ImportBatch,
    approverActorId: string,
    approvalReason = "Aprobación de importación de matriz revisada",
  ): Promise<ImportBatch> {
    transitionToApproved(batch, approverActorId, approvalReason);
    await this.repository.updateBatch(batch);
    return batch;
  }

  /**
   * Confirma y aplica atómicamente el lote aprobado (Fase CONFIRMADO).
   */
  async confirmBatch(
    batch: ImportBatch,
    snapshot: MatrixSnapshot,
    options: {
      actorId?: string | undefined;
      courseMappings?: readonly CourseMapping[] | undefined;
    } = {},
  ): Promise<BatchApplicationResult> {
    const actorId = options.actorId ?? batch.approvalActorId ?? batch.createdBy;
    const existingWorkers = await this.repository.getWorkers();
    const existingCourses = await this.repository.getCourses();
    const existingRecords = await this.repository.getHcRecords();

    const reconciled = reconcileSnapshot({
      snapshot,
      existingWorkers,
      existingCourses,
      existingRecords,
      importId: batch.importId,
      requestId: batch.requestId,
      actorId,
      scope: batch.scope,
      courseMappings: options.courseMappings ?? [],
    });

    if (reconciled.conflicts.length > 0) {
      batch.phase = "CONFLICTO";
      batch.counts = reconciled.counts;
      await this.repository.updateBatch(batch);
      throw new MatrixConflictError(
        `El lote tiene ${reconciled.conflicts.length} contradicciones con fechas de plataforma`,
      );
    }

    transitionToConfirmed(batch, reconciled.counts);

    // Aplicar de forma atómica en el repositorio
    await this.repository.applyBatchAtomic(batch, {
      workersToUpsert: reconciled.workersToUpsert,
      coursesToUpsert: reconciled.coursesToUpsert,
      recordsToInsert: reconciled.recordsToInsert,
      recordsToUpdate: reconciled.recordsToUpdate,
      historyEntriesToInsert: reconciled.historyEntriesToInsert,
      ...(batch.scope === "FULL"
        ? { workersSeen: snapshot.employees.map((empleado) => empleado.employeeId as string) }
        : {}),
    });

    const validation: BatchValidationResult = {
      phase: "VALIDADO",
      counts: reconciled.counts,
      conflicts: [],
      unknownCourses: [],
      unknownWorkers: [],
      issues: snapshot.diagnostics.issues,
    };

    return {
      importId: batch.importId,
      requestId: batch.requestId,
      status: "COMPLETADO",
      repeated: false,
      counts: reconciled.counts,
      validation,
    };
  }

  /**
   * Flujo de alto nivel para ejecutar el ciclo completo de un snapshot.
   *
   * Idéntico al contrato operativo de OperationalHcService.importSnapshot():
   * - Recibe el snapshot
   * - Prepara y valida
   * - Si hay conflictos, marca estado CONFLICTO y lanza MatrixConflictError
   * - Si es válido, aprueba y confirma atómicamente
   * - Si la solicitud se repite, devuelve el resultado anterior con repeated: true
   */
  async importSnapshot(input: ImportSnapshotInput): Promise<BatchApplicationResult> {
    const { batch, snapshot, repeated } = await this.receiveBatch({
      source: input.snapshot,
      requestId: input.requestId,
      actorId: input.actorId ?? "sistema@kcm.invalid",
      scope: input.scope ?? "FULL",
    });

    if (repeated || !snapshot) {
      return {
        importId: batch.importId,
        requestId: batch.requestId,
        status: "COMPLETADO",
        repeated: true,
        counts: batch.counts,
        validation: {
          phase: "VALIDADO",
          counts: batch.counts,
          conflicts: [],
          unknownCourses: [],
          unknownWorkers: [],
          issues: [],
        },
      };
    }

    await this.prepareBatch(batch, snapshot, input.scope ?? "FULL");

    const validation = await this.validateBatch(batch, snapshot, {
      actorId: input.actorId,
      courseMappings: input.courseMappings,
    });

    if (validation.phase === "CONFLICTO") {
      throw new MatrixConflictError(
        `El snapshot presenta ${validation.conflicts.length} conflictos con fechas liberadas por la plataforma`,
      );
    }

    await this.approveBatch(
      batch,
      input.actorId ?? "sistema@kcm.invalid",
      "Aprobación automática de importación válida",
    );

    return this.confirmBatch(batch, snapshot, {
      actorId: input.actorId,
      courseMappings: input.courseMappings,
    });
  }
}
