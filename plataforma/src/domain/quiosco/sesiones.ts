/**
 * Servicio de ciclo de vida de Sesiones de Capacitación (Funciones 2 y 3).
 * Fuente: MODELO_DATOS.md hoja SESIONES, AUDITORIA.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../ports/reloj.port.ts";
import type { KioskSessionRepositoryPort } from "../../ports/quiosco.port.ts";
import {
  formatearCodigoDeSesion,
  MAYOR_NUMERO_DE_SESION,
  normalizarCodigoDeSesion,
} from "./codigo-de-sesion.ts";
import {
  InvalidInputError,
  InvalidSessionStateError,
  SessionCodeTakenError,
  SessionCodesExhaustedError,
  SessionConflictError,
  SessionNotFoundError,
} from "./errores.ts";
import type {
  ActorIdentity,
  CreateSessionInput,
  KioskSessionBrief,
  OperativeSessionSummary,
  SessionRecord,
  SessionStatus,
} from "./tipos.ts";

/**
 * Hora de inicio de la sesión, en `HH:mm` de veinticuatro horas.
 *
 * Ocupa el lugar del antiguo «turno». Un turno decía «Matutino» y no permitía
 * saber a qué hora empezó realmente la sesión, que es lo que hace falta para
 * cotejar una lista física contra lo registrado. Se acepta vacío —hay sesiones
 * capturadas sin hora— y se rechaza cualquier otra cosa en lugar de guardarla
 * tal cual: un campo de hora que a veces trae texto libre deja de ser una hora.
 *
 * En la base sigue viviendo en la columna `turno`, que es de texto y ya
 * existía; renombrarla exigiría una migración sobre datos capturados y no
 * cambiaría nada de lo que se lee en pantalla.
 */
const HORA_DEL_DIA = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/**
 * Cuántas veces se pide otro consecutivo cuando el que tocaba ya lo tomó una
 * sesión creada al mismo tiempo. Dos a la vez ya es raro; cinco seguidas
 * significaría que algo más está mal, y entonces se deja ver el error.
 */
const INTENTOS_POR_CODIGO = 5;

function normalizeStartTime(valor: unknown): string {
  if (valor === undefined || valor === null) return "";
  // `String()` sobre un objeto da `[object Object]` —que la expresión regular
  // rechaza— pero sobre un arreglo de un elemento da el elemento, y un campo
  // repetido en el formulario llega como arreglo. Aceptarlo dejaría entrar una
  // hora por una puerta que el contrato no declara.
  if (typeof valor !== "string" && typeof valor !== "number") {
    throw new InvalidInputError("La hora de la sesión debe escribirse como HH:mm de 24 horas");
  }
  const texto = String(valor).trim();
  if (texto === "") return "";
  // `<input type="time">` manda `HH:mm:ss` cuando el navegador incluye segundos.
  const recortado = texto.length === 8 && texto[5] === ":" ? texto.slice(0, 5) : texto;
  if (!HORA_DEL_DIA.test(recortado)) {
    throw new InvalidInputError("La hora de la sesión debe escribirse como HH:mm de 24 horas");
  }
  return recortado;
}

export interface SessionServiceDeps {
  readonly repository: KioskSessionRepositoryPort;
  readonly clock: Clock;
}

export class SessionService {
  private readonly repo: KioskSessionRepositoryPort;
  private readonly clock: Clock;

  constructor(deps: SessionServiceDeps) {
    this.repo = deps.repository;
    this.clock = deps.clock;
  }

  /**
   * Guarda la sesión con el siguiente código `KC-NNNN`. Dos sesiones creadas a
   * la vez pueden pedir el mismo número: la base lo impide con su unicidad y la
   * segunda vuelve a pedir el siguiente.
   */
  private async createWithNextCode(
    session: Omit<SessionRecord, "sessionCode">,
  ): Promise<SessionRecord> {
    for (let intento = 1; ; intento += 1) {
      const numero = (await this.repo.getHighestSessionCodeNumber()) + 1;
      if (numero > MAYOR_NUMERO_DE_SESION) throw new SessionCodesExhaustedError();
      try {
        return await this.repo.createSession({
          ...session,
          sessionCode: formatearCodigoDeSesion(numero),
        });
      } catch (error) {
        if (!(error instanceof SessionCodeTakenError) || intento >= INTENTOS_POR_CODIGO) {
          throw error;
        }
      }
    }
  }

