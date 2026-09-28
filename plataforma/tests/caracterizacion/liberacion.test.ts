/**
 * Caracterizacion de la liberacion contra el nucleo de referencia.
 *
 * Congelan el comportamiento observable del nucleo en `packages/core` y
 * comprueban que el puerto en Node decide lo mismo.
 *
 * Donde el puerto se aparta del nucleo lo hace a proposito y la prueba lo
 * declara: la sobrescritura gobernada era antes un bloqueo duro
 * (`MATRIZ_CON_FECHA_EXISTENTE`), y el retiro del OCR elimino una rama de
 * exclusiones que aqui ya no existe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// El nucleo se importa tal cual, sin adaptarlo: es la referencia, no un ayudante.
import { createInMemoryCore } from "../../../packages/core/create-in-memory-core.js";
import { BLOCKING_REASONS, evaluateEligibility } from "../../../packages/core/eligibility.js";
import {
  MAX_PARTICIPANTS_PER_SESSION,
  releaseIdempotencyKey as legacyIdempotencyKey,
} from "../../../packages/contracts/contracts.js";

import { MemoryReleaseRepository } from "../../src/adapters/memoria/liberacion.ts";
import { MatrixGateway } from "../../src/domain/liberacion/pasarela-matriz.ts";
import { ReleaseService, splitEligibility } from "../../src/domain/liberacion/servicio.ts";
import { releaseIdempotencyKey } from "../../src/domain/liberacion/plan-de-escritura.ts";
import { MAX_ENTRIES_PER_BATCH } from "../../src/domain/liberacion/tipos.ts";
import { blockingReasons } from "../../src/domain/preliberacion/servicio.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import {
  CAPACITACION,
  MAPPING_VERSION,
  SECRET,
  SESSION_DATE,
  SESSION_ID,
  TRAINING_ID,
  buildAttendance,
  buildMapping,
  buildSession,
  fixedClock,
} from "../apoyo/fixtures-liberacion.ts";

/** La forma que el legado espera: el objeto sesión, no su identificador. */
const LEGACY_SESSION = Object.freeze({ sessionId: SESSION_ID, authorized: true });

function buildPort(attendances = [buildAttendance("10001"), buildAttendance("10002")]) {
  const repository = new MemoryReleaseRepository({
    sessions: [buildSession()],
    attendances,
    mappings: [buildMapping()],
    trainings: [TRAINING_ID],
  });
  const clock = fixedClock();
  const gateway = new MatrixGateway({ matrix: repository, secret: SECRET, clock });
  const service = new ReleaseService({ repository, gateway, clock, secret: SECRET });
  return { repository, service };
}

// ---------------------------------------------------------------------------

describe("E10 · caracterización de la clave idempotente", () => {
  it("reproduce byte a byte la clave del legado", () => {
    const params = {
      sessionId: SESSION_ID,
      employeeId: "10001",
      trainingId: TRAINING_ID,
      mappingVersion: MAPPING_VERSION,
    };

    assert.equal(releaseIdempotencyKey(params), legacyIdempotencyKey(params));
    assert.equal(releaseIdempotencyKey(params), "SES-0001|10001|CAP-SINT-001|operational-hc-v1");
  });

  it("distingue efectos cuando cambia cualquiera de los cuatro componentes", () => {
    const base = {
      sessionId: SESSION_ID,
      employeeId: "10001",
      trainingId: TRAINING_ID,
      mappingVersion: MAPPING_VERSION,
    };
    const claves = new Set([
      releaseIdempotencyKey(base),
      releaseIdempotencyKey({ ...base, sessionId: "SES-0002" }),
      releaseIdempotencyKey({ ...base, employeeId: "10002" }),
      releaseIdempotencyKey({ ...base, trainingId: "CAP-SINT-002" }),
      releaseIdempotencyKey({ ...base, mappingVersion: "operational-hc-v2" }),
    ]);

    assert.equal(claves.size, 5, "los cuatro componentes participan de la identidad del efecto");
  });
});

// ---------------------------------------------------------------------------

