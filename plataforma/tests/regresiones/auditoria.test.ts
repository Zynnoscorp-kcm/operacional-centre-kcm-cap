import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import { SupabaseKioskSessionRepository } from "../../src/adapters/postgres/quiosco.ts";
import type { SqlExecutor } from "../../src/adapters/postgres/matriz.ts";
import { InvalidInputError, KioskAuthError } from "../../src/domain/quiosco/errores.ts";
import { KioskAuthService } from "../../src/domain/quiosco/autenticacion.ts";
import { SessionService } from "../../src/domain/quiosco/sesiones.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import { deriveCategoryFromPosition } from "../../src/domain/sistema-trabajador/reglas-de-categoria.ts";

const AHORA = new Date("2026-08-19T10:00:00.000Z");
const reloj = { now: () => AHORA, nowIso: () => AHORA.toISOString() };
const SECRETO = "test-secret-key-32-chars-length!!";

function autenticacion(): KioskAuthService {
  return new KioskAuthService({
    repository: new MemoryKioskSessionRepository({
      activeWorkers: [parseWorkerNumber("10001")],
      secrets: { REGISTRO_QUIOSCO: "1234", APERTURA_SESION: "9876" },
    }),
    clock: reloj,
    tokenSecret: SECRETO,
  });
}

function concesionFirmada(cuerpo: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(cuerpo)).toString("base64url");
  const firma = createHmac("sha256", SECRETO).update(b64).digest("base64url");
  return `${b64}.${firma}`;
}

describe("auditoría · concesión del quiosco", () => {
  it("una concesión vencida se reporta como vencida y no como ilegible", () => {
    const auth = autenticacion();
    const vencida = concesionFirmada({
      role: "REGISTRO_QUIOSCO",
      expiresAt: new Date(AHORA.getTime() - 60_000).toISOString(),
      nonce: "abc",
    });

    assert.throws(
      () => auth.verifyGrant(vencida),
      (error: unknown) => {
        assert.ok(error instanceof KioskAuthError);
        assert.match(error.message, /expirado/i);
        assert.doesNotMatch(error.message, /ilegible/i);
        return true;
      },
    );
  });

  it("una concesión sin fecha de vencimiento se rechaza en vez de no vencer nunca", () => {
    const auth = autenticacion();
    const sinVencimiento = concesionFirmada({ role: "REGISTRO_QUIOSCO", nonce: "abc" });

    assert.throws(() => auth.verifyGrant(sinVencimiento), KioskAuthError);
  });

  it("una concesión vigente devuelve su alcance", () => {
    const auth = autenticacion();
    const vigente = concesionFirmada({
      role: "REGISTRO_QUIOSCO",
      expiresAt: new Date(AHORA.getTime() + 60_000).toISOString(),
      stationLabel: "SALA-1",
      nonce: "abc",
    });

    assert.deepEqual(auth.verifyGrant(vigente), {
      role: "REGISTRO_QUIOSCO",
      stationLabel: "SALA-1",
    });
  });

  it("una concesión sin alcance declarado se rechaza", () => {
    const auth = autenticacion();
    const sinAlcance = concesionFirmada({
      expiresAt: new Date(AHORA.getTime() + 60_000).toISOString(),
      nonce: "abc",
    });

    assert.throws(() => auth.verifyGrant(sinAlcance), KioskAuthError);
  });

  it("una firma alterada se rechaza", () => {
    const auth = autenticacion();
    const vigente = concesionFirmada({
      role: "REGISTRO_QUIOSCO",
      expiresAt: new Date(AHORA.getTime() + 60_000).toISOString(),
      nonce: "abc",
    });
    const [cuerpo] = vigente.split(".");

    assert.throws(() => auth.verifyGrant(`${cuerpo}.firmaFalsa`), KioskAuthError);
  });
});