  private validateCreationInput(input: CreateSessionInput): CreateSessionInput {
    if (!input || typeof input !== "object") {
      throw new InvalidInputError("Solicitud de sesión inválida");
    }

    const trainingId = String(input.trainingId || "").trim();
    if (!trainingId) {
      throw new InvalidInputError("El identificador de capacitación es requerido");
    }

    const date = String(input.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new InvalidInputError("La fecha de sesión debe estar en formato ISO (YYYY-MM-DD)");
    }

    const durationMinutes = Number(input.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      throw new InvalidInputError("La duración debe ser un entero entre 1 y 1440 minutos");
    }

    const instructor = String(input.instructor || "").trim();
    if (!instructor) {
      throw new InvalidInputError("El nombre del instructor es requerido");
    }
    if (instructor.length > 120) {
      throw new InvalidInputError("El nombre del instructor no puede exceder 120 caracteres");
    }

    const room =
      input.room !== undefined && input.room !== null ? String(input.room).trim().slice(0, 80) : "";
    const startTime = normalizeStartTime(input.startTime);
    const eventType =
      String(input.eventType || "Capacitacion")
        .trim()
        .slice(0, 80) || "Capacitacion";

    return { trainingId, date, durationMinutes, instructor, room, startTime, eventType };
  }

  private assertSameCreation(
    existing: SessionRecord,
    intended: CreateSessionInput,
    actor: string,
  ): void {
    if (
      existing.createdBy !== actor ||
      existing.trainingId !== intended.trainingId ||
      existing.date !== intended.date ||
      existing.durationMinutes !== intended.durationMinutes ||
      existing.instructor !== intended.instructor ||
      (existing.room || "") !== (intended.room || "") ||
      (existing.startTime || "") !== (intended.startTime || "") ||
      (existing.eventType || "") !== (intended.eventType || "")
    ) {
      throw new SessionConflictError("El requestId ya pertenece a otra creación de sesión");
    }
  }

  /**
   * Crea una nueva sesión en estado BORRADOR con idempotencia por creationRequestId.
   */
  async createSession(
    input: CreateSessionInput,
    identity: ActorIdentity,
    requestId: string,
  ): Promise<SessionRecord> {
    const intended = this.validateCreationInput(input);
    const opRequestId = String(requestId || "").trim();
    if (!opRequestId) {
      throw new InvalidInputError("requestId es requerido para crear sesión");
    }

    return this.repo.withLock(`session:create:${opRequestId}`, async () => {
      // Validar si el curso existe y está activo
      const training = await this.repo.getTrainingById(intended.trainingId);
      if (!training || !training.active) {
        throw new InvalidInputError("Seleccione un nombre válido de la lista.");
      }

      // Comprobar idempotencia por requestId
      const existing = await this.repo.getSessionByCreationRequestId(opRequestId);
      if (existing) {
        this.assertSameCreation(existing, intended, identity.actor);
        // Asegurar auditoría si faltaba
        const audits = await this.repo.listAuditEvents({
          sessionId: existing.sessionId,
          requestId: opRequestId,
          entityId: existing.sessionId,
        });
        if (audits.length === 0) {
          await this.repo.recordAudit({
            actor: identity.actor,
            role: identity.role,
            entityType: "Session",
            entityId: existing.sessionId,
            action: "SESSION_CREATED",
            previousState: "",
            newState: "BORRADOR",
            sessionId: existing.sessionId,
            requestId: opRequestId,
            provenance: "PLATAFORMA",
            contractVersion: "1.0.0",
          });
        }
        return existing;
      }

      const nowIso = this.clock.now().toISOString();
      const sessionId = randomUUID();

      const newSession: Omit<SessionRecord, "sessionCode"> = {
        sessionId,
        trainingId: intended.trainingId,
        instructor: intended.instructor,
        date: intended.date,
        durationMinutes: intended.durationMinutes,
        room: intended.room,
        startTime: intended.startTime,
        eventType: intended.eventType || "Capacitacion",
        maxCapacity: 40,
        status: "BORRADOR",
        authorized: false,
        createdBy: identity.actor,
        createdAt: nowIso,
        creationRequestId: opRequestId,
        version: 1,
      };

      const created = await this.createWithNextCode(newSession);

      // Auditoría append-only
      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: created.sessionId,
        action: "SESSION_CREATED",
        previousState: "",
        newState: "BORRADOR",
        sessionId: created.sessionId,
        requestId: opRequestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      return created;
    });
  }

