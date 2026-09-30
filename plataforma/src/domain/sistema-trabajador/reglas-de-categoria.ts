import type { DerivedCategory } from "./tipos.ts";

export const CATEGORY_RULE_V1 = {
  ruleId: "REG-CAT-2026-V1",
  ruleVersion: "1.0.0",
  description: "Clasificación de puestos de planta en 5 categorías estándar KCM",
} as const;

export function deriveCategoryFromPosition(position: string | null | undefined): DerivedCategory {
  const cleanPos = (position ?? "").trim().toUpperCase();

  if (!cleanPos) {
    return {
      category: "OPERATIVO",
      ruleId: CATEGORY_RULE_V1.ruleId,
      ruleVersion: CATEGORY_RULE_V1.ruleVersion,
      sourcePosition: "(Sin puesto registrado)",
      description: "Asignado por omisión debido a puesto no especificado",
    };
  }

  let category: DerivedCategory["category"];
  let explanation: string;

  if (
    cleanPos.includes("GERENTE") ||
    cleanPos.includes("SUPERINTENDENTE") ||
    cleanPos.includes("DIRECTOR")
  ) {
    category = "GERENCIAL";
    explanation = "Puesto directivo o de gestión de área/departamento";
  } else if (
    cleanPos.includes("SUPERVISOR") ||
    cleanPos.includes("COORDINADOR") ||
    cleanPos.includes("FACILITADOR") ||
    cleanPos.includes("JEFE") ||
    cleanPos.includes("LIDER")
  ) {
    category = "MANDO_MEDIO";
    explanation = "Mando medio de operación, mantenimiento o calidad";
  } else if (
    cleanPos.includes("MECANICO") ||
    cleanPos.includes("MECÁNICO") ||
    cleanPos.includes("ELECTRICO") ||
    cleanPos.includes("ELÉCTRICO") ||
    cleanPos.includes("INSTRUMENTISTA") ||
    cleanPos.includes("TECNICO") ||
    cleanPos.includes("TÉCNICO") ||
    cleanPos.includes("SOLDADOR") ||
    cleanPos.includes("TORNERO") ||
    cleanPos.includes("PAILERO") ||
    cleanPos.includes("ELECTRONICO") ||
    cleanPos.includes("ELECTRÓNICO") ||
    cleanPos.includes("LUBRICADOR") ||
    cleanPos.includes("ESPECIALISTA")
  ) {
    category = "TECNICO";
    explanation = "Personal técnico calificado de mantenimiento o soporte de planta";
  } else if (
    cleanPos.includes("ANALISTA") ||
    cleanPos.includes("ASISTENTE") ||
    cleanPos.includes("AUXILIAR") ||
    cleanPos.includes("PLANEADOR") ||
    cleanPos.includes("SECRETARIA") ||
    cleanPos.includes("CAPTURISTA") ||
    cleanPos.includes("PROGRAMADOR")
  ) {
    category = "ADMINISTRATIVO";
    explanation = "Personal administrativo, de planeación o soporte documental";
  } else {
    category = "OPERATIVO";
    explanation = "Personal operativo directo de máquinas, líneas de conversión o almacén";
  }

  return {
    category,
    ruleId: CATEGORY_RULE_V1.ruleId,
    ruleVersion: CATEGORY_RULE_V1.ruleVersion,
    sourcePosition: position ?? "",
    description: explanation,
  };
}
