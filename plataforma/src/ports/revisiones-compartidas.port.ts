/**
 * Puerto de las revisiones que esperan un «Aplicar».
 *
 * El barrido de la matriz y el padrón semanal se leen en una petición y se
 * aplican en otra. En una máquina hay un solo proceso y la revisión puede vivir
 * en su memoria; en la nube cada petición puede caer en una instancia distinta,
 * y la que recibe el «Aplicar» no sería la que leyó el archivo. Este puerto es
 * el lugar común donde la revisión espera, sea cual sea la instancia.
 *
 * Hay una ranura por tipo, igual que en memoria: una revisión nueva sustituye a
 * la anterior.
 */

export type TipoDeRevision = "BARRIDO_MATRIZ" | "PADRON";

export interface RevisionGuardada {
  readonly id: string;
  readonly contenido: unknown;
}

export interface RevisionesCompartidasPort {
  /** Ocupa la ranura del tipo; sustituye lo que hubiera. */
  guardar(
    tipo: TipoDeRevision,
    revision: { readonly id: string; readonly contenido: unknown; readonly venceEn: string },
  ): Promise<void>;

  /**
   * Sólo el identificador de la revisión vigente. La pantalla se consulta a
   * menudo y la revisión de una matriz pesa megabytes: se pregunta primero por
   * el identificador y se trae el contenido sólo si cambió.
   */
  vigente(tipo: TipoDeRevision): Promise<string | undefined>;

  /** La revisión vigente del tipo, o `undefined` si no hay o ya venció. */
  leer(tipo: TipoDeRevision): Promise<RevisionGuardada | undefined>;

  /**
   * Retira la revisión si sigue siendo `id`. Devuelve `true` sólo a quien la
   * retiró: de dos «Aplicar» simultáneos en instancias distintas, uno solo
   * escribe.
   */
  retirar(tipo: TipoDeRevision, id: string): Promise<boolean>;

  /** Vacía la ranura, haya lo que haya. */
  descartar(tipo: TipoDeRevision): Promise<void>;
}
