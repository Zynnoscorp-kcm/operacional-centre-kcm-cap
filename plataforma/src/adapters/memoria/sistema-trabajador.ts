/**
 * Adaptador en memoria para el repositorio del Sistema General por Trabajador (Función 8).
 * Útil para desarrollo local, pruebas unitarias y entornos sintéticos sin dependencias externas.
 */

import { parseWorkerNumber, type WorkerNumber } from "../../domain/numero-trabajador.ts";
import type {
  WorkerSystemRepositoryPort,
  WorkerFilter,
  DncCoverageRow,
  DncReconciliation,
} from "../../ports/sistema-trabajador.port.ts";
import type {
  WorkerRecord,
  CourseTrajectoryEntry,
  Dc3WorkerLogEntry,
} from "../../domain/sistema-trabajador/tipos.ts";

export class MemoryWorkerSystemRepository implements WorkerSystemRepositoryPort {
  private readonly workers: Map<WorkerNumber, WorkerRecord> = new Map();
  private readonly trajectories: Map<WorkerNumber, CourseTrajectoryEntry[]> = new Map();
  private readonly scheduledSessions: Map<WorkerNumber, Record<string, string>> = new Map();
  private readonly dc3Records: Map<WorkerNumber, Dc3WorkerLogEntry[]> = new Map();

  constructor() {
    this._seedSyntheticData();
  }

  setWorker(worker: WorkerRecord): void {
    this.workers.set(worker.employeeId, worker);
  }

  setTrajectory(employeeId: WorkerNumber, trajectory: CourseTrajectoryEntry[]): void {
    this.trajectories.set(employeeId, trajectory);
  }

  setScheduledSessions(employeeId: WorkerNumber, sessions: Record<string, string>): void {
    this.scheduledSessions.set(employeeId, sessions);
  }

  setDc3Records(employeeId: WorkerNumber, records: Dc3WorkerLogEntry[]): void {
    this.dc3Records.set(employeeId, records);
  }

  listWorkers(filter?: WorkerFilter): Promise<readonly WorkerRecord[]> {
    let result = Array.from(this.workers.values());

    if (filter?.activeOnly) {
      result = result.filter((w) => w.active);
    }

    if (filter?.department) {
      const depLower = filter.department.toLowerCase();
      result = result.filter((w) => w.department.toLowerCase().includes(depLower));
    }

    if (filter?.area) {
      const areaLower = filter.area.toLowerCase();
      result = result.filter((w) => w.area.toLowerCase().includes(areaLower));
    }

    if (filter?.payrollType) {
      const payrollType = filter.payrollType.trim().toUpperCase();
      result = result.filter((w) => String(w.payrollType ?? "").toUpperCase() === payrollType);
    }

    if (filter?.hireDateFrom) {
      result = result.filter((w) => w.hireDate !== null && w.hireDate >= filter.hireDateFrom!);
    }

    if (filter?.hireDateTo) {
      result = result.filter((w) => w.hireDate !== null && w.hireDate <= filter.hireDateTo!);
    }

    if (filter?.query) {
      const q = filter.query.trim().toLowerCase();
      result = result.filter(
        (w) =>
          w.employeeId.includes(q) ||
          w.name.toLowerCase().includes(q) ||
          w.position.toLowerCase().includes(q),
      );
    }

    return Promise.resolve(result.sort((a, b) => a.employeeId.localeCompare(b.employeeId)));
  }

  getWorkerByNumber(workerNumber: WorkerNumber): Promise<WorkerRecord | null> {
    return Promise.resolve(this.workers.get(workerNumber) ?? null);
  }

  getWorkerTrainingHistory(workerNumber: WorkerNumber): Promise<readonly CourseTrajectoryEntry[]> {
    const list = this.trajectories.get(workerNumber) ?? [];
    return Promise.resolve(
      [...list].sort((a, b) => b.completionDate.localeCompare(a.completionDate)),
    );
  }

  getWorkerScheduledSessions(workerNumber: WorkerNumber): Promise<Record<string, string>> {
    return Promise.resolve(this.scheduledSessions.get(workerNumber) ?? {});
  }

  getLatestTrainingByWorker(): Promise<ReadonlyMap<string, Record<string, string>>> {
    const mapa = new Map<string, Record<string, string>>();
    for (const [workerNumber, list] of this.trajectories.entries()) {
      const ultimas: Record<string, string> = {};
      for (const item of list) {
        const previa = ultimas[item.trainingId];
        if (!previa || item.completionDate > previa) ultimas[item.trainingId] = item.completionDate;
      }
      mapa.set(String(workerNumber), ultimas);
    }
    return Promise.resolve(mapa);
  }

  getScheduledSessionsByWorker(): Promise<ReadonlyMap<string, Record<string, string>>> {
    const mapa = new Map<string, Record<string, string>>();
    for (const [workerNumber, sesiones] of this.scheduledSessions.entries()) {
      mapa.set(String(workerNumber), { ...sesiones });
    }
    return Promise.resolve(mapa);
  }

