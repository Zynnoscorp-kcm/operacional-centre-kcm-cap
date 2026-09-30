import type {
  DeclareFieldInput,
  DeclaredField,
  ReleaseAuditRow,
  RoomAuditRow,
  SessionAuditRow,
  TablePreview,
  TableSummary,
} from "../../domain/consola-interna/tipos.ts";
import type { Clock } from "../../ports/reloj.port.ts";
import type { InternalConsolePort } from "../../ports/consola-interna.port.ts";
import { systemClock } from "../sistema/reloj-sistema.ts";

export class MemoryInternalConsoleRepository implements InternalConsolePort {
  readonly #clock: Clock;
  readonly #campos = new Map<string, DeclaredField>();
  #siguiente = 1;

  constructor(deps: { readonly clock?: Clock } = {}) {
    this.#clock = deps.clock ?? systemClock;
  }

  listSessionAudit(): Promise<readonly SessionAuditRow[]> {
    return Promise.resolve([]);
  }

  listRoomAudit(): Promise<readonly RoomAuditRow[]> {
    return Promise.resolve([]);
  }

  listReleaseAudit(): Promise<readonly ReleaseAuditRow[]> {
    return Promise.resolve([]);
  }

  listDeclaredFields(): Promise<readonly DeclaredField[]> {
    return Promise.resolve(
      [...this.#campos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  declareField(input: DeclareFieldInput, _actor: string): Promise<DeclaredField> {
    if ([...this.#campos.values()].some((campo) => campo.name === input.name)) {
      return Promise.reject(new Error(`El campo ${input.name} ya está declarado.`));
    }

    const fieldId = `campo-memoria-${String(this.#siguiente++)}`;
    const campo: DeclaredField = {
      fieldId,
      name: input.name,
      dataType: input.dataType as DeclaredField["dataType"],
      ...(input.description ? { description: input.description } : {}),
      source: input.source as DeclaredField["source"],
      approvedForRules: false,
      createdAt: this.#clock.nowIso(),
      valuesInUse: 0,
    };
    this.#campos.set(fieldId, campo);
    return Promise.resolve(campo);
  }

  approveField(fieldId: string, actor: string): Promise<DeclaredField> {
    const campo = this.#campos.get(fieldId);
    if (campo === undefined) return Promise.reject(new Error(`El campo ${fieldId} no existe.`));

    const aprobado: DeclaredField = {
      ...campo,
      approvedForRules: true,
      approvedBy: actor,
      approvedAt: this.#clock.nowIso(),
    };
    this.#campos.set(fieldId, aprobado);
    return Promise.resolve(aprobado);
  }

  listTables(): Promise<readonly TableSummary[]> {
    return Promise.resolve([]);
  }

  previewTable(): Promise<TablePreview | null> {
    return Promise.resolve(null);
  }
}
