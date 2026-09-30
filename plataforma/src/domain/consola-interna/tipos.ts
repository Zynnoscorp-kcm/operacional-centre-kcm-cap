export const VENTANA_AUDITORIA_DIAS = 8;

export interface SessionAuditRow {
  readonly sessionId: string;
  readonly code: string;
  readonly course: string;
  readonly trainer: string;
  readonly date: string;
  readonly state: string;
  readonly authorized: boolean;
  readonly createdAt: string;
  readonly openedAt?: string;
  readonly closedAt?: string;
  readonly attendances: number;
  readonly released: number;
}

export interface RoomAuditRow {
  readonly reservationId: string;
  readonly room: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly requesterName: string;
  readonly requesterArea: string;
  readonly status: string;
  readonly origin: string;
  readonly createdAt: string;
  readonly cancelledAt?: string;
  readonly cancelledBy?: string;
  readonly cancellationReason?: string;
}

export interface ReleaseAuditRow {
  readonly releaseId: string;
  readonly batchId: string;
  readonly requestId: string;
  readonly sessionCode: string;
  readonly workerNumber: string;
  readonly workerName: string;
  readonly course: string;
  readonly effectiveDate: string;
  readonly result: string;
  readonly appliedAt: string;
  readonly batchState: string;
  readonly releasedBy: string;
  readonly previousDate?: string;
  readonly overwriteReason?: string;
  readonly overwriteActor?: string;
  readonly overwriteAt?: string;
}

export interface AuditWindow {
  readonly days: number;
  readonly from: string;
  readonly to: string;
}

export const TIPOS_DE_CAMPO = ["TEXTO", "NUMERO", "FECHA", "BOOLEANO", "JSON"] as const;
export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number];

export const ORIGENES_DE_CAMPO = [
  "MATRIZ_XLSB",
  "TSV_DNC",
  "DNC_TECNICO",
  "CAPTA",
  "PLATAFORMA",
  "DEPARTAMENTO",
] as const;
export type OrigenDeCampo = (typeof ORIGENES_DE_CAMPO)[number];

export interface DeclaredField {
  readonly fieldId: string;
  readonly name: string;
  readonly dataType: TipoDeCampo;
  readonly description?: string;
  readonly source: OrigenDeCampo;
  readonly approvedForRules: boolean;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly createdAt: string;
  readonly valuesInUse: number;
}

export interface DeclareFieldInput {
  readonly name: string;
  readonly dataType: string;
  readonly description?: string;
  readonly source: string;
}

export interface TableSummary {
  readonly name: string;
  readonly comment?: string;
  readonly rows: number;
  readonly appendOnly: boolean;
}

export interface TablePreview {
  readonly table: string;
  readonly comment?: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly maskedColumns: readonly string[];
}

export const LIMITE_MAXIMO_DE_FILAS = 200;
export const LIMITE_POR_OMISION = 50;

export const ESQUEMAS_DEL_DOMINIO: readonly string[] = [
  "organizacion",
  "catalogo",
  "operacion",
  "matriz",
  "dnc",
  "dc3",
  "seguridad",
  "sistema",
];

export const TABLAS_VEDADAS: readonly string[] = ["secreto", "credencial_equipo", "nonce"];

export const COLUMNAS_ENMASCARADAS: readonly string[] = [
  "curp",
  "marcador",
  "firma_hmac",
  "hmac",
  "mac",
  "secreto",
  "hash_fuente",
  "token",
];
