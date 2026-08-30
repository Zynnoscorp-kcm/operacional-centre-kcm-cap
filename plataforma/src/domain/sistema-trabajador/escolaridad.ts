/**
 * Manejo de escolaridad declarada por omisión.
 */

import type { DerivedSchooling } from "./tipos.ts";

export function deriveSchooling(declaredSchooling?: string | null): DerivedSchooling {
  const isDeclaredByDefault = !declaredSchooling || declaredSchooling.trim() === "";
  const level = isDeclaredByDefault ? "SECUNDARIA" : declaredSchooling.trim().toUpperCase();

  return {
    level,
    isDeclaredByDefault,
    disclaimer: isDeclaredByDefault
      ? "Declarada por omisión (pendiente de acreditación documental)"
      : "Registrada en padrón de recursos humanos",
  };
}
