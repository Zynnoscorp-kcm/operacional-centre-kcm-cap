export type TipoDeRevision = "BARRIDO_MATRIZ" | "PADRON";

export interface RevisionGuardada {
  readonly id: string;
  readonly contenido: unknown;
}

export interface RevisionesCompartidasPort {
  guardar(
    tipo: TipoDeRevision,
    revision: { readonly id: string; readonly contenido: unknown; readonly venceEn: string },
  ): Promise<void>;

  vigente(tipo: TipoDeRevision): Promise<string | undefined>;

  leer(tipo: TipoDeRevision): Promise<RevisionGuardada | undefined>;

  retirar(tipo: TipoDeRevision, id: string): Promise<boolean>;

  descartar(tipo: TipoDeRevision): Promise<void>;
}
