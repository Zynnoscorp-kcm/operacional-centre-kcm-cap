import type { PeriodoDc3 } from "../domain/dc3/corte.ts";

export interface Dc3CandidateFilter {
  readonly courseKey?: string;
  readonly area?: string;
  readonly payrollType?: string;
  readonly query?: string;
  readonly status?: Dc3PlanTab;
  readonly emission?: Dc3EmissionState;
  readonly period?: PeriodoDc3;
}

export type { PeriodoDc3 };

export type Dc3EmissionState = "emitidas" | "pendientes" | "parciales";

export type Dc3PlanTab = "listos" | "incompletos" | "sin-curso";

export type Dc3CandidateOrder = "nombre" | "personal";

export interface Dc3PlanSummary {
  readonly ready: number;
  readonly incomplete: number;
  readonly withoutDate: number;
  readonly withoutOccupation: number;
  readonly fromCutoff: number;
  readonly beforeCutoff: number;
}

export interface Dc3CourseCoverage {
  readonly courseKey: string;
  readonly courseName: string;
  readonly total: number;
  readonly ready: number;
  readonly incomplete: number;
  readonly withoutDate: number;
  readonly emitted: number;
  readonly pending: number;
  readonly beforeCutoff: number;
}

export interface Dc3EmissionRecord {
  readonly at: string;
  readonly actor: string;
  readonly workerNumber: string;
  readonly workerName: string | null;
  readonly courseKey: string;
  readonly courseName: string | null;
  readonly partial: boolean;
}

export interface Dc3Candidate {
  readonly workerNumber: string;
  readonly workerName: string;
  readonly area: string;
  readonly department: string;
  readonly position: string;
  readonly payrollType: string | null;
  readonly courseKey: string;
  readonly courseName: string;
  readonly completionDate: string | null;
  readonly periodDays: number;
  readonly beforeCutoff: boolean;
  readonly hasCurp: boolean;
  readonly missing: readonly string[];
}

export interface Dc3CandidateDetail extends Dc3Candidate {
  readonly curp: string;
  readonly occupation: string;
  readonly durationHours: number | null;
  readonly thematicAreaKey: string | null;
  readonly thematicAreaName: string | null;
  readonly trainingAgent: string | null;
}

export interface Dc3EmissionSummary {
  readonly key: string;
  readonly count: number;
  readonly lastAt: string;
  readonly lastActor: string;
  readonly lastPartial: boolean;
  readonly anyComplete: boolean;
}

export interface Dc3EmissionFilter {
  readonly from?: string;
  readonly to?: string;
  readonly courseKey?: string;
  readonly actor?: string;
  readonly outcome?: "completas" | "parciales";
  readonly query?: string;
  readonly workerNumber?: string;
}

export interface Dc3EmissionTotals {
  readonly today: number;
  readonly week: number;
  readonly month: number;
  readonly total: number;
  readonly partial: number;
}

export interface Dc3AreaCoverage extends Dc3CourseCoverage {
  readonly area: string;
}

export interface Dc3CourseMetadata {
  readonly courseKey: string;
  readonly courseName: string;
  readonly durationHours: number | null;
  readonly durationDays: number | null;
  readonly thematicAreaKey: string | null;
  readonly thematicAreaName: string | null;
  readonly trainingAgent: string | null;
  readonly dateRule: string;
  readonly periodDays: number;
  readonly approved: boolean;
}

export interface Dc3DataGaps {
  readonly activeWorkers: number;
  readonly withoutCurp: number;
  readonly withoutOccupation: number;
  readonly withoutPosition: number;
}

export interface Dc3OccupationGap {
  readonly area: string;
  readonly position: string;
  readonly workers: number;
}

export interface Dc3WorkerWithoutOccupation {
  readonly workerNumber: string;
  readonly workerName: string;
  readonly area: string;
  readonly position: string;
  readonly payrollType: string | null;
}

export interface Dc3Key {
  readonly workerNumber: string;
  readonly courseKey: string;
}

export interface Dc3EmissionEntry extends Dc3Key {
  readonly actor: string;
  readonly requestId: string;
  readonly partial: boolean;
}

export interface Dc3CertificatePort {
  listDc3Courses(): Promise<readonly { readonly courseKey: string; readonly courseName: string }[]>;
  listCandidates(
    filter: Dc3CandidateFilter,
    limit: number,
    order?: Dc3CandidateOrder,
    offset?: number,
  ): Promise<readonly Dc3Candidate[]>;
  countCandidates(filter: Dc3CandidateFilter): Promise<number>;
  countByCourse(
    filter: Dc3CandidateFilter,
  ): Promise<readonly { readonly courseKey: string; readonly total: number }[]>;
  coverage(filter: Dc3CandidateFilter): Promise<readonly Dc3CourseCoverage[]>;
  coverageByArea(filter: Dc3CandidateFilter): Promise<readonly Dc3AreaCoverage[]>;
  listEmissions(
    filter: Dc3EmissionFilter,
    limit: number,
    offset?: number,
  ): Promise<readonly Dc3EmissionRecord[]>;
  countEmissions(filter: Dc3EmissionFilter): Promise<number>;
  summarizeEmissions(days: {
    readonly today: string;
    readonly week: string;
    readonly month: string;
  }): Promise<Dc3EmissionTotals>;
  listEmissionActors(): Promise<readonly string[]>;
  listEmissionSummaries(): Promise<readonly Dc3EmissionSummary[]>;
  findCandidate(workerNumber: string, courseKey: string): Promise<Dc3CandidateDetail | null>;
  findCandidates(keys: readonly Dc3Key[]): Promise<readonly Dc3CandidateDetail[]>;
  listWorkerCandidates(workerNumber: string): Promise<readonly Dc3CandidateDetail[]>;
  summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary>;
  listCourseMetadata(): Promise<readonly Dc3CourseMetadata[]>;
  dataGaps(): Promise<Dc3DataGaps>;
  listOccupationGaps(limit: number): Promise<readonly Dc3OccupationGap[]>;
  listWorkersWithoutOccupation(limit: number): Promise<readonly Dc3WorkerWithoutOccupation[]>;
  listRequestEmissionKeys(requestId: string): Promise<readonly string[]>;
  recordEmission(input: Dc3EmissionEntry): Promise<void>;
  recordEmissions(inputs: readonly Dc3EmissionEntry[]): Promise<void>;
}