  /**
   * Abre una sesión en estado BORRADOR pasando a ABIERTA.
   */
  async openSession(
    sessionId: string,
    identity: ActorIdentity,
    requestId: string,
  ): Promise<SessionRecord> {
    const opRequestId = String(requestId || "").trim();
    return this.repo.withLock(`session:state:${sessionId}`, async () => {
      const session = await this.repo.getSessionById(sessionId);
      if (!session) {
        throw new SessionNotFoundError("La sesión no existe");
      }

      if (identity.role === "CAPACITADOR" && session.createdBy !== identity.actor) {
        throw new InvalidSessionStateError("La sesión no pertenece al capacitador");
      }

      if (session.status === "ABIERTA") {
        // Idempotente
        return session;
      }

      if (session.status !== "BORRADOR") {
        throw new InvalidSessionStateError(
          `No se puede abrir una sesión en estado ${session.status}. Debe estar en BORRADOR.`,
        );
      }

      const nowIso = this.clock.now().toISOString();

      // Auditoría antes del cambio de estado
      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: session.sessionId,
        action: "SESSION_STATE_CHANGED",
        previousState: "BORRADOR",
        newState: "ABIERTA",
        sessionId: session.sessionId,
        requestId: opRequestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      return this.repo.updateSession(session.sessionId, {
        status: "ABIERTA",
        openedAt: nowIso,
      });
    });
  }

  /**
   * Cierra una sesión en estado ABIERTA pasando a CERRADA y reconcilia los journals del quiosco.
   */
  async closeSession(
    sessionId: string,
    identity: ActorIdentity,
    requestId: string,
    reconcileFn?: (sessionId: string) => Promise<void>,
  ): Promise<SessionRecord> {
    const opRequestId = String(requestId || "").trim();
    return this.repo.withLock(`session:state:${sessionId}`, async () => {
      const session = await this.repo.getSessionById(sessionId);
      if (!session) {
        throw new SessionNotFoundError("La sesión no existe");
      }

      /*
       * Un capacitador sólo mueve lo suyo.
       *
       * El equipo de la sala no entra por aquí: actúa con el rol `KIOSK` y
       * su autoridad es el token firmado para esa sesión concreta, no haber
       * sido quien la creó. Cerraba como `CAPACITADOR` y esta guarda lo
       * rechazaba en cuanto la sesión venía de la consola —que es el caso
       * normal—: el instructor oprimía «cerrar» en la sala, veía un error, y
       * alguien tenía que volver a cerrarla desde la plataforma.
       */
      if (identity.role === "CAPACITADOR" && session.createdBy !== identity.actor) {
        throw new InvalidSessionStateError("La sesión no pertenece al capacitador");
      }

      if (session.status === "CERRADA") {
        // Idempotente: que la sala y la consola cierren la misma sesión no es un
        // conflicto, es lo normal cuando las dos ven que ya terminó.
        return session;
      }

      if (session.status !== "ABIERTA") {
        throw new InvalidSessionStateError(
          `No se puede cerrar una sesión en estado ${session.status}. Debe estar ABIERTA.`,
        );
      }

      // Reconciliar quiosco si se proporciona función o directamente desde repositorio
      if (reconcileFn) {
        await reconcileFn(sessionId);
      }

      const nowIso = this.clock.now().toISOString();

      // Auditoría antes de mutación de estado
      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: session.sessionId,
        action: "SESSION_STATE_CHANGED",
        previousState: "ABIERTA",
        newState: "CERRADA",
        sessionId: session.sessionId,
        requestId: opRequestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      return this.repo.updateSession(session.sessionId, {
        status: "CERRADA",
        closedAt: nowIso,
      });
    });
  }

