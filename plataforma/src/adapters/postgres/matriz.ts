import { parseWorkerNumber } from "../../domain/comun/numero-trabajador.ts";
import { normalizeText } from "../../domain/importacion-matriz/reconciliador.ts";
import type {
  BatchPhase,
  CandidateCourse,
  CandidateWorker,
  CourseCatalogEntry,
  DateProvenance,
  HcRecord,
  HcRecordHistory,
  ImportBatch,
  ImportScope,
  MatrixSnapshot,
  RecordStatus,
  SnapshotDiagnostics,
  WorkerCatalogEntry,
} from "../../domain/importacion-matriz/tipos.ts";
import type {
  AtomicBatchOperations,
  MatrixRepositoryPort,
} from "../../ports/importacion-matriz.port.ts";

export interface SqlExecutor {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T>;
}

interface LoteImportacionRow {
  importacion_id: string;
  solicitud_id: string;
  sha256_fuente: string;
  sha256_snapshot: string;
  nombre_archivo_fuente: string;
  nombre_hoja_fuente: string;
  extraido_en: string | Date;
  estado: BatchPhase;
  alcance: ImportScope;
  total_trabajadores: number;
  total_cursos: number;
  total_fechas: number;
  total_insertados: number;
  total_corregidos: number;
  total_retirados: number;
  total_reactivados: number;
  total_conflictos: number;
  total_pendientes_maestro: number;
  diagnosticos: SnapshotDiagnostics;
  creado_por: string;
  creado_en: string | Date;
  completado_en: string | Date | null;
  version: number;
}

interface TrabajadorRow {
  numero_trabajador: string;
  nombre_completo: string;
  fecha_alta: string | Date | null;
  tipo_nomina: string;
  puesto_nombre: string | null;
  depto_nombre: string | null;
  area_nombre: string | null;
  planta: string;
  activo: boolean;
  visto_en_padron: boolean | null;
  hash_fuente: string;
  actualizado_en: string | Date;
}

interface CapacitacionRow {
  capacitacion_id: string;
  clave_curso: string;
  nombre: string;
  nombre_normalizado: string;
  clave_origen: string | null;
  activa: boolean;
  primera_importacion: string | null;
  ultima_importacion: string | null;
  actualizada_en: string | Date;
  aliases: string[];
}

interface RegistroHcRow {
  registro_id: string;
  clave_idempotencia: string;
  numero_trabajador: string;
  clave_curso: string;
  fecha_capacitacion: string | Date | null;
  procedencia: DateProvenance;
  estado_registro: RecordStatus;
  sesion_id: string | null;
  liberacion_id: string | null;
  version_mapeo: string;
  lote_id: string | null;
  marcador: string | null;
  importacion_id: string | null;
  solicitud_id: string;
  creado_en: string | Date;
  actualizado_en: string | Date;
  version: number;
}

interface HistorialSobrescrituraRow {
  historial_id: string;
  registro_id: string;
  numero_trabajador: string;
  clave_curso: string;
  tipo_cambio: "ALTA" | "CORREGIDA" | "RETIRADA" | "REACTIVADA";
  fecha_anterior: string | Date | null;
  fecha_nueva: string | Date | null;
  estado_anterior: RecordStatus | null;
  estado_nuevo: RecordStatus;
  procedencia: DateProvenance;
  actor_correo: string;
  motivo: string;
  solicitud_id: string;
  importacion_id: string;
  registrado_en: string | Date;
}

export class SupabaseMatrixRepository implements MatrixRepositoryPort {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  async findBatchByRequestId(requestId: string): Promise<ImportBatch | null> {
    const res = await this.db.query<LoteImportacionRow>(
      `SELECT importacion_id, solicitud_id, sha256_fuente, sha256_snapshot,
              nombre_archivo_fuente, nombre_hoja_fuente, extraido_en,
              estado, alcance, total_trabajadores, total_cursos, total_fechas,
              total_insertados, total_corregidos, total_retirados,
              total_reactivados, total_conflictos, total_pendientes_maestro,
              diagnosticos, creado_por, creado_en, completado_en, version
       FROM matriz.importacion
       WHERE solicitud_id = $1`,
      [requestId],
    );

