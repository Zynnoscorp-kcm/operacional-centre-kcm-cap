import type { WorkerNumber } from "../domain/comun/numero-trabajador.ts";
import type {
  WorkerRecord,
  CourseTrajectoryEntry,
  Dc3WorkerLogEntry,
} from "../domain/sistema-trabajador/tipos.ts";

export interface WorkerFilter {
  readonly department?: string;
  readonly area?: string;
  readonly payrollType?: string;
  readonly hireDateFrom?: string;
  readonly hireDateTo?: string;
  readonly query?: string;
  readonly activeOnly?: boolean;
}

export interface DncCoverageFilter {
  readonly planta?: string;
  readonly area?: string;
  readonly departamento?: string;
  readonly curso?: string;
  readonly estado?: string;
}

export interface DncCoverageRow {
  readonly numeroTrabajador: string;
  readonly nombreCompleto: string;
  readonly planta: string;
  readonly departamento: string;
  readonly area: string;
  readonly cursosRequeridos: number;
  readonly cursosCubiertos: number;
  readonly cursosFaltantes: number;
  readonly porcentaje: number;
}

export interface DncReconciliation {
  readonly trabajadoresActivos: number;
  readonly conCurp: number;
  readonly sinCurp: number;
  readonly conReglaDnc: number;
  readonly sinReglaDnc: number;
  readonly paresCubiertos: number;
  readonly paresFaltantes: number;
  readonly candidatosDc3: number;
  readonly ultimoRegistroHc: string | null;
  readonly ultimaInduccion: string | null;
}

export interface DepartmentDncSummary {
  readonly departamento: string;
  readonly trabajadoresActivos: number;
  readonly completados: number;
  readonly reforzar: number;
  readonly pendientes: number;
  readonly programados: number;
  readonly datosInsuficientes: number;
}

export interface AreaCourseCompletionRow {
  readonly courseKey: string;
  readonly courseName: string;
  readonly applicable: number;
  readonly completed: number;
}

export interface CourseDncSummary {
  readonly curso: string;
  readonly claveCurso: string;
  readonly nivelRegla: "DEPARTMENT" | "AREA";
  readonly aplicables: number;
  readonly completados: number;
  readonly reforzar: number;
  readonly pendientes: number;
  readonly programados: number;
}

export interface WorkerSystemRepositoryPort {
  listWorkers(filter?: WorkerFilter): Promise<readonly WorkerRecord[]>;
  listDncCoverage(filter?: DncCoverageFilter): Promise<readonly DncCoverageRow[]>;
  listPlants(): Promise<readonly string[]>;
  listDncCourses(): Promise<readonly string[]>;
  getDncReconciliation(): Promise<DncReconciliation>;
  getWorkerByNumber(workerNumber: WorkerNumber): Promise<WorkerRecord | null>;
  getWorkerTrainingHistory(workerNumber: WorkerNumber): Promise<readonly CourseTrajectoryEntry[]>;
  getWorkerScheduledSessions(workerNumber: WorkerNumber): Promise<Record<string, string>>;
  getLatestTrainingByWorker(): Promise<ReadonlyMap<string, Record<string, string>>>;
  getScheduledSessionsByWorker(): Promise<ReadonlyMap<string, Record<string, string>>>;
  getDncSummaryByDepartment?(): Promise<readonly DepartmentDncSummary[]>;
  getDncSummaryByCourse?(): Promise<readonly CourseDncSummary[]>;
  getAreaCourseCompletion?(workerNumber: WorkerNumber): Promise<readonly AreaCourseCompletionRow[]>;
  getWorkerDc3Records(workerNumber: WorkerNumber): Promise<readonly Dc3WorkerLogEntry[]>;
  listDepartments(): Promise<readonly string[]>;
  listAreas(department?: string): Promise<readonly string[]>;
}
