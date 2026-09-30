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

export function calculateExpirationDate(completionDate, validityMonths = 12, graceDays = 0) {
  if (!completionDate) return null;
  const date = new Date(completionDate);
  if (Number.isNaN(date.getTime())) return null;

  const exp = new Date(date.getTime());
  exp.setUTCMonth(exp.getUTCMonth() + validityMonths);

  if (graceDays > 0) {
    exp.setUTCDate(exp.getUTCDate() + graceDays);
  }

  return exp.toISOString().slice(0, 10);
}

export class DncEngine {
  constructor(ruleRegistry = new DncRuleRegistry()) {
    this.ruleRegistry = ruleRegistry;
  }

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

    let completionDate = null;
    if (typeof history === "string") {
      completionDate = history;
    } else if (typeof history === "object" && history !== null) {
      completionDate = history[course.trainingId] ||
        history[course.canonicalName] ||
        history[course.sourceKeys?.[0]] ||
        null;
    }

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
    publicacionAutorizada: false
  });
}
