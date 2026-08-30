export interface LegacyDc3CandidateStatus {
  readonly candidateKey: string;
  readonly courseId: string;
  readonly completionDate: string;
  readonly status: "LISTO" | "BLOQUEADO";
  readonly blockingReasons: readonly string[];
}

export interface LegacyDc3Result {
  readonly detected: number;
  readonly ready: number;
  readonly blocked: number;
  readonly candidateStatuses?: readonly LegacyDc3CandidateStatus[];
  readonly execution: {
    readonly mode: string;
    readonly generated?: number;
    readonly repeated?: number;
    readonly conflicts?: number;
    /** Cuántas de las emitidas salieron con recuadros vacíos. Subconjunto de `generated`. */
    readonly partialDocuments?: number;
    /** Cuántas constancias parciales fueron reemplazadas por su versión completa. */
    readonly superseded?: number;
  };
}

export function runDc3Generator(options: {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly generate: boolean;
  readonly report?: boolean;
  readonly allowPartial?: boolean;
  readonly includeCandidateStatuses?: boolean;
}): LegacyDc3Result;

export class Dc3NotReadyError extends Error {
  readonly code: "DC3_NOT_READY";
}
