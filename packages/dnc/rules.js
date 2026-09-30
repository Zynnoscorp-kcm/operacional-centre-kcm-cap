import {
  UNIFIED_COURSES,
  COURSE_CATEGORIES,
  resolveCourse,
  normalizeCatalogKey
} from "./catalog.js";

export const DNC_RULE_LEVELS = Object.freeze({
  DEPARTMENT: "DEPARTMENT",
  AREA: "AREA"
});

export const CURRENT_DNC_RULES_VERSION = "1.0.0";

export const TSV_QUALITY_PAIRS = Object.freeze([
  { courseName: "INSPECCIÓN EN LINEA", department: "HIGIENICOS" },
  { courseName: "INSPECCIÓN EN LINEA", department: "FLEXOGRAFICA" },
  { courseName: "INSPECCIÓN EN LINEA", department: "SERVILLETAS Y FACIALES" },
  { courseName: "INSPECCIÓN EN LINEA", department: "MAQUINA PAÑUELERA" },
  { courseName: "INSPECCIÓN EN LINEA", department: "TOALLAS (CONVERSION)" },
  { courseName: "INSPECCIÓN EN LINEA", department: "GERENCIA TECNICA" },

  { courseName: "IMAGEN DE CALIDAD", department: "MAQUINA PAÑUELERA" },
  { courseName: "IMAGEN DE CALIDAD", department: "FLEXOGRAFICA" },
  { courseName: "IMAGEN DE CALIDAD", department: "SERVILLETAS Y FACIALES" },
  { courseName: "IMAGEN DE CALIDAD", department: "HIGIENICOS" },
  { courseName: "IMAGEN DE CALIDAD", department: "TOALLAS (CONVERSION)" },
  { courseName: "IMAGEN DE CALIDAD", department: "GERENCIA TECNICA" },

  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "MAQUINA WADDING 05" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "MAQUINA WADDING 02" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "MAQUINA PAÑUELERA" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "GERENCIA TECNICA" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "SERVILLETAS Y FACIALES" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "TOALLAS (CONVERSION)" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "MAQUINA 1" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "MAQUINA WADDING 03" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "HIGIENICOS" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "MAQUINA WADDING 04" },
  { courseName: "CONTROL DE PRODUCTO NO CONFORME", department: "FLEXOGRAFICA" },

  { courseName: "BPM", department: "MAQUINA 1" },
  { courseName: "BPM", department: "MAQUINA WADDING 05" },
  { courseName: "BPM", department: "AGUA" },
  { courseName: "BPM", department: "GERENCIA TECNICA" },
  { courseName: "BPM", department: "MAQUINA WADDING 02" },
  { courseName: "BPM", department: "CALDERAS" },
  { courseName: "BPM", department: "MAQUINA WADDING 03" },
  { courseName: "BPM", department: "GERENCIA DE CONTRALORIA" },
  { courseName: "BPM", department: "MAQUINA WADDING 04" },
  { courseName: "BPM", department: "HIGIENICOS" },
  { courseName: "BPM", department: "TOALLAS (CONVERSION)" },
  { courseName: "BPM", department: "GERENCIA DE MANTTO." },
  { courseName: "BPM", department: "GERENCIA ADMINISTRATIVA" },
  { courseName: "BPM", department: "PROCESO DE RECICLADO" },
  { courseName: "BPM", department: "SERVILLETAS Y FACIALES" },
  { courseName: "BPM", department: "MAQUINA PAÑUELERA" },
  { courseName: "BPM", department: "RELACIONES INDUSTRIALES" },
  { courseName: "BPM", department: "ALMACEN DE PRODUCTO TERMINADO" },
  { courseName: "BPM", department: "FLEXOGRAFICA" },
  { courseName: "BPM", department: "GERENCIA PLANTA" },
  { courseName: "BPM", department: "INGENIERIA DE PROYECTOS" },

  { courseName: "POLITICA DE CALIDAD", department: "MAQUINA WADDING 03" },
  { courseName: "POLITICA DE CALIDAD", department: "GERENCIA TECNICA" },
  { courseName: "POLITICA DE CALIDAD", department: "MAQUINA WADDING 05" },
  { courseName: "POLITICA DE CALIDAD", department: "FLEXOGRAFICA" },
  { courseName: "POLITICA DE CALIDAD", department: "GERENCIA DE CONTRALORIA" },
  { courseName: "POLITICA DE CALIDAD", department: "MAQUINA WADDING 04" },
  { courseName: "POLITICA DE CALIDAD", department: "MAQUINA 1" },
  { courseName: "POLITICA DE CALIDAD", department: "SERVILLETAS Y FACIALES" },
  { courseName: "POLITICA DE CALIDAD", department: "CALDERAS" },
  { courseName: "POLITICA DE CALIDAD", department: "TOALLAS (CONVERSION)" },
  { courseName: "POLITICA DE CALIDAD", department: "AGUA" },
  { courseName: "POLITICA DE CALIDAD", department: "GERENCIA DE MANTTO." },
  { courseName: "POLITICA DE CALIDAD", department: "GERENCIA ADMINISTRATIVA" },
  { courseName: "POLITICA DE CALIDAD", department: "INGENIERIA DE PROYECTOS" },
  { courseName: "POLITICA DE CALIDAD", department: "PROCESO DE RECICLADO" },
  { courseName: "POLITICA DE CALIDAD", department: "MAQUINA PAÑUELERA" },
  { courseName: "POLITICA DE CALIDAD", department: "MAQUINA WADDING 02" },
  { courseName: "POLITICA DE CALIDAD", department: "ALMACEN DE PRODUCTO TERMINADO" },
  { courseName: "POLITICA DE CALIDAD", department: "HIGIENICOS" },
  { courseName: "POLITICA DE CALIDAD", department: "RELACIONES INDUSTRIALES" },
  { courseName: "POLITICA DE CALIDAD", department: "GERENCIA PLANTA" },

  { courseName: "BPR", department: "MAQUINA WADDING 05" },
  { courseName: "BPR", department: "MAQUINA WADDING 03" },
  { courseName: "BPR", department: "GERENCIA TECNICA" },
  { courseName: "BPR", department: "MAQUINA WADDING 04" },
  { courseName: "BPR", department: "AGUA" },
  { courseName: "BPR", department: "CALDERAS" },
  { courseName: "BPR", department: "MAQUINA 1" },
  { courseName: "BPR", department: "TOALLAS (CONVERSION)" },
  { courseName: "BPR", department: "GERENCIA ADMINISTRATIVA" },
  { courseName: "BPR", department: "HIGIENICOS" },
  { courseName: "BPR", department: "GERENCIA DE MANTTO." },
  { courseName: "BPR", department: "SERVILLETAS Y FACIALES" },
  { courseName: "BPR", department: "PROCESO DE RECICLADO" },
  { courseName: "BPR", department: "MAQUINA PAÑUELERA" },
  { courseName: "BPR", department: "MAQUINA WADDING 02" },
  { courseName: "BPR", department: "ALMACEN DE PRODUCTO TERMINADO" },
  { courseName: "BPR", department: "FLEXOGRAFICA" },
  { courseName: "BPR", department: "GERENCIA DE CONTRALORIA" },
  { courseName: "BPR", department: "GERENCIA PLANTA" },
  { courseName: "BPR", department: "INGENIERIA DE PROYECTOS" },
  { courseName: "BPR", department: "RELACIONES INDUSTRIALES" },

  { courseName: "QMS", department: "MAQUINA WADDING 05" },
  { courseName: "QMS", department: "FLEXOGRAFICA" },
  { courseName: "QMS", department: "GERENCIA TECNICA" },
  { courseName: "QMS", department: "MAQUINA WADDING 02" },
  { courseName: "QMS", department: "SERVILLETAS Y FACIALES" },
  { courseName: "QMS", department: "TOALLAS (CONVERSION)" },
  { courseName: "QMS", department: "MAQUINA 1" },
  { courseName: "QMS", department: "PROCESO DE RECICLADO" },
  { courseName: "QMS", department: "GERENCIA DE MANTTO." },
  { courseName: "QMS", department: "MAQUINA WADDING 03" },
  { courseName: "QMS", department: "MAQUINA PAÑUELERA" },
  { courseName: "QMS", department: "MAQUINA WADDING 04" },
  { courseName: "QMS", department: "RELACIONES INDUSTRIALES" },
  { courseName: "QMS", department: "HIGIENICOS" },
  { courseName: "QMS", department: "ALMACEN DE PRODUCTO TERMINADO" },
  { courseName: "QMS", department: "GERENCIA ADMINISTRATIVA" },
  { courseName: "QMS", department: "AGUA" },
  { courseName: "QMS", department: "CALDERAS" },
  { courseName: "QMS", department: "GERENCIA DE CONTRALORIA" },
  { courseName: "QMS", department: "GERENCIA PLANTA" },
  { courseName: "QMS", department: "INGENIERIA DE PROYECTOS" },

  { courseName: "HACCP", department: "GERENCIA TECNICA" },
  { courseName: "HACCP", department: "MAQUINA WADDING 05" },
  { courseName: "HACCP", department: "CALDERAS" },
  { courseName: "HACCP", department: "AGUA" },
  { courseName: "HACCP", department: "MAQUINA WADDING 04" },
  { courseName: "HACCP", department: "MAQUINA WADDING 03" },
  { courseName: "HACCP", department: "MAQUINA 1" },
  { courseName: "HACCP", department: "MAQUINA PAÑUELERA" },
  { courseName: "HACCP", department: "GERENCIA DE MANTTO." },
  { courseName: "HACCP", department: "SERVILLETAS Y FACIALES" },
  { courseName: "HACCP", department: "PROCESO DE RECICLADO" },
  { courseName: "HACCP", department: "FLEXOGRAFICA" },
  { courseName: "HACCP", department: "HIGIENICOS" },
  { courseName: "HACCP", department: "TOALLAS (CONVERSION)" },
  { courseName: "HACCP", department: "GERENCIA ADMINISTRATIVA" },
  { courseName: "HACCP", department: "ALMACEN DE PRODUCTO TERMINADO" },
  { courseName: "HACCP", department: "MAQUINA WADDING 02" },
  { courseName: "HACCP", department: "GERENCIA DE CONTRALORIA" },
  { courseName: "HACCP", department: "GERENCIA PLANTA" },
  { courseName: "HACCP", department: "INGENIERIA DE PROYECTOS" },
  { courseName: "HACCP", department: "RELACIONES INDUSTRIALES" }
]);