    const r = res.rows[0];
    if (!r) return null;
    return this.mapBatchRow(r);
  }

  async findBatchById(importId: string): Promise<ImportBatch | null> {
    const res = await this.db.query<LoteImportacionRow>(
      `SELECT importacion_id, solicitud_id, sha256_fuente, sha256_snapshot,
              nombre_archivo_fuente, nombre_hoja_fuente, extraido_en,
              estado, alcance, total_trabajadores, total_cursos, total_fechas,
              total_insertados, total_corregidos, total_retirados,
              total_reactivados, total_conflictos, total_pendientes_maestro,
              diagnosticos, creado_por, creado_en, completado_en, version
       FROM matriz.importacion
       WHERE importacion_id = $1`,
      [importId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return this.mapBatchRow(r);
  }

  async getLatestCompletedBatch(): Promise<ImportBatch | null> {
    const res = await this.db.query<LoteImportacionRow>(
      `SELECT importacion_id, solicitud_id, sha256_fuente, sha256_snapshot,
              nombre_archivo_fuente, nombre_hoja_fuente, extraido_en,
              estado, alcance, total_trabajadores, total_cursos, total_fechas,
              total_insertados, total_corregidos, total_retirados,
              total_reactivados, total_conflictos, total_pendientes_maestro,
              diagnosticos, creado_por, creado_en, completado_en, version
       FROM matriz.importacion
       WHERE estado = 'CONFIRMADO'
       ORDER BY extraido_en DESC
       LIMIT 1`,
    );
    const r = res.rows[0];
    if (!r) return null;
    return this.mapBatchRow(r);
  }

  private mapBatchRow(r: LoteImportacionRow): ImportBatch {
    return {
      importId: r.importacion_id,
      requestId: r.solicitud_id,
      sourceSha256: r.sha256_fuente,
      snapshotSha256: r.sha256_snapshot,
      sourceFileName: r.nombre_archivo_fuente,
      sourceSheetName: r.nombre_hoja_fuente,
      sourceExtractedAt: new Date(r.extraido_en).toISOString(),
      phase: r.estado,
      scope: r.alcance,
      counts: {
        totalEmployees: r.total_trabajadores,
        totalCourses: r.total_cursos,
        totalCompletions: r.total_fechas,
        insertedCount: r.total_insertados,
        correctedCount: r.total_corregidos,
        retiredCount: r.total_retirados,
        reactivatedCount: r.total_reactivados,
        conflictCount: r.total_conflictos,
        pendingMasterCount: r.total_pendientes_maestro,
      },
      diagnostics: r.diagnosticos,
      createdBy: r.creado_por,
      createdAt: new Date(r.creado_en).toISOString(),
      completedAt: r.completado_en ? new Date(r.completado_en).toISOString() : null,
      rejectionReason: null,
      approvalActorId: null,
      approvalReason: null,
      version: r.version,
    };
  }

  saveBatch(batch: ImportBatch): Promise<void> {
    return guardarLote(this.db, batch);
  }

  async updateBatch(batch: ImportBatch): Promise<void> {
    await this.saveBatch(batch);
  }

  async getWorkers(): Promise<WorkerCatalogEntry[]> {
    const res = await this.db.query<TrabajadorRow>(
      `SELECT t.numero_trabajador, t.nombre_completo, t.fecha_alta, t.tipo_nomina,
              p.nombre AS puesto_nombre, d.nombre AS depto_nombre, a.nombre AS area_nombre,
              t.planta, t.activo, t.visto_en_padron, t.hash_fuente, t.actualizado_en
       FROM organizacion.trabajador t
       LEFT JOIN organizacion.puesto p ON p.puesto_id = t.puesto_id
       LEFT JOIN organizacion.departamento d ON d.departamento_id = t.departamento_id
       LEFT JOIN organizacion.area a ON a.area_id = t.area_id`,
    );

    return res.rows.map((r) => ({
      workerNumber: parseWorkerNumber(r.numero_trabajador),
      displayName: r.nombre_completo,
      hireDate: r.fecha_alta ? new Date(r.fecha_alta).toISOString().slice(0, 10) : null,
      payrollType: r.tipo_nomina,
      position: r.puesto_nombre ?? "",
      department: r.depto_nombre ?? "",
      area: r.area_nombre ?? "",
      plant: r.planta,
      active: r.activo,
      seenInRoster: r.visto_en_padron ?? true,
      sourceHash: r.hash_fuente,
      updatedAt: new Date(r.actualizado_en).toISOString(),
    }));
  }

  async getCourses(): Promise<CourseCatalogEntry[]> {
    const res = await this.db.query<CapacitacionRow>(
      `SELECT c.capacitacion_id, c.clave_curso, c.nombre, c.nombre_normalizado,
              c.clave_origen, c.activa, c.primera_importacion, c.ultima_importacion, c.actualizada_en,
              COALESCE(array_agg(a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
       FROM catalogo.capacitacion c
       LEFT JOIN catalogo.capacitacion_alias a ON a.capacitacion_id = c.capacitacion_id
       GROUP BY c.capacitacion_id`,
    );

    return res.rows.map((r) => ({
      trainingId: r.clave_curso,
      sourceKey: r.clave_origen ?? "",
      sourceName: r.nombre,
      normalizedName: r.nombre_normalizado,
      aliases: r.aliases,
      active: r.activa,
      firstSeenImportId: r.primera_importacion ?? "",
      lastSeenImportId: r.ultima_importacion ?? "",
      updatedAt: new Date(r.actualizada_en).toISOString(),
    }));
  }

  async getHcRecords(): Promise<HcRecord[]> {
    const res = await this.db.query<RegistroHcRow>(
      `SELECT r.registro_id, r.clave_idempotencia, t.numero_trabajador, c.clave_curso,
              r.fecha_capacitacion, r.procedencia, r.estado_registro, r.sesion_id,
              r.liberacion_id, r.version_mapeo, r.lote_id, r.marcador, r.importacion_id,
              r.solicitud_id, r.creado_en, r.actualizado_en, r.version
       FROM operacion.historial_capacitacion r
       JOIN organizacion.trabajador t ON t.trabajador_id = r.trabajador_id
       JOIN catalogo.capacitacion c ON c.capacitacion_id = r.capacitacion_id`,
    );

    return res.rows.map((r) => ({
      recordId: r.registro_id,
      idempotencyKey: r.clave_idempotencia,
      workerNumber: parseWorkerNumber(r.numero_trabajador),
      trainingId: r.clave_curso,
      completionDate: r.fecha_capacitacion
        ? new Date(r.fecha_capacitacion).toISOString().slice(0, 10)
        : "",
      provenance: r.procedencia,
      status: r.estado_registro,
      sessionId: r.sesion_id,
      releaseId: r.liberacion_id,
      mappingVersion: r.version_mapeo,
      batchId: r.lote_id,
      marker: r.marcador,
      importId: r.importacion_id,
      requestId: r.solicitud_id,
      createdAt: new Date(r.creado_en).toISOString(),
      updatedAt: new Date(r.actualizado_en).toISOString(),
      version: r.version,
    }));
  }

  async getHcRecordHistory(): Promise<HcRecordHistory[]> {
    const res = await this.db.query<HistorialSobrescrituraRow>(
      `SELECT h.historial_id, h.registro_id, t.numero_trabajador, c.clave_curso,
              h.tipo_cambio, h.fecha_anterior, h.fecha_nueva, h.estado_anterior,
              h.estado_nuevo, h.procedencia, a.identificador AS actor_correo,
              h.motivo, h.solicitud_id, h.importacion_id, h.registrado_en
       FROM operacion.historial_capacitacion_cambio h
       JOIN organizacion.trabajador t ON t.trabajador_id = h.trabajador_id
       JOIN catalogo.capacitacion c ON c.capacitacion_id = h.capacitacion_id
       JOIN seguridad.actor a ON a.actor_id = h.actor_id
       ORDER BY h.secuencia ASC`,
    );

    return res.rows.map((r) => ({
      historyId: r.historial_id,
      recordId: r.registro_id,
      workerNumber: parseWorkerNumber(r.numero_trabajador),
      trainingId: r.clave_curso,
      changeType: r.tipo_cambio,
      previousCompletionDate: r.fecha_anterior
        ? new Date(r.fecha_anterior).toISOString().slice(0, 10)
        : null,
      completionDate: r.fecha_nueva ? new Date(r.fecha_nueva).toISOString().slice(0, 10) : null,
      previousStatus: r.estado_anterior,
      status: r.estado_nuevo,
      provenance: r.procedencia,
      actorId: r.actor_correo,
      reason: r.motivo,
      requestId: r.solicitud_id,
      importId: r.importacion_id,
      recordedAt: new Date(r.registrado_en).toISOString(),
    }));
  }

  async applyBatchAtomic(batch: ImportBatch, ops: AtomicBatchOperations): Promise<void> {
    await this.db.transaction(async (tx) => {
      await guardarLote(tx, batch);

      const trabajadores = ops.workersToUpsert;
      if (trabajadores.length) {
        const adscripcion = await resolverAdscripciones(tx, trabajadores);
        const ids = trabajadores.map(adscripcion);
        await tx.query(
          `INSERT INTO organizacion.trabajador (
            numero_trabajador, nombre_completo, fecha_alta, tipo_nomina, planta, activo, hash_fuente,
            puesto_id, departamento_id, area_id
          )
          SELECT * FROM unnest(
            $1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::boolean[], $7::text[],
            $8::uuid[], $9::uuid[], $10::uuid[]
          )
          ON CONFLICT (numero_trabajador) DO UPDATE SET
            nombre_completo = EXCLUDED.nombre_completo,
            fecha_alta = EXCLUDED.fecha_alta,
            tipo_nomina = EXCLUDED.tipo_nomina,
            planta = EXCLUDED.planta,
            activo = EXCLUDED.activo,
            hash_fuente = EXCLUDED.hash_fuente,
            puesto_id = EXCLUDED.puesto_id,
            departamento_id = EXCLUDED.departamento_id,
            area_id = EXCLUDED.area_id,
            actualizado_en = now()`,
          [
            trabajadores.map((w) => w.workerNumber),
            trabajadores.map((w) => w.displayName),
            trabajadores.map((w) => w.hireDate || null),
            trabajadores.map((w) => w.payrollType),
            trabajadores.map((w) => w.plant),
            trabajadores.map((w) => w.active),
            trabajadores.map((w) => w.sourceHash),
            ids.map((i) => i.puesto),
            ids.map((i) => i.departamento),
            ids.map((i) => i.area),
          ],
        );
      }

      for (const c of ops.coursesToUpsert) {
        await tx.query(
          `INSERT INTO catalogo.capacitacion (
            clave_curso, nombre, nombre_normalizado, clave_origen, activa, primera_importacion, ultima_importacion
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (clave_curso) DO UPDATE SET
            nombre = EXCLUDED.nombre,
            nombre_normalizado = EXCLUDED.nombre_normalizado,
            clave_origen = EXCLUDED.clave_origen,
            activa = EXCLUDED.activa,
            ultima_importacion = EXCLUDED.ultima_importacion,
            actualizada_en = now()`,
          [
            c.trainingId,
            c.sourceName,
            c.normalizedName,
            c.sourceKey,
            c.active,
            c.firstSeenImportId,
            c.lastSeenImportId,
          ],
        );
      }

      const corregidos = ops.recordsToUpdate;
      if (corregidos.length) {
        await tx.query(
          `UPDATE operacion.historial_capacitacion h SET
            fecha_capacitacion = v.fecha,
            estado_registro = v.estado,
            importacion_id = v.importacion,
            solicitud_id = v.solicitud,
            version = h.version + 1
          FROM unnest(
            $1::date[], $2::comun.estado_historial[], $3::uuid[], $4::text[], $5::uuid[]
          ) AS v(fecha, estado, importacion, solicitud, registro)
          WHERE h.registro_id = v.registro`,
          [
            corregidos.map((r) => r.completionDate || null),
            corregidos.map((r) => r.status),
            corregidos.map((r) => r.importId),
            corregidos.map((r) => r.requestId),
            corregidos.map((r) => r.recordId),
          ],
        );
      }

      const nuevos = ops.recordsToInsert;
      if (nuevos.length) {
        await tx.query(
          `INSERT INTO operacion.historial_capacitacion (
            registro_id, clave_idempotencia, trabajador_id, capacitacion_id,
            fecha_capacitacion, procedencia, estado_registro, sesion_id,
            liberacion_id, version_mapeo, lote_id, marcador, importacion_id, solicitud_id
          )
          SELECT v.registro, v.clave, t.trabajador_id, c.capacitacion_id,
                 v.fecha, v.procedencia, v.estado, v.sesion,
                 v.liberacion, v.mapeo, v.lote, v.marcador, v.importacion, v.solicitud
            FROM unnest(
              $1::uuid[], $2::text[], $3::text[], $4::text[], $5::date[],
              $6::comun.procedencia_fecha[], $7::comun.estado_historial[], $8::uuid[], $9::uuid[],
              $10::text[], $11::uuid[], $12::text[], $13::uuid[], $14::text[]
            ) WITH ORDINALITY AS v(registro, clave, numero, curso, fecha, procedencia, estado,
                                   sesion, liberacion, mapeo, lote, marcador, importacion,
                                   solicitud, orden)
            LEFT JOIN organizacion.trabajador t ON t.numero_trabajador = v.numero
            LEFT JOIN catalogo.capacitacion c ON c.clave_curso = v.curso
           ORDER BY v.orden`,
          [
            nuevos.map((r) => r.recordId),
            nuevos.map((r) => r.idempotencyKey),
            nuevos.map((r) => r.workerNumber),
            nuevos.map((r) => r.trainingId),
            nuevos.map((r) => r.completionDate || null),
            nuevos.map((r) => r.provenance),
            nuevos.map((r) => r.status),
            nuevos.map((r) => r.sessionId),
            nuevos.map((r) => r.releaseId),
            nuevos.map((r) => r.mappingVersion),
            nuevos.map((r) => r.batchId),
            nuevos.map((r) => r.marker),
            nuevos.map((r) => r.importId),
            nuevos.map((r) => r.requestId),
          ],
        );
      }

      const cambios = ops.historyEntriesToInsert;
      if (cambios.length) {
        const actores = new Map<string, string>();
        for (const identificador of new Set(cambios.map((h) => h.actorId))) {
          actores.set(identificador, await resolverActor(tx, identificador));
        }
        await tx.query(
          `INSERT INTO operacion.historial_capacitacion_cambio (
            historial_id, registro_id, trabajador_id, capacitacion_id,
            tipo_cambio, fecha_anterior, fecha_nueva, estado_anterior,
            estado_nuevo, procedencia, actor_id, motivo, solicitud_id, importacion_id
          )
          SELECT v.historial, v.registro, t.trabajador_id, c.capacitacion_id,
                 v.tipo, v.anterior, v.nueva, v.estado_anterior,
                 v.estado_nuevo, v.procedencia, v.actor, v.motivo, v.solicitud, v.importacion
            FROM unnest(
              $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::comun.tipo_cambio_historial[],
              $6::date[], $7::date[], $8::comun.estado_historial[], $9::comun.estado_historial[],
              $10::comun.procedencia_fecha[], $11::uuid[], $12::text[], $13::text[], $14::uuid[]
            ) WITH ORDINALITY AS v(historial, registro, numero, curso, tipo, anterior, nueva,
                                   estado_anterior, estado_nuevo, procedencia, actor, motivo,
                                   solicitud, importacion, orden)
            LEFT JOIN organizacion.trabajador t ON t.numero_trabajador = v.numero
            LEFT JOIN catalogo.capacitacion c ON c.clave_curso = v.curso
           ORDER BY v.orden`,
          [
            cambios.map((h) => h.historyId),
            cambios.map((h) => h.recordId),
            cambios.map((h) => h.workerNumber),
            cambios.map((h) => h.trainingId),
            cambios.map((h) => h.changeType),
            cambios.map((h) => h.previousCompletionDate || null),
            cambios.map((h) => h.completionDate || null),
            cambios.map((h) => h.previousStatus),
            cambios.map((h) => h.status),
            cambios.map((h) => h.provenance),
            cambios.map((h) => actores.get(h.actorId) ?? null),
            cambios.map((h) => h.reason),
            cambios.map((h) => h.requestId),
            cambios.map((h) => h.importId),
          ],
        );
      }

      if (ops.snapshot) {
        await tx.query(
          `INSERT INTO matriz.importacion_contenido (importacion_id, contenido)
           VALUES ($1, $2)
           ON CONFLICT (importacion_id) DO UPDATE SET contenido = EXCLUDED.contenido;`,
          [batch.importId, JSON.stringify(ops.snapshot)],
        );
        await mantenerMapeo(tx, batch, ops.snapshot);
      }

      if (ops.workersSeen) {
        await tx.query(
          `UPDATE organizacion.trabajador
              SET visto_en_matriz = (numero_trabajador = ANY($1::text[]))
            WHERE visto_en_matriz IS DISTINCT FROM (numero_trabajador = ANY($1::text[]));`,
          [ops.workersSeen],
        );
        await tx.query(
          `UPDATE organizacion.trabajador
              SET activo = false
            WHERE activo AND NOT visto_en_matriz AND NOT visto_en_padron;`,
        );
      }
    });
  }

  async recordCandidateCourse(candidate: CandidateCourse): Promise<void> {
    await this.db.query(
      `INSERT INTO matriz.capacitacion_desconocida (
        candidato_id, clave_origen, nombre_detectado, nombre_normalizado, origen_fuente, estado
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        candidate.candidateId,
        candidate.sourceKey,
        candidate.detectedName,
        candidate.normalizedName,
        candidate.sourceOrigin,
        candidate.status,
      ],
    );
  }

  async recordCandidateWorker(candidate: CandidateWorker): Promise<void> {
    await this.db.query(
      `INSERT INTO matriz.trabajador_desconocido (
        candidato_id, numero_trabajador, nombre_detectado, datos_laborales, origen_fuente, estado
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        candidate.candidateId,
        candidate.workerNumber,
        candidate.detectedName,
        JSON.stringify(candidate.laborData),
        candidate.sourceOrigin,
        candidate.status,
      ],
    );
  }
}

async function guardarLote(db: SqlExecutor, batch: ImportBatch): Promise<void> {
  const creadoPor = await resolverActor(db, batch.createdBy);
  await db.query(
    `INSERT INTO matriz.importacion (
      importacion_id, solicitud_id, sha256_fuente, sha256_snapshot,
      nombre_archivo_fuente, nombre_hoja_fuente, extraido_en,
      estado, alcance, total_trabajadores, total_cursos, total_fechas,
      total_insertados, total_corregidos, total_retirados, total_reactivados,
      total_conflictos, total_pendientes_maestro, diagnosticos, creado_por,
      creado_en, completado_en, version
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
    )
    ON CONFLICT (solicitud_id) DO UPDATE SET
      estado = EXCLUDED.estado,
      alcance = EXCLUDED.alcance,
      total_insertados = EXCLUDED.total_insertados,
      total_corregidos = EXCLUDED.total_corregidos,
      total_retirados = EXCLUDED.total_retirados,
      total_reactivados = EXCLUDED.total_reactivados,
      total_conflictos = EXCLUDED.total_conflictos,
      total_pendientes_maestro = EXCLUDED.total_pendientes_maestro,
      diagnosticos = EXCLUDED.diagnosticos,
      completado_en = EXCLUDED.completado_en,
      version = EXCLUDED.version`,
    [
      batch.importId,
      batch.requestId,
      batch.sourceSha256,
      batch.snapshotSha256,
      batch.sourceFileName,
      batch.sourceSheetName,
      batch.sourceExtractedAt,
      batch.phase,
      batch.scope,
      batch.counts.totalEmployees,
      batch.counts.totalCourses,
      batch.counts.totalCompletions,
      batch.counts.insertedCount,
      batch.counts.correctedCount,
      batch.counts.retiredCount,
      batch.counts.reactivatedCount,
      batch.counts.conflictCount,
      batch.counts.pendingMasterCount,
      JSON.stringify(batch.diagnostics),
      creadoPor,
      batch.createdAt,
      batch.completedAt,
      batch.version,
    ],
  );
}

const DESTINO_DE_LA_MATRIZ = "MATRIZ_HC";
const FILA_DE_ENCABEZADO = 3;

async function mantenerMapeo(
  tx: SqlExecutor,
  batch: ImportBatch,
  snapshot: MatrixSnapshot,
): Promise<void> {
  const columnas = snapshot.courses.filter(
    (curso) => curso.sourceColumn.trim() !== "" && curso.displayName.trim() !== "",
  );
  const hoja = snapshot.source.sheetName;
  const { rows } = await tx.query<{ destino_id: string }>(
    `INSERT INTO matriz.destino (nombre_destino, identificador_archivo, descripcion)
     VALUES ($1, $2, 'Matriz de competencias que envía Excel')
     ON CONFLICT (nombre_destino) DO UPDATE
       SET identificador_archivo = EXCLUDED.identificador_archivo, activo = true
     RETURNING destino_id;`,
    [DESTINO_DE_LA_MATRIZ, snapshot.source.fileName],
  );
  const destino = rows[0]?.destino_id;
  if (destino === undefined) throw new Error("No fue posible registrar el destino de la matriz");

  const vigentes = `
    SELECT DISTINCT ON (c.capacitacion_id) c.capacitacion_id, v.columna, v.encabezado
      FROM unnest($2::text[], $3::text[], $4::text[]) AS v(clave, columna, encabezado)
      JOIN catalogo.capacitacion c ON c.clave_origen = v.clave
     ORDER BY c.capacitacion_id, v.columna`;
  const parametros = [
    destino,
    columnas.map((curso) => curso.sourceKey),
    columnas.map((curso) => curso.sourceColumn),
    columnas.map((curso) => curso.displayName),
    hoja,
  ];

  await tx.query(
    `WITH v AS (${vigentes})
     UPDATE matriz.mapeo_columna m
        SET vigente_hasta = now()
      WHERE m.destino_id = $1
        AND m.vigente_hasta IS NULL
        AND m.vigente_desde < now()
        AND NOT EXISTS (
              SELECT 1 FROM v
               WHERE v.capacitacion_id = m.capacitacion_id
                 AND v.columna = m.columna
                 AND v.encabezado = m.encabezado_esperado
                 AND m.hoja = $5);`,
    parametros,
  );

  const aprobador = await resolverActor(tx, batch.createdBy);
  await tx.query(
    `WITH v AS (${vigentes})
     INSERT INTO matriz.mapeo_columna (
       destino_id, capacitacion_id, version_mapeo, hoja, columna, encabezado_esperado,
       fila_encabezado, politica_sobrescritura, aprobado_por
     )
     SELECT $1, v.capacitacion_id, $6, $5, v.columna, v.encabezado,
            $7, 'OVERWRITE_WITH_HISTORY', $8
       FROM v
      WHERE NOT EXISTS (
              SELECT 1 FROM matriz.mapeo_columna m
               WHERE m.destino_id = $1
                 AND m.capacitacion_id = v.capacitacion_id
                 AND m.vigente_hasta IS NULL);`,
    [...parametros, `matriz-${batch.sourceSha256.slice(0, 12)}`, FILA_DE_ENCABEZADO, aprobador],
  );
}

function nombreDeCatalogo(valor: string | null): string | null {
  return valor === null || valor.trim() === "" ? null : valor;
}

async function resolverAdscripciones(
  tx: SqlExecutor,
  trabajadores: readonly WorkerCatalogEntry[],
): Promise<
  (w: WorkerCatalogEntry) => {
    puesto: string | null;
    departamento: string | null;
    area: string | null;
  }
> {
  const puestos = new Set<string>();
  const departamentos = new Set<string>();
  const areas = new Map<string, readonly [string, string]>();
  for (const w of trabajadores) {
    const puesto = nombreDeCatalogo(w.position);
    const departamento = nombreDeCatalogo(w.department);
    const area = nombreDeCatalogo(w.area);
    if (puesto) puestos.add(puesto);
    if (departamento) departamentos.add(departamento);
    if (departamento && area) areas.set(`${departamento}\u0000${area}`, [departamento, area]);
  }

  const idDePuesto = new Map<string, string>();
  if (puestos.size) {
    const nombres = [...puestos];
    const { rows } = await tx.query<{ puesto_id: string; nombre: string }>(
      `WITH nuevos AS (
         INSERT INTO organizacion.puesto (nombre, nombre_normalizado)
         SELECT unnest($1::text[]), unnest($2::text[])
         ON CONFLICT (nombre) DO NOTHING
         RETURNING puesto_id, nombre
       )
       SELECT puesto_id, nombre FROM nuevos
       UNION ALL
       SELECT puesto_id, nombre FROM organizacion.puesto WHERE nombre = ANY($1::text[]);`,
      [nombres, nombres.map(normalizeText)],
    );
    for (const fila of rows) idDePuesto.set(fila.nombre, fila.puesto_id);
  }

  const idDeDepartamento = new Map<string, string>();
  if (departamentos.size) {
    const nombres = [...departamentos];
    const { rows } = await tx.query<{ departamento_id: string; nombre: string }>(
      `WITH nuevos AS (
         INSERT INTO organizacion.departamento (nombre, nombre_normalizado)
         SELECT unnest($1::text[]), unnest($2::text[])
         ON CONFLICT (nombre) DO NOTHING
         RETURNING departamento_id, nombre
       )
       SELECT departamento_id, nombre FROM nuevos
       UNION ALL
       SELECT departamento_id, nombre FROM organizacion.departamento
        WHERE nombre = ANY($1::text[]);`,
      [nombres, nombres.map(normalizeText)],
    );
    for (const fila of rows) idDeDepartamento.set(fila.nombre, fila.departamento_id);
  }

  const idDeArea = new Map<string, string>();
  const pares = [...areas.entries()].filter(([, [departamento]]) =>
    idDeDepartamento.has(departamento),
  );
  if (pares.length) {
    const deptos = pares.map(([, [departamento]]) => idDeDepartamento.get(departamento) ?? "");
    const nombres = pares.map(([, [, area]]) => area);
    const { rows } = await tx.query<{ area_id: string; departamento_id: string; nombre: string }>(
      `WITH nuevos AS (
         INSERT INTO organizacion.area (departamento_id, nombre, nombre_normalizado)
         SELECT unnest($1::uuid[]), unnest($2::text[]), unnest($3::text[])
         ON CONFLICT (departamento_id, nombre) DO NOTHING
         RETURNING area_id, departamento_id, nombre
       )
       SELECT area_id, departamento_id, nombre FROM nuevos
       UNION ALL
       SELECT a.area_id, a.departamento_id, a.nombre
         FROM organizacion.area a
         JOIN unnest($1::uuid[], $2::text[]) AS v(departamento_id, nombre)
           ON v.departamento_id = a.departamento_id AND v.nombre = a.nombre;`,
      [deptos, nombres, nombres.map(normalizeText)],
    );
    for (const fila of rows)
      idDeArea.set(`${fila.departamento_id}\u0000${fila.nombre}`, fila.area_id);
  }

  return (w) => {
    const puesto = nombreDeCatalogo(w.position);
    const departamento = nombreDeCatalogo(w.department);
    const area = nombreDeCatalogo(w.area);
    const departamentoId = departamento ? (idDeDepartamento.get(departamento) ?? null) : null;
    return {
      puesto: puesto ? (idDePuesto.get(puesto) ?? null) : null,
      departamento: departamentoId,
      area:
        departamentoId && area ? (idDeArea.get(`${departamentoId}\u0000${area}`) ?? null) : null,
    };
  };
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
