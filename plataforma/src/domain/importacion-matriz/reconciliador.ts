import { createHash, randomUUID } from "node:crypto";
import { isWorkerNumber, parseWorkerNumber } from "../comun/numero-trabajador.ts";
import {
  InvalidSnapshotError,
  MatrixConflictError,
  StaleSnapshotError,
  UnmappedCourseError,
} from "./errores.ts";
import type {
  ConflictDetail,
  CourseCatalogEntry,
  CourseMapping,
  HcRecord,
  HcRecordHistory,
  ImportBatchCounts,
  ImportScope,
  MatrixSnapshot,
  SnapshotCompletion,
  SnapshotCourse,
  SnapshotEmployee,
  WorkerCatalogEntry,
} from "./tipos.ts";

export interface ReconciledOperations {
  readonly workersToUpsert: readonly WorkerCatalogEntry[];
  readonly coursesToUpsert: readonly CourseCatalogEntry[];
  readonly recordsToInsert: readonly HcRecord[];
  readonly recordsToUpdate: readonly HcRecord[];
  readonly historyEntriesToInsert: readonly HcRecordHistory[];
  readonly counts: ImportBatchCounts;
  readonly conflicts: readonly ConflictDetail[];
}

export function validateSnapshot(
  snapshot: MatrixSnapshot,
  latestExtractedAt: string | null = null,
): void {
  if (!snapshot || typeof snapshot !== "object") {
    throw new InvalidSnapshotError("Se esperaba un objeto de snapshot");
  }
  if (snapshot.schemaVersion !== "HC_SNAPSHOT_V1") {
    throw new InvalidSnapshotError(`Esquema no soportado: ${String(snapshot.schemaVersion)}`);
  }
  if (!snapshot.source || typeof snapshot.source !== "object") {
    throw new InvalidSnapshotError("El snapshot no contiene metadatos de fuente");
  }
  if (!/^[a-f0-9]{64}$/i.test(snapshot.source.sha256)) {
    throw new InvalidSnapshotError("El hash sha256 de la fuente es inválido");
  }
  if (!snapshot.extractedAt || Number.isNaN(new Date(snapshot.extractedAt).getTime())) {
    throw new InvalidSnapshotError("La fecha de extracción es inválida");
  }

  if (latestExtractedAt) {
    const currentMs = new Date(snapshot.extractedAt).getTime();
    const latestMs = new Date(latestExtractedAt).getTime();
    if (currentMs < latestMs) {
      throw new StaleSnapshotError(
        `El snapshot (${snapshot.extractedAt}) es anterior al estado vigente (${latestExtractedAt})`,
      );
    }
  }

  const diag = snapshot.diagnostics;
  if (diag?.counts) {
    if (diag.counts.skippedCompletionCount > 0) {
      throw new MatrixConflictError(
        `El snapshot tiene ${diag.counts.skippedCompletionCount} fechas omitidas por error`,
      );
    }
    if (diag.counts.formulaErrorCount > 0) {
      throw new MatrixConflictError(
        `El snapshot contiene ${diag.counts.formulaErrorCount} celdas con errores de fórmula`,
      );
    }
    if (diag.counts.formulaCachedValueCount < diag.counts.formulaCellCount) {
      throw new MatrixConflictError("El snapshot contiene fórmulas sin valor calculado en caché");
    }
  }

  if (!snapshot.employees || typeof snapshot.employees !== "object") {
    throw new InvalidSnapshotError("La lista de empleados no es válida");
  }
  for (let i = 0; i < snapshot.employees.length; i += 1) {
    const emp: SnapshotEmployee | undefined = snapshot.employees[i];
    if (!emp || !isWorkerNumber(emp.employeeId)) {
      throw new InvalidSnapshotError("Se encontró un número de trabajador no válido");
    }
    const textFields: readonly (string | null)[] = [
      emp.displayName,
      emp.hireDate,
      emp.payrollType,
      emp.position,
      emp.department,
      emp.area,
      emp.plant,
    ];
    for (const val of textFields) {
      if (typeof val === "string" && /^[=+\-@]/.test(val)) {
        throw new InvalidSnapshotError("Posible inyección de fórmula en campo de empleado");
      }
    }
  }

  if (!snapshot.courses || typeof snapshot.courses !== "object") {
    throw new InvalidSnapshotError("La lista de cursos no es válida");
  }
  for (let i = 0; i < snapshot.courses.length; i += 1) {
    const course: SnapshotCourse | undefined = snapshot.courses[i];
    if (!course || !course.sourceKey || !course.displayName) {
      throw new InvalidSnapshotError("Curso con clave o nombre faltante");
    }
  }

  if (!snapshot.completions || typeof snapshot.completions !== "object") {
    throw new InvalidSnapshotError("La lista de capacitaciones no es válida");
  }
  for (let i = 0; i < snapshot.completions.length; i += 1) {
    const comp: SnapshotCompletion | undefined = snapshot.completions[i];
    if (!comp || !isWorkerNumber(comp.employeeId)) {
      throw new InvalidSnapshotError("Registro con número de trabajador inválido");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(comp.completionDate)) {
      throw new InvalidSnapshotError("Fecha de capacitación con formato no ISO");
    }
  }
}

