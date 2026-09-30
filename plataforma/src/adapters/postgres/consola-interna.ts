import type {
  DeclareFieldInput,
  DeclaredField,
  OrigenDeCampo,
  ReleaseAuditRow,
  RoomAuditRow,
  SessionAuditRow,
  TablePreview,
  TableSummary,
  TipoDeCampo,
} from "../../domain/consola-interna/tipos.ts";
import {
  COLUMNAS_ENMASCARADAS,
  ESQUEMAS_DEL_DOMINIO,
  TABLAS_VEDADAS,
} from "../../domain/consola-interna/tipos.ts";
import { ROOMS } from "../../domain/salas/tipos.ts";
import type { InternalConsolePort } from "../../ports/consola-interna.port.ts";
import type { SqlExecutor } from "./matriz.ts";

const OCULTO = "••••••";

function isoObligatorio(valor: string | Date): string {
  return new Date(valor).toISOString();
}
function soloFechaObligatoria(valor: string | Date): string {
  return typeof valor === "string" ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);
}
function soloFecha(valor: string | Date | null): string | undefined {
  return valor === null ? undefined : soloFechaObligatoria(valor);
}
function soloHora(valor: string): string {
  return String(valor).slice(0, 5);
}

export class SupabaseInternalConsoleRepository implements InternalConsolePort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async listSessionAudit(days: number): Promise<readonly SessionAuditRow[]> {
    const { rows } = await this.#db.query<{
      sesion_id: string;
      codigo_sesion: string;
      curso: string;
      capacitador: string;
      fecha_sesion: string | Date;
      estado: string;
      autorizada: boolean;
      creada_en: string | Date;
      abierta_en: string | Date | null;
      cerrada_en: string | Date | null;
      asistencias: number;
      liberadas: number;
    }>(
      `SELECT s.sesion_id,
              s.codigo_sesion,
              c.nombre AS curso,
              COALESCE(a.nombre_visible, a.identificador, '') AS capacitador,
              s.fecha_sesion,
              s.estado::text AS estado,
              s.autorizada,
              s.creada_en,
              s.abierta_en,
              s.cerrada_en,
              (SELECT count(*) FROM operacion.asistencia x WHERE x.sesion_id = s.sesion_id) AS asistencias,
              (SELECT count(*) FROM operacion.asistencia x
                WHERE x.sesion_id = s.sesion_id AND x.liberada) AS liberadas
         FROM operacion.sesion s
         JOIN catalogo.capacitacion c ON c.capacitacion_id = s.capacitacion_id
         LEFT JOIN seguridad.actor a ON a.actor_id = s.capacitador_id
        WHERE GREATEST(s.creada_en, COALESCE(s.abierta_en, s.creada_en),
                       COALESCE(s.cerrada_en, s.creada_en)) >= now() - make_interval(days => $1::int)
        ORDER BY GREATEST(s.creada_en, COALESCE(s.abierta_en, s.creada_en),
                          COALESCE(s.cerrada_en, s.creada_en)) DESC;`,
      [days],
    );

    return rows.map((r) => ({
      sessionId: r.sesion_id,
      code: r.codigo_sesion,
      course: r.curso,
      trainer: r.capacitador,
      date: soloFecha(r.fecha_sesion) ?? "",
      state: r.estado,
      authorized: r.autorizada,
      createdAt: isoObligatorio(r.creada_en),
      ...(r.abierta_en ? { openedAt: isoObligatorio(r.abierta_en) } : {}),
      ...(r.cerrada_en ? { closedAt: isoObligatorio(r.cerrada_en) } : {}),
      attendances: Number(r.asistencias),
      released: Number(r.liberadas),
    }));
  }

  async listRoomAudit(days: number): Promise<readonly RoomAuditRow[]> {
    const { rows } = await this.#db.query<{
      reserva_id: string;
      clave_sala: string;
      sala: string;
      fecha: string | Date;
      hora_inicio: string;
      hora_fin: string;
      solicitante_nombre: string;
      solicitante_area: string | null;
      estado: string;
      origen: string;
      creada_en: string | Date;
      cancelada_en: string | Date | null;
      cancelador: string | null;
      motivo_cancelacion: string | null;
    }>(
      `SELECT r.reserva_id,
              sa.clave_sala,
              sa.nombre_visible AS sala,
              r.fecha,
              r.hora_inicio::text AS hora_inicio,
              r.hora_fin::text AS hora_fin,
              r.solicitante_nombre,
              r.solicitante_area,
              r.estado::text AS estado,
              r.origen::text AS origen,
              r.creada_en,
              r.cancelada_en,
              COALESCE(ac.nombre_visible, ac.identificador) AS cancelador,
              r.motivo_cancelacion
         FROM operacion.sala_reserva r
         JOIN catalogo.sala sa ON sa.sala_id = r.sala_id
         LEFT JOIN seguridad.actor ac ON ac.actor_id = r.cancelada_por
        WHERE GREATEST(r.creada_en, COALESCE(r.cancelada_en, r.creada_en))
              >= now() - make_interval(days => $1::int)
        ORDER BY GREATEST(r.creada_en, COALESCE(r.cancelada_en, r.creada_en)) DESC;`,
      [days],
    );

    return rows.map((r) => ({
      reservationId: r.reserva_id,
      room: nombreDeSala(r.clave_sala, r.sala),
      date: soloFecha(r.fecha) ?? "",
      startTime: soloHora(r.hora_inicio),
      endTime: soloHora(r.hora_fin),
      requesterName: r.solicitante_nombre,
      requesterArea: r.solicitante_area ?? "",
      status: r.estado,
      origin: r.origen,
      createdAt: isoObligatorio(r.creada_en),
      ...(r.cancelada_en ? { cancelledAt: isoObligatorio(r.cancelada_en) } : {}),
      ...(r.cancelador ? { cancelledBy: r.cancelador } : {}),
      ...(r.motivo_cancelacion ? { cancellationReason: r.motivo_cancelacion } : {}),
    }));
  }

  async listReleaseAudit(limit: number): Promise<readonly ReleaseAuditRow[]> {
    const { rows } = await this.#db.query<{
      liberacion_id: string;
      lote_id: string;
      solicitud_id: string;
      codigo_sesion: string;
      numero_trabajador: string;
      nombre_completo: string;
      curso: string;
      fecha_efectiva: string | Date;
      resultado: string;
      creada_en: string | Date;
      estado_lote: string;
      liberado_por: string;
      fecha_anterior: string | Date | null;
      motivo_sobrescritura: string | null;
      actor_sobrescritura: string | null;
      sobrescrito_en: string | Date | null;
    }>(
      `SELECT l.liberacion_id,
              l.lote_id,
              lo.solicitud_id,
              s.codigo_sesion,
              t.numero_trabajador,
              t.nombre_completo,
              c.nombre AS curso,
              l.fecha_efectiva,
              l.resultado,
              l.creada_en,
              lo.estado::text AS estado_lote,
              COALESCE(cb.nombre_visible, cb.identificador, '') AS liberado_por,
              h.fecha_anterior,
              COALESCE(lo.motivo_sobrescritura, h.motivo) AS motivo_sobrescritura,
              COALESCE(ha.nombre_visible, ha.identificador) AS actor_sobrescritura,
              h.registrado_en AS sobrescrito_en
         FROM matriz.liberacion l
         JOIN matriz.liberacion_lote lo ON lo.lote_id = l.lote_id
         JOIN operacion.sesion s ON s.sesion_id = l.sesion_id
         JOIN organizacion.trabajador t ON t.trabajador_id = l.trabajador_id
         JOIN catalogo.capacitacion c ON c.capacitacion_id = l.capacitacion_id
         LEFT JOIN seguridad.actor cb ON cb.actor_id = lo.creado_por
         LEFT JOIN LATERAL (
           SELECT hh.fecha_anterior, hh.motivo, hh.actor_id, hh.registrado_en
             FROM operacion.historial_capacitacion_cambio hh
            WHERE hh.trabajador_id = l.trabajador_id
              AND hh.capacitacion_id = l.capacitacion_id
              AND hh.tipo_cambio = 'SOBRESCRITA'
              AND hh.procedencia = 'SESSION_RELEASE'
              AND hh.fecha_nueva = l.fecha_efectiva
            ORDER BY hh.secuencia DESC
            LIMIT 1
         ) h ON true
         LEFT JOIN seguridad.actor ha ON ha.actor_id = h.actor_id
        ORDER BY l.creada_en DESC
        LIMIT $1;`,
      [limit],
    );

    return rows.map((r) => ({
      releaseId: r.liberacion_id,
      batchId: r.lote_id,
      requestId: r.solicitud_id,
      sessionCode: r.codigo_sesion,
      workerNumber: r.numero_trabajador,
      workerName: r.nombre_completo,
      course: r.curso,
      effectiveDate: soloFecha(r.fecha_efectiva) ?? "",
      result: r.resultado,
      appliedAt: isoObligatorio(r.creada_en),
      batchState: r.estado_lote,
      releasedBy: r.liberado_por,
      ...(r.fecha_anterior ? { previousDate: soloFechaObligatoria(r.fecha_anterior) } : {}),
      ...(r.fecha_anterior && r.motivo_sobrescritura
        ? { overwriteReason: r.motivo_sobrescritura }
        : {}),
      ...(r.fecha_anterior && r.actor_sobrescritura
        ? { overwriteActor: r.actor_sobrescritura }
        : {}),
      ...(r.fecha_anterior && r.sobrescrito_en
        ? { overwriteAt: isoObligatorio(r.sobrescrito_en) }
        : {}),
    }));
  }

  async listDeclaredFields(): Promise<readonly DeclaredField[]> {
    const { rows } = await this.#db.query<{
      campo_id: string;
      nombre_campo: string;
      tipo_dato: string;
      descripcion: string | null;
      origen_fuente: string;
      aprobado_para_reglas: boolean;
      aprobado_por: string | null;
      aprobado_en: string | Date | null;
      creado_en: string | Date;
      valores: number;
    }>(
      `SELECT cd.campo_id,
              cd.nombre_campo,
              cd.tipo_dato,
              cd.descripcion,
              cd.origen_fuente::text AS origen_fuente,
              cd.aprobado_para_reglas,
              COALESCE(ap.nombre_visible, ap.identificador) AS aprobado_por,
              cd.aprobado_en,
              cd.creado_en,
              (SELECT count(*) FROM organizacion.trabajador_atributo ad
                WHERE ad.nombre_atributo = cd.nombre_campo
                  AND ad.vigente_hasta IS NULL) AS valores
         FROM organizacion.atributo_definicion cd
         LEFT JOIN seguridad.actor ap ON ap.actor_id = cd.aprobado_por
        ORDER BY cd.creado_en DESC;`,
    );

    return rows.map((r) => ({
      fieldId: r.campo_id,
      name: r.nombre_campo,
      dataType: r.tipo_dato as TipoDeCampo,
      ...(r.descripcion ? { description: r.descripcion } : {}),
      source: r.origen_fuente as OrigenDeCampo,
      approvedForRules: r.aprobado_para_reglas,
      ...(r.aprobado_por ? { approvedBy: r.aprobado_por } : {}),
      ...(r.aprobado_en ? { approvedAt: isoObligatorio(r.aprobado_en) } : {}),
      createdAt: isoObligatorio(r.creado_en),
      valuesInUse: Number(r.valores),
    }));
  }

  async declareField(input: DeclareFieldInput, actor: string): Promise<DeclaredField> {
    const campoId = await this.#db.transaction(async (tx) => {
      const { rows } = await tx.query<{ campo_id: string }>(
        `INSERT INTO organizacion.atributo_definicion (nombre_campo, tipo_dato, descripcion, origen_fuente)
         VALUES ($1, $2, $3, $4::comun.origen_fuente)
         RETURNING campo_id;`,
        [input.name, input.dataType, input.description ?? null, input.source],
      );
      const id = rows[0]?.campo_id;
      if (id === undefined) throw new Error("El alta del campo no devolvió identificador.");

      await tx.query(
        `INSERT INTO sistema.bitacora_auditoria (
           actor, rol, entidad_tipo, entidad_id, accion, estado_nuevo, motivo, procedencia
         ) VALUES ($1, 'ADMINISTRADOR', 'CAMPO_DECLARADO', $2, 'DECLARAR', 'SIN_APROBAR', $3, 'PLATAFORMA');`,
        [actor, id, `Campo «${input.name}» declarado como ${input.dataType}.`],
      );
      return id;
    });

    return this.#buscarCampo(campoId);
  }

  async approveField(fieldId: string, actor: string): Promise<DeclaredField> {
    await this.#db.transaction(async (tx) => {
      const actorId = await resolverActor(tx, actor);
      const { rows } = await tx.query<{ nombre_campo: string }>(
        `UPDATE organizacion.atributo_definicion
            SET aprobado_para_reglas = true,
                aprobado_por = $2,
                aprobado_en = now()
          WHERE campo_id = $1
            AND aprobado_para_reglas = false
          RETURNING nombre_campo;`,
        [fieldId, actorId],
      );

      const nombre = rows[0]?.nombre_campo;
      if (nombre === undefined) return;

      await tx.query(
        `INSERT INTO sistema.bitacora_auditoria (
           actor, rol, entidad_tipo, entidad_id, accion,
           estado_anterior, estado_nuevo, motivo, procedencia
         ) VALUES ($1, 'ADMINISTRADOR', 'CAMPO_DECLARADO', $2, 'APROBAR',
                   'SIN_APROBAR', 'APROBADO', $3, 'PLATAFORMA');`,
        [actor, fieldId, `Campo «${nombre}» autorizado para alimentar reglas.`],
      );
    });

    return this.#buscarCampo(fieldId);
  }

  async #buscarCampo(fieldId: string): Promise<DeclaredField> {
    const campos = await this.listDeclaredFields();
    const campo = campos.find((candidato) => candidato.fieldId === fieldId);
    if (campo === undefined) throw new Error(`El campo ${fieldId} desapareció tras escribirlo.`);
    return campo;
  }

  async listTables(): Promise<readonly TableSummary[]> {
    const { rows } = await this.#db.query<{
      tabla: string;
      comentario: string | null;
      filas: string | number;
      solo_agrega: boolean;
    }>(
      `SELECT c.relname AS tabla,
              obj_description(c.oid, 'pg_class') AS comentario,
              (xpath(
                '/row/cnt/text()',
                query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', n.nspname, c.relname),
                             false, true, '')
              ))[1]::text::bigint AS filas,
              EXISTS (
                SELECT 1 FROM pg_trigger tg
                 WHERE tg.tgrelid = c.oid
                   AND NOT tg.tgisinternal
                   AND tg.tgname LIKE '%solo_agrega%'
              ) AS solo_agrega
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY ($2::text[])
          AND c.relkind = 'r'
          AND c.relname <> ALL ($1::text[])
        ORDER BY c.relname;`,
      [TABLAS_VEDADAS, ESQUEMAS_DEL_DOMINIO],
    );

    return rows.map((r) => ({
      name: r.tabla,
      ...(r.comentario ? { comment: r.comentario } : {}),
      rows: Number(r.filas),
      appendOnly: r.solo_agrega,
    }));
  }

  async previewTable(table: string, limit: number, offset: number): Promise<TablePreview | null> {
    const { rows: catalogo } = await this.#db.query<{
      esquema: string;
      tabla: string;
      comentario: string | null;
    }>(
      `SELECT n.nspname AS esquema, c.relname AS tabla,
              obj_description(c.oid, 'pg_class') AS comentario
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY ($3::text[])
          AND c.relkind = 'r'
          AND c.relname = $1
          AND c.relname <> ALL ($2::text[])
        LIMIT 1;`,
      [table, TABLAS_VEDADAS, ESQUEMAS_DEL_DOMINIO],
    );
    const encontrada = catalogo[0];
    if (encontrada === undefined) return null;

    const { rows: columnas } = await this.#db.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position;`,
      [encontrada.esquema, encontrada.tabla],
    );
    const nombresDeColumna = columnas.map((c) => c.column_name);
    const enmascaradas = nombresDeColumna.filter(esColumnaSensible);

    const citar = (nombre: string): string => `"${nombre.replace(/"/gu, '""')}"`;
    const identificador = `${citar(encontrada.esquema)}.${citar(encontrada.tabla)}`;

    return this.#db.transaction(async (tx) => {
      await tx.query("SET TRANSACTION READ ONLY;");

      const { rows: conteo } = await tx.query<{ total: string | number }>(
        `SELECT count(*) AS total FROM ${identificador};`,
      );
      const { rows: datos } = await tx.query<Record<string, unknown>>(
        `SELECT * FROM ${identificador} ORDER BY 1 LIMIT $1 OFFSET $2;`,
        [limit, offset],
      );

      return {
        table: encontrada.tabla,
        ...(encontrada.comentario ? { comment: encontrada.comentario } : {}),
        columns: nombresDeColumna,
        rows: datos.map((fila) =>
          nombresDeColumna.map((columna) =>
            esColumnaSensible(columna) ? OCULTO : aTexto(fila[columna]),
          ),
        ),
        total: Number(conteo[0]?.total ?? 0),
        limit,
        offset,
        maskedColumns: enmascaradas,
      } satisfies TablePreview;
    });
  }
}

function nombreDeSala(claveSala: string, nombreEnBase: string): string {
  return ROOMS.find((sala) => sala.roomId === claveSala)?.name ?? nombreEnBase;
}

function esColumnaSensible(columna: string): boolean {
  const nombre = columna.toLowerCase();
  return COLUMNAS_ENMASCARADAS.some(
    (sensible) => nombre === sensible || nombre.endsWith(`_${sensible}`),
  );
}

function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") return JSON.stringify(valor);
  switch (typeof valor) {
    case "string":
      return valor;
    case "number":
    case "boolean":
    case "bigint":
      return String(valor);
    default:
      return JSON.stringify(valor) ?? "";
  }
}

async function resolverActor(tx: SqlExecutor, identificador: string): Promise<string> {
  const clave = identificador.trim() || "SISTEMA";
  const { rows } = await tx.query<{ actor_id: string }>(
    `INSERT INTO seguridad.actor (identificador, nombre_visible)
     VALUES ($1, $1)
     ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
     RETURNING actor_id;`,
    [clave],
  );
  const actorId = rows[0]?.actor_id;
  if (actorId === undefined) throw new Error(`No fue posible resolver el actor ${clave}`);
  return actorId;
}
