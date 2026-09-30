/**
 * Adaptador PostgreSQL del puente VBA y Power Query (Funciones 10 y 11).
 *
 * Es el que hace que la credencial sobreviva a un reinicio y que un acuse quede
 * en el ledger. Todo lo que toca vive en `database/migrations/0025`.
 *
 * Dos cosas que no son evidentes al leer el puerto:
 *
 * 1. `listPendingReleases` no consulta tablas: llama a
 *    `lectura.obtener_liberaciones_pendientes`, que resuelve la liberación
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
  UltimoLoteAplicado,
  ExcelRepository,
  PendingExcelRelease,
  PowerQueryWorkerRow,
  UploadKey,
  UploadPart,
  UploadPartSummary,
} from "../../domain/excel/tipos.ts";
import type { SqlExecutor } from "./matriz.ts";

/** Actor bajo el que se emiten y revocan credenciales cuando no hay uno nominal. */
const ACTOR_SISTEMA = "sistema.configuracion";

interface FilaCredencial {
  credencial_id: string;
  cliente_id: string;
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
      `INSERT INTO seguridad.actor (identificador, nombre_visible)
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
      `INSERT INTO seguridad.credencial_equipo (
         credencial_id, cliente_id, principal, perfil_windows, equipo,
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
      `SELECT credencial_id, cliente_id, principal, perfil_windows, equipo, alcance,
              recurso, sal, credencial_hash, emitida_en, expira_en, revocada_en,
              motivo_revocacion, ultimo_uso_en
         FROM seguridad.credencial_equipo
        WHERE cliente_id = $1 AND alcance = $2
        ORDER BY emitida_en DESC;`,
      [clientId, scope],
    );
    return rows.map((r) => ({
      credentialId: r.credencial_id,
      clientId: r.cliente_id,
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
      `UPDATE seguridad.credencial_equipo
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
      codigo_sesion: string | null;
      nombre_trabajador: string | null;
      fecha_anterior_esperada: string | null;
    }>(
      // El código de la sesión no sale de la función de lectura y se recoge
      // aquí, no dentro de ella: cambiarle la firma obligaría a una migración
      // para agregar un dato que ninguna de sus reglas necesita. El `LEFT JOIN`
      // no puede quitar renglones —una liberación sin sesión no existe—, y si
      // alguna vez faltara, la fila sigue viniendo con el código vacío en vez de
      // desaparecer de la carga que Excel debe escribir.
      //
      // El nombre del padrón y la fecha que la liberación autorizó sobrescribir
      // se recogen igual, para `RELEASE_CONTEXT_V1`. La fecha anterior es la
      // vigente del historial: el historial no cambia hasta que Excel confirma,
      // así que es la misma que la liberación vio y por la que pidió motivo.
      // Sin registro vigente, la plataforma esperaba la celda libre.
      `SELECT p.*, s.codigo_sesion,
              t.nombre_completo AS nombre_trabajador,
              CASE WHEN h.fecha_capacitacion IS DISTINCT FROM l.fecha_efectiva
                   THEN to_char(h.fecha_capacitacion, 'YYYY-MM-DD') END AS fecha_anterior_esperada
         FROM lectura.obtener_liberaciones_pendientes(500) p
         LEFT JOIN operacion.sesion s ON s.sesion_id = p.session_id::uuid
         LEFT JOIN organizacion.trabajador t ON t.numero_trabajador = p.employee_id
         LEFT JOIN matriz.liberacion l ON l.clave_idempotencia = p.idempotency_key
         LEFT JOIN operacion.historial_capacitacion h
           ON h.trabajador_id = l.trabajador_id
          AND h.capacitacion_id = l.capacitacion_id
          AND h.estado_registro = 'VIGENTE';`,
    );

    return rows.map((r) => ({
      idempotencyKey: r.idempotency_key,
      batchId: r.batch_id,
      sessionId: r.session_id,
      sessionCode: r.codigo_sesion ?? "",
      employeeId: r.employee_id,
      trainingId: r.training_id,
      completionDate: r.completion_date,
      destinationSheet: r.destination_sheet,
      destinationColumn: r.destination_column,
      headerRow: Number(r.header_row),
      destinationHeader: r.destination_header,
      targetMappingVersion: r.target_mapping_version,
      overwritePolicy: r.overwrite_policy,
      workerName: r.nombre_trabajador ?? "",
      expectedPreviousDate: r.fecha_anterior_esperada ?? "",
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
         FROM matriz.liberacion_acuse
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

  async lastAppliedReleaseBatch(): Promise<UltimoLoteAplicado | undefined> {
    const { rows } = await this.#db.query<{
      recibido_en: string | Date;
      fechas: string | number;
      cliente_equipo: string;
    }>(
      `SELECT max(recibido_en) AS recibido_en, count(*) AS fechas, min(cliente_equipo) AS cliente_equipo
         FROM matriz.liberacion_acuse
        WHERE estado::text IN ('APPLIED', 'RECOVERED')
        GROUP BY solicitud_id
        ORDER BY max(recibido_en) DESC
        LIMIT 1;`,
    );
    const fila = rows[0];
    return fila
      ? {
          recibidoEn: iso(fila.recibido_en),
          fechas: Number(fila.fechas),
          equipo: fila.cliente_equipo,
        }
      : undefined;
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
          `INSERT INTO matriz.liberacion_acuse (
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
        // Con el acuse efectivo la fecha ya está en la matriz: sólo entonces
        // entra al historial. Misma transacción, para que no haya acuse sin
        // registro ni registro sin acuse.
        if (row.status === "APPLIED" || row.status === "RECOVERED") {
          await materializarLiberacion(tx, row.idempotencyKey);
        }
      }
    });
  }

