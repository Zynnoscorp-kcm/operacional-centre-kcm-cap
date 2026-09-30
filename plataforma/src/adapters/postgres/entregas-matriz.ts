import type {
  MatrixDelivery,
  MatrixDeliveryPort,
  MatrixDeliveryState,
} from "../../ports/entregas-matriz.port.ts";
import type { SqlExecutor } from "./matriz.ts";

export const ACCION_ENTREGA_OCULTA = "ENTREGA_OCULTADA_DEL_TABLERO";

const ENTIDAD_LOTE = "LOTE_LIBERACION";

interface FilaEntrega {
  lote_id: string;
  sesion_id: string;
  codigo_sesion: string;
  curso: string | null;
  fecha_sesion: string | null;
  liberado_en: string | Date;
  liberado_por: string | null;
  total: number;
  entregadas: number;
  rechazadas: number;
  entregada_en: string | Date | null;
  motivo: string | null;
}

const CUENTAS_DEL_LOTE = `
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE ef.efectiva)::int AS entregadas,
         count(*) FILTER (WHERE ef.efectiva IS NOT TRUE AND ef.rechazada)::int AS rechazadas,
         max(ef.recibido_en) FILTER (WHERE ef.efectiva) AS entregada_en,
         max(ef.detalle) FILTER (WHERE ef.efectiva IS NOT TRUE AND ef.rechazada) AS motivo
    FROM matriz.liberacion l
    CROSS JOIN LATERAL (
      SELECT bool_or(a.estado IN ('APPLIED', 'RECOVERED')) AS efectiva,
             bool_or(a.estado NOT IN ('APPLIED', 'RECOVERED')) AS rechazada,
             max(a.recibido_en) FILTER (WHERE a.estado IN ('APPLIED', 'RECOVERED')) AS recibido_en,
             max(a.detalle) FILTER (WHERE a.estado NOT IN ('APPLIED', 'RECOVERED')) AS detalle
        FROM matriz.liberacion_acuse a
       WHERE a.clave_idempotencia = l.clave_idempotencia
    ) ef
   WHERE l.lote_id = lo.lote_id`;

const ENTREGAS = `
  SELECT lo.lote_id::text AS lote_id,
         lo.sesion_id::text AS sesion_id,
         s.codigo_sesion,
         c.nombre AS curso,
         to_char(s.fecha_sesion, 'YYYY-MM-DD') AS fecha_sesion,
         lo.creado_en AS liberado_en,
         act.nombre_visible AS liberado_por,
         cuentas.total,
         cuentas.entregadas,
         cuentas.rechazadas,
         cuentas.entregada_en,
         cuentas.motivo
    FROM matriz.liberacion_lote lo
    JOIN operacion.sesion s ON s.sesion_id = lo.sesion_id
    LEFT JOIN catalogo.capacitacion c ON c.capacitacion_id = s.capacitacion_id
    LEFT JOIN seguridad.actor act ON act.actor_id = lo.creado_por
    CROSS JOIN LATERAL (${CUENTAS_DEL_LOTE}) cuentas
   WHERE cuentas.total > 0`;

const NO_OCULTA = `
   AND NOT EXISTS (
     SELECT 1
       FROM sistema.bitacora_auditoria au
      WHERE au.entidad_tipo = '${ENTIDAD_LOTE}'
        AND au.entidad_id = lo.lote_id::text
        AND au.accion = '${ACCION_ENTREGA_OCULTA}'
   )`;

export class SupabaseMatrixDeliveryRepository implements MatrixDeliveryPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async listDeliveries(limit: number): Promise<readonly MatrixDelivery[]> {
    const { rows } = await this.#db.query<FilaEntrega>(
      `${ENTREGAS}${NO_OCULTA}
       ORDER BY lo.creado_en DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map(aEntrega);
  }

  async findDelivery(batchId: string): Promise<MatrixDelivery | null> {
    if (!UUID.test(batchId)) return null;
    const { rows } = await this.#db.query<FilaEntrega>(`${ENTREGAS} AND lo.lote_id = $1 LIMIT 1`, [
      batchId,
    ]);
    const fila = rows[0];
    return fila ? aEntrega(fila) : null;
  }

  async hideDelivery(input: {
    readonly batchId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<void> {
    await this.#db.query(
      `INSERT INTO sistema.bitacora_auditoria
         (actor, rol, entidad_tipo, entidad_id, accion, estado_anterior, estado_nuevo,
          motivo, sesion_id, solicitud_id, procedencia, contrato_version)
       SELECT $1, 'CAPACITACION', '${ENTIDAD_LOTE}', lo.lote_id::text, '${ACCION_ENTREGA_OCULTA}',
              'ENTREGADA', 'OCULTA',
              'Retirada del tablero de entregas por quien la revisó. El efecto y su acuse siguen en auditoría.',
              lo.sesion_id, $2, 'PLATAFORMA', '1.0.0'
         FROM matriz.liberacion_lote lo
        WHERE lo.lote_id = $3`,
      [input.actor, input.requestId, input.batchId],
    );
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function iso(valor: string | Date): string {
  return new Date(valor).toISOString();
}

function estadoDe(fila: FilaEntrega): MatrixDeliveryState {
  if (fila.total > 0 && fila.entregadas >= fila.total) return "ENTREGADA";
  return fila.rechazadas > 0 ? "CON_CONFLICTO" : "PENDIENTE";
}

function aEntrega(fila: FilaEntrega): MatrixDelivery {
  return {
    batchId: fila.lote_id,
    sessionId: fila.sesion_id,
    sessionCode: fila.codigo_sesion,
    courseName: fila.curso ?? "",
    sessionDate: fila.fecha_sesion ?? "",
    releasedAt: iso(fila.liberado_en),
    releasedBy: fila.liberado_por ?? "",
    total: Number(fila.total),
    delivered: Number(fila.entregadas),
    rejected: Number(fila.rechazadas),
    state: estadoDe(fila),
    deliveredAt: fila.entregada_en === null ? null : iso(fila.entregada_en),
    conflictDetail: fila.motivo ?? "",
  };
}
