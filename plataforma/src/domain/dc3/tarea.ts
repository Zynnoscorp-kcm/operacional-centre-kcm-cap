import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { Clock } from "../../ports/reloj.ts";
import { DomainError } from "../errores.ts";
import { runDc3Generator } from "../../../../packages/dc3/runner.js";

export type Dc3JobStatus =
  "SIN_CONFIGURACION" | "EN_COLA" | "EJECUTANDO" | "BLOQUEADO" | "COMPLETADO" | "ERROR";
export interface Dc3CandidateStatus {
  readonly candidateKey: string;
  readonly courseId: string;
  readonly completionDate: string;
  readonly status: "LISTO" | "BLOQUEADO" | "COMPLETADO";
  readonly blockingReasons: readonly string[];
}
export interface Dc3JobSnapshot {
  readonly status: Dc3JobStatus;
  readonly queuedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly detected: number;
  readonly ready: number;
  readonly blocked: number;
  readonly generated: number;
  readonly repeated: number;
  readonly conflicts: number;
  /** Constancias emitidas con algún recuadro vacío. Cuenta sobre `generated`, no aparte. */
  readonly partialDocuments: number;
  readonly message: string;
  readonly candidates: readonly Dc3CandidateStatus[];
}

const EMPTY: Dc3JobSnapshot = {
  status: "SIN_CONFIGURACION",
  detected: 0,
  ready: 0,
  blocked: 0,
  generated: 0,
  repeated: 0,
  conflicts: 0,
  partialDocuments: 0,
  message: "Falta el archivo de configuración legal referencias/privado/dc3-config.json.",
  candidates: [],
};

export class Dc3JobService {
  #snapshot: Dc3JobSnapshot = EMPTY;
  readonly #clock: Clock;
  readonly #projectRoot: string;
  readonly #configPath: string;
  readonly #runner: typeof runDc3Generator;

  constructor(input: {
    clock: Clock;
    projectRoot: string;
    configPath?: string;
    runner?: typeof runDc3Generator;
  }) {
    this.#clock = input.clock;
    this.#projectRoot = resolve(input.projectRoot);
    this.#configPath = resolve(
      input.configPath ?? `${this.#projectRoot}/referencias/privado/dc3-config.json`,
    );
    this.#runner = input.runner ?? runDc3Generator;
  }

  status(): Dc3JobSnapshot {
    return structuredClone(this.#snapshot);
  }

  enqueue(input: { generate: boolean; allowPartial?: boolean }): Dc3JobSnapshot {
    if (this.#snapshot.status === "EN_COLA" || this.#snapshot.status === "EJECUTANDO")
      throw new DomainError("DC3_JOB_BUSY", "Ya existe una tarea DC-3 activa.");
    if (!existsSync(this.#configPath) && this.#runner === runDc3Generator) {
      this.#snapshot = EMPTY;
      return this.status();
    }
    const queuedAt = this.#clock.nowIso();
    this.#snapshot = { ...EMPTY, status: "EN_COLA", queuedAt, message: "Tarea DC-3 en cola." };
    setImmediate(() => {
      this.#run(input);
    });
    return this.status();
  }

  #run(input: { generate: boolean; allowPartial?: boolean }): void {
    const startedAt = this.#clock.nowIso();
    this.#snapshot = {
      ...this.#snapshot,
      status: "EJECUTANDO",
      startedAt,
      message: "Planificador DC-3 en ejecución.",
    };
    try {
      const result = this.#runner({
        projectRoot: this.#projectRoot,
        configPath: this.#configPath,
        generate: input.generate,
        report: false,
        allowPartial: input.allowPartial ?? false,
        includeCandidateStatuses: true,
      });
      const execution = result.execution;
      const blocked = result.blocked ?? 0;
      const generated = execution.generated ?? 0;
      const partialDocuments = execution.partialDocuments ?? 0;
      // Un lote con candidatos bloqueados ya no es automáticamente un lote detenido: con la emisión
      // en blanco habilitada, esos candidatos salieron igual y lo que hay que reportar es cuántos
      // llevan recuadros vacíos, no que no se emitió nada.
      this.#snapshot = {
        status: generated > 0 || blocked === 0 ? "COMPLETADO" : "BLOQUEADO",
        queuedAt: this.#snapshot.queuedAt ?? startedAt,
        startedAt,
        completedAt: this.#clock.nowIso(),
        detected: result.detected ?? 0,
        ready: result.ready ?? 0,
        blocked,
        generated,
        repeated: execution.repeated ?? 0,
        conflicts: execution.conflicts ?? 0,
        partialDocuments,
        message:
          partialDocuments > 0
            ? `Emitidas ${generated}, de las cuales ${partialDocuments} salieron con campos en blanco. ` +
              "Al capturar el dato faltante, una nueva emisión las reemplaza."
            : blocked > 0
              ? "Hay candidatos bloqueados; no se emitió ningún documento incompleto."
              : "Tarea DC-3 completada.",
        candidates: (result.candidateStatuses ?? []).map((row) => ({
          ...row,
          blockingReasons: [...row.blockingReasons],
          status: row.status,
        })),
      };
    } catch (error) {
      const blocked = error instanceof Error && "code" in error && error.code === "DC3_NOT_READY";
      this.#snapshot = {
        ...this.#snapshot,
        status: blocked ? "BLOQUEADO" : "ERROR",
        completedAt: this.#clock.nowIso(),
        message: blocked
          ? "Faltan metadatos legales aprobados; no se emitió ningún documento."
          : "La tarea DC-3 falló sin publicar datos sensibles.",
      };
    }
  }
}
