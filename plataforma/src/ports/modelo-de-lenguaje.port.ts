export interface SolicitudJson {
  readonly instrucciones: string;
  readonly mensaje: string;
  readonly esquema: {
    readonly nombre: string;
    readonly definicion: Readonly<Record<string, unknown>>;
  };
  readonly validar?: (datos: unknown) => boolean;
}

export interface RespuestaJson {
  readonly datos: unknown;
  readonly proveedor: string;
  readonly modelo: string;
  readonly tokensDeEntrada: number | null;
  readonly tokensDeSalida: number | null;
  readonly milisegundos: number;
  readonly desvios: readonly string[];
}

export interface OpcionesDeLlamada {
  readonly tiempoMaximoMs?: number;
}

export interface ModeloDeLenguajePort {
  readonly nombre: string;
  responderJson(solicitud: SolicitudJson, opciones?: OpcionesDeLlamada): Promise<RespuestaJson>;
}

export type MotivoDeFalla =
  "LIMITE" | "NO_DISPONIBLE" | "RESPUESTA" | "DEMASIADO_GRANDE" | "MODELO" | "LLAVE" | "SOLICITUD";

const SE_REINTENTAN: ReadonlySet<MotivoDeFalla> = new Set(["LIMITE", "NO_DISPONIBLE", "RESPUESTA"]);

export class FallaDeModelo extends Error {
  readonly motivo: MotivoDeFalla;
  readonly esperaMs: number | null;

  constructor(motivo: MotivoDeFalla, mensaje: string, esperaMs: number | null = null) {
    super(mensaje);
    this.name = "FallaDeModelo";
    this.motivo = motivo;
    this.esperaMs = esperaMs;
  }

  get seReintenta(): boolean {
    return SE_REINTENTAN.has(this.motivo);
  }
}
