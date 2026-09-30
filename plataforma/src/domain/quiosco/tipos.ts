import type { WorkerNumber } from "../comun/numero-trabajador.ts";

export type SessionStatus =
  | "BORRADOR"
  | "ABIERTA"
  | "CERRADA"
  | "PRELIBERACION"
  | "LISTA_PARA_LIBERAR"
  | "LIBERADA_PARCIAL"
  | "LIBERADA_TOTAL"
  | "CANCELADA"
  | "ERROR";

export type KioskJournalPhase = "RESERVADO" | "ASISTENCIA_CREADA" | "COMPLETADO";

export type AttendanceStatus =
  | "CAPTURADA"
  | "IDENTIDAD_INVALIDA"
  | "PENDIENTE_COTEJO"
  | "COTEJADA"
  | "EXAMEN_PENDIENTE"
  | "EXAMEN_CONFIRMADO"
  | "EXAMEN_NO_ENCONTRADO"
  | "ELEGIBLE"
  | "EXCLUIDA"
  | "LIBERADA";

export type ExamStatus = "EXAMEN_PENDIENTE" | "EXAMEN_CONFIRMADO" | "EXAMEN_NO_ENCONTRADO";

export type CaptureRoute = "DIGITAL";

export type AttendanceOrigin = "QUIOSCO" | "ALTA_MANUAL";

export type SecretScope = "REGISTRO_QUIOSCO" | "APERTURA_SESION";

export type ActorRole = "ADMINISTRADOR" | "CAPACITACION" | "AUDITOR" | "CAPACITADOR" | "KIOSK";

export type AuditAction = string;

export interface ActorIdentity {
  readonly actor: string;
  readonly role: ActorRole;
}

export interface TrainingCatalogItem {
  readonly trainingId: string;
  readonly name: string;
  readonly active: boolean;
  readonly durationHours?: number | undefined;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly trainingId: string;
  readonly instructor: string;
  readonly date: string;
  readonly durationMinutes: number;
  readonly room?: string | undefined;
  readonly startTime?: string | undefined;
  readonly eventType: string;
  readonly maxCapacity: number;
  readonly status: SessionStatus;
  readonly authorized: boolean;
  readonly authorizedBy?: string | undefined;
  readonly authorizedAt?: string | undefined;
  readonly openedAt?: string | undefined;
  readonly closedAt?: string | undefined;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly creationRequestId: string;
  readonly version: number;
}

export interface CreateSessionInput {
  readonly trainingId: string;
  readonly date: string;
  readonly durationMinutes: number;
  readonly instructor: string;
  readonly room?: string | undefined;
  readonly startTime?: string | undefined;
  readonly eventType?: string | undefined;
}

export interface AttendanceRecord {
  readonly attendanceId: string;
  readonly sessionId: string;
  readonly workerNumber: WorkerNumber;
  readonly route: CaptureRoute;
  readonly origin: AttendanceOrigin;
  readonly identityValidated: boolean;
  readonly attendanceProven: boolean;
  readonly examStatus: ExamStatus;
  readonly status: AttendanceStatus;
  readonly excludedFromRelease: boolean;
  readonly exclusionReason?: string | undefined;
  readonly excludedBy?: string | undefined;
  readonly excludedAt?: string | undefined;
  readonly released: boolean;
  readonly releasedAt?: string | undefined;
  readonly requestId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface KioskRegistrationJournal {
  readonly registrationId: string;
  readonly sessionId: string;
  readonly workerNumber: WorkerNumber;
  readonly attendanceId?: string | undefined;
  readonly requestId: string;
  readonly stationLabel?: string | undefined;
  readonly phase: KioskJournalPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string | undefined;
}

export interface AuditEventRecord {
  readonly eventId: string;
  readonly sequence?: number | undefined;
  readonly occurredAt: string;
  readonly actor: string;
  readonly role: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly previousState?: string | undefined;
  readonly newState?: string | undefined;
  readonly reason?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly provenance:
    "PLATAFORMA" | "MATRIZ_XLSB" | "TSV_DNC" | "DNC_TECNICO" | "CAPTA" | "DEPARTAMENTO";
  readonly contractVersion: string;
}

export interface ConcessionRecord {
  readonly concessionId: string;
  readonly type: "KIOSK_CODE" | "KIOSK_GRANT" | "PLATFORM_GRANT";
  readonly sessionId?: string | undefined;
  readonly codeHash: string;
  readonly status: "EMITIDA" | "CONSUMIDA" | "EXPIRADA" | "REVOCADA";
  readonly issuedBy: string;
  readonly issuedRole: ActorRole;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string | undefined;
  readonly consumedBy?: string | undefined;
  readonly stationLabel?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface KioskParticipantReceipt {
  readonly received: true;
  readonly message: string;
}

export const GENERIC_KIOSK_RECEIPT: KioskParticipantReceipt = Object.freeze({
  received: true,
  message: "Solicitud recibida; la asistencia se confirmará durante el cotejo físico",
});

export const MAX_REGISTRATIONS_PER_SESSION = 40;

export interface KioskBootstrapState {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly status: SessionStatus;
  readonly stationLabel?: string | undefined;
  readonly trainingId: string;
  readonly trainingName: string;
  readonly date: string;
  readonly startTime: string;
  readonly room: string;
  readonly instructor: string;
  readonly availability: {
    readonly maximum: number;
    readonly available: boolean;
  };
  readonly acceptingRegistrations: boolean;
  readonly expiresAt?: string | undefined;
}

export interface OperativeSessionSummary {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly trainingId: string;
  readonly trainingName: string;
  readonly instructor: string;
  readonly date: string;
  readonly startTime?: string | undefined;
  readonly durationMinutes: number;
  readonly status: SessionStatus;
  readonly authorized: boolean;
  readonly totalAttendances: number;
  readonly createdBy?: string | undefined;
}

export interface KioskSessionBrief {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly trainingId: string;
  readonly trainingName: string;
  readonly instructor: string;
  readonly date: string;
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly room: string;
  readonly eventType: string;
  readonly status: SessionStatus;
  readonly authorized: boolean;
}