export function buildStandardDncRules(version = CURRENT_DNC_RULES_VERSION) {
  const rules = [];
  let ruleSeq = 1;

  for (const pair of TSV_QUALITY_PAIRS) {
    const course = resolveCourse(pair.courseName);
    if (!course) {
      throw new Error(`Curso TSV no reconocido en catalogo canónico: ${pair.courseName}`);
    }

    rules.push(Object.freeze({
      ruleId: `dnc-rule:${version}:dept:${String(ruleSeq++).padStart(4, "0")}`,
      ruleVersion: version,
      trainingId: course.trainingId,
      canonicalCourseName: course.canonicalName,
      level: DNC_RULE_LEVELS.DEPARTMENT,
      targetValue: pair.department,
      normalizedTarget: normalizeCatalogKey(pair.department),
      validityMonths: course.defaultValidityMonths,
      graceDays: course.defaultGraceDays,
      active: true,
      approvedBy: "CONTROL_CAPACITACION",
      approvedAt: "2026-08-02T16:48:00.000Z"
    }));
  }

  const technicalCourses = UNIFIED_COURSES.filter(
    (c) => c.category === COURSE_CATEGORIES.TECHNICAL
  );

  for (const course of technicalCourses) {
    rules.push(Object.freeze({
      ruleId: `dnc-rule:${version}:area:${String(ruleSeq++).padStart(4, "0")}`,
      ruleVersion: version,
      trainingId: course.trainingId,
      canonicalCourseName: course.canonicalName,
      level: DNC_RULE_LEVELS.AREA,
      targetValue: "GERENCIA DE MANTTO. ELECTRICO",
      normalizedTarget: normalizeCatalogKey("GERENCIA DE MANTTO. ELECTRICO"),
      validityMonths: course.defaultValidityMonths,
      graceDays: course.defaultGraceDays,
      active: true,
      approvedBy: "CONTROL_CAPACITACION",
      approvedAt: "2026-08-02T16:48:00.000Z"
    }));
  }

  return Object.freeze(rules);
}

