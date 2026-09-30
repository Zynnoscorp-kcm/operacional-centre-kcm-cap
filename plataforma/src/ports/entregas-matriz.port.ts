export type MatrixDeliveryState = "PENDIENTE" | "ENTREGADA" | "CON_CONFLICTO";

export interface MatrixDelivery {
  readonly batchId: string;
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly courseName: string;
  readonly sessionDate: string;
  readonly releasedAt: string;
  readonly releasedBy: string;
  readonly total: number;
  readonly delivered: number;
  readonly rejected: number;
  readonly state: MatrixDeliveryState;
  readonly deliveredAt: string | null;
  readonly conflictDetail?: string;
}

export interface MatrixDeliveryPort {
  listDeliveries(limit: number): Promise<readonly MatrixDelivery[]>;
  findDelivery(batchId: string): Promise<MatrixDelivery | null>;
  hideDelivery(input: {
    readonly batchId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<void>;
}
