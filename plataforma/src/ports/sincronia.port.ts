export type CampoCotejado =
  "nombre" | "fechaAlta" | "tipoNomina" | "puesto" | "area" | "departamento" | "planta";

export type ClaseDeCotejo = "IGUAL" | "EQUIVALENTE" | "DISCREPANTE" | "SOLO_MATRIZ" | "SOLO_PADRON";

export interface FuenteDeMatriz {
  readonly archivo: string;
  readonly hoja: string;
  readonly sha256: string;
  readonly extraidoEn: string;
  readonly estado: string;
  readonly empleados: number;
}

export interface UniversoCotejado {
  readonly enMatriz: number;
  readonly enPadron: number;
  readonly enAmbos: number;
  readonly soloMatriz: number;
  readonly soloPadron: number;
  readonly muestraSoloMatriz: readonly string[];
  readonly muestraSoloPadron: readonly string[];
}

export interface ConteoDeCampo {
  readonly campo: CampoCotejado;
  readonly iguales: number;
  readonly equivalentes: number;
  readonly discrepantes: number;
  readonly soloMatriz: number;
  readonly soloPadron: number;
}

export interface MuestraDeCotejo {
  readonly campo: CampoCotejado;
  readonly numeroTrabajador: string;
  readonly clase: ClaseDeCotejo;
  readonly enMatriz: string | null;
  readonly enPadron: string | null;
}

export interface CotejoCrudo {
  readonly fuente: FuenteDeMatriz;
  readonly universo: UniversoCotejado;
  readonly campos: readonly ConteoDeCampo[];
  readonly muestras: readonly MuestraDeCotejo[];
}

export interface SincroniaPort {
  cotejar(muestra: number): Promise<CotejoCrudo | null>;
}
