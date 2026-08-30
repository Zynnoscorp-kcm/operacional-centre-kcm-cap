/**
 * Formas del padrón semanal dentro de la plataforma.
 *
 * `PadronLeido` es exactamente lo que devuelve `packages/dc3/roster-extractor.js`,
 * escrito aquí como tipo para que el dominio no dependa de un archivo sin
 * definiciones. Si el extractor cambia de forma, esto deja de compilar, que es
 * lo que se quiere.
 */

export interface EmpleadoDelPadron {
  readonly employeeId: string;
  readonly displayName: string;
  readonly position: string;
  /** Cadena vacía cuando el archivo no la trae o no pasa la validación. */
  readonly curp: string;
  /** ISO `YYYY-MM-DD`, o cadena vacía. */
  readonly hireDate: string;
  /**
   * Clave del Catálogo Nacional de Ocupaciones. Vacía cuando el libro todavía no
   * trae la columna o la celda está en blanco.
   *
   * Viene por trabajador porque así se captura, pero describe al puesto: es
   * la ocupación específica de ese puesto según el catálogo, no un atributo de
   * la persona. La base la guarda donde corresponde, en `kcm.puesto.clave_cno`.
   */
  readonly cnoKey: string;
  /**
   * `NS` sindicalizado, `NQ` confianza. Sale de la hoja en que viene la
   * fila —`SND ACTIVOS` o `EMP ACTIVOS`—, que es como el padrón declara esa
   * clasificación. Cadena vacía si la hoja no es ninguna de las dos.
   */
  readonly payrollType: string;
  /**
   * La planta, aunque la columna del libro se rotule `AREA`. Tres valores para
   * mil seiscientas filas: es el centro de trabajo, no el área operativa de la
   * matriz. Ver el extractor, que lleva la explicación completa.
   */
  readonly plant: string;
  readonly issues: readonly string[];
}

/**
 * Un encabezado del libro tal como el extractor lo resolvió.
 *
 * `field` es el campo declarado del contrato; `header` es el rótulo tal como
 * está escrito en la hoja, que no tiene por qué coincidir —`FEC ALTA` y `FECHA
 * DE ALTA` son el mismo campo—. `present` en falso sólo puede ocurrir en un
 * campo opcional: un requerido ausente hace fallar la lectura entera.
 */
export interface ColumnaLeida {
  readonly field: string;
  readonly header: string;
  readonly columnName: string;
  readonly required: boolean;
  readonly present: boolean;
}

export interface HojaLeida {
  readonly sheetName: string;
  readonly columns: readonly ColumnaLeida[];
  readonly rowsWithIdentity: number;
  readonly acceptedRows: number;
}

export interface PadronLeido {
  readonly source: { readonly sha256: string; readonly byteSize: number };
  readonly employees: readonly EmpleadoDelPadron[];
  readonly diagnostics: {
    readonly employeeCount: number;
    readonly readyEmployeeCount: number;
    readonly issues: Readonly<Record<string, number>>;
    readonly sheets?: readonly HojaLeida[];
  };
}

/** Lee el libro. Falla cerrado si la forma no es la declarada. */
export interface RosterExtractorPort {
  extraer(archivo: Buffer): PadronLeido;
}

/**
 * La respuesta a «¿este archivo corresponde con lo que ya hay?».
 *
 * Son números, no filas: es lo que se pinta en la ventana de cuadre y lo que
 * mantiene el egreso en unos cientos de bytes por revisión.
 */
