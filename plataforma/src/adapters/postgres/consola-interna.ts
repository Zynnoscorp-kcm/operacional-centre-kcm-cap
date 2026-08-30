/**
 * Adaptador PostgreSQL de la consola interna.
 *
 * Casi todo lo que hay aquí es `SELECT`. Las dos únicas escrituras —declarar un
 * campo y aprobarlo— van sobre `kcm.campo_declarado`, que es un catálogo, y
 * dejan su evento en `kcm.auditoria` dentro de la misma transacción: si la
 * bitácora falla, el alta no queda.
 *
 * Nada de aquí toca el camino de operación. Ni sesiones, ni asistencias, ni
 * liberaciones, ni el puente VBA: esas tablas se leen y no se escriben desde
 * este archivo. Es la garantía de que agregar una consola de consulta no puede
 * romper lo que ya funciona.
 */

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
import { COLUMNAS_ENMASCARADAS, TABLAS_VEDADAS } from "../../domain/consola-interna/tipos.ts";
import { ROOMS } from "../../domain/salas/tipos.ts";
import type { InternalConsolePort } from "../../ports/consola-interna.port.ts";
import type { SqlExecutor } from "./matriz.ts";

/** Lo que se enseña en lugar del valor de una columna enmascarada. */
const OCULTO = "••••••";

/**
 * Los campos opcionales del dominio se declaran con
 * `exactOptionalPropertyTypes`: o la propiedad está con un valor, o no está.
 * Por eso los conversores no devuelven `undefined` —el nulo se decide antes,
 * en el `...(condición ? { … } : {})` que arma el objeto—.
 */
