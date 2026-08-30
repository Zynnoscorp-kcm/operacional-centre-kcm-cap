/**
 * Puerto de acceso a datos para el Sistema General por Trabajador (Función 8).
 */

import type { WorkerNumber } from "../domain/numero-trabajador.ts";
import type {
  WorkerRecord,
  CourseTrajectoryEntry,
  Dc3WorkerLogEntry,
} from "../domain/sistema-trabajador/tipos.ts";

export interface WorkerFilter {
  readonly department?: string;
  readonly area?: string;
  /** Tipo de nómina tal como llega de la matriz (NS o NQ). */
  readonly payrollType?: string;
  /** Límite inclusivo de fecha de ingreso, en formato YYYY-MM-DD. */
  readonly hireDateFrom?: string;
  /** Límite inclusivo de fecha de ingreso, en formato YYYY-MM-DD. */
  readonly hireDateTo?: string;
  readonly query?: string; // Búsqueda por número de trabajador o nombre
  readonly activeOnly?: boolean;
}

/** Filtros del tablero DNC. Todos son opcionales y se combinan con AND. */
export interface DncCoverageFilter {
  readonly planta?: string;
  readonly area?: string;
  readonly departamento?: string;
  readonly curso?: string;
  /** `FALTANTE` o `CUBIERTO`. Sin valor devuelve ambos. */
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

/**
 * Estado de concordancia entre las tres fuentes. Es de sólo lectura y barato:
 * responde «¿cuadra todo?» sin volver a ingerir nada, que es lo que hace falta
 * después de cargar una matriz o un padrón nuevos.
 */
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

/** Un renglón por departamento, con los cinco estados ya contados. */
export interface DepartmentDncSummary {
  readonly departamento: string;
  readonly trabajadoresActivos: number;
  readonly completados: number;
  readonly reforzar: number;
  readonly pendientes: number;
  readonly programados: number;
  readonly datosInsuficientes: number;
}

/** Un renglón por curso exigible, con el nivel de la regla que lo impone. */
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
  /**
   * Lo mismo que los dos anteriores, para toda la planta de una vez.
   *
   * Existen porque los tableros agregados —cobertura por curso, resumen por
   * departamento, comparativa— evalúan a los mil setecientos trabajadores. Con
   * las lecturas por persona eso son dos consultas por trabajador, y contra una
   * base remota la página no llega a responder: no era lentitud, era un tablero
   * inservible. Con estas dos, son dos consultas en total.
   *
   * La clave del mapa es el número de trabajador. Del historial se conserva
   * sólo la fecha más reciente por curso, que es lo único que la evaluación
   * DNC mira; la trayectoria completa se sigue leyendo por persona en la ficha.
   */
  getLatestTrainingByWorker(): Promise<ReadonlyMap<string, Record<string, string>>>;
  getScheduledSessionsByWorker(): Promise<ReadonlyMap<string, Record<string, string>>>;
  /**
   * Los tres resúmenes agregados, resueltos por la base.
   *
   * Son opcionales porque sólo existen donde hay vistas: una corrida en memoria
   * no las tiene y el servicio cae al motor DNC en JavaScript, que evalúa
   * trabajador por trabajador. Esa caída es correcta con datos sintéticos y
   * ruinosa con mil setecientas personas al otro lado de un enlace lento —era lo
   * que dejaba estas tres pantallas sin cargar—, así que donde hay base manda la
   * base: devuelve decenas de filas ya sumadas en vez de decenas de miles.
   *
   * La aplicabilidad —a quién le toca cada curso— sigue viviendo en un solo
   * lugar, `kcm.regla_dnc`. Lo que la consulta reproduce es la derivación de
   * estado del motor: vigente contra vencido según `meses_recurrencia` y
   * `dias_gracia`, programado si hay asistencia sin liberar, pendiente si no.
   */
  getDncSummaryByDepartment?(): Promise<readonly DepartmentDncSummary[]>;
  getDncSummaryByCourse?(): Promise<readonly CourseDncSummary[]>;
  getWorkerDc3Records(workerNumber: WorkerNumber): Promise<readonly Dc3WorkerLogEntry[]>;
  listDepartments(): Promise<readonly string[]>;
  listAreas(department?: string): Promise<readonly string[]>;
}
