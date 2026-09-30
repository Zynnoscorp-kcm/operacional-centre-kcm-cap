/**
 * El tablero de entregas a la matriz.
 *
 * Liberar en la plataforma no escribe en el XLSB: deja la fecha lista para que
 * el cliente de Excel la escriba cuando alguien lo pulse en la PC donde vive el
 * libro. Entre esos dos momentos puede pasar una tarde entera, y hasta ahora la
 * pantalla de liberación no decía nada de ese intervalo: la sesión desaparecía
 * de la lista de pendientes y no volvía a aparecer en ninguna parte hasta que
 * alguien abría la matriz a ver si la fecha estaba.
 *
 * Este puerto es lo que permite contestar «¿ya llegó?». Cada lote liberado es
 * una entrega, y una entrega tiene dos estados que importan: esperando a Excel,
 * o escrita y con acuse. No hay reloj ni suscripción: la pantalla pregunta
 * cuando alguien pulsa actualizar, que es más barato que consultar cada minuto
 * a una base con presupuesto de lecturas.
 */

/**
 * Dónde está la entrega.
 *
 * `CON_CONFLICTO` no es un tercer destino sino el mismo `PENDIENTE` con una
 * causa conocida: Excel contestó que no pudo escribir, así que esperar más no
 * la va a resolver y hay que mirarla.
 */
export type MatrixDeliveryState = "PENDIENTE" | "ENTREGADA" | "CON_CONFLICTO";

export interface MatrixDelivery {
  /** El lote de liberación. Es la unidad que Excel aplica todo o nada. */
  readonly batchId: string;
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly courseName: string;
  readonly sessionDate: string;
  /** Cuándo se liberó en la plataforma. */
  readonly releasedAt: string;
  /** La cuenta que liberó el lote. */
  readonly releasedBy: string;
  /** Renglones del lote. */
  readonly total: number;
  /** Renglones con acuse efectivo de Excel: `APPLIED` o `RECOVERED`. */
  readonly delivered: number;
  /** Renglones que Excel contestó sin poder escribir. */
  readonly rejected: number;
  readonly state: MatrixDeliveryState;
  /** Acuse más reciente del lote. Vacío mientras no haya ninguno. */
  readonly deliveredAt: string | null;
  /** Por qué Excel no pudo escribir, tal como lo contestó. Vacío sin conflicto. */
  readonly conflictDetail?: string;
}

export interface MatrixDeliveryPort {
  /** Entregas vigentes del tablero, de la más reciente a la más vieja. */
  listDeliveries(limit: number): Promise<readonly MatrixDelivery[]>;
  /**
   * Una entrega concreta. La pide el botón de ocultar antes de ocultarla: sin
   * mirarla no se puede saber si ya está entregada, y ocultar una que todavía
   * espera a Excel sería perderla de vista justo mientras importa.
   */
  findDelivery(batchId: string): Promise<MatrixDelivery | null>;
  /**
   * Retira del tablero una entrega ya confirmada. No borra nada: asienta en la
   * bitácora que alguien la quitó de la vista, y el tablero deja de enumerarla.
   * La liberación y su acuse siguen enteros en auditoría.
   */
  hideDelivery(input: {
    readonly batchId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<void>;
}