  // ------------------------------------------------------------------------ DC-3

  async listDc3Events(): Promise<readonly Dc3BridgeEvent[]> {
    const { rows } = await this.#db.query<{
      evento_id: string;
      solicitud_id: string;
      cliente_id: string;
      clave_dc3: string;
      numero_trabajador: string;
      clave_curso: string;
      fecha_curso: string | null;
      estado: string;
      sha256_archivo: string | null;
      generado_en: string | Date | null;
      codigo_error: string | null;
      recibido_en: string | Date;
    }>(
      `SELECT evento_id, solicitud_id, cliente_id, clave_dc3, numero_trabajador, clave_curso,
              fecha_curso, estado, sha256_archivo, generado_en, codigo_error, recibido_en
         FROM dc3.evento_excel
        ORDER BY recibido_en ASC;`,
    );
    return rows.map((r) => ({
      eventId: r.evento_id,
      requestId: r.solicitud_id,
      clientId: r.cliente_id,
      dc3Key: r.clave_dc3,
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
          `INSERT INTO dc3.evento_excel (
             evento_id, solicitud_id, cliente_id, clave_dc3, numero_trabajador,
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
    await this.#db.query(`DELETE FROM seguridad.nonce WHERE expira_en < now();`);
    const { rows } = await this.#db.query<{ nonce: string }>(
      `INSERT INTO seguridad.nonce (cliente_id, nonce, expira_en)
       VALUES ($1,$2,$3)
       ON CONFLICT (cliente_id, nonce) DO NOTHING
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
    }>(`SELECT * FROM lectura.obtener_padron_power_query();`);
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
      `INSERT INTO matriz.importacion_contenido (importacion_id, contenido)
       VALUES ($1, $2)
       ON CONFLICT (importacion_id) DO UPDATE SET contenido = EXCLUDED.contenido;`,
      [importId, JSON.stringify(snapshot)],
    );
  }

  async getImportSnapshot(importId: string): Promise<MatrixSnapshot | null> {
    const { rows } = await this.#db.query<{ snapshot: MatrixSnapshot }>(
      `SELECT contenido AS snapshot FROM matriz.importacion_contenido WHERE importacion_id = $1;`,
      [importId],
    );
    return rows[0]?.snapshot ?? null;
  }

  // ------------------------------------------------------------ envío en partes

  async saveUploadPart(part: UploadPart, now: string): Promise<void> {
    // Como con los nonces, la limpieza va antes: la tabla no crece con envíos
    // que se interrumpieron y nadie repitió.
    await this.#db.query(`DELETE FROM sistema.envio_parte WHERE vence_en <= $1;`, [now]);
    await this.#db.query(
      `INSERT INTO sistema.envio_parte
              (cliente_id, solicitud_id, total_caracteres, numero_parte, total_partes,
               accion, contenido, vence_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (cliente_id, solicitud_id, total_caracteres, numero_parte) DO UPDATE
          SET total_partes = EXCLUDED.total_partes,
              accion = EXCLUDED.accion,
              contenido = EXCLUDED.contenido,
              vence_en = EXCLUDED.vence_en,
              recibida_en = now();`,
      [
        part.clientId,
        part.requestId,
        part.totalCharacters,
        part.partNumber,
        part.totalParts,
        part.action,
        part.content,
        part.expiresAt,
      ],
    );
  }

  async listUploadPartNumbers(
    envio: UploadKey,
    now: string,
  ): Promise<readonly UploadPartSummary[]> {
    // Sin `contenido`: mientras falten partes, cada llegada sólo cuenta cuáles hay.
    const { rows } = await this.#db.query<{
      numero_parte: number;
      total_partes: number;
      accion: string;
    }>(
      `SELECT numero_parte, total_partes, accion
         FROM sistema.envio_parte
        WHERE cliente_id = $1 AND solicitud_id = $2 AND total_caracteres = $3
          AND vence_en > $4;`,
      [envio.clientId, envio.requestId, envio.totalCharacters, now],
    );
    return rows.map((r) => ({
      partNumber: Number(r.numero_parte),
      totalParts: Number(r.total_partes),
      action: r.accion,
    }));
  }

  async discardUploadParts(envio: UploadKey): Promise<void> {
    await this.#db.query(
      `DELETE FROM sistema.envio_parte
        WHERE cliente_id = $1 AND solicitud_id = $2 AND total_caracteres = $3;`,
      [envio.clientId, envio.requestId, envio.totalCharacters],
    );
  }

  async listUploadParts(envio: UploadKey, now: string): Promise<readonly UploadPart[]> {
    const { rows } = await this.#db.query<{
      cliente_id: string;
      solicitud_id: string;
      total_caracteres: number;
      numero_parte: number;
      total_partes: number;
      accion: string;
      contenido: string;
      vence_en: string | Date;
    }>(
      `SELECT cliente_id, solicitud_id, total_caracteres, numero_parte, total_partes,
              accion, contenido, vence_en
         FROM sistema.envio_parte
        WHERE cliente_id = $1 AND solicitud_id = $2 AND total_caracteres = $3
          AND vence_en > $4;`,
      [envio.clientId, envio.requestId, envio.totalCharacters, now],
    );
    return rows.map((r) => ({
      clientId: r.cliente_id,
      requestId: r.solicitud_id,
      totalCharacters: Number(r.total_caracteres),
      partNumber: Number(r.numero_parte),
      totalParts: Number(r.total_partes),
      action: r.accion,
      content: r.contenido,
      expiresAt: new Date(r.vence_en).toISOString(),
    }));
  }
}

