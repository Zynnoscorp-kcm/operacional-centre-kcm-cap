import { DncEngine, UNIFIED_COURSES, resolveCourse } from "../../../../packages/dnc/index.js";
import type { WorkerNumber } from "../comun/numero-trabajador.ts";
import type {
  WorkerSystemRepositoryPort,
  WorkerFilter,
} from "../../ports/sistema-trabajador.port.ts";
import { calculateSeniority } from "./antiguedad.ts";
import { deriveCategoryFromPosition } from "./reglas-de-categoria.ts";
import { deriveSchooling } from "./escolaridad.ts";
import { generatePhotoPlaceholder } from "./foto.ts";
import type {
  AreaCourseCompletion,
  DerivedWorkerProfile,
  WorkerRecord,
  WorkerCourseEvaluation,
  WorkerEvaluationMetrics,
  DepartmentSummaryItem,
  CourseCoverageSummaryItem,
  PlantComparisonReport,
  DncStatus,
} from "./tipos.ts";

function clavesDeHistorial(trainingId: string, courseName: string): readonly string[] {
  const claves = new Set<string>();
  for (const bruta of [trainingId, courseName]) {
    if (!bruta) continue;
    claves.add(bruta);
    const curso = resolveCourse(bruta);
    if (curso) {
      claves.add(curso.trainingId);
      claves.add(curso.canonicalName);
    }
  }
  return [...claves];
}

export class WorkerSystemService {
  private readonly repository: WorkerSystemRepositoryPort;
  private readonly dncEngine: DncEngine;

  constructor(repository: WorkerSystemRepositoryPort, dncEngine = new DncEngine()) {
    this.repository = repository;
    this.dncEngine = dncEngine;
  }

  async listWorkers(filter?: WorkerFilter): Promise<readonly WorkerRecord[]> {
    return this.repository.listWorkers(filter);
  }

  async getWorkerProfile(
    workerNumber: WorkerNumber,
    asOfDate: Date | string = new Date(),
  ): Promise<DerivedWorkerProfile | null> {
    const worker = await this.repository.getWorkerByNumber(workerNumber);
    if (!worker) {
      return null;
    }

    const seniority = calculateSeniority(worker.hireDate, asOfDate);
    const category = deriveCategoryFromPosition(worker.position);
    const schooling = deriveSchooling(worker.schoolingDeclared);
    const photo = generatePhotoPlaceholder(worker.name, worker.employeeId);

    const trajectory = await this.repository.getWorkerTrainingHistory(workerNumber);
    const scheduledSessions = await this.repository.getWorkerScheduledSessions(workerNumber);
    const dc3Log = await this.repository.getWorkerDc3Records(workerNumber);

    const latestHistory: Record<string, string> = {};
    for (const item of trajectory) {
      for (const clave of clavesDeHistorial(item.trainingId, item.courseName)) {
        const current = latestHistory[clave];
        if (!current || item.completionDate > current) {
          latestHistory[clave] = item.completionDate;
        }
      }
    }

    const rawEvaluations = this.dncEngine.evaluateAllCoursesForEmployee({
      employee: {
        employeeId: worker.employeeId,
        department: worker.department,
        area: worker.area,
        active: worker.active,
      },
      history: latestHistory,
      scheduledSessions,
      asOfDate,
    });

    const courseEvaluations: WorkerCourseEvaluation[] = rawEvaluations.map((ev) => ({
      employeeId: worker.employeeId,
      trainingId: ev.trainingId,
      canonicalCourseName: ev.canonicalCourseName,
      status: ev.status as DncStatus,
      isApplicable: Boolean(ev.isApplicable),
      ruleId: ev.ruleId ?? null,
      ruleVersion: ev.ruleVersion ?? null,
      ruleLevel: ev.ruleLevel as "DEPARTMENT" | "AREA" | null,
      lastCompletionDate: ev.lastCompletionDate ?? null,
      expirationDate: ev.expirationDate ?? null,
      scheduledSessionId: ev.scheduledSessionId ?? null,
      evaluatedAt: ev.evaluatedAt,
      details: ev.details,
    }));

    let completados = 0;
    let reforzar = 0;
    let pendientes = 0;
    let programados = 0;
    let noAplica = 0;
    let datosInsuficientes = 0;

    for (const ev of courseEvaluations) {
      switch (ev.status) {
        case "COMPLETADO":
          completados++;
          break;
        case "REFORZAR":
          reforzar++;
          break;
        case "PENDIENTE":
          pendientes++;
          break;
        case "PROGRAMADO":
          programados++;
          break;
        case "NO_APLICA":
          noAplica++;
          break;
        case "DATOS_INSUFICIENTES":
          datosInsuficientes++;
          break;
      }
    }

    const applicableCourses = completados + reforzar + pendientes + programados;
    const porcentajeCumplimiento =
      applicableCourses > 0 ? Number(((completados / applicableCourses) * 100).toFixed(2)) : 0;

    const metrics: WorkerEvaluationMetrics = {
      totalCourses: courseEvaluations.length,
      applicableCourses,
      completados,
      reforzar,
      pendientes,
      programados,
      noAplica,
      datosInsuficientes,
      porcentajeCumplimiento,
      publicacionAutorizada: false,
      notaPublicacion: "Porcentajes en validación por el Departamento de Capacitación",
    };

    const areaComparison = await this.#comparacionDeArea(worker, asOfDate);

    return {
      worker,
      seniority,
      category,
      schooling,
      photo,
      courseEvaluations,
      metrics,
      trajectory,
      dc3Log,
      ...(areaComparison ? { areaComparison } : {}),
    };
  }