  getWorkerDc3Records(workerNumber: WorkerNumber): Promise<readonly Dc3WorkerLogEntry[]> {
    const list = this.dc3Records.get(workerNumber) ?? [];
    return Promise.resolve(list);
  }

  listDepartments(): Promise<readonly string[]> {
    const depts = new Set<string>();
    for (const w of this.workers.values()) {
      if (w.department) depts.add(w.department);
    }
    return Promise.resolve(Array.from(depts).sort());
  }

  /**
   * El tablero DNC vive sobre dos vistas de PostgreSQL, y reimplementar aquí el
   * motor de reglas sólo produciría una segunda verdad que se desviaría de la
   * primera. Una corrida en memoria devuelve un tablero vacío y coherente: la
   * cobertura se prueba contra la base, que es donde se calcula.
   */
  listDncCoverage(): Promise<readonly DncCoverageRow[]> {
    return Promise.resolve([]);
  }

  listPlants(): Promise<readonly string[]> {
    const plantas = new Set<string>();
    for (const w of this.workers.values()) if (w.plant) plantas.add(w.plant);
    return Promise.resolve([...plantas].sort());
  }

  listDncCourses(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  getDncReconciliation(): Promise<DncReconciliation> {
    return Promise.resolve({
      trabajadoresActivos: this.workers.size,
      conCurp: 0,
      sinCurp: this.workers.size,
      conReglaDnc: 0,
      sinReglaDnc: this.workers.size,
      paresCubiertos: 0,
      paresFaltantes: 0,
      candidatosDc3: 0,
      ultimoRegistroHc: null,
      ultimaInduccion: null,
    });
  }

  listAreas(department?: string): Promise<readonly string[]> {
    const areas = new Set<string>();
    for (const w of this.workers.values()) {
      if (!department || w.department === department) {
        if (w.area) areas.add(w.area);
      }
    }
    return Promise.resolve(Array.from(areas).sort());
  }

  private _seedSyntheticData(): void {
    // 1. Trabajador Técnico en Gerencia Mantto Eléctrico
    const w1: WorkerRecord = {
      employeeId: parseWorkerNumber("01234"),
      name: "JUAN PÉREZ GARCÍA",
      department: "GERENCIA DE MANTTO.",
      area: "GERENCIA DE MANTTO. ELECTRICO",
      position: "TECNICO INSTRUMENTISTA",
      payrollType: "NS",
      plant: "ECATEPEC I",
      hireDate: "2018-03-15",
      active: true,
      schoolingDeclared: "PREPARATORIA TECNICA",
    };
    this.setWorker(w1);
    this.setTrajectory(w1.employeeId, [
      {
        recordId: "REC-001",
        trainingId: "kcm-course:induccion",
        courseName: "INDUCCION",
        completionDate: "2024-01-15",
        provenance: "XLSB_IMPORT",
        recordedAt: "2024-01-16T10:00:00Z",
        actor: "IMPORTACION_INICIAL",
      },
      {
        recordId: "REC-002",
        trainingId: "kcm-course:qms",
        courseName: "QMS",
        completionDate: "2024-02-10",
        provenance: "SESSION_RELEASE",
        sourceBatchId: "SES-2024-02-10-A",
        recordedAt: "2024-02-10T14:30:00Z",
        actor: "CAPACITADOR_SISTEMA",
      },
      {
        recordId: "REC-003",
        trainingId: "kcm-course:loto-bloqueo",
        courseName: "LOTO",
        completionDate: "2023-01-01", // Expirado (vigencia 12 meses) -> REFORZAR
        provenance: "XLSB_IMPORT",
        recordedAt: "2023-01-02T09:00:00Z",
        actor: "IMPORTACION_INICIAL",
      },
      {
        recordId: "REC-004",
        trainingId: "kcm-course:fundamentos-variadores-frecuencia",
        courseName: "FUNDAMENTOS BASICOS DE VARIADORES DE FRECUENCIA",
        completionDate: "2024-03-01",
        provenance: "SESSION_RELEASE",
        sourceBatchId: "SES-2024-03-01-B",
        recordedAt: "2024-03-01T16:00:00Z",
        actor: "CAPACITADOR_SISTEMA",
      },
    ]);
    this.setScheduledSessions(w1.employeeId, {
      "kcm-course:loto-bloqueo": "SES-2026-08-15-LOTO",
    });
    this.setDc3Records(w1.employeeId, [
      {
        courseId: "kcm-course:induccion",
        courseName: "INDUCCION",
        isEligible: true,
        isIssued: true,
        issuedAt: "2024-01-16",
        documentFolio: "DC3-2024-01234-IND",
        blockingReasons: [],
      },
      {
        courseId: "kcm-course:qms",
        courseName: "QMS",
        isEligible: true,
        isIssued: true,
        issuedAt: "2024-02-11",
        documentFolio: "DC3-2024-01234-QMS",
        blockingReasons: [],
      },
      {
        courseId: "kcm-course:loto-bloqueo",
        courseName: "LOTO",
        isEligible: false,
        isIssued: false,
        issuedAt: null,
        documentFolio: null,
        blockingReasons: ["Acreditación vencida (requiere reforzamiento)"],
      },
    ]);

    // 2. Trabajadora Operativa en Convertidora
    const w2: WorkerRecord = {
      employeeId: parseWorkerNumber("01235"),
      name: "MARÍA LÓPEZ SÁNCHEZ",
      department: "OPERACION CONVERTIDORA",
      area: "LINEA 1",
      position: "OPERADOR DE CONVERTIDORA",
      payrollType: "NQ",
      plant: "ECATEPEC II",
      hireDate: "2020-07-01",
      active: true,
      // schoolingDeclared no especificado -> default SECUNDARIA
    };
    this.setWorker(w2);
    this.setTrajectory(w2.employeeId, [
      {
        recordId: "REC-005",
        trainingId: "kcm-course:induccion",
        courseName: "INDUCCION",
        completionDate: "2024-04-12",
        provenance: "XLSB_IMPORT",
        recordedAt: "2024-04-13T10:00:00Z",
        actor: "IMPORTACION_INICIAL",
      },
      {
        recordId: "REC-006",
        trainingId: "kcm-course:bpm",
        courseName: "BUENAS PRACTICAS DE MANUFACTURA",
        completionDate: "2024-05-18",
        provenance: "SESSION_RELEASE",
        sourceBatchId: "SES-2024-05-18-BPM",
        recordedAt: "2024-05-18T12:00:00Z",
        actor: "CAPACITADOR_SISTEMA",
      },
    ]);

    // 3. Supervisor de Calidad
    const w3: WorkerRecord = {
      employeeId: parseWorkerNumber("01236"),
      name: "ROBERTO SOTO HERNÁNDEZ",
      department: "GERENCIA DE CALIDAD",
      area: "ASEGURAMIENTO DE CALIDAD",
      position: "SUPERVISOR DE CALIDAD",
      payrollType: "NS",
      plant: "ECATEPEC I",
      hireDate: "2015-11-20",
      active: true,
      schoolingDeclared: "INGENIERIA QUIMICA",
    };
    this.setWorker(w3);
    this.setTrajectory(w3.employeeId, [
      {
        recordId: "REC-007",
        trainingId: "kcm-course:induccion",
        courseName: "INDUCCION",
        completionDate: "2024-01-10",
        provenance: "XLSB_IMPORT",
        recordedAt: "2024-01-11T09:00:00Z",
        actor: "IMPORTACION_INICIAL",
      },
      {
        recordId: "REC-008",
        trainingId: "kcm-course:qms",
        courseName: "QMS",
        completionDate: "2024-01-15",
        provenance: "XLSB_IMPORT",
        recordedAt: "2024-01-16T09:00:00Z",
        actor: "IMPORTACION_INICIAL",
      },
      {
        recordId: "REC-009",
        trainingId: "kcm-course:bpm",
        courseName: "BUENAS PRACTICAS DE MANUFACTURA",
        completionDate: "2024-02-20",
        provenance: "SESSION_RELEASE",
        sourceBatchId: "SES-2024-02-20-BPM",
        recordedAt: "2024-02-20T11:00:00Z",
        actor: "CAPACITADOR_SISTEMA",
      },
    ]);

    // 4. Analista de Recursos Humanos
    const w4: WorkerRecord = {
      employeeId: parseWorkerNumber("01237"),
      name: "ANA KAREN DÍAZ MORALES",
      department: "GERENCIA DE RECURSOS HUMANOS",
      area: "CAPACITACION",
      position: "ANALISTA DE CAPACITACION",
      plant: "ECATEPEC II",
      hireDate: "2022-01-10",
      active: true,
      schoolingDeclared: "LICENCIATURA EN PEDAGOGIA",
    };
    this.setWorker(w4);
    this.setTrajectory(w4.employeeId, [
      {
        recordId: "REC-010",
        trainingId: "kcm-course:induccion",
        courseName: "INDUCCION",
        completionDate: "2024-01-10",
        provenance: "XLSB_IMPORT",
        recordedAt: "2024-01-11T09:00:00Z",
        actor: "IMPORTACION_INICIAL",
      },
    ]);

    // 5. Trabajador con datos insuficientes (sin departamento ni área)
    const w5: WorkerRecord = {
      employeeId: parseWorkerNumber("01238"),
      name: "CARLOS RIVERA LÓPEZ",
      department: "",
      area: "",
      position: "OPERADOR GENERAL",
      plant: "MANTTO INGENIERIA",
      hireDate: "2023-05-01",
      active: true,
    };
    this.setWorker(w5);

    // 6. Trabajadora sin fecha de ingreso
    const w6: WorkerRecord = {
      employeeId: parseWorkerNumber("01239"),
      name: "LAURA TORRES MEJÍA",
      department: "OPERACION CONVERTIDORA",
      area: "LINEA 2",
      position: "EMPACADORA",
      hireDate: null,
      active: true,
    };
    this.setWorker(w6);
  }
}
