import type { Clock } from "../../ports/reloj.port.ts";
import type { MatrixSnapshot } from "../../domain/importacion-matriz/tipos.ts";
import type {
  Dc3BridgeEvent,
  DeviceCredential,
  ExcelCredentialScope,
  ExcelReleaseAck,
  UltimoLoteAplicado,
  ExcelRepository,
  PendingExcelRelease,
  PowerQueryWorkerRow,
  UploadKey,
  UploadPart,
  UploadPartSummary,
} from "../../domain/excel/tipos.ts";

export class MemoryExcelRepository implements ExcelRepository {
  readonly #credentials: DeviceCredential[] = [];
  readonly #pending: PendingExcelRelease[];
  readonly #acks: ExcelReleaseAck[] = [];
  readonly #dc3: Dc3BridgeEvent[] = [];
  readonly #nonces = new Map<string, string>();
  readonly #workers: PowerQueryWorkerRow[];
  readonly #snapshots = new Map<string, MatrixSnapshot>();
  readonly #parts = new Map<string, UploadPart>();
  readonly #clock: Clock;

  constructor(seed?: {
    readonly pendingReleases?: readonly PendingExcelRelease[];
    readonly workers?: readonly PowerQueryWorkerRow[];
    readonly clock?: Clock;
  }) {
    this.#pending = (seed?.pendingReleases ?? []).map((row) => ({ ...row }));
    this.#workers = (seed?.workers ?? []).map((row) => ({ ...row }));
    this.#clock = seed?.clock ?? { now: () => new Date(), nowIso: () => new Date().toISOString() };
  }

  insertCredential(credential: DeviceCredential): Promise<void> {
    this.#credentials.push({ ...credential });
    return Promise.resolve();
  }
  findCredentials(
    clientId: string,
    scope: ExcelCredentialScope,
  ): Promise<readonly DeviceCredential[]> {
    return Promise.resolve(
      this.#credentials
        .filter((row) => row.clientId === clientId && row.scope === scope)
        .map((row) => ({ ...row })),
    );
  }
  replaceCredential(credential: DeviceCredential): Promise<void> {
    const index = this.#credentials.findIndex(
      (row) => row.credentialId === credential.credentialId,
    );
    if (index < 0) throw new Error("Credencial inexistente");
    this.#credentials[index] = { ...credential };
    return Promise.resolve();
  }
  listPendingReleases(): Promise<readonly PendingExcelRelease[]> {
    const effective = new Set(
      this.#acks
        .filter((row) => row.status === "APPLIED" || row.status === "RECOVERED")
        .map((row) => row.idempotencyKey),
    );
    return Promise.resolve(
      this.#pending.filter((row) => !effective.has(row.idempotencyKey)).map((row) => ({ ...row })),
    );
  }
  listReleaseAcks(): Promise<readonly ExcelReleaseAck[]> {
    return Promise.resolve(this.#acks.map((row) => ({ ...row })));
  }
  lastAppliedReleaseBatch(): Promise<UltimoLoteAplicado | undefined> {
    const efectivos = this.#acks.filter(
      (row) => row.status === "APPLIED" || row.status === "RECOVERED",
    );
    const ultimo = efectivos.reduce<ExcelReleaseAck | undefined>(
      (mayor, row) => (mayor === undefined || row.receivedAt > mayor.receivedAt ? row : mayor),
      undefined,
    );
    if (!ultimo) return Promise.resolve(undefined);
    const delMismo = efectivos.filter((row) => row.requestId === ultimo.requestId);
    return Promise.resolve({
      recibidoEn: ultimo.receivedAt,
      fechas: delMismo.length,
      equipo: ultimo.clientId,
    });
  }
  appendReleaseAcks(rows: readonly ExcelReleaseAck[]): Promise<void> {
    this.#acks.push(...rows.map((row) => ({ ...row })));
    return Promise.resolve();
  }
  listDc3Events(): Promise<readonly Dc3BridgeEvent[]> {
    return Promise.resolve(this.#dc3.map((row) => ({ ...row })));
  }
  appendDc3Events(rows: readonly Dc3BridgeEvent[]): Promise<void> {
    this.#dc3.push(...rows.map((row) => ({ ...row })));
    return Promise.resolve();
  }
  useNonce(clientId: string, nonce: string, expiresAt: string): Promise<boolean> {
    const now = this.#clock.nowIso();
    for (const [key, expiry] of this.#nonces) if (expiry <= now) this.#nonces.delete(key);
    const key = `${clientId}|${nonce}`;
    if (this.#nonces.has(key)) return Promise.resolve(false);
    this.#nonces.set(key, expiresAt);
    return Promise.resolve(true);
  }
  listPowerQueryWorkers(): Promise<readonly PowerQueryWorkerRow[]> {
    return Promise.resolve(this.#workers.map((row) => ({ ...row })));
  }
  saveImportSnapshot(importId: string, snapshot: MatrixSnapshot): Promise<void> {
    this.#snapshots.set(importId, structuredClone(snapshot));
    return Promise.resolve();
  }
  getImportSnapshot(importId: string): Promise<MatrixSnapshot | null> {
    const row = this.#snapshots.get(importId);
    return Promise.resolve(row ? structuredClone(row) : null);
  }
  saveUploadPart(part: UploadPart, now: string): Promise<void> {
    for (const [clave, guardada] of this.#parts)
      if (guardada.expiresAt <= now) this.#parts.delete(clave);
    const clave = `${part.clientId}|${part.requestId}|${String(part.totalCharacters)}`;
    this.#parts.set(`${clave}#${String(part.partNumber)}`, { ...part });
    return Promise.resolve();
  }
  listUploadParts(envio: UploadKey, now: string): Promise<readonly UploadPart[]> {
    return Promise.resolve(
      [...this.#parts.values()]
        .filter((part) => esDelEnvio(part, envio) && part.expiresAt > now)
        .map((part) => ({ ...part })),
    );
  }
  listUploadPartNumbers(envio: UploadKey, now: string): Promise<readonly UploadPartSummary[]> {
    return Promise.resolve(
      [...this.#parts.values()]
        .filter((part) => esDelEnvio(part, envio) && part.expiresAt > now)
        .map(({ partNumber, totalParts, action }) => ({ partNumber, totalParts, action })),
    );
  }
  discardUploadParts(envio: UploadKey): Promise<void> {
    for (const [clave, part] of this.#parts) if (esDelEnvio(part, envio)) this.#parts.delete(clave);
    return Promise.resolve();
  }
}

function esDelEnvio(part: UploadPart, envio: UploadKey): boolean {
  return (
    part.clientId === envio.clientId &&
    part.requestId === envio.requestId &&
    part.totalCharacters === envio.totalCharacters
  );
}
