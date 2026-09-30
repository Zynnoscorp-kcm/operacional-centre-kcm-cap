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
  listSessionAudit(days: number): Promise<readonly SessionAuditRow[]>;
  listRoomAudit(days: number): Promise<readonly RoomAuditRow[]>;
  listReleaseAudit(limit: number): Promise<readonly ReleaseAuditRow[]>;
}

export interface DeclaredFieldPort {
  listDeclaredFields(): Promise<readonly DeclaredField[]>;
  declareField(input: DeclareFieldInput, actor: string): Promise<DeclaredField>;
  approveField(fieldId: string, actor: string): Promise<DeclaredField>;
}

export interface DataPreviewPort {
  listTables(): Promise<readonly TableSummary[]>;
  previewTable(table: string, limit: number, offset: number): Promise<TablePreview | null>;
}

export type InternalConsolePort = AuditReadPort & DeclaredFieldPort & DataPreviewPort;
