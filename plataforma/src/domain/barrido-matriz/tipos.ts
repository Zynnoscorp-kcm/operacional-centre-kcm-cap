/**
 * Tipos del barrido de la matriz.
 *
 * Un barrido es una lectura completa del XLSB maestro que no escribe nada:
 * el cliente VBA arma el mismo `HC_SNAPSHOT_V1` que transmitiría, pero en lugar
 * de aplicarlo lo deja en revisión. La plataforma lo confronta contra SQL y
 * responde tres preguntas, que son las de la pantalla:
 *
 * 1. Qué columnas trae la matriz y cómo se llaman.
 * 2. Si cuadran con las capacitaciones que ya existen en la base.
 * 3. Qué cambió respecto de la matriz anterior, y sólo eso.
 *
 * El informe no lleva nombres de trabajador. Todo lo que identifica a una
 * persona en esta pantalla es su número de nómina, y de cada lista se enseñan
 * doce como muestra: revisar un barrido cuesta unos kilobytes y no una copia
 * del padrón en cada visita.
 */

import type { ImportBatchCounts, MatrixSnapshot } from "../importacion-matriz/tipos.ts";

/** Cuántos números o nombres se enseñan de cada lista. Lo demás es un conteo. */
export const MUESTRA_DE_BARRIDO = 12;

/**
 * Orden de barrido dejada desde la consola.
 *
 * La plataforma no puede abrir Excel: el XLSB vive en la PC de la matriz y sólo
 * el cliente VBA lo lee. Así que el botón de la pantalla no ejecuta el barrido,
 * lo encarga; el libro controlador lo recoge en cuanto pregunta. Es la misma
 * dirección que ya tiene el puente —el cliente llama, el servidor contesta— y no
 * exige abrirle un puerto a la máquina de nadie.
 */
export interface OrdenDeBarrido {
  readonly ordenId: string;
  readonly solicitadaEn: string;
  /** Quién apretó el botón, tal como lo firma la sesión de consola. */
  readonly solicitadaPor: string;
  readonly venceEn: string;
}

/**
 * Estado de una columna de la matriz frente al catálogo de SQL.
 *
 * Se resuelve con `resolveCourseMappings`, el mismo motor que usará la carga:
 * así lo que la pantalla anuncia es lo que la aplicación hará, y no una segunda
 * opinión que pueda diferir.
 */
export type EstadoDeColumna = "COINCIDE" | "RENOMBRADA" | "NUEVA";

export interface ColumnaDetectada {
  /** Letra de la columna en la hoja, tal como la reporta el cliente. */
  readonly columna: string;
  readonly nombre: string;
  readonly claveOrigen: string;
  /** Cuántas fechas trae esa columna en este barrido. */
  readonly fechas: number;
  readonly estado: EstadoDeColumna;
  /** Nombre con el que la base conoce hoy al curso, cuando difiere. */
  readonly nombreEnBase?: string;
}

export type CampoDeAdscripcion = "PUESTO" | "AREA" | "DEPARTAMENTO";

export interface CambioDeAdscripcion {
  readonly numeroTrabajador: string;
  readonly campo: CampoDeAdscripcion;
  readonly antes: string;
  readonly ahora: string;
}

/**
 * Los conteos del barrido. Es lo que se lee primero y lo único que cabe en la
 * cabecera de la pantalla.
 */
export interface CuadreDeBarrido {
  readonly trabajadoresEnMatriz: number;
  readonly trabajadoresEnBase: number;
  readonly trabajadoresNuevos: number;
  /** En la base y no en la matriz. Ausencia no es baja: no se retira a nadie. */
  readonly trabajadoresAusentes: number;
  readonly cambiosDePuesto: number;
  readonly cambiosDeArea: number;
  readonly cambiosDeDepartamento: number;

  readonly columnasEnMatriz: number;
  readonly columnasEnBase: number;
  readonly columnasNuevas: number;
  readonly columnasRenombradas: number;
  /** Cursos que la base conoce y este barrido ya no trae como columna. */
  readonly columnasRetiradas: number;

  readonly fechasEnMatriz: number;
  readonly fechasNuevas: number;
  readonly fechasCorregidas: number;
  readonly fechasRetiradas: number;
  readonly fechasReactivadas: number;
  /** Fechas liberadas por la plataforma que el maestro contradice. Bloquean. */
  readonly conflictos: number;
  /** Liberaciones de plataforma que el maestro todavía no trae. No bloquean. */
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
  /** `CLIENT_ID` del libro controlador que lo transmitió. */
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
  /** El barrido no cambiaría nada: ni fechas, ni columnas, ni adscripciones. */
  readonly sinCambios: boolean;
  /** Con conflictos la carga se rechaza: aplicar dejaría de ser una opción. */
  readonly bloqueado: boolean;
  /** Incidencias que el propio cliente reportó al leer la hoja. */
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

/** Lo que el servicio guarda mientras la revisión está viva. */
export interface BarridoGuardado {
  readonly informe: InformeDeBarrido;
  readonly snapshot: MatrixSnapshot;
  readonly requestId: string;
}
