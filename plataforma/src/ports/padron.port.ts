export interface FilaDePadronBase {
  readonly trabajadorId: string;
  readonly numeroTrabajador: string;
  readonly nombre?: string | null;
  readonly curp: string | null;
  readonly fechaAlta: string | null;
  readonly puesto: string | null;
  readonly area: string | null;
  readonly claveOcupacion: string | null;
  readonly tipoNomina: string | null;
  readonly planta: string | null;
  readonly activo: boolean;
  readonly rfc?: string | null;
  readonly nss?: string | null;
  readonly centroCostosClave?: string | null;
  readonly centroCostosNombre?: string | null;
  readonly direccion?: string | null;
  readonly codigoPostal?: string | null;
  readonly estadoCivil?: string | null;
  readonly sexo?: string | null;
  readonly vistoEnMatriz?: boolean;
}

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
  readonly fecha: string;
}

export interface PuestoDelCatalogo {
  readonly nombre: string;
  readonly claveCno: string | null;
}

export interface EscriturasDePadron {
  readonly curp: readonly (readonly [string, string])[];
  readonly altas: readonly (readonly [string, string])[];
  readonly inducciones: readonly (readonly [string, string, string])[];
  readonly ocupaciones: readonly (readonly [string, string])[];
  readonly datos?: readonly (readonly [string, DatoDelPadron, string])[];
  readonly enArchivo?: readonly string[];
  readonly fechasDeBaja?: readonly (readonly [string, string])[];
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
  leerPadronBase(): Promise<readonly FilaDePadronBase[]>;
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]>;
  revisarInducciones(
    propuestas: readonly InduccionPropuesta[],
  ): Promise<{ readonly nuevas: number; readonly divergentes: number }>;
  aplicar(escrituras: EscriturasDePadron): Promise<ResultadoDeEscritura>;
}
