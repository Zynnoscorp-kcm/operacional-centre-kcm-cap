import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryReleaseRepository } from "../../src/adapters/memoria/liberacion.ts";
import { MatrixGateway } from "../../src/domain/liberacion/pasarela-matriz.ts";
import { ReleaseService } from "../../src/domain/liberacion/servicio.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import {
  CAPACITACION,
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
import type { OverwritePolicy } from "../../src/domain/liberacion/tipos.ts";
import type { HcRecord } from "../../src/domain/importacion-matriz/tipos.ts";

const FECHA_PREVIA = "2026-01-20";

function build(policy: OverwritePolicy, hcRecords: readonly HcRecord[]) {
  const repository = new MemoryReleaseRepository({
    sessions: [buildSession()],
    attendances: [buildAttendance("10001"), buildAttendance("10002")],
    mappings: [buildMapping(policy)],
    hcRecords,
    trainings: [TRAINING_ID],
  });

  const clock = fixedClock();
  const gateway = new MatrixGateway({ matrix: repository, secret: SECRET, clock });
  const service = new ReleaseService({ repository, gateway, clock, secret: SECRET });

  return { repository, service };
}

describe("E10 · la política del destino es la que habilita", () => {
  it("con NO_OVERWRITE una fecha previa bloquea el lote", async () => {
    const { repository, service } = build("NO_OVERWRITE", [buildHcRecord("10001", FECHA_PREVIA)]);

    const outcome = await service.release(
      {
        sessionId: SESSION_ID,
        requestId: "req-sob-0001",
        overwriteReason: "Corrección autorizada",
      },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "CONFLICTO");
    const bloqueado = outcome.results.find((result) => result.employeeId === "10001");
    assert.equal(bloqueado?.status, "OVERWRITE_NOT_ALLOWED");

    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.completionDate, FECHA_PREVIA);
    assert.equal(repository.getAllHistory().length, 0);
  });

  it("con OVERWRITE_WITH_HISTORY y motivo la fecha se sustituye", async () => {
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", FECHA_PREVIA),
    ]);

    const outcome = await service.release(
      {
        sessionId: SESSION_ID,
        requestId: "req-sob-0002",
        overwriteReason: "El maestro traía la fecha de la sesión anterior",
      },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "COMPLETADO");
    const sobrescrito = outcome.results.find((result) => result.employeeId === "10001");
    assert.equal(sobrescrito?.status, "OVERWRITTEN");
    assert.equal(sobrescrito?.previousDate, FECHA_PREVIA);
    assert.equal(sobrescrito?.previousProvenance, "XLSB_IMPORT");

    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.completionDate, SESSION_DATE);
    assert.equal(registro?.provenance, "SESSION_RELEASE");
  });
});

describe("E10 · sin motivo no hay sobrescritura", () => {
  it("una fecha más reciente no detiene la liberación: se reemplaza con motivo e historial", async () => {
    const reciente = "2099-12-31";
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", reciente),
    ]);

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-sob-reciente", overwriteReason: "Confirmado" },
      CAPACITACION,
    );

    assert.notEqual(outcome.phase, "CONFLICTO");
    const reemplazada = outcome.results.find((result) => result.employeeId === "10001");
    assert.equal(reemplazada?.status, "OVERWRITTEN");
    assert.equal(repository.getAllHistory()[0]?.previousCompletionDate, reciente);
  });

  it("bloquea el lote cuando la política lo permite pero nadie declaró el motivo", async () => {
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", FECHA_PREVIA),
    ]);

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-sob-0010" },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "CONFLICTO");
    const bloqueado = outcome.results.find((result) => result.employeeId === "10001");
    assert.equal(bloqueado?.status, "OVERWRITE_REASON_REQUIRED");

    assert.equal(repository.getAllHistory().length, 0);
    const registro = await repository.getHcRecord(parseWorkerNumber("10001"), TRAINING_ID);
    assert.equal(registro?.completionDate, FECHA_PREVIA);
  });

  it("un motivo de sólo espacios no cuenta como motivo", async () => {
    const { service } = build("OVERWRITE_WITH_HISTORY", [buildHcRecord("10001", FECHA_PREVIA)]);

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-sob-0011", overwriteReason: "    " },
      CAPACITACION,
    );

    assert.equal(outcome.phase, "CONFLICTO");
    assert.equal(
      outcome.results.find((result) => result.employeeId === "10001")?.status,
      "OVERWRITE_REASON_REQUIRED",
    );
  });

  it("preliberación puede saber de antemano quién pedirá motivo", async () => {
    const { service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", FECHA_PREVIA),
      buildHcRecord("10002", "2099-01-01"),
    ]);

    const fechas = await service.existingDates(SESSION_ID);

    assert.deepEqual(
      fechas.map((fecha) => [fecha.employeeId, fecha.previousDate, fecha.newer]),
      [
        ["10001", FECHA_PREVIA, false],
        ["10002", "2099-01-01", true],
      ],
    );
  });

  it("la vista previa avisa que hace falta motivo antes de intentar nada", async () => {
    const { service } = build("OVERWRITE_WITH_HISTORY", [buildHcRecord("10001", FECHA_PREVIA)]);

    const preview = await service.preview(SESSION_ID);

    assert.equal(preview.overwriteRequiresReason, true);
    assert.equal(preview.counts.overwrites, 1);
    assert.equal(preview.atomicBatchReady, false);
    assert.equal(preview.counts.included, 2);
  });
});

