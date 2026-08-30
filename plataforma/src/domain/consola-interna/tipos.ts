/**
 * Consola interna: auditoría por secciones, campos declarados y lectura directa
 * de la base.
 *
 * Las tres piezas comparten una frontera y por eso comparten archivo de tipos:
 * ninguna de ellas toca el flujo de operación. No abren sesiones, no
 * registran asistencias, no liberan a la matriz y no hablan con el puente VBA.
 * Leen lo que ya ocurrió y —en el único caso que escribe— agregan una fila a un
 * catálogo que el esquema ya tenía previsto.
 *
 * Es deliberado: lo que se depuró del puente y de la persistencia se queda
 * exactamente donde está.
 */

// -----------------------------------------------------------------------------
// Auditoría por secciones
// -----------------------------------------------------------------------------

/**
 * Ventana de las dos secciones operativas.
 *
 * Sesiones y reservaciones se miran a ocho días. No es un borrado: la auditoría
 * es de sólo agregado y sus triggers rechazan `DELETE`. Es la ventana de
 * consulta, y existe porque una bitácora operativa que enseña seis meses de
 * golpe no se lee, y lo que no se lee no se audita.
 *
 * La tercera sección —liberaciones— no lleva ventana: una liberación es la
 * evidencia de que una fecha entró a la matriz, y esa pregunta se hace meses
 * después, no dentro de la semana.
 */
export const VENTANA_AUDITORIA_DIAS = 8;

/** Una sesión con sus tres momentos: creada, abierta y cerrada. */
export interface SessionAuditRow {
  readonly sessionId: string;
  readonly code: string;
  readonly course: string;
  readonly trainer: string;
  /** Día de calendario de la sesión, no el instante en que se capturó. */
  readonly date: string;
  readonly state: string;
  readonly authorized: boolean;
  readonly createdAt: string;
  readonly openedAt?: string;
  readonly closedAt?: string;
  /** Asistencias capturadas y cuántas de ellas ya salieron a la matriz. */
  readonly attendances: number;
  readonly released: number;
}

/** Una reservación con su alta y, si la hubo, su cancelación. */
export interface RoomAuditRow {
  readonly reservationId: string;
  readonly room: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly requesterName: string;
  readonly requesterArea: string;
  readonly status: string;
  readonly origin: string;
  readonly createdAt: string;
  readonly cancelledAt?: string;
  readonly cancelledBy?: string;
  readonly cancellationReason?: string;
}

/**
 * Un efecto de liberación: qué trabajador, qué curso, qué fecha quedó inscrita
 * y —lo que nadie más contesta— qué fecha había antes.
 *
 * `previousDate` sale del historial de sobrescritura, no de la liberación: la
 * liberación sólo sabe lo que escribió. Cuando viene con valor, esa fecha fue
 * sustituida por `effectiveDate` y `overwriteReason` dice quién lo autorizó y
 * por qué. Sin sobrescritura los tres campos van vacíos, que es el caso normal:
 * la política por omisión es no sobrescribir.
 */
export interface ReleaseAuditRow {
  readonly releaseId: string;
  readonly batchId: string;
  readonly requestId: string;
  readonly sessionCode: string;
  readonly workerNumber: string;
  readonly workerName: string;
  readonly course: string;
  readonly effectiveDate: string;
  readonly result: string;
  readonly appliedAt: string;
  readonly batchState: string;
  readonly releasedBy: string;
  /** Fecha que estaba antes y que esta liberación sustituyó. */
  readonly previousDate?: string;
  readonly overwriteReason?: string;
  readonly overwriteActor?: string;
  readonly overwriteAt?: string;
}

export interface AuditWindow {
  readonly days: number;
  readonly from: string;
  readonly to: string;
}

// -----------------------------------------------------------------------------
// Campos declarados
// -----------------------------------------------------------------------------

/**
 * Tipos que admite `kcm.campo_declarado`. La lista está fijada por un CHECK del
 * esquema; duplicarla aquí es lo que permite rechazar el valor en la pantalla y
 * no como una violación de restricción a media escritura.
 */
export const TIPOS_DE_CAMPO = ["TEXTO", "NUMERO", "FECHA", "BOOLEANO", "JSON"] as const;
export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number];

/** Valores del enum `kcm.origen_fuente`. */
export const ORIGENES_DE_CAMPO = [
  "MATRIZ_XLSB",
  "TSV_DNC",
  "DNC_TECNICO",
  "CAPTA",
  "PLATAFORMA",
  "DEPARTAMENTO",
] as const;
export type OrigenDeCampo = (typeof ORIGENES_DE_CAMPO)[number];

/**
 * Un campo declarado.
 *
 * `approvedForRules` es la única bandera que importa: mientras esté en falso el
 * campo existe, se puede capturar y se puede consultar, pero tiene prohibido
 * alimentar una regla DNC o un porcentaje de cobertura. Un campo nuevo se
 * incorpora declarándolo, no desplegando código, y no mueve ningún número
 * hasta que alguien lo autorice por su nombre.
 */
export interface DeclaredField {
  readonly fieldId: string;
  readonly name: string;
  readonly dataType: TipoDeCampo;
  readonly description?: string;
  readonly source: OrigenDeCampo;
  readonly approvedForRules: boolean;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly createdAt: string;
  /** Cuántos trabajadores tienen hoy un valor vigente de este campo. */
  readonly valuesInUse: number;
}

export interface DeclareFieldInput {
  readonly name: string;
  readonly dataType: string;
  readonly description?: string;
  readonly source: string;
}

// -----------------------------------------------------------------------------
// Previsualizador de la base
// -----------------------------------------------------------------------------

/** Una tabla del esquema, con su conteo y su comentario del catálogo. */
export interface TableSummary {
  readonly name: string;
  readonly comment?: string;
  readonly rows: number;
  /** De sólo agregado: sus triggers rechazan `UPDATE`, `DELETE` y `TRUNCATE`. */
  readonly appendOnly: boolean;
}

export interface TablePreview {
  readonly table: string;
  readonly comment?: string;
  readonly columns: readonly string[];
  /** Ya enmascaradas y ya convertidas a texto por el adaptador. */
  readonly rows: readonly (readonly (string | null)[])[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** Columnas que se muestran ocultas por llevar un secreto o un dato oficial. */
  readonly maskedColumns: readonly string[];
}

/** Tope duro de filas por página. Una consola no pagina un padrón entero. */
export const LIMITE_MAXIMO_DE_FILAS = 200;
export const LIMITE_POR_OMISION = 50;

/**
 * Tablas que el previsualizador nunca lista ni abre.
 *
 * No es una cortesía: `secreto_operacion` guarda los secretos con los que se
 * valida el quiosco, `credencial_equipo` las credenciales de las estaciones y
 * `nonce_puente` los nonces con los que el puente VBA prueba que una petición
 * no es un reenvío. Enseñarlos en una pantalla de consulta convertiría un
 * visor en una fuga.
 */
export const TABLAS_VEDADAS: readonly string[] = [
  "secreto_operacion",
  "credencial_equipo",
  "nonce_puente",
];

/**
 * Columnas que se enseñan enmascaradas dondequiera que aparezcan.
 *
 * La CURP es un identificador oficial y no hace falta leerla para revisar un
 * padrón; los marcadores, MAC y hashes autentican journals y no significan nada
 * a la vista. Se comparan en minúsculas y por coincidencia exacta o sufijo.
 */
export const COLUMNAS_ENMASCARADAS: readonly string[] = [
  "curp",
  "marcador",
  "journal_mac",
  "mac",
  "secreto",
  "hash_fuente",
  "token",
];
