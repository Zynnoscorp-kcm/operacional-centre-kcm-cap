/**
 * Declaración del compositor del formato DC-3.
 *
 * Como el resto de `src`, el módulo es JavaScript y se consume tal cual: esta
 * firma existe para que `tsc` no quede a ciegas, no para tipar el legado. Los
 * datos van laxos a propósito —el contrato real es `PRINTABLE_FIELDS` dentro del
 * módulo, y es él quien decide qué falta.
 */

export interface Dc3Legends {
  readonly title: string;
  readonly [leyenda: string]: string;
}

export function extractDc3Legends(templateBuffer: Uint8Array): Dc3Legends;

export function renderDc3Pdf(input: {
  readonly legends: Dc3Legends;
  readonly data: Record<string, unknown>;
  readonly allowBlank?: boolean;
  readonly editable?: boolean;
  readonly logos?: Dc3Logos;
}): Uint8Array;

/**
 * Compone el PDF con las leyendas oficiales horneadas en el código.
 *
 * Con `allowBlank` los campos que falten se imprimen como recuadros vacíos en
 * vez de detener la emisión. Con `editable`, esos mismos recuadros vacíos
 * —y sólo ésos— se vuelven campos de formulario que se escriben en el visor.
 */
export function generateDc3Document(
  data: Record<string, unknown>,
  options?: {
    readonly allowBlank?: boolean;
    readonly editable?: boolean;
    readonly logos?: Dc3Logos;
  },
): Uint8Array;

/**
 * Los logotipos del encabezado, ya leídos. El del sindicato sólo se pasa cuando
 * la constancia es de personal sindicalizado; ausente, esa mitad de la banda
 * queda vacía.
 */
export interface Dc3Logos {
  readonly company?: unknown;
  readonly union?: unknown;
}