  /**
   * Autoriza una sesión operativa. Durante el piloto, el operador puede
   * preautorizarla desde BORRADOR con el PIN de autorización; la liberación
   * conserva las demás compuertas de estado, asistencia y examen.
   */
  async authorizeSession(
    sessionId: string,
    identity: ActorIdentity,
    reason: string,
    requestId: string,
  ): Promise<SessionRecord> {
    const opRequestId = String(requestId || "").trim();
    const cleanReason = String(reason || "").trim();
    if (!cleanReason) {
      throw new InvalidInputError("Se requiere un motivo para autorizar la sesión");
    }

    if (identity.role !== "CAPACITACION" && identity.role !== "ADMINISTRADOR") {
      throw new InvalidSessionStateError(
        "Solo Capacitación o Administrador pueden autorizar sesiones",
      );
    }

    return this.repo.withLock(`session:state:${sessionId}`, async () => {
      const session = await this.repo.getSessionById(sessionId);
      if (!session) {
        throw new SessionNotFoundError("La sesión no existe");
      }

      if (session.authorized) {
        return session;
      }

      const validStates: SessionStatus[] = [
        "BORRADOR",
        "ABIERTA",
        "CERRADA",
        "PRELIBERACION",
        "LISTA_PARA_LIBERAR",
        "LIBERADA_PARCIAL",
      ];
      if (!validStates.includes(session.status)) {
        throw new InvalidSessionStateError(
          `La sesión en estado ${session.status} aún no puede autorizarse`,
        );
      }

      const nowIso = this.clock.now().toISOString();

      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Session",
        entityId: session.sessionId,
        action: "SESSION_AUTHORIZED",
        previousState: "false",
        newState: "true",
        reason: cleanReason,
        sessionId: session.sessionId,
        requestId: opRequestId,
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });

      return this.repo.updateSession(session.sessionId, {
        authorized: true,
        authorizedBy: identity.actor,
        authorizedAt: nowIso,
      });
    });
  }

  /**
   * Obtiene una sesión por su ID.
   */
  async getSessionById(sessionId: string): Promise<SessionRecord> {
    const session = await this.repo.getSessionById(sessionId);
    if (!session) {
      throw new SessionNotFoundError("La sesión no fue encontrada");
    }
    return session;
  }

  /**
   * Obtiene una sesión por su código público.
   */
  async getSessionByCode(sessionCode: string): Promise<SessionRecord> {
    const normalized = normalizarCodigoDeSesion(String(sessionCode || ""));
    const session = await this.repo.getSessionByCode(normalized);
    if (!session) {
      throw new SessionNotFoundError("No existe ninguna sesión con ese código");
    }
    return session;
  }

  /**
   * Ficha de la sesión para confirmarla antes de registrar a nadie.
   *
   * Existe porque el código de sesión no dice nada: es un consecutivo que se
   * dicta en voz alta y se teclea en una sala donde puede haber dos cursos el
   * mismo día. Con sólo el código, quien capacita no tiene cómo saber que el
   * quiosco quedó vinculado a la sesión que él está impartiendo, y un registro
   * mal dirigido no se nota hasta la liberación, cuando ya hay asistencias
   * colgadas del curso equivocado.
   *
   * El nombre del curso se resuelve aquí y no en la pantalla: `trainingId` es
   * un identificador y ninguna persona puede reconocer una capacitación por él.
   */
  async getSessionBrief(sessionId: string): Promise<KioskSessionBrief> {
    const session = await this.getSessionById(sessionId);
    const training = await this.repo.getTrainingById(session.trainingId);
    return {
      sessionId: session.sessionId,
      sessionCode: session.sessionCode,
      trainingId: session.trainingId,
      // Un curso retirado del catálogo deja la sesión sin nombre. Se dice, en
      // vez de enseñar el identificador crudo como si fuera un título.
      trainingName: training?.name ?? "Curso no encontrado en el catálogo",
      instructor: session.instructor,
      date: session.date,
      startTime: session.startTime ?? "",
      durationMinutes: session.durationMinutes,
      room: session.room ?? "",
      eventType: session.eventType,
      status: session.status,
      authorized: session.authorized,
    };
  }

  /**
   * Lista sesiones operativas (activas o recientemente cerradas dentro del corte de 14 días).
   */
  async listOperativeSessions(cutoffDate?: string): Promise<readonly OperativeSessionSummary[]> {
    return this.repo.listOperativeSessions({ cutoffDate });
  }
}