export interface CuadreDePadron {
  readonly activosEnArchivo: number;
  readonly sinIncidencias: number;
  readonly reconocidos: number;
  /** En el archivo y no en la base: números que la matriz no conoce. */
  readonly desconocidos: number;
  /** Activos en la base que el archivo no trae. No se dan de baja aquí. */
  readonly ausentes: number;
  readonly curpPorEscribir: number;
  readonly altasPorCorregir: number;
  readonly altasQueCoinciden: number;
  /** Registros de inducción que el archivo agregaría. Las repetidas no cuentan. */
  readonly induccionesNuevas: number;
  /**
   * Trabajadores con inducción vigente y otra fecha en el archivo. No se
   * escriben: cambiar la fecha de un registro que sostiene un DC-3 emitido es
   * decisión del departamento, no efecto colateral de una carga semanal.
   */
  readonly induccionesDivergentes: number;
  /** Puestos del archivo que no están en el catálogo: bloquean el DC-3 por CNO. */
  readonly puestosNuevos: number;
  /** Trabajadores cuyo puesto en el archivo no es el registrado. Sólo se informa. */
  readonly puestosCambiados: number;
  /**
   * Trabajadores cuyo tipo de nómina difiere entre el padrón y la base.
   *
   * No se escribe ninguno. El departamento decidió que la matriz siga
   * mandando en este campo porque la plataforma la consulta mucho más, aun
   * cuando el padrón es la fuente de mayor autoridad sobre cómo está contratada
   * una persona. De ahí que la divergencia se denuncie en vez de resolverse: es
   * un dato que alguien tiene que mirar, no un efecto que la carga pueda decidir
   * sola.
   */
  readonly nominasDivergentes: number;
  /** Igual que el anterior, para la planta. Tampoco se escribe. */
  readonly plantasDivergentes: number;
  /** El libro no trae la columna de planta: los dos conteos de arriba son cero. */
  readonly traeColumnaPlanta: boolean;
  /** Si el libro trae la columna del CNO. Sin ella, los tres números de abajo son cero. */
  readonly traeColumnaCno: boolean;
  /** Puestos que reciben clave del CNO por primera vez o con un valor distinto. */
  readonly cnoPorEscribir: number;
  /** Puestos cuya clave del archivo es la que ya está registrada. */
  readonly cnoQueCoinciden: number;
  /**
   * Puestos con dos claves distintas dentro del mismo archivo. No se
   * escriben: la clave describe al puesto, así que dos personas del mismo puesto
   * no pueden tener ocupaciones distintas, y elegir una en silencio dejaría la
   * mitad de las constancias con la clave equivocada.
   */
  readonly cnoEnConflicto: number;
}

/** Un trabajador cuyo puesto en el archivo no es el que la base tiene. */
export interface CambioDePuesto {
  readonly numeroTrabajador: string;
  readonly antes: string;
  readonly ahora: string;
  /** El puesto nuevo no está en el catálogo: bloquea el DC-3 por CNO. */
  readonly fueraDeCatalogo: boolean;
}

/** Una divergencia entre lo que dice el padrón y lo que la base tiene hoy. */
export interface Divergencia {
  readonly numeroTrabajador: string;
  /** Lo que dice el padrón, que es la fuente de mayor autoridad. */
  readonly enPadron: string;
  /** Lo que tiene la base, puesto ahí por la matriz. */
  readonly enBase: string;
}

export interface MuestrasDeCuadre {
  readonly desconocidos: readonly string[];
  readonly ausentes: readonly string[];
  readonly puestosNuevos: readonly string[];
  /** `PUESTO: clave / clave` — para poder corregir el archivo sin adivinar. */
  readonly cnoEnConflicto: readonly string[];
  readonly cambiosDePuesto: readonly CambioDePuesto[];
  readonly nominasDivergentes: readonly Divergencia[];
  readonly plantasDivergentes: readonly Divergencia[];
  readonly incidencias: Readonly<Record<string, number>>;
}

/**
 * De dónde salió el archivo que se está revisando.
 *
 * `CONSOLA` es la subida manual de siempre; `PUENTE_VBA` es el barrido que el
 * libro controlador entregó desde la PC donde vive el padrón. La revisión y la
 * escritura son idénticas en los dos casos —el mismo lector, el mismo cuadre,
 * el mismo botón—; lo único que cambia es cómo llegaron los bytes, y eso se
 * dice en pantalla para que el acuse no quede sin firma de origen.
 */
export interface OrigenDelPadron {
  readonly tipo: "CONSOLA" | "PUENTE_VBA";
  readonly actor: string;
}

/**
 * Orden de barrido del padrón dejada desde la consola.
 *
 * Misma mecánica que la de la matriz y por la misma razón: la plataforma no
 * puede abrir el archivo, que vive en la PC del departamento. El botón encarga
 * y el libro controlador recoge cuando pregunta.
 */
export interface OrdenDePadron {
  readonly ordenId: string;
  readonly solicitadaEn: string;
  readonly solicitadaPor: string;
  readonly venceEn: string;
}

export interface PlanDePadron {
  readonly planId: string;
  readonly nombreArchivo: string;
  readonly sha256: string;
  readonly leidoEn: string;
  readonly origen: OrigenDelPadron;
  /** Encabezados que el extractor resolvió, hoja por hoja. */
  readonly hojas: readonly HojaLeida[];
  readonly cuadre: CuadreDePadron;
  readonly muestras: MuestrasDeCuadre;
  /** Verdadero cuando no hay nada que escribir: el archivo ya está aplicado. */
  readonly sinCambios: boolean;
}

export interface ResultadoDePadron {
  readonly plan: PlanDePadron;
  readonly curp: number;
  readonly altas: number;
  readonly inducciones: number;
  /** Claves de ocupación escritas, por trabajador. */
  readonly ocupaciones: number;
  readonly aplicadoEn: string;
}
