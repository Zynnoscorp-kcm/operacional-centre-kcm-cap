import type { ImportBatchCounts, MatrixSnapshot } from "../importacion-matriz/tipos.ts";
import type { DetalleDeCambios } from "../cargas/detalle.ts";

export const MUESTRA_DE_BARRIDO = 12;

export type EstadoDeColumna = "COINCIDE" | "RENOMBRADA" | "NUEVA";

export interface ColumnaDetectada {
  readonly columna: string;
  readonly nombre: string;
  readonly claveOrigen: string;
  readonly fechas: number;
  readonly estado: EstadoDeColumna;
  readonly nombreEnBase?: string;
}

export type CampoDeAdscripcion = "PUESTO" | "AREA" | "DEPARTAMENTO";

export interface CambioDeAdscripcion {
  readonly numeroTrabajador: string;
  readonly campo: CampoDeAdscripcion;
  readonly antes: string;
  readonly ahora: string;
}

export interface CuadreDeBarrido {
  readonly trabajadoresEnMatriz: number;
  readonly trabajadoresEnBase: number;
  readonly trabajadoresNuevos: number;
  readonly trabajadoresAusentes: number;
  readonly cambiosDePuesto: number;
  readonly cambiosDeArea: number;
  readonly cambiosDeDepartamento: number;

  readonly columnasEnMatriz: number;
  readonly columnasEnBase: number;
  readonly columnasNuevas: number;
  readonly columnasRenombradas: number;
  readonly columnasRetiradas: number;

  readonly fechasEnMatriz: number;
  readonly fechasNuevas: number;
  readonly fechasCorregidas: number;
  readonly fechasRetiradas: number;
  readonly fechasReactivadas: number;
  readonly conflictos: number;
  readonly pendientesEnMaestro: number;
}

export interface MuestrasDeBarrido {
  readonly trabajadoresNuevos: readonly string[];
  readonly trabajadoresAusentes: readonly string[];
  readonly cambiosDeAdscripcion: readonly CambioDeAdscripcion[];
  readonly columnasNuevas: readonly string[];
  readonly columnasRetiradas: readonly string[];
  readonly conflictos: readonly string[];
}

export interface FuenteDelBarrido {
  readonly nombreArchivo: string;
  readonly hoja: string;
  readonly sha256: string;
  readonly extraidoEn: string;
  readonly cliente: string;
}

export interface InformeDeBarrido {
  readonly barridoId: string;
  readonly recibidoEn: string;
  readonly venceEn: string;
  readonly fuente: FuenteDelBarrido;
  readonly columnas: readonly ColumnaDetectada[];
  readonly cuadre: CuadreDeBarrido;
  readonly muestras: MuestrasDeBarrido;
  readonly detalle?: DetalleDeCambios;
  readonly sinCambios: boolean;
  readonly bloqueado: boolean;
  readonly incidencias: readonly { readonly codigo: string; readonly cuenta: number }[];
}

export interface ResultadoDeBarrido {
  readonly informe: InformeDeBarrido;
  readonly importId: string;
  readonly aplicadoEn: string;
  readonly aplicadoPor: string;
  readonly repetido: boolean;
  readonly conteos: ImportBatchCounts;
}

export interface BarridoGuardado {
  readonly informe: InformeDeBarrido;
  readonly snapshot: MatrixSnapshot;
  readonly requestId: string;
}
