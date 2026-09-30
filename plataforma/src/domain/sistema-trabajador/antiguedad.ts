import type { SeniorityCalculation } from "./tipos.ts";

export function calculateSeniority(
  hireDate: string | Date | null | undefined,
  asOfDate: string | Date = new Date(),
): SeniorityCalculation {
  if (!hireDate) {
    return {
      years: 0,
      months: 0,
      days: 0,
      formatted: "Fecha de ingreso no disponible",
      isAvailable: false,
    };
  }

  const start = typeof hireDate === "string" ? new Date(hireDate) : hireDate;
  const end = typeof asOfDate === "string" ? new Date(asOfDate) : asOfDate;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      years: 0,
      months: 0,
      days: 0,
      formatted: "Fecha de ingreso inválida",
      isAvailable: false,
    };
  }

  if (start.getTime() > end.getTime()) {
    return {
      years: 0,
      months: 0,
      days: 0,
      formatted: "Ingreso futuro registrado",
      isAvailable: true,
    };
  }

  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0),
    ).getUTCDate();
    days += prevMonthDays;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${String(years)} ${years === 1 ? "año" : "años"}`);
  }
  if (months > 0) {
    parts.push(`${String(months)} ${months === 1 ? "mes" : "meses"}`);
  }

  const formatted = parts.length > 0 ? parts.join(", ") : "Menos de 1 mes";

  return {
    years,
    months,
    days,
    formatted,
    isAvailable: true,
  };
}
