/**
 * Servicio de dominio para el Sistema General por Trabajador (Función 8).
 */

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

/**
 * Todas las claves bajo las que conviene guardar una acreditación.
 *
 * El motor busca el historial por `trainingId`, por nombre canónico y por la
 * primera `sourceKey`; la base lo entrega con su `clave_curso` y su nombre. Se
 * guarda bajo la identidad del catálogo y bajo las de la base, en vez de
 * escoger una: guardar de más es barato y no perder una acreditación es lo que
 * está en juego.
 */
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

  /**
   * Obtiene la lista de trabajadores con filtros opcionales.
   */
  async listWorkers(filter?: WorkerFilter): Promise<readonly WorkerRecord[]> {
    return this.repository.listWorkers(filter);
  }

  /**
   * Obtiene la ficha completa e individual de un trabajador con todas sus derivadas.
   */
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

    // Mapear el historial más reciente por curso
    const latestHistory: Record<string, string> = {};
    for (const item of trajectory) {
      // La clave se resuelve contra el catálogo antes de guardarla. El
      // historial llega con la identidad de la base —`clave_curso` y el nombre
      // tal como se escribió al importarlo— y el motor busca por la suya. Sin
      // esta traducción, «INSPECCIÓN EN LINEA» con acento no encontraba a
      // «INSPECCION EN LINEA» y el curso salía PENDIENTE aun estando acreditado:
      // la ficha reportaba menos de lo que la persona tiene. Los alias
      // aprobados viven en el catálogo desde E6; lo que faltaba era usarlos aquí.
      for (const clave of clavesDeHistorial(item.trainingId, item.courseName)) {
        const current = latestHistory[clave];
        if (!current || item.completionDate > current) {
          latestHistory[clave] = item.completionDate;
        }
      }
    }

    // Evaluar la matriz de cursos DNC
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

    // Métricas por trabajador (con aislamiento estricto de DATOS_INSUFICIENTES)
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
      publicacionAutorizada: false, // Invariante: no se publican porcentajes hasta aprobación
      notaPublicacion: "Porcentajes en validación por el Departamento de Capacitación",
    };

    /*
     * Aquí se derivaba el «plan del trimestre». Se retiró, y no sólo de la
     * pantalla: era la lista de cursos en REFORZAR y PENDIENTE —la misma que ya
     * publica `courseEvaluations`— con dos campos inventados encima. La
     * prioridad salía de una lista de cinco claves escrita a mano en este
     * archivo, y el trimestre sugerido era siempre el trimestre en curso, así
     * que no comprometía ninguna fecha. Nada de eso tenía respaldo en la base:
     * no hay tabla, vista ni función de plan trimestral en el esquema.
     *
     * Un plan de capacitación se aprueba y se firma. Cuando exista, va a ser una
     * tabla con su propio ciclo de vida, no un derivado de esta consulta.
     */
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

  /**
   * Cuántos compañeros de área tienen vigente cada curso que les aplica.
   *
   * Donde hay base la suma la base, en una consulta. En memoria se evalúa con
   * el motor a los compañeros del área, que son pocos. Si algo falla, la ficha
   * se dibuja sin la referencia: es un contexto para leer la telaraña, no un
   * dato por el que valga la pena dejar a alguien sin su ficha.
   */
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

  /**
   * Resumen por departamento para la plantilla completa.
   */
  async getDepartmentSummary(
    asOfDate: Date | string = new Date(),
  ): Promise<readonly DepartmentSummaryItem[]> {
    // Donde hay base, el resumen lo suma la base y no se traen los mil
    // setecientos trabajadores para contarlos aquí.
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
    // Historial y sesiones de toda la planta de una vez. Ver el puerto: por
    // trabajador, este resumen no llegaba a responder contra la base remota.
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

  /**
   * Perfil de cobertura por curso.
   */
  async getCourseCoverageSummary(
    asOfDate: Date | string = new Date(),
  ): Promise<readonly CourseCoverageSummaryItem[]> {
    // Igual que el resumen por departamento: donde hay base, cuenta la base.
    // El `trainingId` es la clave del curso en el catálogo unificado, y el
    // identificador de la regla se compone del nivel, que es lo único que la
    // pantalla usa para decir si el curso se exige por área o por departamento.
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

  /**
   * Comparativa de planta estructurada.
   */
  async getPlantComparisonReport(
    asOfDate: Date | string = new Date(),
  ): Promise<PlantComparisonReport> {
    const departments = await this.getDepartmentSummary(asOfDate);
    // La plantilla ya viene contada dentro del resumen: pedir otra vez la lista
    // completa sólo para saber cuántos son costaría los mil setecientos
    // renglones que este cambio precisamente evita traer.
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
