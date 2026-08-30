/**
 * Motor de evaluación DNC de la plataforma KCM Cap.
 */

import { resolveCourse, UNIFIED_COURSES } from "./catalog.js";
import { DncRuleRegistry, buildStandardDncRules } from "./rules.js";
import { assertEmployeeId } from "../contracts/contracts.js";

export const DNC_STATUSES = Object.freeze({
  COMPLETADO: "COMPLETADO",
  REFORZAR: "REFORZAR",
  PENDIENTE: "PENDIENTE",
  NO_APLICA: "NO_APLICA",
  DATOS_INSUFICIENTES: "DATOS_INSUFICIENTES",
  PROGRAMADO: "PROGRAMADO"
});

/**
 * Calcula la fecha de vencimiento dada una fecha de acreditación, meses de vigencia y días de gracia.
 */
export function calculateExpirationDate(completionDate, validityMonths = 12, graceDays = 0) {
  if (!completionDate) return null;
  const date = new Date(completionDate);
  if (Number.isNaN(date.getTime())) return null;

  // Añadir meses
  const exp = new Date(date.getTime());
  exp.setUTCMonth(exp.getUTCMonth() + validityMonths);

  // Añadir días de gracia si existen
  if (graceDays > 0) {
    exp.setUTCDate(exp.getUTCDate() + graceDays);
  }

  return exp.toISOString().slice(0, 10);
}

/**
 * Motor de evaluación DNC.
 */
export class DncEngine {
  constructor(ruleRegistry = new DncRuleRegistry()) {
    this.ruleRegistry = ruleRegistry;
  }

  /**
   * Evalúa la situación de un curso para un trabajador específico.
   *
   * @param {Object} params
   * @param {Object} params.employee - Objeto trabajador { employeeId, department, area, active }
   * @param {string} params.trainingIdentifier - Nombre, alias, trainingId o sourceKey del curso
   * @param {Object} [params.history] - Historial de acreditaciones { [trainingId]: completionDate } o fecha directa
   * @param {Object} [params.scheduledSessions] - Sesiones agendadas { [trainingId]: sessionId }
   * @param {Date|string} [params.asOfDate] - Fecha de corte para cálculo de vigencia (por defecto hoy)
   */
  evaluateCourseForEmployee({
    employee,
    trainingIdentifier,
    history = {},
    scheduledSessions = {},
    asOfDate = new Date()
  }) {
    const course = resolveCourse(trainingIdentifier);
    if (!course) {
      throw new Error(`Curso no reconocido en catálogo unificado: ${trainingIdentifier}`);
    }

    const evalDate = typeof asOfDate === "string" ? new Date(asOfDate) : asOfDate;
    const evalDateStr = evalDate.toISOString().slice(0, 10);

    // 1. Verificación de integridad de datos del trabajador
    if (!employee || !employee.employeeId) {
      return this._createResult({
        employeeId: employee?.employeeId ? String(employee.employeeId) : "00000",
        course,
        status: DNC_STATUSES.DATOS_INSUFICIENTES,
        isApplicable: false,
        evaluatedAt: evalDateStr,
        details: "Trabajador no especificado o identificador ausente"
      });
    }

    let employeeId;
    try {
      employeeId = assertEmployeeId(String(employee.employeeId).padStart(5, "0"));
    } catch {
      return this._createResult({
        employeeId: String(employee.employeeId),
        course,
        status: DNC_STATUSES.DATOS_INSUFICIENTES,
        isApplicable: false,
        evaluatedAt: evalDateStr,
        details: "Formato de identificador de trabajador inválido"
      });
    }

    // Si el trabajador carece de departamento Y de área, no es posible evaluar reglas
    const department = (employee.department || "").trim();
    const area = (employee.area || "").trim();

    if (!department && !area) {
      return this._createResult({
        employeeId,
        course,
        status: DNC_STATUSES.DATOS_INSUFICIENTES,
        isApplicable: false,
        evaluatedAt: evalDateStr,
        details: "Trabajador sin departamento ni área asignada (datos insuficientes)"
      });
    }

    // 2. Buscar regla de aplicabilidad en los dos niveles (Department y Area)
    const rule = this.ruleRegistry.findMatchingRule({
      trainingId: course.trainingId,
      department,
      area
    });

    if (!rule) {
      return this._createResult({
        employeeId,
        course,
        status: DNC_STATUSES.NO_APLICA,
        isApplicable: false,
        evaluatedAt: evalDateStr,
        details: `El curso no aplica para departamento '${department}' ni área '${area}'`
      });
    }

    // 3. Obtener fecha de acreditación histórica (si existe)
    let completionDate = null;
    if (typeof history === "string") {
      completionDate = history;
    } else if (typeof history === "object" && history !== null) {
      completionDate = history[course.trainingId] ||
        history[course.canonicalName] ||
        history[course.sourceKeys?.[0]] ||
        null;
    }

    // 4. Si tiene acreditación, evaluar vigencia
    if (completionDate) {
      const expirationDate = calculateExpirationDate(
        completionDate,
        rule.validityMonths,
        rule.graceDays
      );

      if (expirationDate && expirationDate >= evalDateStr) {
        return this._createResult({
          employeeId,
          course,
          rule,
          status: DNC_STATUSES.COMPLETADO,
          isApplicable: true,
          lastCompletionDate: completionDate,
          expirationDate,
          evaluatedAt: evalDateStr,
          details: `Acreditado vigente hasta ${expirationDate}`
        });
      } else {
        return this._createResult({
          employeeId,
          course,
          rule,
          status: DNC_STATUSES.REFORZAR,
          isApplicable: true,
          lastCompletionDate: completionDate,
          expirationDate,
          evaluatedAt: evalDateStr,
          details: `Vencido el ${expirationDate}. Requiere reforzamiento según regla de vigencia (${rule.validityMonths} meses).`
        });
      }
    }

    // 5. Si no está acreditado, verificar si está PROGRAMADO en la agenda
    const scheduledSessionId = scheduledSessions[course.trainingId] ||
      scheduledSessions[course.canonicalName] ||
      null;

    if (scheduledSessionId) {
      return this._createResult({
        employeeId,
        course,
        rule,
        status: DNC_STATUSES.PROGRAMADO,
        isApplicable: true,
        scheduledSessionId: String(scheduledSessionId),
        evaluatedAt: evalDateStr,
        details: `Programado en sesión ${scheduledSessionId}`
      });
    }

    // 6. Si aplica y no está acreditado ni programado, está PENDIENTE
    return this._createResult({
      employeeId,
      course,
      rule,
      status: DNC_STATUSES.PENDIENTE,
      isApplicable: true,
      evaluatedAt: evalDateStr,
      details: `Exigible por regla ${rule.ruleId} (${rule.level}: ${rule.targetValue})`
    });
  }

