/**
 * El código de sesión `KC-NNNN`: su forma, lo que se acepta tecleado y cómo
 * se asigna el consecutivo, también cuando dos sesiones se crean a la vez.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import {
  esCodigoDeSesion,
  formatearCodigoDeSesion,
  normalizarCodigoDeSesion,
  numeroDeCodigoDeSesion,
} from "../../src/domain/quiosco/codigo-de-sesion.ts";
import { SessionCodesExhaustedError } from "../../src/domain/quiosco/errores.ts";
import { SessionService } from "../../src/domain/quiosco/sesiones.ts";
import type { ActorIdentity, SessionRecord } from "../../src/domain/quiosco/tipos.ts";

const RELOJ = {
  now: () => new Date("2026-09-29T15:00:00.000Z"),
  nowIso: () => "2026-09-29T15:00:00.000Z",
};
const CAPACITADOR: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };
const CURSO = {
  trainingId: "CAP-SINT-001",
  instructor: "INSTRUCTOR_1",
  date: "2026-09-29",
  durationMinutes: 60,
};

/** Una sesión ya guardada con el código que diga la prueba. */
function sesionConCodigo(sessionCode: string): SessionRecord {
  return {
    sessionId: `sesion-${sessionCode}`,
    sessionCode,
    trainingId: "CAP-SINT-001",
    instructor: "INSTRUCTOR_1",
    date: "2026-09-01",
    durationMinutes: 60,
    eventType: "Capacitacion",
    maxCapacity: 40,
    status: "BORRADOR",
    authorized: false,
    createdBy: "INSTRUCTOR_1",
    createdAt: "2026-09-01T15:00:00.000Z",
    creationRequestId: `solicitud-${sessionCode}`,
    version: 1,
  };
}

describe("Código de sesión · forma", () => {
  it("es KC- y cuatro cifras, del 0001 al 9999", () => {
    assert.equal(formatearCodigoDeSesion(1), "KC-0001");
    assert.equal(formatearCodigoDeSesion(42), "KC-0042");
    assert.equal(formatearCodigoDeSesion(9999), "KC-9999");
    assert.throws(() => formatearCodigoDeSesion(0), RangeError);
    assert.throws(() => formatearCodigoDeSesion(10_000), RangeError);
  });

  it("el consecutivo sólo sale de un código nuevo", () => {
    assert.equal(numeroDeCodigoDeSesion("KC-0012"), 12);
    assert.equal(numeroDeCodigoDeSesion("KCM-260803-ABC123"), null);
    assert.equal(numeroDeCodigoDeSesion("KC-12"), null);
  });

  it("tecleado sin ceros, sin guion o en minúsculas, llega como se guardó", () => {
    for (const tecleado of ["KC-0001", "kc-1", "KC1", " KC 0001 ", "kc-0001"]) {
      assert.equal(normalizarCodigoDeSesion(tecleado), "KC-0001", tecleado);
    }
    // El formato anterior sólo se limpia: sigue encontrando su sesión.
    assert.equal(normalizarCodigoDeSesion(" kcm-260803-abc123 "), "KCM-260803-ABC123");
    // Lo que no es un código no se inventa.
    assert.equal(normalizarCodigoDeSesion("KC-0"), "KC-0");
    assert.equal(normalizarCodigoDeSesion("KC-12345"), "KC-12345");
  });

  it("reconoce los dos formatos y nada más", () => {
    assert.equal(esCodigoDeSesion("KC-0001"), true);
    assert.equal(esCodigoDeSesion("KCM-260803-ABC123"), true);
    assert.equal(esCodigoDeSesion("0f8fad5b-d9cb-469f-a165-70867728950e"), false);
    assert.equal(esCodigoDeSesion("KC-001"), false);
  });
});

describe("Código de sesión · consecutivo", () => {
  function servicio(repo: MemoryKioskSessionRepository) {
    return new SessionService({ repository: repo, clock: RELOJ });
  }

  it("cada sesión nueva lleva el siguiente al mayor en uso; los códigos anteriores no cuentan", async () => {
    const repo = new MemoryKioskSessionRepository({
      sessions: [sesionConCodigo("KCM-260803-ABC123"), sesionConCodigo("KC-0041")],
    });
    const sesiones = servicio(repo);
    const primera = await sesiones.createSession(CURSO, CAPACITADOR, "solicitud-1");
    const segunda = await sesiones.createSession(CURSO, CAPACITADOR, "solicitud-2");
    assert.equal(primera.sessionCode, "KC-0042");
    assert.equal(segunda.sessionCode, "KC-0043");
    // Repetir la solicitud devuelve la misma sesión, sin gastar otro número.
    const repetida = await sesiones.createSession(CURSO, CAPACITADOR, "solicitud-1");
    assert.equal(repetida.sessionCode, "KC-0042");
    assert.equal(await repo.getHighestSessionCodeNumber(), 43);
  });

  it("si otra sesión tomó el número al mismo tiempo, se pide el siguiente", async () => {
    // Una instancia vio el mayor en 4 justo antes de que otra guardara KC-0005.
    class RepoConCarrera extends MemoryKioskSessionRepository {
      consultas = 0;
      override async getHighestSessionCodeNumber(): Promise<number> {
        this.consultas += 1;
        const real = await super.getHighestSessionCodeNumber();
        return this.consultas === 1 ? real - 1 : real;
      }
    }
    const repo = new RepoConCarrera({ sessions: [sesionConCodigo("KC-0005")] });
    const creada = await servicio(repo).createSession(CURSO, CAPACITADOR, "solicitud-carrera");
    assert.equal(creada.sessionCode, "KC-0006");
    assert.equal(repo.consultas, 2);
  });

  it("después de KC-9999 no hay código y la creación lo dice", async () => {
    const repo = new MemoryKioskSessionRepository({ sessions: [sesionConCodigo("KC-9999")] });
    await assert.rejects(
      () => servicio(repo).createSession(CURSO, CAPACITADOR, "solicitud-tope"),
      (error: unknown) =>
        error instanceof SessionCodesExhaustedError && error.code === "CODIGOS_DE_SESION_AGOTADOS",
    );
  });

  it("la búsqueda encuentra la sesión aunque se teclee sin ceros", async () => {
    const repo = new MemoryKioskSessionRepository({ sessions: [sesionConCodigo("KC-0007")] });
    const encontrada = await servicio(repo).getSessionByCode("kc-7");
    assert.equal(encontrada.sessionCode, "KC-0007");
  });
});
