/**
 * Constancias DC-3.
 *
 * Toda constancia sale por aquí: la de una persona en ventanilla, las marcadas
 * de una lista y todas las de un filtro de una vez. Lee de la base —donde vive
 * el padrón ya conciliado con la matriz— y asienta en la bitácora, que es el
 * único registro de lo emitido.
 *
 * Los tres cursos con obligación DC-3 son los que tienen fila en
 * `dc3.curso_configuracion`; no se enumeran aquí para que dar de alta un cuarto
 * sea capturar un renglón y no editar código.
 */

import type { PeriodoDc3 } from "../domain/dc3/corte.ts";

/** Filtros de la pantalla. Son los mismos nombres que usa `/trabajadores`. */
export interface Dc3CandidateFilter {
  /** `clave_curso` de `catalogo.capacitacion`. Sin valor, los tres cursos. */
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
  /**
   * Si la constancia ya salió alguna vez.
   *
   * Es la pregunta diaria de la ventanilla —«¿a quién le falta todavía?»— y no
   * se puede contestar tachando renglones a ojo: la marca «ya emitida» aparece
   * por renglón, pero con ochocientos pendientes hay que poder pedir sólo los
   * que faltan. Filtra contra la bitácora, que es donde vive esa verdad.
   *
   * `parciales` son las que salieron alguna vez y nunca completas: las que hay
   * que volver a emitir cuando llegue el dato que les faltaba.
   */
  readonly emission?: Dc3EmissionState;
  /**
   * De qué periodo, según la fecha del curso: desde el corte o de años
   * anteriores. Sólo acota a quien tiene fecha; quien no tiene el curso no es de
   * ningún periodo. Sin valor, los dos.
   */
  readonly period?: PeriodoDc3;
}

export type { PeriodoDc3 };

/** Lo que dice la bitácora de una constancia. */
export type Dc3EmissionState = "emitidas" | "pendientes" | "parciales";

/** Las tres pestañas del plan de emisión. */
export type Dc3PlanTab = "listos" | "incompletos" | "sin-curso";

/**
 * El orden del listado.
 *
 * `nombre` es el de siempre —alfabético— y sirve para dar con una persona.
 * `personal` es el del reparto: primero los empleados de confianza y después
 * los sindicalizados, y dentro de cada grupo por número de nómina de menor a
 * mayor, que es el orden en que se entregan los formatos.
 *
 * Viaja aparte del filtro y no dentro de él porque no decide quién sale en la
 * lista, sino en qué orden; el mismo filtro alimenta las cuentas del plan, a
 * las que el orden no les dice nada.
 */
export type Dc3CandidateOrder = "nombre" | "personal";

/**
 * Las cuentas de la bandeja. Salen de contar en la base, porque lo que tienen
 * que contestar es a cuánta gente le toca constancia y qué le falta a la que no
 * puede recibirla completa.
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
  /**
   * Con fecha del curso desde el corte, y de años anteriores. Cuentan con la
   * situación puesta y sin el periodo, para que la opción elegida no deje a la
   * otra en cero.
   */
  readonly fromCutoff: number;
  readonly beforeCutoff: number;
}

/**
 * La cobertura de un curso sobre el padrón activo.
 *
 * Es la pregunta que la pantalla no sabía contestar: no «a quién le toca hoy»
 * —eso lo dice el plan— sino «cuánto falta». Cada curso con obligación DC-3
 * tiene un universo fijo, el padrón activo, y cada trabajador está en una de
 * cuatro situaciones. La suma de las tres primeras es `total`; `emitted` las
 * cruza, porque una constancia ya emitida sigue contando en su situación.
 */
export interface Dc3CourseCoverage {
  readonly courseKey: string;
  readonly courseName: string;
  /** Trabajadores activos con obligación de este curso. */
  readonly total: number;
  readonly ready: number;
  readonly incomplete: number;
  readonly withoutDate: number;
  /** Con constancia individual ya registrada alguna vez. */
  readonly emitted: number;
  /**
   * Con fecha del curso y sin constancia asentada: lo que de verdad se puede
   * emitir hoy. No es `ready + incomplete - emitted`, porque una constancia
   * rotulada en blanco para quien no tiene el curso también cuenta como emitida.
   */
  readonly pending: number;
  /** Con fecha del curso de años anteriores al corte: lo que se revisa aparte. */
  readonly beforeCutoff: number;
}

/**
 * Una emisión individual ya asentada.
 *
 * Sale de `sistema.bitacora_auditoria`, que es donde vive el rastro legal, y no de una tabla
 * propia: el registro de quién emitió qué no puede depender de una tabla que
 * esta pantalla podría reescribir.
 */