  /**
   * Evalúa la matriz completa de cursos para un trabajador.
   */
  evaluateAllCoursesForEmployee({
    employee,
    history = {},
    scheduledSessions = {},
    asOfDate = new Date()
  }) {
    return UNIFIED_COURSES.map((course) =>
      this.evaluateCourseForEmployee({
        employee,
        trainingIdentifier: course.trainingId,
        history,
        scheduledSessions,
        asOfDate
      })
    );
  }

  _createResult({
    employeeId,
    course,
    rule = null,
    status,
    isApplicable,
    lastCompletionDate = null,
    expirationDate = null,
    scheduledSessionId = null,
    evaluatedAt,
    details = ""
  }) {
    return Object.freeze({
      employeeId,
      trainingId: course.trainingId,
      canonicalCourseName: course.canonicalName,
      status,
      isApplicable,
      ruleId: rule ? rule.ruleId : null,
      ruleVersion: rule ? rule.ruleVersion : null,
      ruleLevel: rule ? rule.level : null,
      lastCompletionDate,
      expirationDate,
      scheduledSessionId,
      evaluatedAt,
      details
    });
  }
}

/**
 * Calcula métricas agregadas garantizando el aislamiento estricto de DATOS_INSUFICIENTES.
 *
 * Invariante de negocio:
 * DATOS_INSUFICIENTES nunca se suma a la base de cálculo de porcentajes.
 */
export function computeDncMetrics(evaluations = []) {
  let completados = 0;
  let reforzar = 0;
  let pendientes = 0;
  let programados = 0;
  let noAplica = 0;
  let datosInsuficientes = 0;

  for (const ev of evaluations) {
    switch (ev.status) {
      case DNC_STATUSES.COMPLETADO:
        completados++;
        break;
      case DNC_STATUSES.REFORZAR:
        reforzar++;
        break;
      case DNC_STATUSES.PENDIENTE:
        pendientes++;
        break;
      case DNC_STATUSES.PROGRAMADO:
        programados++;
        break;
      case DNC_STATUSES.NO_APLICA:
        noAplica++;
        break;
      case DNC_STATUSES.DATOS_INSUFICIENTES:
        datosInsuficientes++;
        break;
    }
  }

  // Población exigible para métrica de cumplimiento (excluye NO_APLICA y DATOS_INSUFICIENTES)
  const poblacionExigible = completados + reforzar + pendientes + programados;
  const porcentajeCumplimiento = poblacionExigible > 0
    ? Number(((completados / poblacionExigible) * 100).toFixed(2))
    : 0;

  return Object.freeze({
    totalEvaluaciones: evaluations.length,
    completados,
    reforzar,
    pendientes,
    programados,
    noAplica,
    datosInsuficientes,
    poblacionExigible,
    porcentajeCumplimiento,
    // Bandera explícita de auditoría
    publicacionAutorizada: false // Los porcentajes no se publican sin aprobación
  });
}
