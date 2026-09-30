import type { DetalleDeCambios } from "../cargas/detalle.ts";

export interface EmpleadoDelPadron {
  readonly employeeId: string;
  readonly displayName: string;
  readonly position: string;
  readonly curp: string;
  readonly hireDate: string;
  readonly cnoKey: string;
  readonly payrollType: string;
  readonly plant: string;
  readonly rfc?: string;
  readonly nss?: string;
  readonly costCenterKey?: string;
  readonly costCenterName?: string;
  readonly address?: string;
  readonly postalCode?: string;
  readonly maritalStatus?: string;
  readonly sex?: string;
  readonly sourceSheet?: string;
  readonly sourceRow?: number;
  readonly issues: readonly string[];
}

export interface BajaDelPadron {
  readonly employeeId: string;
  readonly terminationDate: string;
}

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
  readonly terminations?: readonly BajaDelPadron[];
  readonly diagnostics: {
    readonly employeeCount: number;
    readonly readyEmployeeCount: number;
    readonly issues: Readonly<Record<string, number>>;
    readonly sheets?: readonly HojaLeida[];
  };
}

export interface RosterExtractorPort {
  extraer(archivo: Buffer): PadronLeido;
}

export interface CuadreDePadron {
  readonly activosEnArchivo: number;
  readonly sinIncidencias: number;
  readonly reconocidos: number;
  readonly desconocidos: number;
  readonly ausentes: number;
  readonly curpPorEscribir: number;
  readonly altasPorCorregir: number;
  readonly altasQueCoinciden: number;
  readonly induccionesNuevas: number;
  readonly induccionesDivergentes: number;
  readonly puestosNuevos: number;
  readonly puestosCambiados: number;
  readonly nominasDivergentes: number;
  readonly plantasDivergentes: number;
  readonly traeColumnaPlanta: boolean;
  readonly traeColumnaCno: boolean;
  readonly cnoPorEscribir: number;
  readonly cnoQueCoinciden: number;
  readonly cnoEnConflicto: number;
  readonly datosPorEscribir?: number;
  readonly bajas?: number;
  readonly reactivados?: number;
}

export interface CambioDePuesto {
  readonly numeroTrabajador: string;
  readonly antes: string;
  readonly ahora: string;
  readonly fueraDeCatalogo: boolean;
}

export interface Divergencia {
  readonly numeroTrabajador: string;
  readonly enPadron: string;
  readonly enBase: string;
}

export interface MuestrasDeCuadre {
  readonly desconocidos: readonly string[];
  readonly ausentes: readonly string[];
  readonly puestosNuevos: readonly string[];
  readonly cnoEnConflicto: readonly string[];
  readonly cambiosDePuesto: readonly CambioDePuesto[];
  readonly nominasDivergentes: readonly Divergencia[];
  readonly plantasDivergentes: readonly Divergencia[];
  readonly incidencias: Readonly<Record<string, number>>;
}

export interface OrigenDelPadron {
  readonly tipo: "CONSOLA" | "PUENTE_VBA";
  readonly actor: string;
}

export interface PlanDePadron {
  readonly planId: string;
  readonly nombreArchivo: string;
  readonly sha256: string;
  readonly leidoEn: string;
  readonly origen: OrigenDelPadron;
  readonly hojas: readonly HojaLeida[];
  readonly cuadre: CuadreDePadron;
  readonly muestras: MuestrasDeCuadre;
  readonly detalle?: DetalleDeCambios;
  readonly sinCambios: boolean;
}

export interface ResultadoDePadron {
  readonly plan: PlanDePadron;
  readonly curp: number;
  readonly altas: number;
  readonly inducciones: number;
  readonly ocupaciones: number;
  readonly aplicadoEn: string;
}
