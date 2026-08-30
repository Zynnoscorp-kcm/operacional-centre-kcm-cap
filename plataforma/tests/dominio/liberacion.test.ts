/**
 * Saga de liberación (Función 5).
 *
 * Lo que estas pruebas fijan es la clase de defecto que en esta ejecución
 * pierde datos reales: un segundo efecto sobre una fecha ya liberada, un lote
 * aplicado a medias, o un journal que afirma un efecto que nunca ocurrió.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryReleaseRepository } from "../../src/adapters/memoria/liberacion.ts";
import { MatrixGateway } from "../../src/domain/liberacion/pasarela-matriz.ts";
import { ReleaseService } from "../../src/domain/liberacion/servicio.ts";
import {
  InvalidReleaseStateError,
  ReleaseConflictError,
  ReleaseForbiddenError,
  ReleaseIntegrityError,
} from "../../src/domain/liberacion/errores.ts";
import { releaseIdempotencyKey } from "../../src/domain/liberacion/plan-de-escritura.ts";
import { parseWorkerNumber } from "../../src/domain/numero-trabajador.ts";
import {
  AUDITOR,
  CAPACITACION,
  MAPPING_VERSION,
  SECRET,
  SESSION_DATE,
  SESSION_ID,
  TRAINING_ID,
  buildAttendance,
  buildHcRecord,
  buildMapping,
  buildSession,
  fixedClock,
} from "../apoyo/fixtures-liberacion.ts";
import type { AttendanceRecord, SessionRecord } from "../../src/domain/quiosco/tipos.ts";
import type { HcRecord } from "../../src/domain/importacion-matriz/tipos.ts";
import type { MatrixMapping } from "../../src/domain/liberacion/tipos.ts";

function build(
  options: {
    session?: SessionRecord;
    attendances?: readonly AttendanceRecord[];
    mapping?: MatrixMapping;
    hcRecords?: readonly HcRecord[];
  } = {},
) {
  const session = options.session ?? buildSession();
  const attendances = options.attendances ?? [
    buildAttendance("10001"),
    buildAttendance("10002"),
    buildAttendance("10003"),
  ];

  const repository = new MemoryReleaseRepository({
    sessions: [session],
    attendances,
    mappings: [options.mapping ?? buildMapping()],
    hcRecords: options.hcRecords ?? [],
    trainings: [TRAINING_ID],
  });

  const clock = fixedClock();
  const gateway = new MatrixGateway({ matrix: repository, secret: SECRET, clock });
  const service = new ReleaseService({ repository, gateway, clock, secret: SECRET });

  return { repository, gateway, service };
}

/**
 * Repositorio que falla la primera vez que refleja el dominio.
 *
 * Es la única forma honesta de comprobar la reanudación: obligar a que el lote
 * quede a mitad de camino en vez de forzar la fase a mano, que probaría el
 * `tamperBatch` y no la saga.
 */
class RepositorioInterrumpible extends MemoryReleaseRepository {
  fallasRestantes = 1;

  override updateManyAttendances(
    updates: readonly { attendanceId: string; updates: Partial<AttendanceRecord> }[],
  ): Promise<void> {
    if (this.fallasRestantes > 0) {
      this.fallasRestantes -= 1;
      return Promise.reject(new Error("interrupción simulada al reflejar el dominio"));
    }
    return super.updateManyAttendances(updates);
  }
}

function buildInterrumpible() {
  const repository = new RepositorioInterrumpible({
    sessions: [buildSession()],
    attendances: [buildAttendance("10001"), buildAttendance("10002"), buildAttendance("10003")],
    mappings: [buildMapping()],
    trainings: [TRAINING_ID],
  });

  const clock = fixedClock();
  const gateway = new MatrixGateway({ matrix: repository, secret: SECRET, clock });
  const service = new ReleaseService({ repository, gateway, clock, secret: SECRET });

  return { repository, gateway, service };
}

// ---------------------------------------------------------------------------

