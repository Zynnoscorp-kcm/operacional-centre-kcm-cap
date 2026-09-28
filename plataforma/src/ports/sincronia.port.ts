/**
 * Cotejo entre la matriz guardada en la base y el padrón que la plataforma tiene
 * aplicado.
 *
 * Las dos cargas maestras describen a la misma gente y escriben en la misma
 * fila. El barrido de la matriz y la revisión del padrón contestan «¿qué
 * cambiaría este archivo?»; ninguna de las dos contesta «¿lo que ya está
 * aplicado sigue diciendo lo mismo en las dos fuentes?». Esa es la pregunta de
 * este puerto, y no necesita archivo: los dos lados ya viven en la base.
 *
 * - La matriz es el `HC_SNAPSHOT_V1` conservado en `matriz.importacion_contenido`,
 *   el del lote más reciente que dejó snapshot.
 * - El padrón es `organizacion.trabajador` con sus catálogos de puesto, área y
 *   departamento resueltos.
 *
 * El cotejo entero ocurre en PostgreSQL y de aquí sólo salen cifras y muestras.
 * No es una preferencia de estilo: el snapshot pesa unos 190 kB y el padrón son
 * mil setecientas filas, así que traerse los dos lados para compararlos en Node
 * costaría casi medio mega de egreso **por visita a la pestaña**, contra un
 * kilobyte largo haciéndolo donde los datos ya están. Es la misma decisión, y
 * por la misma razón, que `revisarInducciones` en `padron.port.ts`.
 */

/** Los siete campos que las dos fuentes declaran de la misma persona. */
export type CampoCotejado =
  "nombre" | "fechaAlta" | "tipoNomina" | "puesto" | "area" | "departamento" | "planta";

/**
 * En qué situación quedó un campo de un trabajador.
 *
 * `EQUIVALENTE` es la mitad «similitud» del análisis y existe porque no toda
 * diferencia es una discrepancia: entre un libro de Excel y una columna de
 * PostgreSQL viajan mayúsculas, acentos y espacios dobles que describen el mismo
 * dato. Separarlas del resto evita las dos lecturas equivocadas: contarlas como
 * error llenaría la pantalla de ruido, y contarlas como iguales escondería que
 * las dos fuentes ya no se escriben igual.
 *
 * `SOLO_MATRIZ` y `SOLO_PADRON` son ausencias, no desacuerdos: una de las dos
 * fuentes no trae el dato. Se cuentan aparte porque se corrigen distinto.
 */
export type ClaseDeCotejo = "IGUAL" | "EQUIVALENTE" | "DISCREPANTE" | "SOLO_MATRIZ" | "SOLO_PADRON";

/** De qué matriz se está hablando. Sin esto el informe no es reproducible. */
export interface FuenteDeMatriz {
  readonly archivo: string;
  readonly hoja: string;
  readonly sha256: string;
  /** ISO 8601: cuándo el cliente VBA leyó el libro, no cuándo se guardó. */
  readonly extraidoEn: string;
  /** Fase del lote que dejó este snapshot. */
  readonly estado: string;
  readonly empleados: number;
}

/**
 * Quién está en cada lado.
 *
 * `soloPadron` no es un error por sí mismo —el padrón semanal da de alta gente
 * que la matriz todavía no conoce, que es justo la procedencia `ROSTER_ALTA`—,
 * mientras que `soloMatriz` sí lo es: la matriz conoce a alguien que el padrón
 * de la plataforma perdió. Se cuentan por separado para poder decirlo.
 */
export interface UniversoCotejado {
  readonly enMatriz: number;
  readonly enPadron: number;
  readonly enAmbos: number;
  readonly soloMatriz: number;
  readonly soloPadron: number;
  readonly muestraSoloMatriz: readonly string[];
  readonly muestraSoloPadron: readonly string[];
}

/** Cómo quedó un campo sobre el total de trabajadores que están en los dos lados. */
export interface ConteoDeCampo {
  readonly campo: CampoCotejado;
  readonly iguales: number;
  readonly equivalentes: number;
  readonly discrepantes: number;
  readonly soloMatriz: number;
  readonly soloPadron: number;
}

/**
 * Un caso concreto, para poder ir a corregirlo.
 *
 * `enMatriz` y `enPadron` llegan en nulo cuando el campo identifica a una
 * persona. El nombre completo es el único de los siete que lo hace, y esta
 * pantalla mantiene la regla que ya rigen el barrido y el historial: aquí no
 * aparece el nombre de nadie, sólo su número de nómina. El enmascarado se hace
 * en la consulta y no al dibujar, de modo que el nombre no llega siquiera a
 * salir de la base.
 */
export interface MuestraDeCotejo {
  readonly campo: CampoCotejado;
  readonly numeroTrabajador: string;
  readonly clase: ClaseDeCotejo;
  readonly enMatriz: string | null;
  readonly enPadron: string | null;
}

export interface CotejoCrudo {
  readonly fuente: FuenteDeMatriz;
  readonly universo: UniversoCotejado;
  readonly campos: readonly ConteoDeCampo[];
  readonly muestras: readonly MuestraDeCotejo[];
}

export interface SincroniaPort {
  /**
   * Coteja las dos fuentes tal como están ahora mismo.
   *
   * Devuelve `null` cuando no hay matriz guardada contra la cual cotejar. Es una
   * situación legítima y no un fallo: la base conserva el snapshot del lote que
   * lo dejó, y una instalación recién reconstruida todavía no tuvo ninguno. La
   * pantalla lo dice en vez de enseñar mil seiscientas ausencias.
   *
   * @param muestra Cuántos casos se traen de cada campo. El resto son cifra.
   */
  cotejar(muestra: number): Promise<CotejoCrudo | null>;
}
