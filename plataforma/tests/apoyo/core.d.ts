declare module "*/packages/contracts/contracts.js" {
  export const CONTRACT_VERSION: string;
  export const MAX_PARTICIPANTS_PER_SESSION: number;
  export function releaseIdempotencyKey(params: {
    sessionId: string;
    employeeId: string;
    trainingId: string;
    mappingVersion: string;
  }): string;
}

declare module "*/packages/core/eligibility.js" {
  export const BLOCKING_REASONS: Readonly<{
    INVALID_IDENTITY: string;
    ATTENDANCE_NOT_PROVEN: string;
    EXAM_NOT_CONFIRMED: string;
    EXAM_NOT_FOUND: string;
    SESSION_NOT_AUTHORIZED: string;
    ALREADY_RELEASED: string;
    MATRIX_VALUE_EXISTS: string;
  }>;
  export function evaluateEligibility(attendance: Record<string, unknown>): {
    readonly eligible: boolean;
    readonly reasons: readonly string[];
  };
}

declare module "*/packages/core/create-in-memory-core.js" {
  export function createInMemoryCore(options?: Record<string, unknown>): {
    readonly capture: {
      registerDigital(input: Record<string, unknown>): Record<string, unknown>;
      confirmAttendance(input: Record<string, unknown>): Record<string, unknown>;
    };
    readonly exams: { reconcile(input: Record<string, unknown>): Record<string, unknown> };
    readonly release: {
      preview(input: Record<string, unknown>): {
        readonly included: readonly Record<string, string>[];
        readonly excluded: readonly { employeeId: string; reasons: readonly string[] }[];
      };
      release(input: Record<string, unknown>): Promise<{
        readonly status: string;
        readonly effectiveWrites: number;
      }>;
    };
    readonly matrix: {
      seedCell(input: { employeeId: string; trainingId: string; value: string }): void;
      readonly writeCount: number;
    };
  };
}