describe("E10 · liberación completa", () => {
  it("aplica el lote, cierra la sesión y deja un efecto por clave idempotente", async () => {
    const { repository, service } = build();

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0001" },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "COMPLETADO");
    assert.equal(outcome.status, "COMPLETADO");
    assert.equal(outcome.sessionOutcome, "LIBERADA_TOTAL");
    assert.equal(outcome.effectiveWrites, 3);
    assert.equal(outcome.repeated, false);
    assert.ok(outcome.results.every((result) => result.status === "WRITTEN"));

    const efectos = repository.getAllEffects();
    assert.equal(efectos.length, 3);

    // La clave efectiva concatena sesión, trabajador, capacitación y mapeo.
    assert.ok(
      efectos.some(
        (efecto) =>
          efecto.idempotencyKey ===
          releaseIdempotencyKey({
            sessionId: SESSION_ID,
            employeeId: "10001",
            trainingId: TRAINING_ID,
            mappingVersion: MAPPING_VERSION,
          }),
      ),
    );

    // El XLSB lo escribe el cliente VBA: aquí el efecto queda pendiente de acuse.
    assert.ok(efectos.every((efecto) => efecto.xlsbAckStatus === "PENDIENTE_ACUSE"));

    const sesion = await repository.getSessionById(SESSION_ID);
    assert.equal(sesion?.status, "LIBERADA_TOTAL");

    const asistencias = await repository.listAttendancesBySession(SESSION_ID);
    assert.ok(asistencias.every((asistencia) => asistencia.released));
    assert.ok(asistencias.every((asistencia) => asistencia.status === "LIBERADA"));
  });

  it("escribe la fecha en la réplica con procedencia de plataforma", async () => {
    const { repository, service } = build();

    await service.release({ sessionId: SESSION_ID, requestId: "req-lib-0002" }, CAPACITACION);

    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.completionDate, SESSION_DATE);
    assert.equal(registro?.provenance, "SESSION_RELEASE");
    assert.equal(registro?.sessionId, SESSION_ID);
    assert.equal(registro?.mappingVersion, MAPPING_VERSION);
    assert.ok(registro?.marker?.startsWith("KCM_RELEASE_V2:"));
  });

  it("deja auditoría de cada asistencia liberada y del cierre del lote", async () => {
    const { repository, service } = build();

    await service.release({ sessionId: SESSION_ID, requestId: "req-lib-0003" }, CAPACITACION);

    const auditoria = repository.getAllAudits();
    assert.equal(auditoria.filter((evento) => evento.action === "MATRIX_RELEASED").length, 3);
    assert.equal(auditoria.filter((evento) => evento.action === "RELEASE_COMPLETED").length, 1);
    assert.ok(auditoria.every((evento) => evento.provenance === "PLATAFORMA"));
    assert.ok(auditoria.every((evento) => evento.requestId === "req-lib-0003"));
  });
});

// ---------------------------------------------------------------------------

describe("E10 · idempotencia", () => {
  it("un reintento con el mismo requestId no produce un segundo efecto", async () => {
    const { repository, service } = build();

    const primero = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0010" },
      CAPACITACION,
    );
    const registroTrasPrimero = await repository.getHcRecord(
      parseWorkerNumber("10001"),
      TRAINING_ID,
    );

    const segundo = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0010" },
      CAPACITACION,
    );

    assert.equal(primero.repeated, false);
    assert.equal(segundo.repeated, true);
    assert.equal(segundo.batchId, primero.batchId);

    // Ni un efecto más, ni una versión más en la réplica.
    assert.equal(repository.getAllEffects().length, 3);
    const registroTrasSegundo = await repository.getHcRecord(
      parseWorkerNumber("10001"),
      TRAINING_ID,
    );
    assert.equal(registroTrasSegundo?.version, registroTrasPrimero?.version);
    assert.equal(registroTrasSegundo?.updatedAt, registroTrasPrimero?.updatedAt);

    // Y la auditoría tampoco se duplica.
    const liberadas = repository
      .getAllAudits()
      .filter((evento) => evento.action === "MATRIX_RELEASED");
    assert.equal(liberadas.length, 3);
  });

  it("una sesión ya liberada por completo no admite un lote nuevo", async () => {
    const { service } = build();

    await service.release({ sessionId: SESSION_ID, requestId: "req-lib-0011" }, CAPACITACION);

    // Queda en LIBERADA_TOTAL, que no es un estado desde el que se libere.
    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0012" }, CAPACITACION),
      InvalidReleaseStateError,
    );
  });

  it("una sesión parcial sin elegibles restantes rechaza el lote nuevo", async () => {
    const { service } = build({
      attendances: [
        buildAttendance("10001"),
        buildAttendance("10002", { excludedFromRelease: true, exclusionReason: "Sin examen" }),
      ],
    });

    await service.release({ sessionId: SESSION_ID, requestId: "req-lib-0013" }, CAPACITACION);

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0014" }, CAPACITACION),
      (error: Error) =>
        error instanceof ReleaseConflictError && /No hay registros elegibles/.test(error.message),
    );
  });

  it("dos liberaciones simultáneas sobre la misma sesión no duplican el efecto", async () => {
    const { repository, service } = build();

    // Sin serialización, ambas armarían su plan sobre las mismas asistencias y
    // el segundo lote escribiría encima del primero.
    const resultados = await Promise.allSettled([
      service.release({ sessionId: SESSION_ID, requestId: "req-lib-0025" }, CAPACITACION),
      service.release({ sessionId: SESSION_ID, requestId: "req-lib-0026" }, CAPACITACION),
    ]);

    const cumplidas = resultados.filter((r) => r.status === "fulfilled");
    assert.equal(cumplidas.length, 1, "sólo una de las dos produce efectos");

    assert.equal(repository.getAllEffects().length, 3);
    const lotes = await repository.listBatchesBySession(SESSION_ID);
    assert.equal(lotes.length, 1, "el segundo lote ni siquiera llega a crearse");

    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.version, 1);
  });

  it("un lote interrumpido sólo se reanuda con su requestId original", async () => {
    const { repository, service } = buildInterrumpible();

    // La primera llamada aplica la matriz y cae al reflejar el dominio.
    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0020" }, CAPACITACION),
      /interrupción simulada/,
    );

    const lotes = await repository.listBatchesBySession(SESSION_ID);
    assert.equal(lotes.length, 1);
    assert.equal(lotes[0]?.phase, "MATRIZ_APLICADA", "el journal conserva la fase alcanzada");

    // Otro requestId no puede abrir un lote nuevo sobre la misma sesión.
    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0021" }, CAPACITACION),
      (error: Error) =>
        error instanceof ReleaseConflictError && /requestId original/.test(error.message),
    );

    // Con el requestId original sí retoma, y termina sin duplicar el efecto.
    const reanudado = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0020" },
      CAPACITACION,
    );

    assert.equal(reanudado.phase, "COMPLETADO");
    assert.equal(reanudado.effectiveWrites, 3);
    assert.equal(repository.getAllEffects().length, 3);
    assert.equal((await repository.listBatchesBySession(SESSION_ID)).length, 1);

    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.version, 1, "la réplica se escribió una sola vez");
  });
});

