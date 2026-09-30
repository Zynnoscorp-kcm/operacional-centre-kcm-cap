export interface Dc3Legends {
  readonly title: string;
  readonly employerName: string;
  readonly instructorCaption: string;
  readonly employerCaption: string;
  readonly workerCaption: string;
  readonly taxId: readonly string[];
  readonly templateSignatures: Readonly<{
    instructor: string;
    employerRepresentative: string;
    workerRepresentative: string;
  }>;
  readonly [leyenda: string]: unknown;
}

export function extractDc3Legends(templateBuffer: Uint8Array): Dc3Legends;

export function renderDc3Pdf(input: {
  readonly legends: Dc3Legends;
  readonly data: Record<string, unknown>;
  readonly allowBlank?: boolean;
  readonly editable?: boolean;
  readonly logos?: Dc3Logos;
}): Uint8Array;

export function generateDc3Document(
  data: Record<string, unknown>,
  options?: {
    readonly allowBlank?: boolean;
    readonly editable?: boolean;
    readonly logos?: Dc3Logos;
  },
): Uint8Array;

export function componerConstanciaDc3(
  data: Record<string, unknown>,
  options?: {
    readonly allowBlank?: boolean;
    readonly editable?: boolean;
    readonly logos?: Dc3Logos;
    readonly prefijoDeCampos?: string;
  },
): {
  readonly page: import("../../../plataforma/src/web/pdf/escritor.ts").PdfPage;
  readonly title: string;
  readonly date: string;
};

export interface Dc3Logos {
  readonly company?: unknown;
  readonly union?: unknown;
}
