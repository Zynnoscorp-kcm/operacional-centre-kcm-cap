/**
 * Adaptador PostgreSQL del puente VBA y Power Query (Funciones 10 y 11).
 *
 * Es el que hace que la credencial sobreviva a un reinicio y que un acuse quede
 * en el ledger. Todo lo que toca vive en `database/migrations/0025`.
 *
 * Dos cosas que no son evidentes al leer el puerto:
 *
 * 1. `listPendingReleases` no consulta tablas: llama a
 *    `kcm_lectura.obtener_liberaciones_pendientes`, que resuelve la liberación
 *    contra el mapeo vigente y el destino activo. Una liberación sin mapeo no se
 *    entrega, y esa regla vive en la base para que ningún adaptador pueda
 *    saltársela.
 * 2. El nonce se consume con un `INSERT ... ON CONFLICT DO NOTHING`. La
 *    unicidad de la llave primaria es la garantía de un solo uso; comprobar
 *    antes con un `SELECT` dejaría una ventana entre la lectura y la escritura.
 */

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
import type { SqlExecutor } from "./matriz.ts";

/** Actor bajo el que se emiten y revocan credenciales cuando no hay uno nominal. */
const ACTOR_SISTEMA = "sistema.configuracion";

interface FilaCredencial {
  credencial_id: string;
  client_id: string;
  principal: string;
  perfil_windows: string;
  equipo: string;
  alcance: ExcelCredentialScope;
  recurso: string;
  sal: string;
  credencial_hash: string;
  emitida_en: string | Date;
  expira_en: string | Date | null;
  revocada_en: string | Date | null;
  motivo_revocacion: string | null;
  ultimo_uso_en: string | Date | null;
}

function iso(valor: string | Date): string {
  return new Date(valor).toISOString();
}

