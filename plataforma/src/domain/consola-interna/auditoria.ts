import type { Clock } from "../../ports/reloj.port.ts";
import type { AuditReadPort } from "../../ports/consola-interna.port.ts";
import { DomainError } from "../comun/errores.ts";
import {
  VENTANA_AUDITORIA_DIAS,
  type AuditWindow,
  type ReleaseAuditRow,
  type RoomAuditRow,
  type SessionAuditRow,
} from "./tipos.ts";

const MAXIMO_DE_LIBERACIONES = 500;

const UN_DIA_MS = 24 * 60 * 60 * 1000;

export class InternalAuditService {
  readonly #repository: AuditReadPort;
  readonly #clock: Clock;

  constructor(deps: { readonly repository: AuditReadPort; readonly clock: Clock }) {
    this.#repository = deps.repository;
    this.#clock = deps.clock;
  }

  window(): AuditWindow {
    const hasta = this.#clock.now();
    const desde = new Date(hasta.getTime() - VENTANA_AUDITORIA_DIAS * UN_DIA_MS);
    return {
      days: VENTANA_AUDITORIA_DIAS,
      from: desde.toISOString().slice(0, 10),
      to: hasta.toISOString().slice(0, 10),
    };
  }

  sessions(): Promise<readonly SessionAuditRow[]> {
    return this.#repository.listSessionAudit(VENTANA_AUDITORIA_DIAS);
  }

  rooms(): Promise<readonly RoomAuditRow[]> {
    return this.#repository.listRoomAudit(VENTANA_AUDITORIA_DIAS);
  }

  releases(limit = MAXIMO_DE_LIBERACIONES): Promise<readonly ReleaseAuditRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMO_DE_LIBERACIONES) {
      throw new DomainError(
        "LIMITE_INVALIDO",
        `El listado de liberaciones admite entre 1 y ${String(MAXIMO_DE_LIBERACIONES)} renglones.`,
      );
    }
    return this.#repository.listReleaseAudit(limit);
  }

  static countOverwrites(rows: readonly ReleaseAuditRow[]): number {
    return rows.filter((row) => row.previousDate !== undefined).length;
  }
}
