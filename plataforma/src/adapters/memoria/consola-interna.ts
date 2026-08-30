/**
 * Consola interna sin base.
 *
 * Es el adaptador que sostiene la corrida en memoria y las pruebas. Dos de sus
 * tres mitades no pueden fingirse y no lo intentan:
 *
 * · Auditoría: sin base no hay sesiones, reservaciones ni liberaciones que
 *   auditar. Devuelve listas vacías, y la pantalla lo dice con todas sus
 *   letras en vez de enseñar un listado vacío que se lee igual que «no pasó
 *   nada esta semana».
 * · Previsualizador: sin base no hay catálogo. Mismo trato.
 * · Campos declarados: éste sí es fiel. El registro de campos es una lista
 *   con reglas —nombre único, aprobación con actor y momento— y esas reglas se
 *   sostienen igual en un `Map`, lo que permite probar el servicio completo
 *   sin credenciales.
 */

import type {
  DeclareFieldInput,
  DeclaredField,
  ReleaseAuditRow,
  RoomAuditRow,
  SessionAuditRow,
  TablePreview,
  TableSummary,
} from "../../domain/consola-interna/tipos.ts";
import type { Clock } from "../../ports/reloj.ts";
import type { InternalConsolePort } from "../../ports/consola-interna.port.ts";
import { systemClock } from "../reloj-sistema.ts";

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
      // El esquema lo impone con un UNIQUE; aquí se impone a mano para que una
      // prueba en memoria falle por lo mismo que fallaría contra la base.
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