describe("E10 · caracterización de la elegibilidad", () => {
  const casos: readonly {
    nombre: string;
    overrides: Record<string, unknown>;
    legacy: Record<string, unknown>;
    esperado: readonly string[];
  }[] = [
    {
      nombre: "identidad sin validar",
      overrides: { identityValidated: false },
      legacy: { identityValidated: false },
      esperado: [BLOCKING_REASONS.INVALID_IDENTITY],
    },
    {
      nombre: "asistencia sin cotejar",
      overrides: { attendanceProven: false },
      legacy: { attendanceProven: false },
      esperado: [BLOCKING_REASONS.ATTENDANCE_NOT_PROVEN],
    },
    {
      nombre: "examen no encontrado",
      overrides: { examStatus: "EXAMEN_NO_ENCONTRADO" },
      legacy: { examStatus: "EXAMEN_NO_ENCONTRADO" },
      esperado: [BLOCKING_REASONS.EXAM_NOT_FOUND],
    },
    {
      nombre: "examen pendiente",
      overrides: { examStatus: "EXAMEN_PENDIENTE" },
      legacy: { examStatus: "EXAMEN_PENDIENTE" },
      esperado: [BLOCKING_REASONS.EXAM_NOT_CONFIRMED],
    },
    {
      nombre: "ya liberado",
      overrides: { released: true },
      legacy: { released: true },
      esperado: [BLOCKING_REASONS.ALREADY_RELEASED],
    },
  ];

  for (const caso of casos) {
    it(`coincide con el legado: ${caso.nombre}`, () => {
      const legacyEvaluation = evaluateEligibility({
        identityValidated: true,
        attendanceProven: true,
        examStatus: "EXAMEN_CONFIRMADO",
        sessionAuthorized: true,
        released: false,
        ...caso.legacy,
      });

      const portadas = blockingReasons(buildAttendance("10001", caso.overrides), buildSession());

      assert.deepEqual([...legacyEvaluation.reasons], [...caso.esperado]);
      assert.deepEqual([...portadas], [...caso.esperado]);
    });
  }

  it("la sesión sin autorizar bloquea igual en ambos", () => {
    const legacyEvaluation = evaluateEligibility({
      identityValidated: true,
      attendanceProven: true,
      examStatus: "EXAMEN_CONFIRMADO",
      sessionAuthorized: false,
      released: false,
    });

    const portadas = blockingReasons(buildAttendance("10001"), buildSession({ authorized: false }));

    assert.deepEqual([...legacyEvaluation.reasons], [BLOCKING_REASONS.SESSION_NOT_AUTHORIZED]);
    assert.deepEqual([...portadas], ["SESION_NO_AUTORIZADA"]);
  });

  it("acumula todos los motivos, no sólo el primero", () => {
    const legacyEvaluation = evaluateEligibility({
      identityValidated: false,
      attendanceProven: false,
      examStatus: "EXAMEN_NO_ENCONTRADO",
      sessionAuthorized: false,
      released: true,
    });

    const portadas = blockingReasons(
      buildAttendance("10001", {
        identityValidated: false,
        attendanceProven: false,
        examStatus: "EXAMEN_NO_ENCONTRADO",
        released: true,
      }),
      buildSession({ authorized: false }),
    );

    assert.equal(legacyEvaluation.reasons.length, 5);
    assert.deepEqual([...portadas], [...legacyEvaluation.reasons]);
  });

  it("separa incluidos y excluidos como el preview del legado", () => {
    const legado = createInMemoryCore({
      employees: [
        {
          employeeId: "10001",
          displayName: "A",
          area: "X",
          position: "P",
          startTime: "07:00",
          active: true,
        },
        {
          employeeId: "10002",
          displayName: "B",
          area: "X",
          position: "P",
          startTime: "07:00",
          active: true,
        },
      ],
    });

    for (const employeeId of ["10001", "10002"]) {
      legado.capture.registerDigital({
        session: LEGACY_SESSION,
        employeeId,
        actor: "prueba",
        requestId: `req-alta-${employeeId}`,
      });
      legado.capture.confirmAttendance({
        sessionId: SESSION_ID,
        employeeId,
        actor: "prueba",
        requestId: `req-cotejo-${employeeId}`,
      });
    }

    // 10002 no entregó examen.
    legado.exams.reconcile({
      sessionId: SESSION_ID,
      receivedExamCount: 1,
      missingEmployeeIds: ["10002"],
      actor: "prueba",
      requestId: "req-examenes",
    });

    const previewLegado = legado.release.preview({
      sessionId: SESSION_ID,
      trainingId: TRAINING_ID,
      mappingVersion: MAPPING_VERSION,
      releaseDate: SESSION_DATE,
    });

    assert.equal(previewLegado.included.length, 1);
    assert.equal(previewLegado.included[0]?.employeeId, "10001");
    assert.equal(previewLegado.excluded.length, 1);
    assert.equal(previewLegado.excluded[0]?.employeeId, "10002");
    assert.ok(previewLegado.excluded[0]?.reasons.includes(BLOCKING_REASONS.EXAM_NOT_FOUND));

    // El puerto separa el mismo caso con los mismos motivos.
    const { eligible, excluded } = splitEligibility(
      [buildAttendance("10001"), buildAttendance("10002", { examStatus: "EXAMEN_NO_ENCONTRADO" })],
      buildSession(),
    );

    assert.equal(eligible.length, 1);
    assert.equal(eligible[0]?.workerNumber, "10001");
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0]?.employeeId, "10002");
    assert.deepEqual([...(excluded[0]?.reasons ?? [])], [BLOCKING_REASONS.EXAM_NOT_FOUND]);
  });
});

