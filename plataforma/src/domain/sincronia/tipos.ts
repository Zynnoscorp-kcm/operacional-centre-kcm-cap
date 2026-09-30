import type {
  CampoCotejado,
  ConteoDeCampo,
  FuenteDeMatriz,
  MuestraDeCotejo,
  UniversoCotejado,
} from "../../ports/sincronia.port.ts";

export const MUESTRA_DE_SINCRONIA = 12;

export type VeredictoDeSincronia = "IDENTICOS" | "EQUIVALENTES" | "CON_DISCREPANCIAS";

export interface CampoDelInforme extends ConteoDeCampo {
  readonly comparados: number;
  readonly diferencias: number;
  readonly similitud: number;
  readonly muestras: readonly MuestraDeCotejo[];
}

export interface InformeDeSincronia {
  readonly corridoEn: string;
  readonly fuente: FuenteDeMatriz;
  readonly universo: UniversoCotejado;
  readonly campos: readonly CampoDelInforme[];
  readonly veredicto: VeredictoDeSincronia;
  readonly diferenciasTotales: number;
  readonly equivalentesTotales: number;
  readonly similitudGlobal: number;
}

export const NOMBRE_DE_CAMPO: Readonly<Record<CampoCotejado, string>> = {
  nombre: "Nombre completo",
  fechaAlta: "Fecha de alta",
  tipoNomina: "Tipo de nómina",
  puesto: "Puesto",
  area: "Área",
  departamento: "Departamento",
  planta: "Planta",
};
