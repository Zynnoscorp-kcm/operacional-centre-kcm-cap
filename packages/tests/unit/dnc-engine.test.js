import assert from "node:assert/strict";
import test from "node:test";
import {
  DncEngine,
  DNC_STATUSES,
  computeDncMetrics,
  calculateExpirationDate
} from "../../dnc/engine.js";

test("calculateExpirationDate calcula correctamente vigencia y dias de gracia", () => {
  const exp1 = calculateExpirationDate("2025-01-15", 12, 0);
  assert.equal(exp1, "2026-01-15");

  const expGrace = calculateExpirationDate("2025-01-15", 12, 30);
  assert.equal(expGrace, "2026-02-14");

  assert.equal(calculateExpirationDate(null), null);
  assert.equal(calculateExpirationDate("fecha-invalida"), null);
});

test("evalua estado COMPLETADO cuando la acreditacion esta vigente", () => {
  const engine = new DncEngine();
  const employee = {
    employeeId: "12345",
    department: "HIGIENICOS",
    area: "CONVERSION"
  };

  // Curso acreditado hace 2 meses (vigencia 12 meses + 30 dias gracia)
  const result = engine.evaluateCourseForEmployee({
    employee,
    trainingIdentifier: "kcm-course:bpm",
    history: {
      "kcm-course:bpm": "2026-06-01"
    },
    asOfDate: "2026-08-01"
  });

  assert.equal(result.status, DNC_STATUSES.COMPLETADO);
  assert.equal(result.isApplicable, true);
  assert.ok(result.ruleId);
  assert.ok(result.expirationDate);
  assert.ok(result.expirationDate >= "2026-08-01");
});

test("evalua estado REFORZAR cuando la acreditacion ha expirado", () => {
  const engine = new DncEngine();
  const employee = {
    employeeId: "12345",
    department: "HIGIENICOS",
    area: "CONVERSION"
  };

  // Curso acreditado hace 2 años (vencido)
  const result = engine.evaluateCourseForEmployee({
    employee,
    trainingIdentifier: "kcm-course:bpm",
    history: {
      "kcm-course:bpm": "2024-01-15"
    },
    asOfDate: "2026-08-01"
  });

  assert.equal(result.status, DNC_STATUSES.REFORZAR);
  assert.equal(result.isApplicable, true);
  assert.ok(result.ruleId);
  assert.ok(result.expirationDate < "2026-08-01");
  assert.match(result.details, /Requiere reforzamiento/);
});

test("evalua estado PENDIENTE cuando el curso aplica pero no esta acreditado", () => {
  const engine = new DncEngine();
  const employee = {
    employeeId: "12345",
    department: "HIGIENICOS",
    area: "CONVERSION"
  };

  const result = engine.evaluateCourseForEmployee({
    employee,
    trainingIdentifier: "kcm-course:bpm",
    history: {},
    asOfDate: "2026-08-01"
  });

  assert.equal(result.status, DNC_STATUSES.PENDIENTE);
  assert.equal(result.isApplicable, true);
  assert.ok(result.ruleId);
});

test("evalua estado PROGRAMADO cuando existe una sesion agendada", () => {
  const engine = new DncEngine();
  const employee = {
    employeeId: "12345",
    department: "HIGIENICOS",
    area: "CONVERSION"
  };

  const result = engine.evaluateCourseForEmployee({
    employee,
    trainingIdentifier: "kcm-course:bpm",
    history: {},
    scheduledSessions: {
      "kcm-course:bpm": "ses-2026-08-15-sala1"
    },
    asOfDate: "2026-08-01"
  });

  assert.equal(result.status, DNC_STATUSES.PROGRAMADO);
  assert.equal(result.isApplicable, true);
  assert.equal(result.scheduledSessionId, "ses-2026-08-15-sala1");
});

test("evalua estado NO_APLICA cuando la regla no aplica al departamento o area", () => {
  const engine = new DncEngine();
  const employee = {
    employeeId: "12345",
    department: "GERENCIA ADMINISTRATIVA",
    area: "CONTABILIDAD"
  };

  // SISTEMA DE CONTROL DE MOTORES sólo aplica a GERENCIA DE MANTTO. ELECTRICO
  const result = engine.evaluateCourseForEmployee({
    employee,
    trainingIdentifier: "kcm-course:sistema-control-motores",
    history: {},
    asOfDate: "2026-08-01"
  });

  assert.equal(result.status, DNC_STATUSES.NO_APLICA);
  assert.equal(result.isApplicable, false);
  assert.equal(result.ruleId, null);
});

test("evalua estado DATOS_INSUFICIENTES si faltan departamento y area o el id es invalido", () => {
  const engine = new DncEngine();

  const noDeptArea = engine.evaluateCourseForEmployee({
    employee: { employeeId: "12345", department: "", area: "" },
    trainingIdentifier: "kcm-course:bpm"
  });
  assert.equal(noDeptArea.status, DNC_STATUSES.DATOS_INSUFICIENTES);
  assert.equal(noDeptArea.isApplicable, false);

  const invalidId = engine.evaluateCourseForEmployee({
    employee: { employeeId: "abc", department: "HIGIENICOS" },
    trainingIdentifier: "kcm-course:bpm"
  });
  assert.equal(invalidId.status, DNC_STATUSES.DATOS_INSUFICIENTES);
});

test("invariante de aislamiento de DATOS_INSUFICIENTES en calculo de metricas", () => {
  const evaluations = [
    { status: DNC_STATUSES.COMPLETADO },
    { status: DNC_STATUSES.COMPLETADO },
    { status: DNC_STATUSES.REFORZAR },
    { status: DNC_STATUSES.PENDIENTE },
    { status: DNC_STATUSES.PROGRAMADO },
    { status: DNC_STATUSES.NO_APLICA },
    { status: DNC_STATUSES.DATOS_INSUFICIENTES },
    { status: DNC_STATUSES.DATOS_INSUFICIENTES }
  ];

  const metrics = computeDncMetrics(evaluations);

  assert.equal(metrics.totalEvaluaciones, 8);
  assert.equal(metrics.completados, 2);
  assert.equal(metrics.reforzar, 1);
  assert.equal(metrics.pendientes, 1);
  assert.equal(metrics.programados, 1);
  assert.equal(metrics.noAplica, 1);
  assert.equal(metrics.datosInsuficientes, 2);

  // Población exigible = completados (2) + reforzar (1) + pendientes (1) + programados (1) = 5
  // Excluye noAplica (1) y datosInsuficientes (2)
  assert.equal(metrics.poblacionExigible, 5);

  // Porcentaje = 2 / 5 = 40%
  assert.equal(metrics.porcentajeCumplimiento, 40.0);
  assert.equal(metrics.publicacionAutorizada, false, "Los porcentajes nunca se publican de forma automática");
});
