/**
 * Puerto de la consola interna.
 *
 * Tres capacidades separadas a propósito, aunque un solo adaptador las
 * implemente: leer auditoría, declarar campos y mirar la base. Un
 * consumidor que sólo necesita leer no recibe el método que escribe.
 *
 * Todo lo que sale por aquí ya viene del lado de PostgreSQL con su filtro
 * aplicado. El servicio no recorta en memoria: una ventana de ocho días
 * resuelta con un `filter` sobre el resultado completo traería la tabla entera
 * por la red para tirar la mayor parte.
 */

import type {
  DeclareFieldInput,
  DeclaredField,
  ReleaseAuditRow,
  RoomAuditRow,
  SessionAuditRow,
  TablePreview,
  TableSummary,
} from "../domain/consola-interna/tipos.ts";

export interface AuditReadPort {
  /** Sesiones con actividad —creada, abierta o cerrada— dentro de la ventana. */
  listSessionAudit(days: number): Promise<readonly SessionAuditRow[]>;
  /** Reservaciones creadas o canceladas dentro de la ventana. */
  listRoomAudit(days: number): Promise<readonly RoomAuditRow[]>;
  /**
   * Efectos de liberación, del más reciente al más antiguo, con la fecha que
   * cada uno sustituyó cuando la hubo. Sin ventana: es evidencia permanente.
   */
  listReleaseAudit(limit: number): Promise<readonly ReleaseAuditRow[]>;
}

export interface DeclaredFieldPort {
  listDeclaredFields(): Promise<readonly DeclaredField[]>;
  /** Falla si el nombre ya existe: el esquema lo tiene como UNIQUE. */
  declareField(input: DeclareFieldInput, actor: string): Promise<DeclaredField>;
  /**
   * Autoriza el campo para alimentar reglas. El esquema exige actor y momento
   * juntos, así que el adaptador los escribe en la misma sentencia.
   */
  approveField(fieldId: string, actor: string): Promise<DeclaredField>;
}

export interface DataPreviewPort {
  listTables(): Promise<readonly TableSummary[]>;
  /**
   * Devuelve `null` cuando la tabla no existe o está vedada. Que las dos
   * respuestas sean la misma es intencional: distinguirlas confirmaría la
   * existencia de las tablas que precisamente no se quieren enseñar.
   */
  previewTable(table: string, limit: number, offset: number): Promise<TablePreview | null>;
}

export type InternalConsolePort = AuditReadPort & DeclaredFieldPort & DataPreviewPort;