function isoObligatorio(valor: string | Date): string {
  return new Date(valor).toISOString();
}
/** `date` llega como texto por el parser de `postgres-executor`; `time` como HH:MM:SS. */
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

  // ---------------------------------------------------------------------------
  // Auditoría — sesiones
  // ---------------------------------------------------------------------------

  /**
   * Una sesión entra si cualquiera de sus tres momentos cae en la ventana.
   * Filtrar sólo por `creada_en` escondería la sesión que se creó hace diez
   * días y se cerró ayer, que es justo la que se está buscando.
   */
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
              (SELECT count(*) FROM kcm.asistencia x WHERE x.sesion_id = s.sesion_id) AS asistencias,
              (SELECT count(*) FROM kcm.asistencia x
                WHERE x.sesion_id = s.sesion_id AND x.liberada) AS liberadas
         FROM kcm.sesion s
         JOIN kcm.capacitacion c ON c.capacitacion_id = s.capacitacion_id
         LEFT JOIN kcm.actor a ON a.actor_id = s.capacitador_id
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

  // ---------------------------------------------------------------------------
  // Auditoría — reservaciones de sala
  // ---------------------------------------------------------------------------

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
         FROM kcm.reserva_sala r
         JOIN kcm.sala sa ON sa.sala_id = r.sala_id
         LEFT JOIN kcm.actor ac ON ac.actor_id = r.cancelada_por
        WHERE GREATEST(r.creada_en, COALESCE(r.cancelada_en, r.creada_en))
              >= now() - make_interval(days => $1::int)
        ORDER BY GREATEST(r.creada_en, COALESCE(r.cancelada_en, r.creada_en)) DESC;`,
      [days],
    );

    return rows.map((r) => ({
      reservationId: r.reserva_id,
      // El nombre visible sale de `ROOMS`, no de la base. `kcm.sala` guarda los
      // nombres con los que se sembró el catálogo y renombrar una sala se hace
      // en la constante: si la auditoría leyera el de la base, la misma sala se
      // llamaría distinto según la pantalla.
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

  // ---------------------------------------------------------------------------
  // Auditoría — liberaciones y la fecha que sustituyeron
  // ---------------------------------------------------------------------------

  /**
   * La liberación sabe qué escribió; no sabe qué había antes. Eso vive en
   * `kcm.historial_sobrescritura_fecha`, el ledger que conserva el valor previo
   * de toda sobrescritura con actor, motivo y momento.
   *
   * El `LATERAL` los une por el único vínculo que existe entre los dos: mismo
   * trabajador, mismo curso, y la fecha nueva del historial es exactamente la
   * fecha efectiva de la liberación. Se restringe a `procedencia =
   * 'SESSION_RELEASE'` para no confundir una sobrescritura hecha por una
   * importación del XLSB con una hecha por una liberación, y toma la última por
   * secuencia porque el mismo par puede haberse sobrescrito más de una vez.
   *
   * Sin coincidencia, los campos van vacíos: esa liberación inscribió una fecha
   * donde no había ninguna, que es el caso normal.
   */
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
         FROM kcm.liberacion l
         JOIN kcm.lote_liberacion lo ON lo.lote_id = l.lote_id
         JOIN kcm.sesion s ON s.sesion_id = l.sesion_id
         JOIN kcm.trabajador t ON t.trabajador_id = l.trabajador_id
         JOIN kcm.capacitacion c ON c.capacitacion_id = l.capacitacion_id
         LEFT JOIN kcm.actor cb ON cb.actor_id = lo.creado_por
         LEFT JOIN LATERAL (
           SELECT hh.fecha_anterior, hh.motivo, hh.actor_id, hh.registrado_en
             FROM kcm.historial_sobrescritura_fecha hh
            WHERE hh.trabajador_id = l.trabajador_id
              AND hh.capacitacion_id = l.capacitacion_id
              AND hh.tipo_cambio = 'SOBRESCRITA'
              AND hh.procedencia = 'SESSION_RELEASE'
              AND hh.fecha_nueva = l.fecha_efectiva
            ORDER BY hh.secuencia DESC
            LIMIT 1
         ) h ON true
         LEFT JOIN kcm.actor ha ON ha.actor_id = h.actor_id
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
      // El motivo sólo se enseña cuando hubo algo que sustituir: el lote lleva
      // uno aunque no haya sobrescrito nada, y mostrarlo suelto haría pensar
      // que sí lo hizo.
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

  // ---------------------------------------------------------------------------
  // Campos declarados
  // ---------------------------------------------------------------------------

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
              (SELECT count(*) FROM kcm.atributo_declarado ad
                WHERE ad.nombre_atributo = cd.nombre_campo
                  AND ad.vigente_hasta IS NULL) AS valores
         FROM kcm.campo_declarado cd
         LEFT JOIN kcm.actor ap ON ap.actor_id = cd.aprobado_por
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

  /**
   * Alta y bitácora en una sola transacción. Si el `INSERT` en `kcm.auditoria`
   * falla —por un rol que el enum no admite, por ejemplo—, el campo tampoco
   * queda: un catálogo que crece sin dejar rastro de quién lo hizo crecer es
   * precisamente lo que este registro existe para evitar.
   */
  async declareField(input: DeclareFieldInput, actor: string): Promise<DeclaredField> {
    const campoId = await this.#db.transaction(async (tx) => {
      const { rows } = await tx.query<{ campo_id: string }>(
        `INSERT INTO kcm.campo_declarado (nombre_campo, tipo_dato, descripcion, origen_fuente)
         VALUES ($1, $2, $3, $4::kcm.origen_fuente)
         RETURNING campo_id;`,
        [input.name, input.dataType, input.description ?? null, input.source],
      );
      const id = rows[0]?.campo_id;
      if (id === undefined) throw new Error("El alta del campo no devolvió identificador.");

      await tx.query(
        `INSERT INTO kcm.auditoria (
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
        `UPDATE kcm.campo_declarado
            SET aprobado_para_reglas = true,
                aprobado_por = $2,
                aprobado_en = now()
          WHERE campo_id = $1
            AND aprobado_para_reglas = false
          RETURNING nombre_campo;`,
        [fieldId, actorId],
      );

      // Sin renglón, o el campo no existe o ya estaba aprobado. En ninguno de
      // los dos casos hay hecho nuevo que auditar.
      const nombre = rows[0]?.nombre_campo;
      if (nombre === undefined) return;

      await tx.query(
        `INSERT INTO kcm.auditoria (
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

  // ---------------------------------------------------------------------------
  // Previsualizador
  // ---------------------------------------------------------------------------

  /**
   * Conteos exactos, no la estimación de `reltuples`.
   *
   * Un conteo estimado en una consola de verificación es peor que no tenerlo:
   * quien la abre para comprobar que una carga entró completa necesita el
   * número, no una aproximación que el `ANALYZE` todavía no actualizó.
   * `query_to_xml` corre el `count(*)` por tabla desde una sola sentencia, y el
   * `%I` de `format` cita el identificador del lado del servidor.
   */
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
        WHERE n.nspname = 'kcm'
          AND c.relkind = 'r'
          AND c.relname <> ALL ($1::text[])
        ORDER BY c.relname;`,
      [TABLAS_VEDADAS],
    );

    return rows.map((r) => ({
      name: r.tabla,
      ...(r.comentario ? { comment: r.comentario } : {}),
      rows: Number(r.filas),
      appendOnly: r.solo_agrega,
    }));
  }

  async previewTable(table: string, limit: number, offset: number): Promise<TablePreview | null> {
    // El nombre se resuelve contra el catálogo del servidor. Lo que no aparece
    // aquí no se consulta, y con eso la interpolación posterior no puede
    // referirse a nada que no exista y esté permitido.
    const { rows: catalogo } = await this.#db.query<{ tabla: string; comentario: string | null }>(
      `SELECT c.relname AS tabla, obj_description(c.oid, 'pg_class') AS comentario
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'kcm'
          AND c.relkind = 'r'
          AND c.relname = $1
          AND c.relname <> ALL ($2::text[])
        LIMIT 1;`,
      [table, TABLAS_VEDADAS],
    );
    const encontrada = catalogo[0];
    if (encontrada === undefined) return null;

    const { rows: columnas } = await this.#db.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'kcm' AND table_name = $1
        ORDER BY ordinal_position;`,
      [table],
    );
    const nombresDeColumna = columnas.map((c) => c.column_name);
    const enmascaradas = nombresDeColumna.filter(esColumnaSensible);

    const identificador = `kcm."${encontrada.tabla.replace(/"/gu, '""')}"`;

    // Cinturón sobre el tirante: la lectura corre en una transacción declarada
    // de sólo lectura. Si un cambio futuro colara una sentencia que escribe,
    // la aborta el servidor y no la buena voluntad de quien la escribió.
    return this.#db.transaction(async (tx) => {
      await tx.query("SET TRANSACTION READ ONLY;");

      const { rows: conteo } = await tx.query<{ total: string | number }>(
        `SELECT count(*) AS total FROM ${identificador};`,
      );
      const { rows: datos } = await tx.query<Record<string, unknown>>(
        // `ORDER BY 1` es arbitrario pero determinista: sin orden, dos páginas
        // consecutivas pueden repetir y omitir renglones.
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

/**
 * Nombre visible de una sala a partir de su clave. Cae al nombre de la base
 * cuando la clave no está en el catálogo del dominio —una sala agregada
 * directo en la base seguiría apareciendo, con el nombre que tenga allí—.
 */
function nombreDeSala(claveSala: string, nombreEnBase: string): string {
  return ROOMS.find((sala) => sala.roomId === claveSala)?.name ?? nombreEnBase;
}

/** Coincidencia exacta o por sufijo: `journal_mac` cae por `mac`, `curp` por sí misma. */
function esColumnaSensible(columna: string): boolean {
  const nombre = columna.toLowerCase();
  return COLUMNAS_ENMASCARADAS.some(
    (sensible) => nombre === sensible || nombre.endsWith(`_${sensible}`),
  );
}

/**
 * Todo se enseña como texto. `null` se conserva distinto de la cadena vacía
 * porque en una tabla la diferencia entre «sin valor» y «vacío» es información.
 */
function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") return JSON.stringify(valor);
  // Lo que queda es primitivo: `pg` entrega texto, número, booleano o bigint.
  // El `switch` no está de adorno: `String()` sobre `unknown` imprimiría
  // `[object Object]` el día que aparezca un tipo que no se previó.
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

/** Misma resolución que usa el resto del árbol: el actor se crea si no existe. */
async function resolverActor(tx: SqlExecutor, identificador: string): Promise<string> {
  const clave = identificador.trim() || "SISTEMA";
  const { rows } = await tx.query<{ actor_id: string }>(
    `INSERT INTO kcm.actor (identificador, nombre_visible)
     VALUES ($1, $1)
     ON CONFLICT (identificador) DO UPDATE SET identificador = EXCLUDED.identificador
     RETURNING actor_id;`,
    [clave],
  );
  const actorId = rows[0]?.actor_id;
  if (actorId === undefined) throw new Error(`No fue posible resolver el actor ${clave}`);
  return actorId;
}
