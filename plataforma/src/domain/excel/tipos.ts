import type { MatrixSnapshot } from "../importacion-matriz/tipos.ts";

export type ExcelCredentialScope = "PUENTE_VBA" | "POWER_QUERY_LECTURA";
export type BridgeAction =
  | "MATRIX_IMPORT_V1"
  | "MATRIX_SCAN_V1"
  | "ROSTER_SCAN_V1"
  | "SCAN_ORDERS_V1"
  | "RELEASE_PULL_V1"
  | "RELEASE_ACK_V1"
  | "DC3_REPORT_V1"
  | "STATUS_V1";

export interface DeviceCredential {
  readonly credentialId: string;
  readonly clientId: string;
  readonly principal: string;
  readonly windowsProfile: string;
  readonly equipment: string;
  readonly scope: ExcelCredentialScope;
  readonly resource: string;
  readonly salt: string;
  readonly credentialHash: string;
  readonly issuedAt: string;
  /** `null` significa credencial permanente. Siempre puede revocarse. */
  readonly expiresAt: string | null;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly lastUsedAt?: string;
}

export interface PendingExcelRelease {
  readonly idempotencyKey: string;
  readonly batchId: string;
  readonly sessionId: string;
  readonly employeeId: string;
  readonly trainingId: string;
  readonly completionDate: string;
  readonly destinationSheet: string;
  readonly destinationColumn: string;
  readonly headerRow: number;
  readonly destinationHeader: string;
  readonly targetMappingVersion: string;
  readonly overwritePolicy: "NO_OVERWRITE" | "OVERWRITE_WITH_HISTORY";
}

export interface ExcelReleaseAck {
  readonly ackId: string;
  readonly requestId: string;
  readonly clientId: string;
  readonly idempotencyKey: string;
  readonly batchId: string;
  readonly targetMappingVersion: string;
  readonly completionDate: string;
  readonly status: string;
  readonly workbookSha256: string;
  readonly destinationAddress: string;
  readonly detail: string;
  readonly receivedAt: string;
}

export interface Dc3BridgeEvent {
  readonly eventId: string;
  readonly requestId: string;
  readonly clientId: string;
  readonly dc3Key: string;
  readonly employeeId: string;
  readonly courseId: string;
  readonly completionDate: string;
  readonly status: string;
  readonly fileSha256: string;
  readonly generatedAt: string;
  readonly errorCode: string;
  readonly receivedAt: string;
}

export interface PowerQueryWorkerRow {
  readonly employeeId: string;
  readonly department: string;
  readonly area: string;
  readonly position: string;
  readonly active: boolean;
}

export interface ExcelImportPreview {
  readonly importId: string;
  readonly requestId: string;
  readonly phase: string;
  readonly conflicts: number;
  readonly unknownCourses: number;
  readonly unknownWorkers: number;
  readonly inserted: number;
  readonly corrected: number;
  readonly retired: number;
  readonly reactivated: number;
}

export interface ExcelRepository {
  insertCredential(credential: DeviceCredential): Promise<void>;
  findCredentials(
    clientId: string,
    scope: ExcelCredentialScope,
  ): Promise<readonly DeviceCredential[]>;
  replaceCredential(credential: DeviceCredential): Promise<void>;
  listPendingReleases(): Promise<readonly PendingExcelRelease[]>;
  listReleaseAcks(): Promise<readonly ExcelReleaseAck[]>;
  appendReleaseAcks(rows: readonly ExcelReleaseAck[]): Promise<void>;
  listDc3Events(): Promise<readonly Dc3BridgeEvent[]>;
  appendDc3Events(rows: readonly Dc3BridgeEvent[]): Promise<void>;
  useNonce(clientId: string, nonce: string, expiresAt: string): Promise<boolean>;
  listPowerQueryWorkers(): Promise<readonly PowerQueryWorkerRow[]>;
  saveImportSnapshot(importId: string, snapshot: MatrixSnapshot): Promise<void>;
  getImportSnapshot(importId: string): Promise<MatrixSnapshot | null>;
}

export interface BridgeRequest {
  readonly action: BridgeAction;
  readonly clientId: string;
  readonly requestId: string;
  readonly sentAt: string;
  readonly nonce: string;
  readonly credential: string;
  readonly payload: string;
}
