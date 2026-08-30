export interface DncEvaluation {
  readonly trainingId: string;
  readonly canonicalCourseName: string;
  readonly status: string;
  readonly isApplicable: boolean;
  readonly ruleId: string | null;
  readonly ruleVersion: string | null;
  readonly ruleLevel: "DEPARTMENT" | "AREA" | null;
  readonly lastCompletionDate: string | null;
  readonly expirationDate: string | null;
  readonly scheduledSessionId: string | null;
  readonly evaluatedAt: string;
  readonly details: string;
}

export class DncEngine {
  evaluateAllCoursesForEmployee(input: {
    employee: { employeeId: string; department: string | null; area: string | null; active: boolean };
    history?: Record<string, string>;
    scheduledSessions?: unknown;
    asOfDate?: Date | string;
  }): readonly DncEvaluation[];
}

export const UNIFIED_COURSES: readonly { readonly trainingId: string; readonly canonicalName: string; readonly isTechnical: boolean }[];

/**
 * Resuelve un identificador de curso —trainingId, nombre canónico o alias
 * aprobado— contra el catálogo unificado. `null` cuando no lo reconoce.
 */
export function resolveCourse(
  identifier: string,
  options?: { readonly sourceKey?: string },
): { readonly trainingId: string; readonly canonicalName: string } | null;