/**
 * Pasa al historial una fecha liberada que Excel ya escribió en la matriz.
 *
 * Idempotente: si el historial ya tiene la clave, no hace nada. Si había una
 * fecha vigente distinta, primero asienta el cambio `SOBRESCRITA` con el motivo
 * y el actor del lote, después retira la vigente y al final agrega la nueva.
 */
async function materializarLiberacion(
  tx: { query: SqlExecutor["query"] },
  clave: string,
): Promise<void> {
  const { rows } = await tx.query<{
    trabajador_id: string;
    capacitacion_id: string;
    fecha: string;
    sesion_id: string;
    version_mapeo: string;
    lote_id: string;
    marcador: string;
    solicitud_id: string | null;
    motivo_sobrescritura: string | null;
    creado_por: string | null;
  }>(
    `SELECT l.trabajador_id, l.capacitacion_id, to_char(l.fecha_efectiva, 'YYYY-MM-DD') AS fecha,
            l.sesion_id, l.version_mapeo, l.lote_id, l.marcador,
            lo.solicitud_id, lo.motivo_sobrescritura, lo.creado_por
       FROM matriz.liberacion l
       JOIN matriz.liberacion_lote lo ON lo.lote_id = l.lote_id
      WHERE l.clave_idempotencia = $1
        AND NOT EXISTS (
          SELECT 1 FROM operacion.historial_capacitacion h
           WHERE h.clave_idempotencia = l.clave_idempotencia
        );`,
    [clave],
  );
  const l = rows[0];
  if (!l) return;

  const previo = (
    await tx.query<{ registro_id: string; fecha: string }>(
      `SELECT registro_id, to_char(fecha_capacitacion, 'YYYY-MM-DD') AS fecha
         FROM operacion.historial_capacitacion
        WHERE trabajador_id = $1 AND capacitacion_id = $2 AND estado_registro = 'VIGENTE'
        FOR UPDATE;`,
      [l.trabajador_id, l.capacitacion_id],
    )
  ).rows[0];

  if (previo && previo.fecha !== l.fecha) {
    await tx.query(
      `INSERT INTO operacion.historial_capacitacion_cambio (
         registro_id, trabajador_id, capacitacion_id, tipo_cambio, fecha_anterior, fecha_nueva,
         estado_anterior, estado_nuevo, procedencia, actor_id, motivo, solicitud_id
       ) VALUES (
         $1, $2, $3, 'SOBRESCRITA', $4, $5, 'VIGENTE', 'VIGENTE', 'SESSION_RELEASE',
         COALESCE($6::uuid, (SELECT actor_id FROM seguridad.actor
                              WHERE identificador = 'SISTEMA' LIMIT 1)),
         $7, $8
       );`,
      [
        previo.registro_id,
        l.trabajador_id,
        l.capacitacion_id,
        previo.fecha,
        l.fecha,
        l.creado_por,
        (l.motivo_sobrescritura ?? "").trim() || "Liberación de sesión confirmada por Excel",
        l.solicitud_id,
      ],
    );
  }
  if (previo) {
    await tx.query(
      `UPDATE operacion.historial_capacitacion
          SET estado_registro = 'RETIRADO'
        WHERE registro_id = $1 AND estado_registro = 'VIGENTE';`,
      [previo.registro_id],
    );
  }

  await tx.query(
    `INSERT INTO operacion.historial_capacitacion (
       clave_idempotencia, trabajador_id, capacitacion_id, fecha_capacitacion, procedencia,
       estado_registro, sesion_id, liberacion_id, version_mapeo, lote_id, marcador, solicitud_id
     ) VALUES ($1, $2, $3, $4, 'SESSION_RELEASE', 'VIGENTE', $5, $6, $7, $6, $8, $9)
     ON CONFLICT (clave_idempotencia) DO NOTHING;`,
    [
      clave,
      l.trabajador_id,
      l.capacitacion_id,
      l.fecha,
      l.sesion_id,
      l.lote_id,
      l.version_mapeo,
      l.marcador,
      l.solicitud_id,
    ],
  );
}
