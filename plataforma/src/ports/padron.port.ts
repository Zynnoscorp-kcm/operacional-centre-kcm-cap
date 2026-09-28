/**
 * Padrón semanal (`sem NN CAP.xlsx`) contra la base.
 *
 * El puerto está partido en dos por una razón de costo, no de estilo: la
 * comparación entera se resuelve con una lectura del padrón que ya está en
 * la base —unas 1 700 filas cortas— y una escritura por lote sólo si alguien
 * la confirma. Ni la pantalla ni el servicio hacen una consulta por trabajador;
 * con el presupuesto de Supabase que tiene esta instalación, mil setecientos
 * viajes por archivo semanal no son una opción.
 */

export interface FilaDePadronBase {
  readonly trabajadorId: string;
  readonly numeroTrabajador: string;
  /** Para enseñar quién es en la revisión. Opcional: un doble de prueba puede omitirlo. */
  readonly nombre?: string | null;
  readonly curp: string | null;
  /** Fecha ISO `YYYY-MM-DD`, ya en texto: una fecha de alta es un día, no un instante. */
  readonly fechaAlta: string | null;
  readonly puesto: string | null;
  /**
   * Área a la que está adscrito. Viene de la matriz, no del padrón, y sirve
   * para una sola cosa: agrupar por `(puesto, área)` al revisar la clave de
   * ocupación, que es el par del que depende según el departamento.
   */
  readonly area: string | null;
  /** Clave de ocupación registrada hoy, o `null` si nadie se la ha asignado. */
  readonly claveOcupacion: string | null;
  /**
   * `NS` o `NQ` tal como está hoy en la base, puesto ahí por la matriz. Se trae
   * para poder contrastarlo con lo que declara el padrón, no para escribirlo.
   */
  readonly tipoNomina: string | null;
  /** La planta registrada hoy. Mismo propósito: contrastar, no escribir. */
  readonly planta: string | null;
  readonly activo: boolean;
  /** Lo que el padrón guardó la vez anterior (0046). Opcionales para los dobles de prueba. */
  readonly rfc?: string | null;
  readonly nss?: string | null;
  readonly centroCostosClave?: string | null;
  readonly centroCostosNombre?: string | null;
  readonly direccion?: string | null;
  readonly codigoPostal?: string | null;
  readonly estadoCivil?: string | null;
  readonly sexo?: string | null;
  /** Si la última matriz aplicada lo traía. Ausente se lee como sí. */
  readonly vistoEnMatriz?: boolean;
}

/** Las columnas personales del padrón, con su nombre en la base. */
export const DATOS_DEL_PADRON = [
  "rfc",
  "nss",
  "centro_costos_clave",
  "centro_costos_nombre",
  "direccion",
  "codigo_postal",
  "estado_civil",
  "sexo",
] as const;
export type DatoDelPadron = (typeof DATOS_DEL_PADRON)[number];

export interface InduccionPropuesta {
  readonly trabajadorId: string;
  /** ISO `YYYY-MM-DD`. */
  readonly fecha: string;
}

/** Un puesto del catálogo con la clave del CNO que tenga hoy. */
export interface PuestoDelCatalogo {
  readonly nombre: string;
  /** `null` mientras nadie le haya asignado ocupación específica. */
  readonly claveCno: string | null;
}

/** Lo que el archivo cambia. Vacío significa que el padrón ya está aplicado. */
export interface EscriturasDePadron {
  /** `[trabajadorId, curp]` */
  readonly curp: readonly (readonly [string, string])[];
  /** `[trabajadorId, fechaAlta]` */
  readonly altas: readonly (readonly [string, string])[];
  /** `[claveIdempotencia, trabajadorId, fecha]` del registro de inducción. */
  readonly inducciones: readonly (readonly [string, string, string])[];
  /**
   * `[trabajadorId, claveDeOcupacion]`.
   *
   * Va por trabajador, no por puesto. Hasta la migración `0041` se
   * consolidaba en `organizacion.puesto.clave_cno` porque se creía que la ocupación
   * describía al puesto; el departamento corrigió esa premisa el 2026-08-12: la
   * clave varía según el puesto y el área de cada quien, así que un mismo
   * puesto en dos áreas trae legítimamente dos claves. Consolidarlas rechazaba
   * las dos.
   */
  readonly ocupaciones: readonly (readonly [string, string])[];
  /** `[trabajadorId, columna, valor]` de las columnas personales que cambian. */
  readonly datos?: readonly (readonly [string, DatoDelPadron, string])[];
  /** Números que trae el archivo: con ellos se anota quién estuvo en el último padrón. */
  readonly enArchivo?: readonly string[];
  /** `[numeroTrabajador, fechaDeBaja]` que declaran las hojas de bajas. */
  readonly fechasDeBaja?: readonly (readonly [string, string])[];
  /** Trabajadores inactivos que el padrón vuelve a traer. */
  readonly reactivar?: readonly string[];
}

export interface ResultadoDeEscritura {
  readonly curp: number;
  readonly altas: number;
  readonly inducciones: number;
  readonly ocupaciones: number;
  readonly datos?: number;
  readonly bajas?: number;
  readonly reactivados?: number;
}

export interface RosterRepositoryPort {
  /** Padrón completo tal como está hoy en la base. Una sola consulta. */
  leerPadronBase(): Promise<readonly FilaDePadronBase[]>;
  /**
   * Catálogo de puestos con su clave del CNO. Sirve para dos cosas a la vez:
   * saber qué puestos del archivo no existen y qué ocupaciones cambiarían.
   */
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]>;
  /**
   * Confronta las inducciones propuestas con el ledger.
   *
   * Devuelve dos números y ninguna fila: nuevas, las de quien no tiene
   * registro vigente de Inducción, y divergentes, las de quien ya lo tiene
   * con otra fecha. La distinción no es cosmética. `operacion.historial_capacitacion` lleva un
   * índice único `(trabajador_id, capacitacion_id) WHERE VIGENTE`: insertar una
   * fecha corregida no se absorbe con `ON CONFLICT (clave_idempotencia)` —esa
   * clave es distinta— sino que revienta la carga entera. Se cuentan aparte
   * para no escribirlas y para poder decir cuántas son.
   */
  revisarInducciones(
    propuestas: readonly InduccionPropuesta[],
  ): Promise<{ readonly nuevas: number; readonly divergentes: number }>;
  /** Todo o nada: las tres escrituras van en una transacción. */
  aplicar(escrituras: EscriturasDePadron): Promise<ResultadoDeEscritura>;
}
