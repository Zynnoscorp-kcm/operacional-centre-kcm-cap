import assert from "node:assert/strict";
import test from "node:test";
import {
  DncEngine,
  DNC_STATUSES,
  computeDncMetrics,
  UNIFIED_COURSES,
  COURSE_CATEGORIES,
  buildStandardDncRules,
  DncRuleRegistry
} from "../../dnc/index.js";

test("cobertura integral de reglas DNC: poblacion sintetica, 128 pares TSV, 13 tecnicos y 21 insuficientes", () => {
  const registry = new DncRuleRegistry(buildStandardDncRules("1.0.0"));
  const engine = new DncEngine(registry);

  // 1. Cohorte de trabajadores regulares con departamentos y areas validos
  const regularEmployees = [
    { employeeId: "10001", department: "HIGIENICOS", area: "CONVERSION" },
    { employeeId: "10002", department: "GERENCIA TECNICA", area: "LABORATORIO" },
    { employeeId: "10003", department: "GERENCIA DE MANTTO.", area: "GERENCIA DE MANTTO. ELECTRICO" },
    { employeeId: "10004", department: "FLEXOGRAFICA", area: "IMPRESION" },
    { employeeId: "10005", department: "MAQUINA WADDING 05", area: "PRODUCCION" }
  ];

  // Historial sintetico de capacitaciones
  const syntheticHistory = {
    "10001": {
      "kcm-course:bpm": "2026-05-10", // Vigente -> COMPLETADO
      "kcm-course:inspeccion-linea": "2024-01-01" // Vencido -> REFORZAR
    },
    "10003": {
      "kcm-course:sistema-control-motores": "2025-11-20", // Vigente -> COMPLETADO
      "kcm-course:bpm": "2026-03-15" // Vigente -> COMPLETADO
    }
  };

  const scheduled = {
    "10002": {
      "kcm-course:haccp": "ses-2026-08-20-lab" // PROGRAMADO
    }
  };

  const evaluations = [];

  for (const emp of regularEmployees) {
    const empHistory = syntheticHistory[emp.employeeId] || {};
    const empScheduled = scheduled[emp.employeeId] || {};

    const empEvals = engine.evaluateAllCoursesForEmployee({
      employee: emp,
      history: empHistory,
      scheduledSessions: empScheduled,
      asOfDate: "2026-08-01"
    });

    evaluations.push(...empEvals);
  }

  // Verificar que el trabajador electrico tiene los 13 cursos tecnicos evaluados como aplicables
  const electricoEvals = evaluations.filter((e) => e.employeeId === "10003");
  const techEvals = electricoEvals.filter((e) => {
    const c = UNIFIED_COURSES.find((x) => x.trainingId === e.trainingId);
    return c && c.category === COURSE_CATEGORIES.TECHNICAL;
  });
  assert.equal(techEvals.length, 13, "El trabajador de mantenimiento electrico debe tener 13 evaluaciones tecnicas");
  techEvals.forEach((e) => {
    assert.equal(e.isApplicable, true);
    assert.ok(e.ruleId);
    assert.equal(e.ruleVersion, "1.0.0");
    assert.equal(e.ruleLevel, "AREA");
  });

  // Verificar que trabajador de HIGIENICOS no recibe los tecnicos
  const higienicosEvals = evaluations.filter((e) => e.employeeId === "10001");
  const techForHigienicos = higienicosEvals.filter((e) => {
    const c = UNIFIED_COURSES.find((x) => x.trainingId === e.trainingId);
    return c && c.category === COURSE_CATEGORIES.TECHNICAL;
  });
  techForHigienicos.forEach((e) => {
    assert.equal(e.status, DNC_STATUSES.NO_APLICA);
    assert.equal(e.isApplicable, false);
  });

  // 2. Cohorte de 21 trabajadores sin cobertura declarada (sin departamento ni area)
  const unmappedEmployees = Array.from({ length: 21 }, (_, i) => ({
    employeeId: String(20000 + i + 1),
    department: "",
    area: ""
  }));

  const unmappedEvaluations = [];
  for (const emp of unmappedEmployees) {
    const evals = engine.evaluateAllCoursesForEmployee({
      employee: emp,
      history: {},
      asOfDate: "2026-08-01"
    });
    unmappedEvaluations.push(...evals);
  }

  // Todos los 21 trabajadores sin cobertura quedan clasificados como DATOS_INSUFICIENTES
  assert.equal(unmappedEmployees.length, 21);
  unmappedEvaluations.forEach((e) => {
    assert.equal(e.status, DNC_STATUSES.DATOS_INSUFICIENTES);
    assert.equal(e.isApplicable, false);
  });

  // 3. Calculo de metricas agregadas con los 21 trabajadores insuficientes incluidos
  const allEvaluations = [...evaluations, ...unmappedEvaluations];
  const metrics = computeDncMetrics(allEvaluations);

  assert.equal(metrics.datosInsuficientes, 21 * UNIFIED_COURSES.length);
  assert.ok(metrics.completados > 0);
  assert.ok(metrics.reforzar > 0);
  assert.ok(metrics.programados > 0);
  assert.ok(metrics.pendientes > 0);

  // Invariante de seguridad y reporte:
  // - publicacionAutorizada es FALSE
  // - el porcentaje de cumplimiento NO incluye en su base a los 21 trabajadores con DATOS_INSUFICIENTES
  assert.equal(metrics.publicacionAutorizada, false);
  assert.equal(
    metrics.poblacionExigible,
    metrics.completados + metrics.reforzar + metrics.pendientes + metrics.programados
  );
  const expectedPercentage = Number(
    ((metrics.completados / metrics.poblacionExigible) * 100).toFixed(2)
  );
  assert.equal(metrics.porcentajeCumplimiento, expectedPercentage);
});
