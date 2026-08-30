import type { Clock } from "../../ports/reloj.ts";
import type { MatrixSnapshot } from "../../domain/importacion-matriz/tipos.ts";
import type {
  Dc3BridgeEvent,
  DeviceCredential,
  ExcelCredentialScope,
  ExcelReleaseAck,
  ExcelRepository,
  PendingExcelRelease,
  PowerQueryWorkerRow,
} from "../../domain/excel/tipos.ts";

export class MemoryExcelRepository implements ExcelRepository {
  readonly #credentials: DeviceCredential[] = [];
  readonly #pending: PendingExcelRelease[];
  readonly #acks: ExcelReleaseAck[] = [];
  readonly #dc3: Dc3BridgeEvent[] = [];
  readonly #nonces = new Map<string, string>();
  readonly #workers: PowerQueryWorkerRow[];
  readonly #snapshots = new Map<string, MatrixSnapshot>();
  readonly #clock: Clock;

  constructor(seed?: {
    readonly pendingReleases?: readonly PendingExcelRelease[];
    readonly workers?: readonly PowerQueryWorkerRow[];
    readonly clock?: Clock;
  }) {
    this.#pending = (seed?.pendingReleases ?? []).map((row) => ({ ...row }));
    this.#workers = (seed?.workers ?? []).map((row) => ({ ...row }));
    // El vencimiento del nonce se mide con el mismo reloj que fija el servicio.
    // Con `new Date()` la purga usaba la hora real y podía borrar un nonce recién
    // aceptado, apagando el rechazo de replay según la hora del día.
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
}