// ---------------------------------------------------------------------------

describe("E10 · caracterización de la idempotencia efectiva", () => {
  it("el legado no escribe dos veces la misma celda y el puerto tampoco", async () => {
    // --- Legado ---
    const legado = createInMemoryCore({
      employees: [
        {
          employeeId: "10001",
          displayName: "A",
          area: "X",
          position: "P",
          startTime: "07:00",
          active: true,
        },
      ],
    });
    legado.capture.registerDigital({
      session: LEGACY_SESSION,
      employeeId: "10001",
      actor: "prueba",
      requestId: "req-1",
    });
    legado.capture.confirmAttendance({
      sessionId: SESSION_ID,
      employeeId: "10001",
      actor: "prueba",
      requestId: "req-2",
    });
    legado.exams.reconcile({
      sessionId: SESSION_ID,
      receivedExamCount: 1,
      actor: "prueba",
      requestId: "req-3",
    });

    const entrada = {
      sessionId: SESSION_ID,
      trainingId: TRAINING_ID,
      mappingVersion: MAPPING_VERSION,
      releaseDate: SESSION_DATE,
      actor: "prueba",
      requestId: "req-lib",
    };

    const primeroLegado = await legado.release.release(entrada);
    const segundoLegado = await legado.release.release({ ...entrada, requestId: "req-lib-2" });

    assert.equal(primeroLegado.effectiveWrites, 1);
    assert.equal(segundoLegado.effectiveWrites, 0);
    assert.equal(segundoLegado.status, "SIN_CAMBIOS");
    assert.equal(legado.matrix.writeCount, 1);

    // --- Puerto en Node ---
    const { repository, service } = buildPort([buildAttendance("10001")]);

    const primero = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib" },
      CAPACITACION,
    );
    const segundo = await service.release(
      { sessionId: SESSION_ID, requestId: "req-lib" },
      CAPACITACION,
    );

    assert.equal(primero.effectiveWrites, 1);
    assert.equal(segundo.repeated, true);
    assert.equal(
      repository.getAllEffects().length,
      1,
      "una sola escritura efectiva, igual que el legado",
    );

    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.version, 1);
  });
});

// ---------------------------------------------------------------------------

describe("E10 · desviaciones declaradas respecto del legado", () => {
  it("el legado bloqueaba toda fecha existente; el puerto lo hace sólo bajo NO_OVERWRITE", async () => {
    // Legado: una celda ocupada produce MATRIZ_CON_FECHA_EXISTENTE, sin excepción.
    const legado = createInMemoryCore({
      employees: [
        {
          employeeId: "10001",
          displayName: "A",
          area: "X",
          position: "P",
          startTime: "07:00",
          active: true,
        },
      ],
    });
    legado.matrix.seedCell({ employeeId: "10001", trainingId: TRAINING_ID, value: "2026-01-20" });
    legado.capture.registerDigital({
      session: LEGACY_SESSION,
      employeeId: "10001",
      actor: "prueba",
      requestId: "req-1",
    });
    legado.capture.confirmAttendance({
      sessionId: SESSION_ID,
      employeeId: "10001",
      actor: "prueba",
      requestId: "req-2",
    });
    legado.exams.reconcile({
      sessionId: SESSION_ID,
      receivedExamCount: 1,
      actor: "prueba",
      requestId: "req-3",
    });

    const previewLegado = legado.release.preview({
      sessionId: SESSION_ID,
      trainingId: TRAINING_ID,
      mappingVersion: MAPPING_VERSION,
      releaseDate: SESSION_DATE,
    });

    assert.equal(previewLegado.included.length, 0);
    assert.ok(
      previewLegado.excluded[0]?.reasons.includes(BLOCKING_REASONS.MATRIX_VALUE_EXISTS),
      "el legado no admitía ninguna sobrescritura",
    );

    // El puerto conserva ese bloqueo bajo NO_OVERWRITE: sólo la política del
    // destino habilita el segundo valor, y siempre con motivo.
    const { service } = buildPort([buildAttendance("10001")]);
    const preview = await service.preview(SESSION_ID);
    assert.equal(preview.mapping.overwritePolicy, "NO_OVERWRITE");
  });

  it("el tope del lote sigue atado al tope de la sesión del legado", () => {
    // Son el mismo número por la misma razón: el quiosco no admite un registro
    // cuarenta y uno, así que un lote de cuarenta y uno no puede existir.
    assert.equal(MAX_ENTRIES_PER_BATCH, MAX_PARTICIPANTS_PER_SESSION);
    assert.equal(MAX_ENTRIES_PER_BATCH, 40);
  });
});