export function generateTrainingId(sourceKey: string): string {
  const hash = createHash("sha256").update(sourceKey).digest("hex").toUpperCase();
  return `HC-${hash.slice(0, 20)}`;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function resolveCourseMappings(
  snapshotCourses: readonly SnapshotCourse[],
  existingCourses: readonly CourseCatalogEntry[],
  mappings: readonly CourseMapping[] = [],
  allowNewCourses = true,
): {
  sourceKeyToTrainingId: Map<string, string>;
  updatedCourses: CourseCatalogEntry[];
  newCourses: CourseCatalogEntry[];
} {
  const sourceKeyToTrainingId = new Map<string, string>();
  const updatedCourses: CourseCatalogEntry[] = [];
  const newCourses: CourseCatalogEntry[] = [];

  const mappingMap = new Map(mappings.map((m) => [m.sourceKey, m.trainingId]));
  const existingBySourceKey = new Map(existingCourses.map((c) => [c.sourceKey, c]));
  const existingByTrainingId = new Map(existingCourses.map((c) => [c.trainingId, c]));
  const existingByNormName = new Map(existingCourses.map((c) => [c.normalizedName, c]));

  for (const sc of snapshotCourses) {
    const mappedTrainingId = mappingMap.get(sc.sourceKey);
    if (mappedTrainingId) {
      const existing = existingByTrainingId.get(mappedTrainingId);
      if (existing) {
        sourceKeyToTrainingId.set(sc.sourceKey, existing.trainingId);
        const aliases = new Set(existing.aliases);
        if (existing.sourceName && existing.sourceName !== sc.displayName) {
          aliases.add(existing.sourceName);
        }
        updatedCourses.push({
          ...existing,
          sourceKey: sc.sourceKey,
          sourceName: sc.displayName,
          aliases: [...aliases],
          updatedAt: new Date().toISOString(),
        });
        continue;
      }
    }

    const byKey = existingBySourceKey.get(sc.sourceKey);
    if (byKey) {
      sourceKeyToTrainingId.set(sc.sourceKey, byKey.trainingId);
      if (byKey.sourceName !== sc.displayName) {
        const aliases = new Set(byKey.aliases);
        if (byKey.sourceName) aliases.add(byKey.sourceName);
        updatedCourses.push({
          ...byKey,
          sourceName: sc.displayName,
          aliases: [...aliases],
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    const normName = normalizeText(sc.displayName);
    const byName = existingByNormName.get(normName);
    if (byName) {
      sourceKeyToTrainingId.set(sc.sourceKey, byName.trainingId);
      const aliases = new Set(byName.aliases);
      if (byName.sourceName && byName.sourceName !== sc.displayName) {
        aliases.add(byName.sourceName);
      }
      updatedCourses.push({
        ...byName,
        sourceKey: sc.sourceKey,
        sourceName: sc.displayName,
        aliases: [...aliases],
        updatedAt: new Date().toISOString(),
      });
      continue;
    }

    if (existingCourses.length > 0 && !allowNewCourses) {
      throw new UnmappedCourseError(
        `El curso '${sc.displayName}' (${sc.sourceKey}) no tiene mapeo a un trainingId del catálogo`,
      );
    }

    const newTrainingId = generateTrainingId(sc.sourceKey);
    sourceKeyToTrainingId.set(sc.sourceKey, newTrainingId);
    newCourses.push({
      trainingId: newTrainingId,
      sourceKey: sc.sourceKey,
      sourceName: sc.displayName,
      normalizedName: normName,
      aliases: [],
      active: true,
      firstSeenImportId: "",
      lastSeenImportId: "",
      updatedAt: new Date().toISOString(),
    });
  }

  return { sourceKeyToTrainingId, updatedCourses, newCourses };
}

export function reconcileSnapshot({
  snapshot,
  existingWorkers,
  existingCourses,
  existingRecords,
  importId,
  requestId,
  actorId,
  scope = "FULL",
  courseMappings = [],
}: {
  snapshot: MatrixSnapshot;
  existingWorkers: readonly WorkerCatalogEntry[];
  existingCourses: readonly CourseCatalogEntry[];
  existingRecords: readonly HcRecord[];
  importId: string;
  requestId: string;
  actorId: string;
  scope: ImportScope;
  courseMappings?: readonly CourseMapping[];
}): ReconciledOperations {
  validateSnapshot(snapshot);

  const { sourceKeyToTrainingId, updatedCourses, newCourses } = resolveCourseMappings(
    snapshot.courses,
    existingCourses,
    courseMappings,
    true,
  );

  const allCoursesMap = new Map<string, CourseCatalogEntry>();
  for (const c of existingCourses) allCoursesMap.set(c.trainingId, { ...c });
  for (const c of updatedCourses) allCoursesMap.set(c.trainingId, { ...c });
  for (const c of newCourses) {
    allCoursesMap.set(c.trainingId, {
      ...c,
      firstSeenImportId: importId,
      lastSeenImportId: importId,
    });
  }

  const coursesToUpsert: CourseCatalogEntry[] = [];
  const seenTrainingIds = new Set<string>();

  for (const sc of snapshot.courses) {
    const trainingId = sourceKeyToTrainingId.get(sc.sourceKey);
    if (trainingId) {
      seenTrainingIds.add(trainingId);
      const entry = allCoursesMap.get(trainingId);
      if (entry) {
        entry.lastSeenImportId = importId;
        if (!entry.firstSeenImportId) entry.firstSeenImportId = importId;
        coursesToUpsert.push(entry);
      }
    }
  }

  const existingWorkersMap = new Map(existingWorkers.map((w) => [w.workerNumber, w]));
  const workersToUpsert: WorkerCatalogEntry[] = [];
  const snapshotWorkerIds = new Set<string>();

  for (const emp of snapshot.employees) {
    snapshotWorkerIds.add(emp.employeeId);
    const existing = existingWorkersMap.get(emp.employeeId);
    const nowIso = new Date().toISOString();
    if (!existing) {
      workersToUpsert.push({
        workerNumber: emp.employeeId,
        displayName: emp.displayName,
        hireDate: emp.hireDate,
        payrollType: emp.payrollType,
        position: emp.position,
        department: emp.department,
        area: emp.area,
        plant: emp.plant,
        active: true,
        sourceHash: snapshot.source.sha256,
        updatedAt: nowIso,
      });
    } else {
      const changed =
        existing.displayName !== emp.displayName ||
        existing.hireDate !== emp.hireDate ||
        existing.payrollType !== emp.payrollType ||
        existing.position !== emp.position ||
        existing.department !== emp.department ||
        existing.area !== emp.area ||
        existing.plant !== emp.plant ||
        !existing.active;

      if (changed) {
        workersToUpsert.push({
          ...existing,
          displayName: emp.displayName,
          hireDate: emp.hireDate,
          payrollType: emp.payrollType,
          position: emp.position,
          department: emp.department,
          area: emp.area,
          plant: emp.plant,
          active: true,
          sourceHash: snapshot.source.sha256,
          updatedAt: nowIso,
        });
      }
    }
  }

  const snapshotCompletionsMap = new Map<string, SnapshotCompletion>();
  for (const comp of snapshot.completions) {
    const trainingId = sourceKeyToTrainingId.get(comp.sourceKey);
    if (trainingId) {
      const key = `${comp.employeeId}|${trainingId}`;
      snapshotCompletionsMap.set(key, comp);
    }
  }

  const recordsByPair = new Map<string, HcRecord[]>();
  for (const rec of existingRecords) {
    const pairKey = `${rec.workerNumber}|${rec.trainingId}`;
    const list = recordsByPair.get(pairKey) ?? [];
    list.push(rec);
    recordsByPair.set(pairKey, list);
  }

  const recordsToInsert: HcRecord[] = [];
  const recordsToUpdate: HcRecord[] = [];
  const historyEntriesToInsert: HcRecordHistory[] = [];
  const conflicts: ConflictDetail[] = [];

  let insertedCount = 0;
  let correctedCount = 0;
  let retiredCount = 0;
  let reactivatedCount = 0;
  let conflictCount = 0;
  let pendingMasterCount = 0;

  const processedPairKeys = new Set<string>();
  const nowIso = new Date().toISOString();

  for (const [pairKey, comp] of snapshotCompletionsMap.entries()) {
    processedPairKeys.add(pairKey);
    const parts = pairKey.split("|");
    const workerNumStr = parts[0];
    const trainingId = parts[1];
    if (!workerNumStr || !trainingId) continue;
    const workerNum = parseWorkerNumber(workerNumStr);

    const pairRecords = recordsByPair.get(pairKey) ?? [];
    const activeRecord = pairRecords.find((r) => r.status === "VIGENTE");

    if (activeRecord) {
      if (activeRecord.provenance === "SESSION_RELEASE") {
        if (activeRecord.completionDate === comp.completionDate) {
          continue;
        } else {
          conflictCount += 1;
          conflicts.push({
            workerNumber: workerNum,
            trainingId,
            existingDate: activeRecord.completionDate,
            existingProvenance: "SESSION_RELEASE",
            snapshotDate: comp.completionDate,
            reason: `El maestro trae fecha ${comp.completionDate}, pero la plataforma tiene ${activeRecord.completionDate} liberada por sesión`,
          });
        }
      } else {
        if (activeRecord.completionDate === comp.completionDate) {
          continue;
        } else {
          correctedCount += 1;
          const previousDate = activeRecord.completionDate;
          const updated: HcRecord = {
            ...activeRecord,
            completionDate: comp.completionDate,
            importId,
            requestId,
            updatedAt: nowIso,
            version: activeRecord.version + 1,
          };
          recordsToUpdate.push(updated);
          historyEntriesToInsert.push({
            historyId: randomUUID(),
            recordId: activeRecord.recordId,
            workerNumber: workerNum,
            trainingId,
            changeType: "CORREGIDA",
            previousCompletionDate: previousDate,
            completionDate: comp.completionDate,
            previousStatus: "VIGENTE",
            status: "VIGENTE",
            provenance: "XLSB_IMPORT",
            actorId,
            reason: "Corrección de fecha en matriz XLSB maestra",
            requestId,
            importId,
            recordedAt: nowIso,
          });
        }
      }
    } else {
      const retiredRecord = pairRecords.find((r) => r.status === "RETIRADO");
      if (retiredRecord && retiredRecord.provenance === "XLSB_IMPORT") {
        reactivatedCount += 1;
        const updated: HcRecord = {
          ...retiredRecord,
          completionDate: comp.completionDate,
          status: "VIGENTE",
          importId,
          requestId,
          updatedAt: nowIso,
          version: retiredRecord.version + 1,
        };
        recordsToUpdate.push(updated);
        historyEntriesToInsert.push({
          historyId: randomUUID(),
          recordId: retiredRecord.recordId,
          workerNumber: workerNum,
          trainingId,
          changeType: "REACTIVADA",
          previousCompletionDate: null,
          completionDate: comp.completionDate,
          previousStatus: "RETIRADO",
          status: "VIGENTE",
          provenance: "XLSB_IMPORT",
          actorId,
          reason: "Reactivación de fecha reaparecida en matriz XLSB maestra",
          requestId,
          importId,
          recordedAt: nowIso,
        });
      } else {
        insertedCount += 1;
        const recordId = randomUUID();
        const newRecord: HcRecord = {
          recordId,
          idempotencyKey: `xlsb|${workerNumStr}|${trainingId}|${comp.completionDate}`,
          workerNumber: workerNum,
          trainingId,
          completionDate: comp.completionDate,
          provenance: "XLSB_IMPORT",
          status: "VIGENTE",
          sessionId: null,
          releaseId: null,
          mappingVersion: "operational-hc-v1",
          batchId: null,
          marker: null,
          importId,
          requestId,
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
        };
        recordsToInsert.push(newRecord);
        historyEntriesToInsert.push({
          historyId: randomUUID(),
          recordId,
          workerNumber: workerNum,
          trainingId,
          changeType: "ALTA",
          previousCompletionDate: null,
          completionDate: comp.completionDate,
          previousStatus: null,
          status: "VIGENTE",
          provenance: "XLSB_IMPORT",
          actorId,
          reason: "Alta inicial por importación de matriz XLSB maestra",
          requestId,
          importId,
          recordedAt: nowIso,
        });
      }
    }
  }

  if (scope === "FULL") {
    for (const [pairKey, pairRecords] of recordsByPair.entries()) {
      if (processedPairKeys.has(pairKey)) continue;

      const activeRecord = pairRecords.find((r) => r.status === "VIGENTE");
      if (!activeRecord) continue;

      const parts = pairKey.split("|");
      const workerNumStr = parts[0];
      const trainingId = parts[1];
      if (!workerNumStr || !trainingId) continue;
      const workerNum = parseWorkerNumber(workerNumStr);

      if (activeRecord.provenance === "SESSION_RELEASE") {
        pendingMasterCount += 1;
        continue;
      }

      if (snapshotWorkerIds.has(workerNum) && seenTrainingIds.has(trainingId)) {
        retiredCount += 1;
        const previousDate = activeRecord.completionDate;
        const updated: HcRecord = {
          ...activeRecord,
          completionDate: "",
          status: "RETIRADO",
          importId,
          requestId,
          updatedAt: nowIso,
          version: activeRecord.version + 1,
        };
        recordsToUpdate.push(updated);
        historyEntriesToInsert.push({
          historyId: randomUUID(),
          recordId: activeRecord.recordId,
          workerNumber: workerNum,
          trainingId,
          changeType: "RETIRADA",
          previousCompletionDate: previousDate,
          completionDate: null,
          previousStatus: "VIGENTE",
          status: "RETIRADO",
          provenance: "XLSB_IMPORT",
          actorId,
          reason: "Retiro de fecha eliminada en matriz XLSB maestra",
          requestId,
          importId,
          recordedAt: nowIso,
        });
      }
    }
  }

  const counts: ImportBatchCounts = {
    totalEmployees: snapshot.employees.length,
    totalCourses: snapshot.courses.length,
    totalCompletions: snapshot.completions.length,
    insertedCount,
    correctedCount,
    retiredCount,
    reactivatedCount,
    conflictCount,
    pendingMasterCount,
  };

  return {
    workersToUpsert,
    coursesToUpsert,
    recordsToInsert,
    recordsToUpdate,
    historyEntriesToInsert,
    counts,
    conflicts,
  };
}