export interface Dc3EmissionRecord {
  readonly at: string;
  readonly actor: string;
  readonly workerNumber: string;
  /** Del padrón, cuando el trabajador sigue activo. */
  readonly workerName: string | null;
  readonly courseKey: string;
  readonly courseName: string | null;
  /** Salió con recuadros en blanco. */
  readonly partial: boolean;
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
  /** Días que se suman a la fecha del curso para llegar a su término. */
  readonly periodDays: number;
  /** La fecha del curso es de antes del corte. */
  readonly beforeCutoff: boolean;
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

/**
 * Lo asentado de una constancia, resumido por clave `nomina:curso`.
 *
 * La bitácora guarda un asiento por emisión; la pantalla necesita saber, de
 * cada constancia, si salió, cuándo la última vez, quién la emitió y si alguna
 * vez salió completa. Resumirlo en la base es una consulta; resumirlo aquí
 * serían todos los asientos por el enlace en cada pantalla.
 */
export interface Dc3EmissionSummary {
  /** `numeroDeNomina:claveDeCurso`, como la asienta la bitácora. */
  readonly key: string;
  /** Cuántas veces se asentó. Reemitir es legítimo y se cuenta. */
  readonly count: number;
  readonly lastAt: string;
  readonly lastActor: string;
  /** La última emisión salió con recuadros en blanco. */
  readonly lastPartial: boolean;
  /** Alguna de sus emisiones salió completa. */
  readonly anyComplete: boolean;
}

/**
 * Filtros del historial. Todos opcionales y acumulables; las fechas son días de
 * la planta —hora de la Ciudad de México—, no del proceso, para que «hoy»
 * signifique lo mismo a las once de la noche que a mediodía.
 */
export interface Dc3EmissionFilter {
  /** Desde este día, inclusive (`YYYY-MM-DD`). */
  readonly from?: string;
  /** Hasta este día, inclusive (`YYYY-MM-DD`). */
  readonly to?: string;
  readonly courseKey?: string;
  /** La cuenta de consola que emitió. */
  readonly actor?: string;
  /** Sólo las que salieron completas, o sólo las que salieron con blancos. */
  readonly outcome?: "completas" | "parciales";
  /** Número de trabajador o parte del nombre. */
  readonly query?: string;
  /** Un solo trabajador, por número exacto. */
  readonly workerNumber?: string;
}

/** Las cuentas del historial que se miran a diario. */
export interface Dc3EmissionTotals {
  readonly today: number;
  readonly week: number;
  readonly month: number;
  readonly total: number;
  /** Asientos que salieron con recuadros en blanco. */
  readonly partial: number;
}

/** Cobertura de un curso dentro de un área: la pregunta de quien lleva el área. */
export interface Dc3AreaCoverage extends Dc3CourseCoverage {
  /** Vacío cuando el trabajador no tiene área en el padrón. */
  readonly area: string;
}

/** Lo que el formato imprime de cada curso, tal como está en la base. */
export interface Dc3CourseMetadata {
  readonly courseKey: string;
  /** El nombre que se imprime, que puede diferir del de catálogo. */
  readonly courseName: string;
  readonly durationHours: number | null;
  /** Referencia interna: el formato imprime horas. */
  readonly durationDays: number | null;
  readonly thematicAreaKey: string | null;
  readonly thematicAreaName: string | null;
  readonly trainingAgent: string | null;
  /** De dónde sale la fecha del curso: alta, matriz o sesión. */
  readonly dateRule: string;
  /** Días que se suman al inicio para el término del periodo. */
  readonly periodDays: number;
  readonly approved: boolean;
}

/** Cuántos trabajadores activos no traen cada dato que el formato imprime. */
export interface Dc3DataGaps {
  readonly activeWorkers: number;
  readonly withoutCurp: number;
  readonly withoutOccupation: number;
  readonly withoutPosition: number;
}

/**
 * Una combinación de área y puesto sin clave de ocupación.
 *
 * La clave varía según el puesto y el área de cada quien, así que para
 * completarla no hace falta decidir mil seiscientas claves sino una por
 * combinación. Agrupada así, la lista es la que se lleva a quien la decide.
 */
export interface Dc3OccupationGap {
  readonly area: string;
  readonly position: string;
  readonly workers: number;
}

/** Un trabajador activo sin clave de ocupación: el renglón que el padrón tiene que traer. */
export interface Dc3WorkerWithoutOccupation {
  readonly workerNumber: string;
  readonly workerName: string;
  readonly area: string;
  readonly position: string;
  readonly payrollType: string | null;
}

/** Nómina y curso: lo que identifica una constancia. */
export interface Dc3Key {
  readonly workerNumber: string;
  readonly courseKey: string;
}

/** Un asiento de emisión, tal como lo recibe la bitácora. */
export interface Dc3EmissionEntry extends Dc3Key {
  readonly actor: string;
  readonly requestId: string;
  readonly partial: boolean;
}

export interface Dc3CertificatePort {
  /** Cursos con obligación DC-3, para el desplegable. */
  listDc3Courses(): Promise<readonly { readonly courseKey: string; readonly courseName: string }[]>;
  /**
   * Candidatos que cumplen los filtros. El límite no es negociable: sin él, una
   * pantalla sin filtrar arrastraría más de cinco mil renglones por el enlace.
   *
   * El orden se aplica antes de recortar, y por eso llega hasta aquí en vez de
   * resolverse sobre las filas ya traídas: reordenar lo que ya llegó dejaría
   * fuera a la misma gente en los dos órdenes, y entonces cambiar de orden no
   * enseñaría a nadie nuevo.
   */
  listCandidates(
    filter: Dc3CandidateFilter,
    limit: number,
    order?: Dc3CandidateOrder,
    /**
     * Renglones a saltar. Es lo que convierte el tope en páginas: sin él, un
     * curso con ochocientos pendientes enseñaba los primeros trescientos y el
     * resto no existía para la pantalla.
     */
    offset?: number,
  ): Promise<readonly Dc3Candidate[]>;
  /**
   * Cuántos renglones cumplen el filtro, sin traerlos. Es lo que permite decir
   * «301 a 600 de 812» en vez de «lista recortada», y lo que decide si hay
   * página siguiente.
   */
  countCandidates(filter: Dc3CandidateFilter): Promise<number>;
  /**
   * Cuántos renglones cumplen el filtro en cada curso. Alimenta las opciones
   * de curso de la pantalla, que dicen cuántos hay detrás antes de pulsarlas.
   */
  countByCourse(
    filter: Dc3CandidateFilter,
  ): Promise<readonly { readonly courseKey: string; readonly total: number }[]>;
  /** Cobertura por curso sobre el padrón activo, con los mismos filtros. */
  coverage(filter: Dc3CandidateFilter): Promise<readonly Dc3CourseCoverage[]>;
  /** La misma cobertura, partida por área. */
  coverageByArea(filter: Dc3CandidateFilter): Promise<readonly Dc3AreaCoverage[]>;
  /** Emisiones asentadas con los filtros puestos, de la más reciente a la más vieja. */
  listEmissions(
    filter: Dc3EmissionFilter,
    limit: number,
    offset?: number,
  ): Promise<readonly Dc3EmissionRecord[]>;
  /** Cuántos asientos cumplen el filtro, para paginar el historial. */
  countEmissions(filter: Dc3EmissionFilter): Promise<number>;
  /** Hoy, la semana y el mes, con los días de corte ya calculados en la planta. */
  summarizeEmissions(days: {
    readonly today: string;
    readonly week: string;
    readonly month: string;
  }): Promise<Dc3EmissionTotals>;
  /** Las cuentas que han emitido alguna vez, para filtrar por quién. */
  listEmissionActors(): Promise<readonly string[]>;
  /** Lo asentado de cada constancia, resumido por clave. */
  listEmissionSummaries(): Promise<readonly Dc3EmissionSummary[]>;
  findCandidate(workerNumber: string, courseKey: string): Promise<Dc3CandidateDetail | null>;
  /**
   * Varias a la vez, en una consulta. Una tanda de sesenta preguntaba sesenta
   * veces por la misma forma de renglón; en la nube, eso es un viaje a la base
   * por constancia antes de contestar.
   */
  findCandidates(keys: readonly Dc3Key[]): Promise<readonly Dc3CandidateDetail[]>;
  /** Todos los cursos DC-3 de una persona, emitibles o no: su expediente. */
  listWorkerCandidates(workerNumber: string): Promise<readonly Dc3CandidateDetail[]>;
  /** Las cuentas del plan para los mismos filtros de la pantalla. */
  summarizePlan(filter: Dc3CandidateFilter): Promise<Dc3PlanSummary>;
  /** Lo que el formato imprime de cada curso. */
  listCourseMetadata(): Promise<readonly Dc3CourseMetadata[]>;
  /** Cuántos trabajadores activos no traen cada dato del formato. */
  dataGaps(): Promise<Dc3DataGaps>;
  /** Las combinaciones de área y puesto sin clave de ocupación, de la más poblada a la menos. */
  listOccupationGaps(limit: number): Promise<readonly Dc3OccupationGap[]>;
  /** Los trabajadores activos sin clave de ocupación, ordenados por área y puesto. */
  listWorkersWithoutOccupation(limit: number): Promise<readonly Dc3WorkerWithoutOccupation[]>;
  /**
   * Las claves que asentó una solicitud, en el orden en que se asentaron. Es lo
   * que descarga el documento después de emitir: una emisión de dos mil
   * constancias no cabe en una dirección, su número de solicitud sí.
   */
  listRequestEmissionKeys(requestId: string): Promise<readonly string[]>;
  /**
   * Deja constancia de que se emitió una constancia. Un documento legal con
   * datos personales no puede salir sin dejar rastro, y el rastro es uno solo:
   * la bitácora de la consola.
   */
  recordEmission(input: Dc3EmissionEntry): Promise<void>;
  /** Varias en un solo viaje: o se asientan todas o ninguna. */
  recordEmissions(inputs: readonly Dc3EmissionEntry[]): Promise<void>;
}