// ---------------------------------------------------------------------------

describe("E10 · atomicidad del lote", () => {
  it("un solo conflicto aborta el lote entero y no escribe nada", async () => {
    // 10002 ya tiene una fecha distinta y la política prohíbe sobrescribir.
    const { repository, service } = build({
      hcRecords: [buildHcRecord("10002", "2026-01-20")],
    });

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0030" },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "CONFLICTO");
    assert.equal(outcome.status, "CONFLICTO");
    assert.equal(outcome.effectiveWrites, 0);

    const conflictivo = outcome.results.find((result) => result.employeeId === "10002");
    assert.equal(conflictivo?.status, "OVERWRITE_NOT_ALLOWED");

    // Las demás no se intentaron: quedan marcadas como abortadas, no como
    // fallidas, y la réplica sigue intacta para ellas.
    const otras = outcome.results.filter((result) => result.employeeId !== "10002");
    assert.ok(otras.every((result) => result.status === "ATOMIC_BATCH_ABORTED"));

    assert.equal(repository.getAllEffects().length, 0);
    assert.equal(await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID), null);
    assert.equal(await repository.getHcRecord(parseWorkerNumber("10003"), TRAINING_ID), null);

    // La fecha que ya estaba no se tocó.
    const intacto = await repository.getHcRecord(parseWorkerNumber("10002"), TRAINING_ID);
    assert.equal(intacto?.completionDate, "2026-01-20");
    assert.equal(intacto?.provenance, "XLSB_IMPORT");

    const sesion = await repository.getSessionById(SESSION_ID);
    assert.equal(
      sesion?.status,
      "LISTA_PARA_LIBERAR",
      "la sesión no avanza con el lote en conflicto",
    );
  });

  it("un trabajador ausente de la matriz bloquea el lote en vez de crear una identidad", async () => {
    // 99999 asiste pero no aparece en el padrón de la réplica. El adaptador
    // toma como padrón la unión de asistencias y registros, así que se declara
    // explícitamente cuál es el universo conocido.
    const conAusente = new MemoryReleaseRepository({
      sessions: [buildSession()],
      attendances: [buildAttendance("10001"), buildAttendance("99999")],
      mappings: [buildMapping()],
      trainings: [TRAINING_ID],
      workers: ["10001"],
    });

    const clock = fixedClock();
    const gateway = new MatrixGateway({ matrix: conAusente, secret: SECRET, clock });
    const service = new ReleaseService({ repository: conAusente, gateway, clock, secret: SECRET });

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0031" },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "CONFLICTO");
    const ausente = outcome.results.find((result) => result.employeeId === "99999");
    assert.equal(ausente?.status, "EMPLOYEE_NOT_FOUND");
    assert.equal(conAusente.getAllEffects().length, 0);
  });
});

