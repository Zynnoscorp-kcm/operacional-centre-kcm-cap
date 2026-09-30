import type { MatrixSnapshot } from "../importacion-matriz/tipos.ts";

export type ExcelCredentialScope = "PUENTE_VBA" | "POWER_QUERY_LECTURA";
export type BridgeAction =
  | "MATRIX_IMPORT_V1"
  | "MATRIX_SCAN_V1"
  | "ROSTER_SCAN_V1"
  | "RELEASE_PULL_V1"
  | "RELEASE_SESSIONS_V1"
  | "RELEASE_ACK_V1"
  | "DC3_REPORT_V1"
  | "STATUS_V1"
  | "LOCAL_SHUTDOWN_V1"
  | "UPLOAD_PART_V1";

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
  /**
   * El código legible de la sesión, el mismo que se ve en la consola. No entra
   * en el TSV de `RELEASE_PULL_V1` —el contrato de esa acción no se toca— pero
   * es lo único con lo que una persona reconoce una sesión: el UUID no lo lee
   * nadie, y el panel del libro tiene que poder decir cuál llegó.
   */
  readonly sessionCode: string;
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

/**
 * Una sesión con liberaciones esperando a Excel, ya resumida.
 *
 * Es lo que alimenta el subpanel del libro controlador: la lista de lo que ha
 * llegado, para poder escoger qué se escribe. Se resume en el servidor y no en
 * la macro porque el cliente ya tiene bastante con abrir la matriz.
 */
export interface PendingReleaseSession {
  readonly sessionId: string;
  readonly sessionCode: string;
  /** `clave_curso`. La sesión es de un solo curso. */
  readonly trainingId: string;
  /** La fecha que se escribiría. Es la misma para toda la sesión. */
  readonly completionDate: string;
  /** Renglones que faltan por escribir en esa sesión. */
  readonly pending: number;
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

/**
 * El último envío chico: un acuse de Excel con las fechas que escribió en la
 * matriz. Se agrupa por solicitud porque un acuse trae varias fechas a la vez.
 */
export interface UltimoLoteAplicado {
  readonly recibidoEn: string;
  readonly fechas: number;
  readonly equipo: string;
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

/**
 * Una parte de un envío que no cabe en una sola petición.
 *
 * La nube corta cada petición en 4.5 MB. Excel parte lo que pase de ahí y manda
 * las partes una tras otra; cada una puede caer en una instancia distinta, así
 * que esperan en la base hasta que llega la última y el envío se procesa
 * completo, como si hubiera llegado de una vez.
 */
export interface UploadPart {
  /**
   * Cliente, solicitud y largo total identifican el envío: dos envíos distintos
   * nunca comparten partes.
   */
  readonly clientId: string;
  readonly requestId: string;
  /** Largo del envío completo, en caracteres base64 web-safe. */
  readonly totalCharacters: number;
  /** Número de esta parte, desde 1. */
  readonly partNumber: number;
  readonly totalParts: number;
  /** La acción que se ejecuta al juntar las partes. */
  readonly action: string;
  readonly content: string;
  readonly expiresAt: string;
}

/** Lo que se sabe de una parte sin leer su contenido. */
export type UploadPartSummary = Pick<UploadPart, "partNumber" | "totalParts" | "action">;

/** Lo que identifica un envío en partes. */
export interface UploadKey {
  readonly clientId: string;
  readonly requestId: string;
  readonly totalCharacters: number;
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
  /** El acuse más reciente con fechas escritas de verdad; nada si no hay ninguno. */
  lastAppliedReleaseBatch(): Promise<UltimoLoteAplicado | undefined>;
  appendReleaseAcks(rows: readonly ExcelReleaseAck[]): Promise<void>;
  listDc3Events(): Promise<readonly Dc3BridgeEvent[]>;
  appendDc3Events(rows: readonly Dc3BridgeEvent[]): Promise<void>;
  useNonce(clientId: string, nonce: string, expiresAt: string): Promise<boolean>;
  listPowerQueryWorkers(): Promise<readonly PowerQueryWorkerRow[]>;
  saveImportSnapshot(importId: string, snapshot: MatrixSnapshot): Promise<void>;
  getImportSnapshot(importId: string): Promise<MatrixSnapshot | null>;
  /** Guarda una parte; repetirla la sustituye. De paso borra las vencidas de cualquier envío. */
  saveUploadPart(part: UploadPart, now: string): Promise<void>;
  /** Las partes vigentes de un envío, en cualquier orden. */
  listUploadParts(envio: UploadKey, now: string): Promise<readonly UploadPart[]>;
  /**
   * Qué partes vigentes tiene un envío, sin su contenido: basta para saber si
   * ya está completo sin leer megas de más en cada parte.
   */
  listUploadPartNumbers(envio: UploadKey, now: string): Promise<readonly UploadPartSummary[]>;
  /** Borra todas las partes de un envío. */
  discardUploadParts(envio: UploadKey): Promise<void>;
}

export interface BridgeRequest {
  readonly action: BridgeAction;
  readonly clientId: string;
  readonly requestId: string;
  readonly sentAt: string;
  readonly nonce: string;
  readonly credential: string;
  readonly payload: string;
  /** Sólo en `UPLOAD_PART_V1`: la acción del envío completo. */
  readonly target?: string;
  /** Sólo en `UPLOAD_PART_V1`: número de esta parte, desde 1. */
  readonly part?: string;
  /** Sólo en `UPLOAD_PART_V1`: cuántas partes forman el envío. */
  readonly parts?: string;
  /** Sólo en `UPLOAD_PART_V1`: largo del envío completo. */
  readonly length?: string;
}