  async #comparacionDeArea(
    worker: WorkerRecord,
    asOfDate: Date | string,
  ): Promise<readonly AreaCourseCompletion[] | undefined> {
    try {
      if (this.repository.getAreaCourseCompletion) {
        const filas = await this.repository.getAreaCourseCompletion(worker.employeeId);
        return filas.flatMap((fila) => {
          const curso = resolveCourse(fila.courseKey) ?? resolveCourse(fila.courseName);
          return curso
            ? [
                {
                  trainingId: curso.trainingId,
                  applicable: fila.applicable,
                  completed: fila.completed,
                },
              ]
            : [];
        });
      }

      if (!worker.area) return undefined;
      const [companeros, historialPorTrabajador, sesionesPorTrabajador] = await Promise.all([
        this.repository.listWorkers({ area: worker.area, activeOnly: true }),
        this.repository.getLatestTrainingByWorker(),
        this.repository.getScheduledSessionsByWorker(),
      ]);

      const cuentas = new Map<string, { applicable: number; completed: number }>();
      for (const companero of companeros) {
        if (companero.area !== worker.area) continue;
        const historial: Record<string, string> = {};
        for (const [curso, fecha] of Object.entries(
          historialPorTrabajador.get(String(companero.employeeId)) ?? {},
        )) {
          for (const clave of clavesDeHistorial(curso, curso)) {
            const actual = historial[clave];
            if (!actual || fecha > actual) historial[clave] = fecha;
          }
        }
        const evaluaciones = this.dncEngine.evaluateAllCoursesForEmployee({
          employee: {
            employeeId: companero.employeeId,
            department: companero.department,
            area: companero.area,
            active: companero.active,
          },
          history: historial,
          scheduledSessions: sesionesPorTrabajador.get(String(companero.employeeId)) ?? {},
          asOfDate,
        });
        for (const evaluacion of evaluaciones) {
          if (!evaluacion.isApplicable) continue;
          const cuenta = cuentas.get(evaluacion.trainingId) ?? { applicable: 0, completed: 0 };
          cuenta.applicable += 1;
          if (evaluacion.status === "COMPLETADO") cuenta.completed += 1;
          cuentas.set(evaluacion.trainingId, cuenta);
        }
      }
      return [...cuentas].map(([trainingId, cuenta]) => ({ trainingId, ...cuenta }));
    } catch {
      return undefined;
    }
  }

  async getDepartmentSummary(
    asOfDate: Date | string = new Date(),
  ): Promise<readonly DepartmentSummaryItem[]> {
    if (this.repository.getDncSummaryByDepartment) {
      const filas = await this.repository.getDncSummaryByDepartment();
      return filas
        .map((fila) => ({
          department: fila.departamento,
          activeWorkersCount: fila.trabajadoresActivos,
          completadosCount: fila.completados,
          reforzarCount: fila.reforzar,
          pendientesCount: fila.pendientes,
          programadosCount: fila.programados,
          datosInsuficientesCount: fila.datosInsuficientes,
          publicacionAutorizada: false,
        }))
        .sort((a, b) => a.department.localeCompare(b.department));
    }

    const workers = await this.repository.listWorkers({ activeOnly: true });
    const departments = await this.repository.listDepartments();
    const [historialPorTrabajador, sesionesPorTrabajador] = await Promise.all([
      this.repository.getLatestTrainingByWorker(),
      this.repository.getScheduledSessionsByWorker(),
    ]);

    const summaryMap = new Map<
      string,
      {
        activeWorkersCount: number;
        completadosCount: number;
        reforzarCount: number;
        pendientesCount: number;
        programadosCount: number;
        datosInsuficientesCount: number;
      }
    >();

    for (const dep of departments) {
      summaryMap.set(dep, {
        activeWorkersCount: 0,
        completadosCount: 0,
        reforzarCount: 0,
        pendientesCount: 0,
        programadosCount: 0,
        datosInsuficientesCount: 0,
      });
    }

    for (const worker of workers) {
      const dep = worker.department || "SIN_DEPARTAMENTO";
      let current = summaryMap.get(dep);
      if (!current) {
        current = {
          activeWorkersCount: 0,
          completadosCount: 0,
          reforzarCount: 0,
          pendientesCount: 0,
          programadosCount: 0,
          datosInsuficientesCount: 0,
        };
        summaryMap.set(dep, current);
      }

      current.activeWorkersCount += 1;

      const latestHistory = historialPorTrabajador.get(String(worker.employeeId)) ?? {};
      const scheduledSessions = sesionesPorTrabajador.get(String(worker.employeeId)) ?? {};

      const evaluations = this.dncEngine.evaluateAllCoursesForEmployee({
        employee: {
          employeeId: worker.employeeId,
          department: worker.department,
          area: worker.area,
          active: worker.active,
        },
        history: latestHistory,
        scheduledSessions,
        asOfDate,
      });

      for (const ev of evaluations) {
        if (ev.status === "COMPLETADO") current.completadosCount += 1;
        else if (ev.status === "REFORZAR") current.reforzarCount += 1;
        else if (ev.status === "PENDIENTE") current.pendientesCount += 1;
        else if (ev.status === "PROGRAMADO") current.programadosCount += 1;
        else if (ev.status === "DATOS_INSUFICIENTES") current.datosInsuficientesCount += 1;
      }
    }

    const result: DepartmentSummaryItem[] = [];
    for (const [dep, stats] of summaryMap.entries()) {
      result.push({
        department: dep,
        activeWorkersCount: stats.activeWorkersCount,
        completadosCount: stats.completadosCount,
        reforzarCount: stats.reforzarCount,
        pendientesCount: stats.pendientesCount,
        programadosCount: stats.programadosCount,
        datosInsuficientesCount: stats.datosInsuficientesCount,
        publicacionAutorizada: false,
      });
    }

    return result.sort((a, b) => a.department.localeCompare(b.department));
  }

  async getCourseCoverageSummary(
    asOfDate: Date | string = new Date(),
  ): Promise<readonly CourseCoverageSummaryItem[]> {
    if (this.repository.getDncSummaryByCourse) {
      const filas = await this.repository.getDncSummaryByCourse();
      return filas
        .map((fila) => ({
          trainingId: fila.claveCurso,
          canonicalName: fila.curso,
          ruleLevel: fila.nivelRegla,
          ruleId: fila.nivelRegla === "AREA" ? "REG-DNC-AREA-V1" : "REG-DNC-DEP-V1",
          ruleVersion: "1.0.0",
          applicableWorkersCount: fila.aplicables,
          completadosCount: fila.completados,
          reforzarCount: fila.reforzar,
          pendientesCount: fila.pendientes,
          programadosCount: fila.programados,
          publicacionAutorizada: false,
        }))
        .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    }

    const workers = await this.repository.listWorkers({ activeOnly: true });
    const [historialPorTrabajador, sesionesPorTrabajador] = await Promise.all([
      this.repository.getLatestTrainingByWorker(),
      this.repository.getScheduledSessionsByWorker(),
    ]);

    const coverageMap = new Map<
      string,
      {
        trainingId: string;
        canonicalName: string;
        ruleLevel: "DEPARTMENT" | "AREA";
        ruleId: string;
        ruleVersion: string;
        applicableWorkersCount: number;
        completadosCount: number;
        reforzarCount: number;
        pendientesCount: number;
        programadosCount: number;
      }
    >();

    for (const course of UNIFIED_COURSES) {
      coverageMap.set(course.trainingId, {
        trainingId: course.trainingId,
        canonicalName: course.canonicalName,
        ruleLevel: course.isTechnical ? "AREA" : "DEPARTMENT",
        ruleId: course.isTechnical ? "REG-DNC-AREA-V1" : "REG-DNC-DEP-V1",
        ruleVersion: "1.0.0",
        applicableWorkersCount: 0,
        completadosCount: 0,
        reforzarCount: 0,
        pendientesCount: 0,
        programadosCount: 0,
      });
    }

    for (const worker of workers) {
      const latestHistory = historialPorTrabajador.get(String(worker.employeeId)) ?? {};
      const scheduledSessions = sesionesPorTrabajador.get(String(worker.employeeId)) ?? {};

      const evaluations = this.dncEngine.evaluateAllCoursesForEmployee({
        employee: {
          employeeId: worker.employeeId,
          department: worker.department,
          area: worker.area,
          active: worker.active,
        },
        history: latestHistory,
        scheduledSessions,
        asOfDate,
      });

      for (const ev of evaluations) {
        const summary = coverageMap.get(ev.trainingId);
        if (!summary) continue;

        if (ev.isApplicable) {
          summary.applicableWorkersCount += 1;
        }
        if (ev.status === "COMPLETADO") summary.completadosCount += 1;
        else if (ev.status === "REFORZAR") summary.reforzarCount += 1;
        else if (ev.status === "PENDIENTE") summary.pendientesCount += 1;
        else if (ev.status === "PROGRAMADO") summary.programadosCount += 1;
      }
    }

    const result: CourseCoverageSummaryItem[] = [];
    for (const stats of coverageMap.values()) {
      result.push({
        ...stats,
        publicacionAutorizada: false,
      });
    }

    return result.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  }

  async getPlantComparisonReport(
    asOfDate: Date | string = new Date(),
  ): Promise<PlantComparisonReport> {
    const departments = await this.getDepartmentSummary(asOfDate);
    const totalWorkers = departments.reduce((total, dep) => total + dep.activeWorkersCount, 0);

    return {
      totalWorkers,
      totalDepartments: departments.length,
      generatedAt: (typeof asOfDate === "string" ? new Date(asOfDate) : asOfDate)
        .toISOString()
        .slice(0, 10),
      departments,
      publicacionAutorizada: false,
    };
  }
}