// ---------------------------------------------------------------------------

describe("E10 · compuertas antes de cualquier efecto", () => {
  it("no libera una sesión sin autorizar", async () => {
    const { service } = build({ session: buildSession({ authorized: false }) });

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0040" }, CAPACITACION),
      ReleaseForbiddenError,
    );
  });

  it("no libera una sesión que todavía está en preliberación", async () => {
    const { service } = build({ session: buildSession({ status: "PRELIBERACION" }) });

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0041" }, CAPACITACION),
      InvalidReleaseStateError,
    );
  });

  it("un auditor no puede liberar", async () => {
    const { service } = build();

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0042" }, AUDITOR),
      ReleaseForbiddenError,
    );
  });

  it("exige exactamente un mapeo vigente para la capacitación", async () => {
    const repository = new MemoryReleaseRepository({
      sessions: [buildSession()],
      attendances: [buildAttendance("10001")],
      mappings: [buildMapping(), buildMapping("NO_OVERWRITE", { destinationColumn: "AG" })],
      trainings: [TRAINING_ID],
    });
    const clock = fixedClock();
    const gateway = new MatrixGateway({ matrix: repository, secret: SECRET, clock });
    const service = new ReleaseService({ repository, gateway, clock, secret: SECRET });

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0043" }, CAPACITACION),
      ReleaseConflictError,
    );
  });

  it("excluye del plan a quien tiene un motivo de bloqueo y deja la sesión parcial", async () => {
    const { repository, service } = build({
      attendances: [
        buildAttendance("10001"),
        buildAttendance("10002", {
          excludedFromRelease: true,
          exclusionReason: "No presentó examen",
        }),
      ],
    });

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib-0044" },
      CAPACITACION,
    );

    assert.equal(outcome.effectiveWrites, 1);
    assert.equal(outcome.sessionOutcome, "LIBERADA_PARCIAL");
    assert.equal(await repository.getHcRecord(parseWorkerNumber("10002"), TRAINING_ID), null);
  });
});

// ---------------------------------------------------------------------------

describe("E10 · integridad del journal", () => {
  it("detecta un lote cuya fila fue alterada sin volver a firmarse", async () => {
    const { repository, service } = build();

    await service.release({ sessionId: SESSION_ID, requestId: "req-lib-0050" }, CAPACITACION);
    const lotes = await repository.listBatchesBySession(SESSION_ID);
    const lote = lotes[0];
    assert.ok(lote);

    repository.tamperBatch(lote.batchId, { totalWritten: 99 });

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0050" }, CAPACITACION),
      ReleaseIntegrityError,
    );
  });

  it("detecta un plan sustituido aunque la fila conserve su firma original", async () => {
    const { repository, service } = build();

    await service.release({ sessionId: SESSION_ID, requestId: "req-lib-0051" }, CAPACITACION);
    const lotes = await repository.listBatchesBySession(SESSION_ID);
    const lote = lotes[0];
    assert.ok(lote);

    const planAlterado = JSON.parse(lote.plan) as { entries: { completionDate: string }[] };
    planAlterado.entries[0]!.completionDate = "2026-12-31";
    repository.tamperBatch(lote.batchId, { plan: JSON.stringify(planAlterado) });

    await assert.rejects(
      () => service.release({ sessionId: SESSION_ID, requestId: "req-lib-0051" }, CAPACITACION),
      ReleaseIntegrityError,
    );
  });
});

// ---------------------------------------------------------------------------

describe("E10 · vista previa", () => {
  it("cuenta incluidos y excluidos sin producir ningún efecto", async () => {
    const { repository, service } = build({
      attendances: [
        buildAttendance("10001"),
        buildAttendance("10002", { attendanceProven: false }),
      ],
    });

    const preview = await service.preview(SESSION_ID);

    assert.equal(preview.counts.included, 1);
    assert.equal(preview.counts.excluded, 1);
    assert.equal(preview.atomicBatchReady, true);
    assert.equal(preview.excluded[0]?.reasons.includes("ASISTENCIA_NO_COMPROBADA"), true);

    // Preflight no escribe: la réplica y el journal siguen vacíos.
    assert.equal(await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID), null);
    assert.equal((await repository.listBatchesBySession(SESSION_ID)).length, 0);
    assert.equal(repository.getAllEffects().length, 0);
  });
});
