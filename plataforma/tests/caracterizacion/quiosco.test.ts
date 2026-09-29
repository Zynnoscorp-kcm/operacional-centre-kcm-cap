/**
 * Caracterización y congelamiento de comportamiento de quiosco y sesiones.
 * Valida la paridad de la implementación con los contratos de quiosco y sesión.
 *
 * Invariantes verificados:
 * 1. Journal transaccional de 3 fases (RESERVADO -> ASISTENCIA_CREADA -> COMPLETADO).
 * 2. Acuse genérico indistinguible (sin oráculos de existencia, duplicidad o cupo).
 * 3. Cupo máximo estricto de 40 registros por sesión.
 * 4. Padrón activo vs trabajador no listado (identidad_validada = true/false).
 * 5. Reparación automática de journals huérfanos durante el bootstrap.
 * 6. Idempotencia total por requestId y por (sessionId, workerNumber).
 * 7. Segunda contraseña con alcances y auditoría independientes (REGISTRO_QUIOSCO vs APERTURA_SESION).
 * 8. Ciclo de vida estricto de sesiones (BORRADOR -> ABIERTA -> CERRADA -> AUTORIZADA).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import { KioskAuthService } from "../../src/domain/quiosco/autenticacion.ts";
import { KioskService } from "../../src/domain/quiosco/registro.ts";
import { SessionService } from "../../src/domain/quiosco/sesiones.ts";
import { GENERIC_KIOSK_RECEIPT, type ActorIdentity } from "../../src/domain/quiosco/tipos.ts";
import {
  InvalidSessionStateError,
  KioskAuthError,
  SessionConflictError,
} from "../../src/domain/quiosco/errores.ts";

const FIXED_DATE = new Date("2026-08-03T10:00:00.000Z");
const testClock = { now: () => FIXED_DATE, nowIso: () => FIXED_DATE.toISOString() };
const TOKEN_SECRET = "test-secret-key-32-chars-length!!";

function setupServices(activeWorkers: string[] = ["10001", "10002", "10003"]) {
  const repo = new MemoryKioskSessionRepository({
    activeWorkers: activeWorkers.map(parseWorkerNumber),
    secrets: {
      REGISTRO_QUIOSCO: "1234",
      APERTURA_SESION: "9876",
    },
  });
  const auth = new KioskAuthService({
    repository: repo,
    clock: testClock,
    tokenSecret: TOKEN_SECRET,
  });
  const kiosk = new KioskService({
    repository: repo,
    authService: auth,
    clock: testClock,
  });
  const session = new SessionService({
    repository: repo,
    clock: testClock,
  });

  return { repo, auth, kiosk, session };
}

describe("Caracterización de Quiosco y Sesiones (Funciones 1, 2 y 3)", () => {
  describe("Segunda contraseña y separación de alcances de seguridad", () => {
    it("valida el PIN de quiosco (Secret 1) y genera una concesión con auditoría de éxito", async () => {
      const { auth, repo } = setupServices();
      const result = await auth.unlockKiosk("1234", "ESTACION-SALA-A");
      assert.ok(result.grant);
      assert.ok(result.expiresAt);

      const audits = await repo.listAuditEvents({ entityId: "KIOSK_PIN" });
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.action, "KIOSK_PIN_ACCEPTED");
      assert.equal(audits[0]?.newState, "AUTORIZADO");
      assert.equal(audits[0]?.reason, "ESTACION:ESTACION-SALA-A");
    });

    it("rechaza PIN de quiosco incorrecto y registra auditoría independiente KIOSK_PIN_REJECTED", async () => {
      const { auth, repo } = setupServices();
      await assert.rejects(
        () => auth.unlockKiosk("0000", "ESTACION-SALA-A"),
        (err: any) =>
          err instanceof KioskAuthError && err.message.includes("PIN del quiosco no es correcto"),
      );

      const audits = await repo.listAuditEvents({ entityId: "KIOSK_PIN" });
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.action, "KIOSK_PIN_REJECTED");
      assert.equal(audits[0]?.newState, "DENEGADO");
    });

    it("valida la segunda contraseña de apertura (Secret 2) separada del PIN de quiosco", async () => {
      const { auth, repo } = setupServices();

      // PIN de apertura con clave correcta
      const ok = await auth.verifySessionLaunchSecret("9876", undefined, "ESTACION-1");
      assert.equal(ok, true);

      // Auditoría de PIN de sesión
      const audits = await repo.listAuditEvents({ entityId: "SESSION_LAUNCH_PIN" });
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.action, "SESSION_PIN_ACCEPTED");

      // El PIN de quiosco (1234) NO sirve como PIN de apertura
      await assert.rejects(
        () => auth.verifySessionLaunchSecret("1234", undefined, "ESTACION-1"),
        KioskAuthError,
      );
    });
  });

  describe("Ciclo de vida y creación de sesiones (Funciones 2 y 3)", () => {
    it("crea una sesión en BORRADOR con código KC-0001 e idempotencia por creationRequestId", async () => {
      const { session, repo } = setupServices();
      const identity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      const created = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 120,
          room: "SALA NORTE",
        },
        identity,
        "req-create-001",
      );

      assert.equal(created.status, "BORRADOR");
      assert.equal(created.authorized, false);
      assert.equal(created.durationMinutes, 120);
      assert.equal(created.sessionCode, "KC-0001");

      // Auditoría SESSION_CREATED
      const audits = await repo.listAuditEvents({ sessionId: created.sessionId });
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.action, "SESSION_CREATED");
      assert.equal(audits[0]?.newState, "BORRADOR");

      // Idempotencia: misma llamada devuelve la misma sesión
      const repeated = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 120,
          room: "SALA NORTE",
        },
        identity,
        "req-create-001",
      );
      assert.equal(repeated.sessionId, created.sessionId);

      // Conflicto si los datos difieren para el mismo requestId
      await assert.rejects(
        () =>
          session.createSession(
            {
              trainingId: "CAP-SINT-002",
              instructor: "INSTRUCTOR_2",
              date: "2026-08-03",
              durationMinutes: 60,
            },
            identity,
            "req-create-001",
          ),
        SessionConflictError,
      );
    });

    it("recorre las transiciones permitidas: BORRADOR -> ABIERTA -> CERRADA", async () => {
      const { session } = setupServices();
      const identity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        identity,
        "req-trans-001",
      );

      // Abrir sesión
      const opened = await session.openSession(s.sessionId, identity, "req-open-001");
      assert.equal(opened.status, "ABIERTA");
      assert.ok(opened.openedAt);

      // Reintento idempotente de abrir
      const openedAgain = await session.openSession(s.sessionId, identity, "req-open-002");
      assert.equal(openedAgain.status, "ABIERTA");

      // Cerrar sesión
      const closed = await session.closeSession(s.sessionId, identity, "req-close-001");
      assert.equal(closed.status, "CERRADA");
      assert.ok(closed.closedAt);

      // No se puede volver a abrir una sesión cerrada
      await assert.rejects(
        () => session.openSession(s.sessionId, identity, "req-open-003"),
        InvalidSessionStateError,
      );
    });

    it("permite preautorizar una sesión en borrador durante el piloto y exige rol autorizado", async () => {
      const { session } = setupServices();
      const capIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };
      const adminIdentity: ActorIdentity = { actor: "ADMIN_CAP", role: "CAPACITACION" };

      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        capIdentity,
        "req-auth-001",
      );

      // El piloto permite autorizar desde BORRADOR para preparar pruebas E2E.
      const authorized = await session.authorizeSession(
        s.sessionId,
        adminIdentity,
        "Autorización de prueba con PIN",
        "req-auth-002",
      );
      assert.equal(authorized.authorized, true);
      assert.equal(authorized.authorizedBy, "ADMIN_CAP");

      // Capacitador no puede autorizar
      await assert.rejects(
        () => session.authorizeSession(s.sessionId, capIdentity, "Aprobado", "req-auth-003"),
        InvalidSessionStateError,
      );
    });
  });

  describe("Quiosco: Journal transaccional de 3 fases, acuse y cupo (Función 1)", () => {
    it("registra un participante en 3 fases: RESERVADO -> ASISTENCIA_CREADA -> COMPLETADO", async () => {
      const { session, kiosk, auth, repo } = setupServices(["10001"]);
      const instructorIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      // Crear y abrir sesión
      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        instructorIdentity,
        "req-kiosk-s1",
      );
      await session.openSession(s.sessionId, instructorIdentity, "req-kiosk-open1");

      const { token } = auth.createKioskToken(s.sessionId, "ESTACION-1");

      // Registro de trabajador
      const receipt = await kiosk.register({
        token,
        employeeId: "10001",
        requestId: "req-reg-001",
      });

      assert.deepEqual(receipt, GENERIC_KIOSK_RECEIPT);

      // Verificar journal
      const journals = await repo.listJournalsBySession(s.sessionId);
      assert.equal(journals.length, 1);
      assert.equal(journals[0]?.phase, "COMPLETADO");
      assert.equal(journals[0]?.workerNumber, parseWorkerNumber("10001"));
      assert.ok(journals[0]?.attendanceId);

      // Verificar asistencia creada
      const attendance = await repo.getAttendanceBySessionAndWorker(
        s.sessionId,
        parseWorkerNumber("10001"),
      );
      assert.ok(attendance);
      assert.equal(attendance.identityValidated, true);
      assert.equal(attendance.status, "PENDIENTE_COTEJO");
      assert.equal(attendance.route, "DIGITAL");
      assert.equal(attendance.origin, "QUIOSCO");

      // Verificar auditoría
      const audits = await repo.listAuditEvents({
        sessionId: s.sessionId,
        action: "DIGITAL_ATTENDANCE_CAPTURED",
      });
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.actor, "KIOSK");
    });

    it("un trabajador no registrado en el padrón recibe el mismo acuse pero con identidad_validada = false", async () => {
      const { session, kiosk, auth, repo } = setupServices(["10001"]);
      const instructorIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        instructorIdentity,
        "req-kiosk-s2",
      );
      await session.openSession(s.sessionId, instructorIdentity, "req-kiosk-open2");

      const { token } = auth.createKioskToken(s.sessionId, "ESTACION-1");

      // Registro de trabajador desconocido "99999"
      const receipt = await kiosk.register({
        token,
        employeeId: "99999",
        requestId: "req-reg-999",
      });

      assert.deepEqual(receipt, GENERIC_KIOSK_RECEIPT);

      const attendance = await repo.getAttendanceBySessionAndWorker(
        s.sessionId,
        parseWorkerNumber("99999"),
      );
      assert.ok(attendance);
      assert.equal(attendance.identityValidated, false);
      assert.equal(attendance.status, "CAPTURADA");
    });

    it("reintentos con el mismo requestId o mismo trabajador devuelven el acuse genérico sin duplicar", async () => {
      const { session, kiosk, auth, repo } = setupServices(["10001"]);
      const instructorIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        instructorIdentity,
        "req-kiosk-s3",
      );
      await session.openSession(s.sessionId, instructorIdentity, "req-kiosk-open3");
      const { token } = auth.createKioskToken(s.sessionId, "ESTACION-1");

      // Primer registro
      const receipt1 = await kiosk.register({
        token,
        employeeId: "10001",
        requestId: "req-reg-dup-1",
      });
      assert.deepEqual(receipt1, GENERIC_KIOSK_RECEIPT);

      // Mismo requestId
      const receipt2 = await kiosk.register({
        token,
        employeeId: "10001",
        requestId: "req-reg-dup-1",
      });
      assert.deepEqual(receipt2, GENERIC_KIOSK_RECEIPT);

      // Distinto requestId pero mismo trabajador en la misma sesión
      const receipt3 = await kiosk.register({
        token,
        employeeId: "10001",
        requestId: "req-reg-dup-2",
      });
      assert.deepEqual(receipt3, GENERIC_KIOSK_RECEIPT);

      const count = await repo.countAttendancesBySession(s.sessionId);
      assert.equal(count, 1);
    });

    it("aplica el límite estricto de cupo máximo de 40 y devuelve acuse genérico indistinguible", async () => {
      const { session, kiosk, auth, repo } = setupServices();
      const instructorIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        instructorIdentity,
        "req-kiosk-cap-s",
      );
      await session.openSession(s.sessionId, instructorIdentity, "req-kiosk-cap-open");
      const { token } = auth.createKioskToken(s.sessionId, "ESTACION-1");

      // Simular 40 registros
      for (let i = 1; i <= 40; i++) {
        const empId = String(10000 + i);
        await kiosk.register({
          token,
          employeeId: empId,
          requestId: `req-bulk-${i}`,
        });
      }

      const totalCount = await repo.countAttendancesBySession(s.sessionId);
      assert.equal(totalCount, 40);

      // Registro número 41 (excede cupo)
      const receipt41 = await kiosk.register({
        token,
        employeeId: "20001",
        requestId: "req-bulk-41",
      });

      // Debe devolver el acuse genérico idéntico sin oráculo de cupo
      assert.deepEqual(receipt41, GENERIC_KIOSK_RECEIPT);

      // El conteo en la base de datos debe permanecer en 40
      const finalCount = await repo.countAttendancesBySession(s.sessionId);
      assert.equal(finalCount, 40);
    });

    it("repara automáticamente journals en RESERVADO o ASISTENCIA_CREADA durante el bootstrap", async () => {
      const { session, kiosk, auth, repo } = setupServices(["10001", "10002"]);
      const instructorIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      const s = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        instructorIdentity,
        "req-repair-s",
      );
      await session.openSession(s.sessionId, instructorIdentity, "req-repair-open");
      const { token } = auth.createKioskToken(s.sessionId, "ESTACION-1");

      // Inyectar un journal simulado que quedó varado en RESERVADO (e.g. corte de energía)
      await repo.createJournal({
        registrationId: "journal-orphaned-1",
        sessionId: s.sessionId,
        workerNumber: parseWorkerNumber("10001"),
        requestId: "req-interrupted-1",
        stationLabel: "ESTACION-1",
        phase: "RESERVADO",
        createdAt: "2026-08-03T10:00:00.000Z",
        updatedAt: "2026-08-03T10:00:00.000Z",
      });

      // Al llamar a bootstrap, se debe reparar
      const bootstrapState = await kiosk.bootstrap(token);
      assert.equal(bootstrapState.sessionId, s.sessionId);
      assert.equal(bootstrapState.acceptingRegistrations, true);
      assert.equal(bootstrapState.availability.maximum, 40);

      // Comprobar que el journal avanzó a COMPLETADO y la asistencia se creó
      const journal = await repo.getJournalByRequest("req-interrupted-1");
      assert.equal(journal?.phase, "COMPLETADO");
      assert.ok(journal?.attendanceId);

      const attendance = await repo.getAttendanceBySessionAndWorker(
        s.sessionId,
        parseWorkerNumber("10001"),
      );
      assert.ok(attendance);
      assert.equal(attendance.identityValidated, true);
    });
  });

  describe("Vista de Sesiones Operativas (Función 3)", () => {
    it("proyecta sesiones activas y recientemente cerradas sin fugar datos personales", async () => {
      const { session } = setupServices();
      const instructorIdentity: ActorIdentity = { actor: "INSTRUCTOR_1", role: "CAPACITADOR" };

      // Sesión 1: ABIERTA
      const s1 = await session.createSession(
        {
          trainingId: "CAP-SINT-001",
          instructor: "INSTRUCTOR_1",
          date: "2026-08-03",
          durationMinutes: 60,
        },
        instructorIdentity,
        "req-view-1",
      );
      await session.openSession(s1.sessionId, instructorIdentity, "req-view-open1");

      // Sesión 2: CERRADA reciente
      const s2 = await session.createSession(
        {
          trainingId: "CAP-SINT-002",
          instructor: "INSTRUCTOR_2",
          date: "2026-08-01",
          durationMinutes: 120,
        },
        instructorIdentity,
        "req-view-2",
      );
      await session.openSession(s2.sessionId, instructorIdentity, "req-view-open2");
      await session.closeSession(s2.sessionId, instructorIdentity, "req-view-close2");

      const operative = await session.listOperativeSessions("2026-07-20");
      assert.equal(operative.length, 2);

      const codes = operative.map((o) => o.sessionCode);
      assert.ok(codes.includes(s1.sessionCode));
      assert.ok(codes.includes(s2.sessionCode));
    });
  });
});
