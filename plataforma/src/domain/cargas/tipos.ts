/**
 * Bitácora de las dos cargas maestras.
 *
 * La matriz y el padrón semanal son las dos únicas fuentes de las que la
 * plataforma obtiene personal e historial. Sin esta bitácora, ninguna de las
 * dos deja rastro: la matriz escribe su lote de importación y nada más, y el
 * padrón se aplica sin registrar qué archivo entró, quién lo subió ni cuándo.
 *
 * Los asientos van a `sistema.bitacora_auditoria` y no a una tabla propia. Ese ledger ya es
 * append-only y ya lleva actor, rol, entidad, acción, `solicitud_id` y
 * procedencia; una carga es un hecho auditable como cualquier otro.
 *
 * Se registran los cuatro momentos, no sólo el último. Saber que una carga se
 * aplicó no dice si alguien la revisó antes, y saber que un barrido se rechazó
 * por conflictos es justamente lo que hay que poder mirar cuando la matriz y la
 * plataforma dejaron de coincidir.
 */

/** Cuál de las dos fuentes maestras. */
export type TipoDeCarga = "MATRIZ" | "PADRON";

/**
 * Qué ocurrió.
 *
 * - `REVISADA`: el archivo llegó y se cuadró contra la base. No se escribió nada.
 * - `APLICADA`: se confirmó y la base cambió. Es el único hecho con efecto.
 * - `RECHAZADA`: la revisión no se pudo aplicar. El motivo va en el resumen.
 */
export type HechoDeCarga = "REVISADA" | "APLICADA" | "RECHAZADA";

/**
 * El resumen de un hecho.
 *
 * Va como diccionario abierto y no como estructura fija porque los conteos de
 * las dos cargas no son los mismos —la matriz cuenta fechas y columnas, el
 * padrón cuenta CURP, altas e inducciones— y forzarlas a un tipo común
 * obligaría a llenar de ceros la mitad de cada asiento. Lo que sí es común es
 * cómo se lee: rótulo humano contra cifra.
 */
export type ResumenDeCarga = Readonly<Record<string, number | string | boolean>>;

/** Lo que se pide registrar. La bitácora agrega identidad y momento. */
export interface AsientoDeCarga {
  readonly tipo: TipoDeCarga;
  readonly hecho: HechoDeCarga;
  /** Quién lo hizo, tal como lo firma la sesión de consola. */
  readonly actor: string;
  /**
   * Nombre del archivo tal como lo reportó quien lo entregó.
   *
   * Es el dato que delata que la matriz cambió de lugar o de versión: un
   * `Matriz de Competencias 10 Agosto.xlsb` donde antes decía `03 Agosto` es un
   * archivo distinto aunque la huella no se mire.
   */
  readonly archivo: string;
  /**
   * Huella del archivo leído. Cadena vacía en el rechazo de una revisión
   * vencida, donde el archivo ya no está para huellarlo.
   *
   * Es lo que permite responder «¿este libro es el mismo de la semana pasada?»
   * sin abrirlo: dos huellas iguales son el mismo archivo byte por byte.
   */
  readonly sha256: string;
  /** `requestId` o `planId`, para poder atar el asiento a su revisión. */
  readonly solicitudId?: string | undefined;
  readonly resumen: ResumenDeCarga;
}

/** Un asiento ya escrito. */
export interface CargaRegistrada extends AsientoDeCarga {
  readonly asientoId: string;
  readonly ocurridoEn: string;
}

/**
 * Lo que la revisión en curso sabe de la carga anterior.
 *
 * Existe para responder la pregunta que la pantalla no podía contestar: qué se
 * cargó la última vez y si esto que llegó ahora es lo mismo. Sin ella, cada
 * barrido se compara contra el estado de la base y contra nada más, así que
 * volver a subir el archivo de la semana pasada se veía idéntico a subir uno
 * nuevo que no cambia nada.
 */
export interface ComparacionConLaAnterior {
  readonly anterior: CargaRegistrada;
  /**
   * El archivo que se está revisando es byte por byte el que ya se aplicó.
   * Aplicarlo otra vez no puede cambiar nada, y decirlo evita que alguien
   * interprete «sin cambios» como «la carga falló».
   */
  readonly mismoArchivo: boolean;
  /**
   * El nombre cambió respecto de la última carga aplicada. No es un error —la
   * matriz lleva la fecha en el nombre y cambia a propósito— pero sí es lo
   * primero que hay que mirar cuando el libro se movió de carpeta o alguien
   * está barriendo una copia vieja.
   */
  readonly cambioDeNombre: boolean;
  /** Días transcurridos desde la última carga aplicada, redondeados hacia abajo. */
  readonly diasDesde: number;
}
