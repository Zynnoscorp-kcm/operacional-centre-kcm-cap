/**
 * Emisión individual de constancias DC-3.
 *
 * El runner por lotes (`packages/dc3/runner.js`) sigue siendo el camino para emitir
 * las 1,745 de una vez: lee el XLSB, el padrón y la plantilla, y lleva su propio
 * ledger. Este puerto sirve al caso contrario y mucho más común en ventanilla:
 * una persona, un curso, ahora. Lee de la base —que es donde vive el padrón
 * ya conciliado— en vez de volver a abrir el libro de Excel.
 *
 * Los tres cursos con obligación DC-3 son los que tienen fila en
 * `kcm.metadato_curso_dc3`; no se enumeran aquí para que dar de alta un cuarto
 * sea capturar un renglón y no editar código.
 */

/** Filtros de la pantalla. Son los mismos nombres que usa `/trabajadores`. */
export interface Dc3CandidateFilter {
  /** `clave_curso` de `kcm.capacitacion`. Sin valor, los tres cursos. */
  readonly courseKey?: string;
  readonly area?: string;
  /** `NS` sindicalizado, `NQ` confianza. */
  readonly payrollType?: string;
  /** Número de trabajador o parte del nombre. */
  readonly query?: string;
  /**
   * La pestaña del plan. Parte el padrón en las tres situaciones que exigen
   * decisiones distintas: quien ya puede recibir una constancia completa, quien
   * la recibiría con recuadros en blanco, y quien no tiene el curso.
   */
  readonly status?: Dc3PlanTab;
}

/** Las tres pestañas del plan de emisión. */
export type Dc3PlanTab = "listos" | "incompletos" | "sin-curso";

/**
 * Las cuentas del plan de emisión. Salen de la base y no del runner por lotes,
 * porque lo que el plan tiene que contestar es a cuánta gente le toca constancia
 * hoy y qué le falta a la que no puede recibirla.
 */
export interface Dc3PlanSummary {
  /** Con fecha del curso y todos sus datos legales: la constancia sale completa. */
  readonly ready: number;
  /** Con fecha del curso pero con algún recuadro que saldría en blanco. */
  readonly incomplete: number;
  /** Sin fecha del curso: no lo han tomado, o no está registrado. */
  readonly withoutDate: number;
  /**
   * Cursaron pero no tienen clave de ocupación. Se cuenta aparte de `incomplete`
   * porque hoy es un pendiente del padrón completo y no un defecto individual;
   * su recuadro sale en blanco en cualquiera de las dos pestañas.
   */
  readonly withoutOccupation: number;
}

export interface Dc3Candidate {
  readonly workerNumber: string;
  readonly workerName: string;
  readonly area: string;
  readonly department: string;
  readonly position: string;
  readonly payrollType: string | null;
  readonly courseKey: string;
  readonly courseName: string;
  /** Fecha del curso, o de alta cuando la regla del curso es `FECHA_ALTA`. */
  readonly completionDate: string | null;
  /** Si el padrón tiene CURP. Sin ella la constancia sale con recuadros vacíos. */
  readonly hasCurp: boolean;
  /**
   * Los recuadros legales que saldrían en blanco, ya con nombre legible. Vacío
   * significa que la constancia sale completa. No incluye la fecha del curso:
   * ésa separa las pestañas del plan y se dice aparte.
   */
  readonly missing: readonly string[];
}

/** Lo que hace falta para imprimir, CURP incluida. No se lista: se pide por uno. */
export interface Dc3CandidateDetail extends Dc3Candidate {
  readonly curp: string;
  /**
   * Ocupación específica según el Catálogo Nacional de Ocupaciones, ya compuesta
   * para imprimir. Vacía mientras el puesto no tenga clave asignada: es lo que
   * el padrón semanal escribe con su columna nueva.
   */
  readonly occupation: string;
  readonly durationHours: number | null;
  readonly thematicAreaKey: string | null;
  readonly thematicAreaName: string | null;
  readonly trainingAgent: string | null;
}

export interface Dc3CertificatePort {
  /** Cursos con obligación DC-3, para el desplegable. */
  listDc3Courses(): Promise<readonly { readonly courseKey: string; readonly courseName: string }[]>;
  /**
   * Candidatos que cumplen los filtros. El límite no es negociable: sin él, una
   * pantalla sin filtrar arrastraría más de cinco mil renglones por el enlace.
   */
  listCandidates(filter: Dc3CandidateFilter, limit: number): Promise<readonly Dc3Candidate[]>;
  findCandidate(workerNumber: string, courseKey: string): Promise<Dc3CandidateDetail | null>;
  /**
   * Deja constancia de que se emitió una constancia. La emisión individual no
   * escribe `kcm.documento_dc3` —ese contrato lo lleva el runner por lotes— pero
   * un documento legal con datos personales no puede salir sin dejar rastro.
   */
  /** Las cuentas del plan para los mismos filtros de la pantalla. */
  summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary>;
  /**
   * Claves `numeroDeNomina:claveDeCurso` que ya se emitieron alguna vez. Sirve
   * para que el plan diga a quién ya se le entregó su constancia en vez de
   * dejar que se emita dos veces sin saberlo.
   */
  listEmittedKeys(): Promise<readonly string[]>;
  recordEmission(input: {
    readonly actor: string;
    readonly workerNumber: string;
    readonly courseKey: string;
    readonly requestId: string;
    readonly partial: boolean;
  }): Promise<void>;
}
