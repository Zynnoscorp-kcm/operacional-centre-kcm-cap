/**
 * Auditoría interna en tres secciones.
 *
 * La bitácora que ya existía es un ledger plano: un renglón por evento, con
 * actor, entidad y transición. Sirve para probar que algo pasó y no sirve para
 * la pregunta que se hace en la práctica, que no es «¿qué eventos hubo?» sino
 * «¿qué pasó con esta sesión?», «¿quién canceló esta sala?» y «¿qué fecha tenía
 * este trabajador antes de que la liberación la pisara?».
 *
 * Por eso las tres secciones no son filtros del mismo listado: cada una se
 * arma desde la entidad y arrastra los momentos que la explican.
 *
 * Por qué ocho días en dos de ellas y ninguno en la tercera
 *
 * Sesiones y salas son operación: se revisan mientras la semana está viva. A
 * los ocho días la pregunta ya no es operativa y el listado sólo estorba.
 *
 * Una liberación es otra cosa: es la evidencia de que una fecha entró a la
 * matriz de Recursos Humanos. Esa se consulta cuando alguien reclama una
 * constancia, y eso ocurre meses después. Recortarla a ocho días sería tirar el
 * único lugar donde consta qué fecha se sustituyó.
 *
 * En ninguno de los dos casos se borra nada: las tablas de origen son de sólo
 * agregado y sus triggers rechazan `UPDATE`, `DELETE` y `TRUNCATE`. La ventana
 * es de consulta.
 */

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

/** Tope del listado de liberaciones. Sin ventana, pero no sin límite. */
const MAXIMO_DE_LIBERACIONES = 500;

const UN_DIA_MS = 24 * 60 * 60 * 1000;

export class InternalAuditService {
  readonly #repository: AuditReadPort;
  readonly #clock: Clock;

  constructor(deps: { readonly repository: AuditReadPort; readonly clock: Clock }) {
    this.#repository = deps.repository;
    this.#clock = deps.clock;
  }

  /**
   * La ventana vigente, para que la pantalla la enseñe con fechas y no con la
   * frase «últimos ocho días», que obliga a quien lee a calcularla.
   */
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

  /**
   * Cuántas de las liberaciones listadas pisaron una fecha anterior. Es el dato
   * que se mira primero: la política por omisión es no sobrescribir, así que un
   * conteo distinto de cero es una pregunta, no una estadística.
   */
  static countOverwrites(rows: readonly ReleaseAuditRow[]): number {
    return rows.filter((row) => row.previousDate !== undefined).length;
  }
}