export class DncRuleRegistry {
  constructor(rules = buildStandardDncRules()) {
    this.rules = rules;
    this.rulesByTrainingId = new Map();
    this.rulesByDepartment = new Map();
    this.rulesByArea = new Map();

    for (const rule of this.rules) {
      if (!this.rulesByTrainingId.has(rule.trainingId)) {
        this.rulesByTrainingId.set(rule.trainingId, []);
      }
      this.rulesByTrainingId.get(rule.trainingId).push(rule);

      if (rule.level === DNC_RULE_LEVELS.DEPARTMENT) {
        if (!this.rulesByDepartment.has(rule.normalizedTarget)) {
          this.rulesByDepartment.set(rule.normalizedTarget, []);
        }
        this.rulesByDepartment.get(rule.normalizedTarget).push(rule);
      } else if (rule.level === DNC_RULE_LEVELS.AREA) {
        if (!this.rulesByArea.has(rule.normalizedTarget)) {
          this.rulesByArea.set(rule.normalizedTarget, []);
        }
        this.rulesByArea.get(rule.normalizedTarget).push(rule);
      }
    }
  }

  getApplicableRulesForEmployee({ department, area }) {
    const applicable = [];
    const normDept = normalizeCatalogKey(department);
    const normArea = normalizeCatalogKey(area);

    if (normDept && this.rulesByDepartment.has(normDept)) {
      applicable.push(...this.rulesByDepartment.get(normDept));
    }

    if (normArea && this.rulesByArea.has(normArea)) {
      applicable.push(...this.rulesByArea.get(normArea));
    }

    return applicable;
  }

  findMatchingRule({ trainingId, department, area }) {
    const course = resolveCourse(trainingId);
    if (!course) return null;

    const normDept = normalizeCatalogKey(department);
    const normArea = normalizeCatalogKey(area);

    const candidates = this.rulesByTrainingId.get(course.trainingId) || [];
    for (const rule of candidates) {
      if (!rule.active) continue;

      if (rule.level === DNC_RULE_LEVELS.DEPARTMENT && normDept && rule.normalizedTarget === normDept) {
        return rule;
      }
      if (rule.level === DNC_RULE_LEVELS.AREA && normArea && rule.normalizedTarget === normArea) {
        return rule;
      }
    }

    return null;
  }
}