describe("auditoría · paridad de adaptadores en sesiones operativas", () => {
  it("trainingId es la identidad del curso y no su nombre", async () => {
    const fila = {
      sesion_id: "s-1",
      codigo_sesion: "KCM-260819-AAAAAA",
      capacitacion_id: "11111111-1111-1111-1111-111111111111",
      clave_curso: "INDUCCION_EMPRESA",
      capacitacion: "Inducción a la empresa",
      capacitador: "INSTRUCTOR",
      fecha_sesion: "2026-08-19",
      turno: "08:00",
      duracion_minutos: 60,
      estado: "ABIERTA",
      autorizada: true,
      total_asistencias: "3",
    };
    const ejecutor: SqlExecutor = {
      query: () => Promise.resolve({ rows: [fila] as never[] }),
      transaction: (fn) => fn(ejecutor),
    };

    const [sesion] = await new SupabaseKioskSessionRepository(ejecutor).listOperativeSessions();

    assert.ok(sesion);
    assert.equal(sesion.trainingId, "INDUCCION_EMPRESA");
    assert.equal(sesion.trainingName, "Inducción a la empresa");
    assert.notEqual(sesion.trainingId, sesion.trainingName);
  });

  it("una sesión sin nombre de capacitador devuelve texto vacío y no null", async () => {
    const fila = {
      sesion_id: "s-2",
      codigo_sesion: "KCM-260819-BBBBBB",
      capacitacion_id: "11111111-1111-1111-1111-111111111111",
      clave_curso: null,
      capacitacion: "Inducción a la empresa",
      capacitador: null,
      fecha_sesion: "2026-08-19",
      turno: null,
      duracion_minutos: 60,
      estado: "ABIERTA",
      autorizada: false,
      total_asistencias: null,
    };
    const ejecutor: SqlExecutor = {
      query: () => Promise.resolve({ rows: [fila] as never[] }),
      transaction: (fn) => fn(ejecutor),
    };

    const [sesion] = await new SupabaseKioskSessionRepository(ejecutor).listOperativeSessions();

    assert.ok(sesion);
    assert.equal(sesion.instructor, "");
    assert.equal(sesion.totalAttendances, 0);
    assert.equal(sesion.trainingId, "11111111-1111-1111-1111-111111111111");
  });

  it("un curso sin metadatos DC-3 no devuelve una duración nula", async () => {
    const ejecutor: SqlExecutor = {
      query: () =>
        Promise.resolve({
          rows: [
            {
              capacitacion_id: "22222222-2222-2222-2222-222222222222",
              clave_curso: "5S",
              nombre: "5S",
              activa: true,
              duracion_horas: null,
            },
          ] as never[],
        }),
      transaction: (fn) => fn(ejecutor),
    };

    const curso = await new SupabaseKioskSessionRepository(ejecutor).getTrainingById("5S");

    assert.ok(curso);
    assert.equal(curso.durationHours, undefined);
    assert.notEqual(curso.durationHours, null);
  });
});

describe("auditoría · hora de sesión", () => {
  it("rechaza un arreglo aunque su texto parezca una hora", () => {
    const servicio = new SessionService({
      repository: new MemoryKioskSessionRepository({ activeWorkers: [] }),
      clock: reloj,
    });

    return assert.rejects(
      () =>
        servicio.createSession(
          {
            trainingId: "5S",
            date: "2026-08-19",
            durationMinutes: 60,
            instructor: "INSTRUCTOR",
            startTime: ["08:00"] as unknown as string,
          },
          { actor: "PRUEBA", role: "CAPACITADOR" },
          "req-hora-arreglo",
        ),
      InvalidInputError,
    );
  });
});

describe("auditoría · categoría por puesto", () => {
  it("cada puesto cae en su categoría y ninguno queda sin explicación", () => {
    const casos: readonly [string, string][] = [
      ["GERENTE DE PLANTA", "GERENCIAL"],
      ["SUPERVISOR DE LINEA", "MANDO_MEDIO"],
      ["MECANICO DE MANTENIMIENTO", "TECNICO"],
      ["ANALISTA DE CALIDAD", "ADMINISTRATIVO"],
      ["OPERADOR DE MAQUINA", "OPERATIVO"],
    ];
    for (const [puesto, esperada] of casos) {
      const derivada = deriveCategoryFromPosition(puesto);
      assert.equal(derivada.category, esperada, puesto);
      assert.notEqual(derivada.description.trim(), "");
    }
    assert.equal(deriveCategoryFromPosition("").category, "OPERATIVO");
    assert.equal(deriveCategoryFromPosition(null).category, "OPERATIVO");
  });
});
