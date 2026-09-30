import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStandardDncRules,
  DncRuleRegistry,
  TSV_QUALITY_PAIRS,
  DNC_RULE_LEVELS,
  CURRENT_DNC_RULES_VERSION
} from "../../dnc/rules.js";

test("compila exactamente los 128 pares del TSV a nivel DEPARTMENT", () => {
  assert.equal(TSV_QUALITY_PAIRS.length, 128, "El TSV contiene exactamente 128 pares curso-departamento");

  const rules = buildStandardDncRules();
  const deptRules = rules.filter((r) => r.level === DNC_RULE_LEVELS.DEPARTMENT);

  assert.equal(deptRules.length, 128, "Deben compilarse 128 reglas de nivel DEPARTMENT");
  deptRules.forEach((r) => {
    assert.equal(r.ruleVersion, CURRENT_DNC_RULES_VERSION);
    assert.equal(r.active, true);
    assert.equal(r.approvedBy, "CONTROL_CAPACITACION");
    assert.ok(r.validityMonths > 0);
  });
});

test("compila exactamente las 13 reglas tecnicas a nivel AREA", () => {
  const rules = buildStandardDncRules();
  const areaRules = rules.filter((r) => r.level === DNC_RULE_LEVELS.AREA);

  assert.equal(areaRules.length, 13, "Deben compilarse 13 reglas de nivel AREA");
  areaRules.forEach((r) => {
    assert.equal(r.targetValue, "GERENCIA DE MANTTO. ELECTRICO");
    assert.equal(r.ruleVersion, CURRENT_DNC_RULES_VERSION);
    assert.equal(r.active, true);
  });
});

test("total de reglas compiladas en v1.0.0 es 141 (128 de calidad + 13 tecnicas)", () => {
  const rules = buildStandardDncRules();
  assert.equal(rules.length, 141);
});

test("registro de reglas encuentra reglas por departamento y area", () => {
  const registry = new DncRuleRegistry();

  const higienicosRules = registry.getApplicableRulesForEmployee({
    department: "HIGIENICOS",
    area: ""
  });
  assert.ok(higienicosRules.length > 0);
  assert.ok(higienicosRules.some((r) => r.canonicalCourseName === "BUENAS PRACTICAS DE MANUFACTURA"));
  assert.ok(higienicosRules.some((r) => r.canonicalCourseName === "INSPECCION EN LINEA"));

  const electricoRules = registry.getApplicableRulesForEmployee({
    department: "GERENCIA DE MANTTO.",
    area: "GERENCIA DE MANTTO. ELECTRICO"
  });

  const technicalCount = electricoRules.filter((r) => r.level === DNC_RULE_LEVELS.AREA).length;
  assert.equal(technicalCount, 13, "El área eléctrica debe recibir los 13 cursos técnicos");
});

test("findMatchingRule resuelve la regla correspondiente a un curso especifico", () => {
  const registry = new DncRuleRegistry();

  const ruleBpm = registry.findMatchingRule({
    trainingId: "kcm-course:bpm",
    department: "HIGIENICOS",
    area: ""
  });
  assert.ok(ruleBpm);
  assert.equal(ruleBpm.level, DNC_RULE_LEVELS.DEPARTMENT);

  const ruleMotores = registry.findMatchingRule({
    trainingId: "kcm-course:sistema-control-motores",
    department: "GERENCIA DE MANTTO.",
    area: "GERENCIA DE MANTTO. ELECTRICO"
  });
  assert.ok(ruleMotores);
  assert.equal(ruleMotores.level, DNC_RULE_LEVELS.AREA);

  const ruleNoAplica = registry.findMatchingRule({
    trainingId: "kcm-course:sistema-control-motores",
    department: "GERENCIA ADMINISTRATIVA",
    area: "CONTABILIDAD"
  });
  assert.equal(ruleNoAplica, null);
});
