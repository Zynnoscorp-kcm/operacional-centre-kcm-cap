/**
 * Servicio de Quiosco de Registro de Participantes (Función 1).
 * Implementa el journal transaccional de 3 fases (RESERVADO -> ASISTENCIA_CREADA -> COMPLETADO),
 * auto-reparación en el arranque, acuse indistinguible y cupo máximo de 40 registros.
 *
 * Fuente: MODELO_DATOS.md hojas KIOSK_REGISTROS, ASISTENCIAS, AUDITORIA.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../ports/reloj.port.ts";
import type { KioskSessionRepositoryPort } from "../../ports/quiosco.port.ts";
import { parseWorkerNumber } from "../comun/numero-trabajador.ts";
import { InvalidInputError, InvalidSessionStateError, SessionNotFoundError } from "./errores.ts";
import type { KioskAuthService } from "./autenticacion.ts";
import {
  GENERIC_KIOSK_RECEIPT,
  MAX_REGISTRATIONS_PER_SESSION,
  type ActorIdentity,
  type AttendanceRecord,
  type KioskBootstrapState,
  type KioskParticipantReceipt,
  type KioskRegistrationJournal,
} from "./tipos.ts";

export interface KioskServiceDeps {
  readonly repository: KioskSessionRepositoryPort;
  readonly authService: KioskAuthService;
  readonly clock: Clock;
}

export interface RegisterParticipantInput {
  readonly token: string;
  readonly employeeId: string;
  readonly requestId: string;
}

export class KioskService {
  private readonly repo: KioskSessionRepositoryPort;
  private readonly auth: KioskAuthService;
  private readonly clock: Clock;

  constructor(deps: KioskServiceDeps) {
    this.repo = deps.repository;
    this.auth = deps.authService;
    this.clock = deps.clock;
  }

  /**
   * Repara un journal individual inconcluso.
   */
  private async repairJournal(journal: KioskRegistrationJournal): Promise<void> {
    const nowIso = this.clock.now().toISOString();

    // Si está en RESERVADO, creamos la asistencia si aún no existe
    let attendanceId = journal.attendanceId;
    if (!attendanceId || journal.phase === "RESERVADO") {
      let existingAttendance = await this.repo.getAttendanceBySessionAndWorker(
        journal.sessionId,
        journal.workerNumber,
      );

      if (!existingAttendance) {
        const isActive = await this.repo.isWorkerActive(journal.workerNumber);
        const newAttendance: AttendanceRecord = {
          attendanceId: randomUUID(),
          sessionId: journal.sessionId,
          workerNumber: journal.workerNumber,
          route: "DIGITAL",
          origin: "QUIOSCO",
          identityValidated: isActive,
          attendanceProven: false,
          examStatus: "EXAMEN_PENDIENTE",
          status: isActive ? "PENDIENTE_COTEJO" : "CAPTURADA",
          excludedFromRelease: false,
          released: false,
          requestId: journal.requestId,
          createdAt: journal.createdAt,
          updatedAt: nowIso,
          version: 1,
        };
        existingAttendance = await this.repo.createAttendance(newAttendance);
      }
      attendanceId = existingAttendance.attendanceId;

      await this.repo.updateJournal(journal.registrationId, {
        phase: "ASISTENCIA_CREADA",
        attendanceId,
        updatedAt: nowIso,
      });
    }

    // Si falta la auditoría, la aseguramos
    const audits = await this.repo.listAuditEvents({
      sessionId: journal.sessionId,
      requestId: journal.requestId,
      entityId: attendanceId,
    });

    if (audits.length === 0 && attendanceId) {
      await this.repo.recordAudit({
        actor: "KIOSK",
        role: "KIOSK",
        entityType: "Attendance",
        entityId: attendanceId,
        action: "DIGITAL_ATTENDANCE_CAPTURED",
        previousState: "",
        newState: "CAPTURADA",
        reason: journal.stationLabel ? `ESTACION:${journal.stationLabel}` : "",
        sessionId: journal.sessionId,
        requestId: journal.requestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });
    }

    // Finalizar el journal en COMPLETADO
    await this.repo.updateJournal(journal.registrationId, {
      phase: "COMPLETADO",
      attendanceId,
      completedAt: nowIso,
      updatedAt: nowIso,
    });
  }

  /**
   * Repara en tiempo lineal todos los journals incompletos de una sesión sin reabrir los ya terminados.
   */
  async repairSessionJournals(sessionId: string): Promise<void> {
    const incomplete = await this.repo.listIncompleteJournalsBySession(sessionId);
    for (const journal of incomplete) {
      await this.repairJournal(journal);
    }
  }

  /**
   * Registra a un participante en el quiosco físico con reserva durable previa (3 fases),
   * cupo máximo de 40 y acuse indistinguible.
   */
  async register(input: RegisterParticipantInput): Promise<KioskParticipantReceipt> {
    if (!input || typeof input !== "object") {
      throw new InvalidInputError("Solicitud de registro inválida");
    }

    const opRequestId = String(input.requestId || "").trim();
    if (!opRequestId) {
      throw new InvalidInputError("requestId es requerido para registrar asistencia");
    }

    const payload = this.auth.verifyKioskToken(input.token);
    const workerNumber = parseWorkerNumber(input.employeeId);
    const { sessionId, stationLabel } = payload;

    return this.repo.withLock(`kiosk:session:${sessionId}`, async () => {
      const session = await this.repo.getSessionById(sessionId);
      if (!session) {
        throw new SessionNotFoundError("La sesión del quiosco no fue encontrada");
      }

      if (session.status !== "ABIERTA") {
        throw new InvalidSessionStateError("La sesión ya no acepta registros");
      }

      // Idempotencia por requestId
      const requestJournal = await this.repo.getJournalByRequest(opRequestId);
      if (requestJournal) {
        if (requestJournal.phase !== "COMPLETADO") {
          await this.repairJournal(requestJournal);
        }
        return GENERIC_KIOSK_RECEIPT;
      }

      // Idempotencia por (sessionId, workerNumber)
      const existingAttendance = await this.repo.getAttendanceBySessionAndWorker(
        sessionId,
        workerNumber,
      );
      if (existingAttendance) {
        return GENERIC_KIOSK_RECEIPT;
      }

      // Comprobación de cupo máximo de 40 registros
      const currentAttendanceCount = await this.repo.countAttendancesBySession(sessionId);
      if (currentAttendanceCount >= MAX_REGISTRATIONS_PER_SESSION) {
        // No se inserta sobre cupo lleno, pero se devuelve el acuse genérico indistinguible
        return GENERIC_KIOSK_RECEIPT;
      }

      const nowIso = this.clock.now().toISOString();

      // FASE 1: RESERVADO en Journal
      const journalRecord: KioskRegistrationJournal = {
        registrationId: randomUUID(),
        sessionId,
        workerNumber,
        requestId: opRequestId,
        stationLabel,
        phase: "RESERVADO",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await this.repo.createJournal(journalRecord);

      // FASE 2: ASISTENCIA_CREADA
      const isActive = await this.repo.isWorkerActive(workerNumber);
      const attendanceId = randomUUID();

      const attendanceRecord: AttendanceRecord = {
        attendanceId,
        sessionId,
        workerNumber,
        route: "DIGITAL",
        origin: "QUIOSCO",
        identityValidated: isActive,
        attendanceProven: false,
        examStatus: "EXAMEN_PENDIENTE",
        status: isActive ? "PENDIENTE_COTEJO" : "CAPTURADA",
        excludedFromRelease: false,
        released: false,
        requestId: opRequestId,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };

      await this.repo.createAttendance(attendanceRecord);

      await this.repo.updateJournal(journalRecord.registrationId, {
        phase: "ASISTENCIA_CREADA",
        attendanceId,
        updatedAt: nowIso,
      });

      // FASE 3: AUDITORIA Y COMPLETADO
      await this.repo.recordAudit({
        actor: "KIOSK",
        role: "KIOSK",
        entityType: "Attendance",
        entityId: attendanceId,
        action: "DIGITAL_ATTENDANCE_CAPTURED",
        previousState: "",
        newState: "CAPTURADA",
        reason: stationLabel ? `ESTACION:${stationLabel}` : "",
        sessionId,
        requestId: opRequestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      await this.repo.updateJournal(journalRecord.registrationId, {
        phase: "COMPLETADO",
        attendanceId,
        completedAt: nowIso,
        updatedAt: nowIso,
      });

      return GENERIC_KIOSK_RECEIPT;
    });
  }

  /**
   * Consulta el estado del quiosco, repara journals huérfanos y expone cupo y disponibilidad sin fugar PII.
   */
  async bootstrap(token: string): Promise<KioskBootstrapState> {
    const payload = this.auth.verifyKioskToken(token);
    const { sessionId, stationLabel, expiresAt } = payload;

    return this.repo.withLock(`kiosk:session:${sessionId}`, async () => {
      // Auto-reparación en el arranque
      await this.repairSessionJournals(sessionId);

      const session = await this.repo.getSessionById(sessionId);
      if (!session) {
        throw new SessionNotFoundError("La sesión no existe");
      }

      const attendanceCount = await this.repo.countAttendancesBySession(sessionId);
      const isAvailable = attendanceCount < MAX_REGISTRATIONS_PER_SESSION;
      const isAccepting = session.status === "ABIERTA" && isAvailable;

      // El nombre del curso acompaña a la pantalla de registro mientras dura la
      // sesión. Cuesta una lectura por arranque de quiosco, no por registro, y
      // evita que la única referencia visible sea un código de doce caracteres
      // que nadie puede reconocer.
      const training = await this.repo.getTrainingById(session.trainingId);

      return {
        sessionId: session.sessionId,
        sessionCode: session.sessionCode,
        status: session.status,
        stationLabel,
        trainingId: session.trainingId,
        trainingName: training?.name ?? "Curso no encontrado en el catálogo",
        date: session.date,
        startTime: session.startTime ?? "",
        room: session.room ?? "",
        instructor: session.instructor,
        availability: {
          maximum: MAX_REGISTRATIONS_PER_SESSION,
          available: isAvailable,
        },
        acceptingRegistrations: isAccepting,
        expiresAt,
      };
    });
  }

  /**
   * Reconciliación explícita invocada al cerrar la sesión.
   */
  async reconcileSession(_identity: ActorIdentity, sessionId: string): Promise<void> {
    await this.repairSessionJournals(sessionId);
  }
}
