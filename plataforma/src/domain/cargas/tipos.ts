export type TipoDeCarga = "MATRIZ" | "PADRON";

export type HechoDeCarga = "REVISADA" | "APLICADA" | "RECHAZADA";

export type ResumenDeCarga = Readonly<Record<string, number | string | boolean>>;

export interface AsientoDeCarga {
  readonly tipo: TipoDeCarga;
  readonly hecho: HechoDeCarga;
  readonly actor: string;
  readonly archivo: string;
  readonly sha256: string;
  readonly solicitudId?: string | undefined;
  readonly resumen: ResumenDeCarga;
}

export interface CargaRegistrada extends AsientoDeCarga {
  readonly asientoId: string;
  readonly ocurridoEn: string;
}

export interface ComparacionConLaAnterior {
  readonly anterior: CargaRegistrada;
  readonly mismoArchivo: boolean;
  readonly cambioDeNombre: boolean;
  readonly diasDesde: number;
}
