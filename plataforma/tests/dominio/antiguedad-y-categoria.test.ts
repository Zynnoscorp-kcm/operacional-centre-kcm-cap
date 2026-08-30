import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { calculateSeniority } from "../../src/domain/sistema-trabajador/antiguedad.ts";
import {
  deriveCategoryFromPosition,
  CATEGORY_RULE_V1,
} from "../../src/domain/sistema-trabajador/reglas-de-categoria.ts";
import { deriveSchooling } from "../../src/domain/sistema-trabajador/escolaridad.ts";
import { generatePhotoPlaceholder } from "../../src/domain/sistema-trabajador/foto.ts";

describe("Cálculo de Antigüedad Laboral", () => {
  it("calcula años y meses exactos para fechas válidas", () => {
    const res = calculateSeniority("2018-03-15", "2026-08-02");
    assert.equal(res.isAvailable, true);
    assert.equal(res.years, 8);
    assert.equal(res.months, 4);
    assert.equal(res.formatted, "8 años, 4 meses");
  });

  it("formatea correctamente singular '1 año, 1 mes'", () => {
    const res = calculateSeniority("2025-07-02", "2026-08-02");
    assert.equal(res.years, 1);
    assert.equal(res.months, 1);
    assert.equal(res.formatted, "1 año, 1 mes");
  });

  it("devuelve 'Menos de 1 mes' para ingresos muy recientes", () => {
    const res = calculateSeniority("2026-08-01", "2026-08-02");
    assert.equal(res.years, 0);
    assert.equal(res.months, 0);
    assert.equal(res.formatted, "Menos de 1 mes");
  });

  it("maneja de forma segura valores nulos, indefinidos o vacíos", () => {
    const resNull = calculateSeniority(null);
    assert.equal(resNull.isAvailable, false);
    assert.equal(resNull.formatted, "Fecha de ingreso no disponible");

    const resUndef = calculateSeniority(undefined);
    assert.equal(resUndef.isAvailable, false);

    const resEmpty = calculateSeniority("");
    assert.equal(resEmpty.isAvailable, false);
  });

  it("maneja fechas inválidas sin lanzar excepciones", () => {
    const res = calculateSeniority("fecha-no-valida");
    assert.equal(res.isAvailable, false);
    assert.equal(res.formatted, "Fecha de ingreso inválida");
  });
});

describe("Reglas Versionadas de Categoría (REG-CAT-2026-V1)", () => {
  it("clasifica puestos gerenciales y directivos", () => {
    const g1 = deriveCategoryFromPosition("GERENTE DE PLANTA");
    assert.equal(g1.category, "GERENCIAL");
    assert.equal(g1.ruleId, CATEGORY_RULE_V1.ruleId);
    assert.equal(g1.ruleVersion, CATEGORY_RULE_V1.ruleVersion);

    const g2 = deriveCategoryFromPosition("SUPERINTENDENTE DE PRODUCCION");
    assert.equal(g2.category, "GERENCIAL");
  });

  it("clasifica puestos de mandos medios y supervisión", () => {
    const s1 = deriveCategoryFromPosition("SUPERVISOR DE TURNO");
    assert.equal(s1.category, "MANDO_MEDIO");

    const s2 = deriveCategoryFromPosition("COORDINADOR DE CALIDAD");
    assert.equal(s2.category, "MANDO_MEDIO");
  });

  it("clasifica puestos técnicos especializados", () => {
    const t1 = deriveCategoryFromPosition("TECNICO INSTRUMENTISTA");
    assert.equal(t1.category, "TECNICO");

    const t2 = deriveCategoryFromPosition("MECANICO DE CONVERTIDORA");
    assert.equal(t2.category, "TECNICO");

    const t3 = deriveCategoryFromPosition("ELECTRICO ESPECIALISTA");
    assert.equal(t3.category, "TECNICO");
  });

  it("clasifica puestos administrativos y soporte", () => {
    const a1 = deriveCategoryFromPosition("ANALISTA DE CAPACITACION");
    assert.equal(a1.category, "ADMINISTRATIVO");

    const a2 = deriveCategoryFromPosition("AUXILIAR ADMINISTRATIVO");
    assert.equal(a2.category, "ADMINISTRATIVO");
  });

  it("asigna OPERATIVO por omisión a puestos generales de línea", () => {
    const o1 = deriveCategoryFromPosition("OPERADOR DE MAQUINA");
    assert.equal(o1.category, "OPERATIVO");

    const o2 = deriveCategoryFromPosition("AYUDANTE GENERAL");
    assert.equal(o2.category, "OPERATIVO");

    const o3 = deriveCategoryFromPosition("");
    assert.equal(o3.category, "OPERATIVO");
  });
});

describe("Escolaridad Declarada por Omisión", () => {
  it("marca SECUNDARIA por omisión cuando no se especifica", () => {
    const res = deriveSchooling();
    assert.equal(res.level, "SECUNDARIA");
    assert.equal(res.isDeclaredByDefault, true);
    assert.match(res.disclaimer, /omisión/i);
  });

  it("respeta escolaridad explícita cuando existe", () => {
    const res = deriveSchooling("LICENCIATURA EN PEDAGOGIA");
    assert.equal(res.level, "LICENCIATURA EN PEDAGOGIA");
    assert.equal(res.isDeclaredByDefault, false);
  });
});

describe("Marcador de Posición Visual para Fotos", () => {
  it("genera iniciales y color determinista sin imágenes externas", () => {
    const p1 = generatePhotoPlaceholder("JUAN PEREZ", "01234");
    assert.equal(p1.initials, "JP");
    assert.ok(p1.accentColor.startsWith("#"));

    const p2 = generatePhotoPlaceholder("MARIA LOPEZ", "01235");
    assert.equal(p2.initials, "ML");
  });
});