export class SupabaseExcelRepository implements ExcelRepository {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async #actorId(identificador = ACTOR_SISTEMA): Promise<string> {
    const { rows } = await this.#db.query<{ actor_id: string }>(
      `INSERT INTO kcm.actor (identificador, nombre_visible)
       VALUES ($1, $1)
       ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
       RETURNING actor_id;`,
      [identificador],
    );
    const id = rows[0]?.actor_id;
    if (!id) throw new Error(`No fue posible resolver el actor ${identificador}`);
    return id;
  }

  // ---------------------------------------------------------------- credenciales

  async insertCredential(credential: DeviceCredential): Promise<void> {
    const emisor = await this.#actorId();
    await this.#db.query(
      `INSERT INTO kcm.credencial_equipo (
         credencial_id, client_id, principal, perfil_windows, equipo,
         alcance, recurso, credencial_hash, sal, algoritmo,
         emitida_por, emitida_en, expira_en
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scrypt',$10,$11,$12);`,
      [
        credential.credentialId,
        credential.clientId,
        credential.principal,
        credential.windowsProfile,
        credential.equipment,
        credential.scope,
        credential.resource,
        credential.credentialHash,
        credential.salt,
        emisor,
        credential.issuedAt,
        credential.expiresAt,
      ],
    );
  }

  async findCredentials(
    clientId: string,
    scope: ExcelCredentialScope,
  ): Promise<readonly DeviceCredential[]> {
    const { rows } = await this.#db.query<FilaCredencial>(
      `SELECT credencial_id, client_id, principal, perfil_windows, equipo, alcance,
              recurso, sal, credencial_hash, emitida_en, expira_en, revocada_en,
              motivo_revocacion, ultimo_uso_en
         FROM kcm.credencial_equipo
        WHERE client_id = $1 AND alcance = $2
        ORDER BY emitida_en DESC;`,
      [clientId, scope],
    );
    return rows.map((r) => ({
      credentialId: r.credencial_id,
      clientId: r.client_id,
      principal: r.principal,
      windowsProfile: r.perfil_windows,
      equipment: r.equipo,
      scope: r.alcance,
      resource: r.recurso,
      salt: r.sal,
      credentialHash: r.credencial_hash,
      issuedAt: iso(r.emitida_en),
      expiresAt: r.expira_en ? iso(r.expira_en) : null,
      ...(r.revocada_en ? { revokedAt: iso(r.revocada_en) } : {}),
      ...(r.motivo_revocacion ? { revocationReason: r.motivo_revocacion } : {}),
      ...(r.ultimo_uso_en ? { lastUsedAt: iso(r.ultimo_uso_en) } : {}),
    }));
  }

  /**
   * Sólo se reescriben los tres campos que cambian en vida de una credencial:
   * uso, revocación y su motivo. Reemplazar la fila completa permitiría alterar
   * el hash o la caducidad desde una ruta que no es la de emisión.
   */
  async replaceCredential(credential: DeviceCredential): Promise<void> {
    // `credencial_revocacion_coherente` ata revocada_en a revocada_por: revocar
    // sin dejar quién lo hizo no es revocar, es borrar el rastro.
    const revocador = credential.revokedAt ? await this.#actorId() : null;
    await this.#db.query(
      `UPDATE kcm.credencial_equipo
          SET ultimo_uso_en = $2,
              revocada_en = $3,
              revocada_por = $4,
              motivo_revocacion = $5
        WHERE credencial_id = $1;`,
      [
        credential.credentialId,
        credential.lastUsedAt ?? null,
        credential.revokedAt ?? null,
        revocador,
        credential.revocationReason ?? null,
      ],
    );
  }

  // ------------------------------------------------------------------ liberación

  async listPendingReleases(): Promise<readonly PendingExcelRelease[]> {
    const { rows } = await this.#db.query<{
      idempotency_key: string;
      batch_id: string;
      session_id: string;
      employee_id: string;
      training_id: string;
      completion_date: string;
      destination_sheet: string;
      destination_column: string;
      header_row: number;
      destination_header: string;
      target_mapping_version: string;
      overwrite_policy: "NO_OVERWRITE" | "OVERWRITE_WITH_HISTORY";
    }>(`SELECT * FROM kcm_lectura.obtener_liberaciones_pendientes(500);`);

    return rows.map((r) => ({
      idempotencyKey: r.idempotency_key,
      batchId: r.batch_id,
      sessionId: r.session_id,
      employeeId: r.employee_id,
      trainingId: r.training_id,
      completionDate: r.completion_date,
      destinationSheet: r.destination_sheet,
      destinationColumn: r.destination_column,
      headerRow: Number(r.header_row),
      destinationHeader: r.destination_header,
      targetMappingVersion: r.target_mapping_version,
      overwritePolicy: r.overwrite_policy,
    }));
  }

  async listReleaseAcks(): Promise<readonly ExcelReleaseAck[]> {
    const { rows } = await this.#db.query<{
      acuse_id: string;
      solicitud_id: string;
      cliente_equipo: string;
      clave_idempotencia: string;
      lote_id: string;
      version_mapeo: string;
      fecha_capacitacion: string;
      estado: string;
      sha256_xlsb: string | null;
      direccion_aplicada: string | null;
      detalle: string | null;
      recibido_en: string | Date;
    }>(
      `SELECT acuse_id, solicitud_id, cliente_equipo, clave_idempotencia, lote_id,
              version_mapeo, fecha_capacitacion, estado, sha256_xlsb,
              direccion_aplicada, detalle, recibido_en
         FROM kcm.acuse_liberacion_vba
        ORDER BY recibido_en ASC;`,
    );
    return rows.map((r) => ({
      ackId: r.acuse_id,
      requestId: r.solicitud_id,
      clientId: r.cliente_equipo,
      idempotencyKey: r.clave_idempotencia,
      batchId: r.lote_id,
      targetMappingVersion: r.version_mapeo,
      completionDate: String(r.fecha_capacitacion).slice(0, 10),
      status: r.estado,
      workbookSha256: r.sha256_xlsb ?? "",
      destinationAddress: r.direccion_aplicada ?? "",
      detail: r.detalle ?? "",
      receivedAt: iso(r.recibido_en),
    }));
  }

  /**
   * El lote entero entra en una transacción: un acuse a medias dejaría al
   * cliente sin saber cuáles quedaron registrados.
   */
  async appendReleaseAcks(rows: readonly ExcelReleaseAck[]): Promise<void> {
    if (rows.length === 0) return;
    await this.#db.transaction(async (tx) => {
      for (const row of rows) {
        await tx.query(
          `INSERT INTO kcm.acuse_liberacion_vba (
             acuse_id, clave_idempotencia, lote_id, cliente_equipo, version_mapeo,
             fecha_capacitacion, estado, sha256_xlsb, direccion_aplicada,
             detalle, solicitud_id, recibido_en
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);`,
          [
            row.ackId,
            row.idempotencyKey,
            row.batchId,
            row.clientId,
            row.targetMappingVersion,
            row.completionDate,
            row.status,
            row.workbookSha256 || null,
            row.destinationAddress || null,
            row.detail || null,
            row.requestId,
            row.receivedAt,
          ],
        );
      }
    });
  }

  // ------------------------------------------------------------------------ DC-3

  async listDc3Events(): Promise<readonly Dc3BridgeEvent[]> {
    const { rows } = await this.#db.query<{
      evento_id: string;
      solicitud_id: string;
      client_id: string;
      dc3_key: string;
      numero_trabajador: string;
      clave_curso: string;
      fecha_curso: string | null;
      estado: string;
      sha256_archivo: string | null;
      generado_en: string | Date | null;
      codigo_error: string | null;
      recibido_en: string | Date;
    }>(
      `SELECT evento_id, solicitud_id, client_id, dc3_key, numero_trabajador, clave_curso,
              fecha_curso, estado, sha256_archivo, generado_en, codigo_error, recibido_en
         FROM kcm.evento_dc3_vba
        ORDER BY recibido_en ASC;`,
    );
    return rows.map((r) => ({
      eventId: r.evento_id,
      requestId: r.solicitud_id,
      clientId: r.client_id,
      dc3Key: r.dc3_key,
      employeeId: r.numero_trabajador,
      courseId: r.clave_curso,
      completionDate: r.fecha_curso ? String(r.fecha_curso).slice(0, 10) : "",
      status: r.estado,
      fileSha256: r.sha256_archivo ?? "",
      generatedAt: r.generado_en ? iso(r.generado_en) : "",
      errorCode: r.codigo_error ?? "",
      receivedAt: iso(r.recibido_en),
    }));
  }

  async appendDc3Events(rows: readonly Dc3BridgeEvent[]): Promise<void> {
    if (rows.length === 0) return;
    await this.#db.transaction(async (tx) => {
      for (const row of rows) {
        await tx.query(
          `INSERT INTO kcm.evento_dc3_vba (
             evento_id, solicitud_id, client_id, dc3_key, numero_trabajador,
             clave_curso, fecha_curso, estado, sha256_archivo, generado_en,
             codigo_error, recibido_en
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (evento_id) DO NOTHING;`,
          [
            row.eventId,
            row.requestId,
            row.clientId,
            row.dc3Key,
            row.employeeId,
            row.courseId,
            row.completionDate || null,
            row.status,
            row.fileSha256 || null,
            row.generatedAt || null,
            row.errorCode || null,
            row.receivedAt,
          ],
        );
      }
    });
  }

  // ----------------------------------------------------------------------- nonce

  async useNonce(clientId: string, nonce: string, expiresAt: string): Promise<boolean> {
    // La limpieza va antes del intento: una fila caducada no debe rechazar un
    // nonce nuevo, y así la tabla no crece sin fin.
    await this.#db.query(`DELETE FROM kcm.nonce_puente WHERE expira_en < now();`);
    const { rows } = await this.#db.query<{ nonce: string }>(
      `INSERT INTO kcm.nonce_puente (client_id, nonce, expira_en)
       VALUES ($1,$2,$3)
       ON CONFLICT (client_id, nonce) DO NOTHING
       RETURNING nonce;`,
      [clientId, nonce, expiresAt],
    );
    return rows.length > 0;
  }

  // ----------------------------------------------------------------- Power Query

  async listPowerQueryWorkers(): Promise<readonly PowerQueryWorkerRow[]> {
    const { rows } = await this.#db.query<{
      employee_id: string;
      department: string;
      area: string;
      position: string;
      active: boolean;
    }>(`SELECT * FROM kcm_lectura.obtener_padron_power_query();`);
    return rows.map((r) => ({
      employeeId: r.employee_id,
      department: r.department,
      area: r.area,
      position: r.position,
      active: Boolean(r.active),
    }));
  }

  // -------------------------------------------------------------------- snapshot

  async saveImportSnapshot(importId: string, snapshot: MatrixSnapshot): Promise<void> {
    await this.#db.query(
      `INSERT INTO kcm.snapshot_importacion (importacion_id, snapshot)
       VALUES ($1, $2)
       ON CONFLICT (importacion_id) DO UPDATE SET snapshot = EXCLUDED.snapshot;`,
      [importId, JSON.stringify(snapshot)],
    );
  }

  async getImportSnapshot(importId: string): Promise<MatrixSnapshot | null> {
    const { rows } = await this.#db.query<{ snapshot: MatrixSnapshot }>(
      `SELECT snapshot FROM kcm.snapshot_importacion WHERE importacion_id = $1;`,
      [importId],
    );
    return rows[0]?.snapshot ?? null;
  }
}