describe("E10 · el historial se escribe antes que el valor", () => {
  it("registra el historial primero y el registro después", async () => {
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", FECHA_PREVIA),
    ]);

    await service.release(
      {
        sessionId: SESSION_ID,
        requestId: "req-sob-0020",
        overwriteReason: "Fecha corregida en sala",
      },
      CAPACITACION,
    );

    const orden = repository.getWriteLog();
    const indiceHistorial = orden.findIndex((paso) => paso.startsWith("history:"));
    const indiceRegistro = orden.findIndex(
      (paso) =>
        paso.startsWith("record:") &&
        paso.endsWith("|10001|" + TRAINING_ID + "|" + "operational-hc-v1"),
    );

    assert.ok(indiceHistorial >= 0, "hubo entrada de historial");
    assert.ok(indiceRegistro >= 0, "hubo escritura del registro");
    assert.ok(
      indiceHistorial < indiceRegistro,
      "si el valor se escribiera primero, una interrupción perdería el hecho original",
    );
  });

  it("no genera historial cuando la celda estaba libre", async () => {
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", []);

    await service.release(
      { sessionId: SESSION_ID, requestId: "req-sob-0021", overwriteReason: "No aplica" },
      CAPACITACION,
    );

    assert.equal(repository.getAllHistory().length, 0);
    assert.ok(repository.getWriteLog().every((paso) => paso.startsWith("record:")));
  });

  it("no genera historial cuando el valor previo ya era el mismo", async () => {
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", SESSION_DATE),
    ]);

    const outcome = await service.release(
      { sessionId: SESSION_ID, requestId: "req-sob-0022", overwriteReason: "Reaplicación" },
      CAPACITACION,
    );

    assert.equal(
      outcome.results.find((result) => result.employeeId === "10001")?.status,
      "ALREADY_APPLIED",
    );
    assert.equal(repository.getAllHistory().length, 0);
  });
});

describe("E10 · el historial es consultable y conserva el hecho", () => {
  it("guarda valor anterior, procedencia, actor, motivo y momento", async () => {
    const { repository, service } = build("OVERWRITE_WITH_HISTORY", [
      buildHcRecord("10001", FECHA_PREVIA),
    ]);

    await service.release(
      {
        sessionId: SESSION_ID,
        requestId: "req-sob-0030",
        overwriteReason: "El trabajador recursó y la fecha vigente es la de esta sesión",
      },
      CAPACITACION,
    );

    const historial = await repository.listOverwriteHistory(
      parseWorkerNumber("10001"),
      TRAINING_ID,
    );
    assert.equal(historial.length, 1);

    const entrada = historial[0];
    assert.equal(entrada?.changeType, "SOBRESCRITA");
    assert.equal(entrada?.previousCompletionDate, FECHA_PREVIA);
    assert.equal(entrada?.completionDate, SESSION_DATE);
    assert.equal(entrada?.previousProvenance, "XLSB_IMPORT");
    assert.equal(entrada?.provenance, "SESSION_RELEASE");
    assert.equal(entrada?.actorId, CAPACITACION.actor);
    assert.equal(entrada?.reason, "El trabajador recursó y la fecha vigente es la de esta sesión");
    assert.equal(entrada?.requestId, "req-sob-0030");
    assert.equal(entrada?.sessionId, SESSION_ID);
    assert.ok(entrada?.recordedAt);
  });

  it("acumula una entrada por cada sobrescritura y no pierde ninguna", async () => {
    const repository = new MemoryReleaseRepository({
      sessions: [buildSession()],
      attendances: [buildAttendance("10001")],
      mappings: [buildMapping("OVERWRITE_WITH_HISTORY")],
      hcRecords: [buildHcRecord("10001", FECHA_PREVIA)],
      trainings: [TRAINING_ID],
    });
    const clock = fixedClock();
    const gateway = new MatrixGateway({ matrix: repository, secret: SECRET, clock });
    const service = new ReleaseService({ repository, gateway, clock, secret: SECRET });

    await service.release(
      { sessionId: SESSION_ID, requestId: "req-sob-0040", overwriteReason: "Primera corrección" },
      CAPACITACION,
    );

    const segundaSesion = buildSession({
      sessionId: "SES-0002",
      sessionCode: "KCM-260820-BBBBBB",
      date: "2026-08-20",
      status: "LISTA_PARA_LIBERAR",
    });
    repository.seedSession(segundaSesion);
    repository.seedAttendance(
      buildAttendance("10001", { attendanceId: "AST-10001-B", sessionId: "SES-0002" }),
    );

    await service.release(
      { sessionId: "SES-0002", requestId: "req-sob-0041", overwriteReason: "Recursó el curso" },
      CAPACITACION,
    );

    const historial = await repository.listOverwriteHistory(
      parseWorkerNumber("10001"),
      TRAINING_ID,
    );
    assert.equal(historial.length, 2);

    assert.equal(historial[0]?.previousCompletionDate, SESSION_DATE);
    assert.equal(historial[0]?.completionDate, "2026-08-20");
    assert.equal(historial[0]?.previousProvenance, "SESSION_RELEASE");
    assert.equal(historial[1]?.previousCompletionDate, FECHA_PREVIA);
    assert.equal(historial[1]?.completionDate, SESSION_DATE);
  });
});
