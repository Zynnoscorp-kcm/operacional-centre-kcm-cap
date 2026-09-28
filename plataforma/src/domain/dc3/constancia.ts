/**
 * Constancias DC-3.
 *
 * Toda constancia sale de aquí: la de una persona en ventanilla, las marcadas
 * de una lista y todas las de un filtro de una vez. Todas se asientan en la
 * bitácora, que es el único registro de lo emitido; no existe otra vía de
 * emisión con otro registro que pudiera contradecirla.
 *
 * Lo que se imprime sale de dos sitios y de ninguno más: la base —identidad,
 * curso, fecha y datos legales del curso— y el formato oficial —leyendas, razón
 * social y firmas—. Los dos viajan con la plataforma, así que el equipo del
 * departamento y la instancia publicada imprimen el mismo documento. Antes una
 * parte se leía de un archivo privado que sólo existía en una computadora.
 *
 * Se emite con recuadros vacíos. Es la decisión ya tomada el 2026-08-06:
 * mientras el agente capacitador o el nombre del área temática no estén
 * capturados, el formato sale con esos recuadros en blanco para llenarse a mano,
 * en lugar de no salir. La respuesta dice cuáles quedaron vacíos y la bitácora
 * lo registra; una constancia incompleta es válida como formato, no como
 * constancia.
 *
 * ── Tandas y reimpresiones ─────────────────────────────────────────────────
 *
 * Una tanda se asienta de un golpe —una consulta para leer a todos, un `INSERT`
 * para asentarlos— y se entrega en un solo PDF que se imprime de una vez, con
 * la hoja de entrega delante si se pide. Reimprimir compone lo ya asentado sin
 * volver a asentarlo, y sólo lo ya asentado: una reimpresión masiva de lo que
 * nunca se emitió sería una emisión sin rastro.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildPdf, type PdfPage } from "../../web/pdf/escritor.ts";
import { leerImagen, type ImagenParaPdf } from "../../web/pdf/imagenes.ts";
import { componerRelacionDc3 } from "../../web/pdf/relacion-dc3.ts";

import { sumarDiasIso } from "../../../../packages/dc3/fechas.js";
import {
  componerConstanciaDc3,
  generateDc3Document,
} from "../../../../packages/dc3/pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "../../../../packages/dc3/pdf/leyendas-oficiales.js";
import type {
  Dc3CandidateDetail,
  Dc3CertificatePort,
  Dc3EmissionEntry,
  Dc3EmissionSummary,
  Dc3Key,
} from "../../ports/dc3-constancia.port.ts";
import { DomainError } from "../comun/errores.ts";
import { nombreDeAreaTematica } from "./areas-tematicas.ts";
import { CORTE_DE_CONSTANCIAS } from "./corte.ts";

export interface Dc3CertificateResult {
  readonly pdf: Uint8Array;
  readonly fileName: string;
  /** Campos legales que salieron en blanco. Vacío significa constancia completa. */
  readonly blankFields: readonly string[];
  /** Si los recuadros vacíos se entregaron como campos escribibles. */
  readonly editable: boolean;
  /**
   * A quién y a qué curso corresponde. Los pide la pantalla de acuse, que
   * enseña de quién es la constancia que acaba de salir; sin esto tendría que
   * volver a consultar el padrón para repetir un dato que ya se leyó aquí.
   */
  readonly workerNumber: string;
  readonly workerName: string;
  readonly courseName: string;
}

/** Una constancia de la tanda que quedó asentada. */
export interface EmisionDeTanda {
  readonly clave: string;
  readonly workerName: string;
  readonly courseName: string;
  readonly blankFields: readonly string[];
}

/**
 * Una que no salió, con el código del motivo. El código y no el mensaje: el
 * resultado viaja en la dirección de regreso, y un mensaje lleva nombres.
 */
export interface FalloDeTanda {
  readonly clave: string;
  readonly codigo: string;
}

export interface ResultadoDeTanda {
  readonly emitidas: readonly EmisionDeTanda[];
  readonly fallidas: readonly FalloDeTanda[];
}

/** Lo que baja al navegador: un PDF listo, o los archivos de un ZIP. */
export interface DocumentoDc3 {
  readonly formato: "pdf" | "zip";
  readonly nombre: string;
  /** El PDF, cuando el formato es `pdf`. */
  readonly pdf?: Uint8Array;
  /** Los archivos, cuando el formato es `zip`. Los empaqueta quien responde. */
  readonly archivos?: readonly { readonly nombre: string; readonly contenido: Uint8Array }[];
  readonly incluidas: number;
  /** Claves pedidas que no entraron: ilegibles, sin asentar o fuera del padrón activo. */
  readonly omitidas: readonly string[];
}

/** Lo que la pantalla de datos del formato enseña de lo que imprime la constancia. */
export interface FormatoVisibleDc3 {
  readonly razonSocial: string;
  readonly firmas: readonly { readonly rotulo: string; readonly nombre: string }[];
  /** Desde cuándo cuentan las constancias. */
  readonly corte: string;
  readonly logotipos: { readonly empresa: boolean; readonly sindicato: boolean };
}

/**
 * Dónde viven los logotipos del membrete: junto al compositor, dentro de la
 * plataforma. Viajan con ella a cualquier equipo; en una carpeta privada sólo
 * los tenía la computadora del departamento, y la constancia que se emitía en
 * otro lado salía sin membrete.
 */
const DIRECTORIO_DE_LOGOTIPOS = fileURLToPath(new URL("../../web/pdf/membrete/", import.meta.url));
const LOGOTIPO_EMPRESA = "empresa.png";
const LOGOTIPO_SINDICATO = "sindicato.png";

/** `10001:QMS`. Es la forma en que la bitácora asienta cada constancia. */
export function claveDc3(clave: Dc3Key): string {
  return `${clave.workerNumber}:${clave.courseKey}`;
}

/**
 * Lee `nomina:curso` venido de un formulario o de una dirección. La nómina es
 * texto de cinco dígitos y nunca número; el curso, una clave de catálogo. Lo que
 * no tenga esa forma no llega a la consulta.
 */
export function leerClaveDc3(texto: string): Dc3Key | undefined {
  const partes = texto.trim().split(":");
  if (partes.length !== 2) return undefined;
  const [numero = "", curso = ""] = partes;
  if (!/^\d{5}$/u.test(numero)) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(curso)) return undefined;
  return { workerNumber: numero, courseKey: curso };
}

/**
 * El nombre corto de un curso DC-3, para las columnas y las fichas.
 *
 * El nombre DC-3 de LOTO tiene ciento cincuenta caracteres y rompe cualquier
 * columna; el de la inducción no cabe en una ficha. Lo que se lee de un vistazo
 * es la sigla del final, si la hay, o la primera palabra. El nombre completo
 * sigue en el título del elemento y en la constancia.
 */
export function etiquetaCortaDeCurso(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/u).filter(Boolean);
  const completo = palabras.join(" ");
  if (completo.length <= 12) return completo;
  const ultima = palabras.at(-1) ?? "";
  if (/^[A-ZÁÉÍÓÚÑ]{2,6}$/u.test(ultima)) return ultima;
  const primera = palabras[0] ?? completo;
  return primera.charAt(0).toLocaleUpperCase("es-MX") + primera.slice(1).toLocaleLowerCase("es-MX");
}

/** Lo que una constancia necesita para componerse, ya resuelto. */
interface Pieza {
  readonly candidato: Dc3CandidateDetail;
  readonly datos: Record<string, unknown>;
  readonly blankFields: readonly string[];
  readonly logos: { company?: unknown; union?: unknown };
}

export class Dc3CertificateService {
  readonly #repository: Dc3CertificatePort;
  readonly #logotiposLeidos = new Map<string, ImagenParaPdf | null>();
  readonly #directorioDeLogotipos: string;

  constructor(input: {
    repository: Dc3CertificatePort;
    /** Para las pruebas: otro membrete, o ninguno. */
    directorioDeLogotipos?: string;
  }) {
    this.#repository = input.repository;
    this.#directorioDeLogotipos = input.directorioDeLogotipos ?? DIRECTORIO_DE_LOGOTIPOS;
  }

  listDc3Courses() {
    return this.#repository.listDc3Courses();
  }

  listCandidates(
    filter: Parameters<Dc3CertificatePort["listCandidates"]>[0],
    limit: number,
    order?: Parameters<Dc3CertificatePort["listCandidates"]>[2],
    offset?: number,
  ) {
    return this.#repository.listCandidates(filter, limit, order, offset);
  }

  summarizePlan(filter: Parameters<Dc3CertificatePort["summarizePlan"]>[0]) {
    return this.#repository.summarizePlan(filter);
  }

  /** Cuántos hay con ese filtro, sin traerlos: es lo que pagina la pantalla. */
  countCandidates(filter: Parameters<Dc3CertificatePort["countCandidates"]>[0]) {
    return this.#repository.countCandidates(filter);
  }

  /** Cuántos hay en cada curso con el resto de los filtros puestos. */
  countByCourse(filter: Parameters<Dc3CertificatePort["countByCourse"]>[0]) {
    return this.#repository.countByCourse(filter);
  }

  /** Cobertura por curso sobre el padrón activo. Alimenta el panel del módulo. */
  coverage(filter: Parameters<Dc3CertificatePort["coverage"]>[0]) {
    return this.#repository.coverage(filter);
  }

  coverageByArea(filter: Parameters<Dc3CertificatePort["coverageByArea"]>[0]) {
    return this.#repository.coverageByArea(filter);
  }

  /** Las emisiones ya asentadas, de la más reciente a la más vieja. */
  listEmissions(
    filter: Parameters<Dc3CertificatePort["listEmissions"]>[0],
    limit: number,
    offset?: number,
  ) {
    return this.#repository.listEmissions(filter, limit, offset);
  }

  countEmissions(filter: Parameters<Dc3CertificatePort["countEmissions"]>[0]) {
    return this.#repository.countEmissions(filter);
  }

  summarizeEmissions(days: Parameters<Dc3CertificatePort["summarizeEmissions"]>[0]) {
    return this.#repository.summarizeEmissions(days);
  }

  listEmissionActors() {
    return this.#repository.listEmissionActors();
  }

  listWorkerCandidates(workerNumber: string) {
    return this.#repository.listWorkerCandidates(workerNumber);
  }

  listCourseMetadata() {
    return this.#repository.listCourseMetadata();
  }

  dataGaps() {
    return this.#repository.dataGaps();
  }

  listOccupationGaps(limit: number) {
    return this.#repository.listOccupationGaps(limit);
  }

  listWorkersWithoutOccupation(limit: number) {
    return this.#repository.listWorkersWithoutOccupation(limit);
  }

  /** Lo asentado de cada constancia, por clave `nomina:curso`. */
  async emissionIndex(): Promise<ReadonlyMap<string, Dc3EmissionSummary>> {
    const resumenes = await this.#repository.listEmissionSummaries();
    return new Map(resumenes.map((resumen) => [resumen.key, resumen]));
  }

  /** Las claves ya emitidas, como conjunto: la pantalla pregunta una por renglón. */
  async emittedKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.#repository.listEmissionSummaries()).map((r) => r.key));
  }

  async emitir(input: {
    readonly workerNumber: string;
    readonly courseKey: string;
    readonly actor: string;
    readonly requestId: string;
    /**
     * Entrega los recuadros vacíos como campos escribibles en el visor. Se pide
     * desde la pantalla; no es el modo por omisión, porque una constancia
     * completa debe salir plana y no debe poder alterarse desde un lector de
     * PDF.
     */
    readonly editable?: boolean;
    /**
     * Emite aunque no haya fecha del curso, dejando ese recuadro en blanco.
     * Sólo lo pide la pestaña del plan que enumera a quien no lo ha tomado, y
     * hay que pedirlo: por omisión sigue sin emitirse, porque una constancia sin
     * fecha no certifica nada. Sirve para entregar el formato ya rotulado con la
     * identidad del trabajador y llenarlo a mano el día del curso.
     */
    readonly allowMissingDate?: boolean;
    /**
     * Compone el documento sin registrarlo. Es lo que pide el ojo de vista
     * previa: mirar la constancia antes de decidir no es emitirla, y anotar en
     * la bitácora cada mirada haría que «ya emitida» dejara de significar algo.
     * La emisión de verdad sigue siendo la que no pasa por aquí.
     */
    readonly preview?: boolean;
  }): Promise<Dc3CertificateResult> {
    const candidato = await this.#repository.findCandidate(input.workerNumber, input.courseKey);
    if (!candidato) {
      throw new DomainError(
        "CANDIDATO_DC3_NO_ENCONTRADO",
        "No hay trabajador activo con ese número y ese curso con obligación DC-3.",
      );
    }
    // Sin fecha no hay constancia que emitir: el documento certifica que alguien
    // tomó un curso un día. Un recuadro de fecha vacío no dice «no la sabemos»,
    // dice que el curso no ocurrió.
    if (!candidato.completionDate && !input.allowMissingDate) {
      throw new DomainError(
        "SIN_FECHA_DE_CURSO",
        `${candidato.workerName} no tiene fecha registrada para ${candidato.courseName}. ` +
          "Sin fecha no se emite: la constancia certifica un día concreto.",
      );
    }

    const pieza = this.#pieza(candidato);
    // Editable sólo tiene sentido si algo quedó en blanco: pedirlo sobre una
    // constancia completa devolvería un formulario sin campos.
    const editable = (input.editable ?? false) && pieza.blankFields.length > 0;
    const pdf = generateDc3Document(pieza.datos, {
      allowBlank: true,
      editable,
      logos: pieza.logos,
    });

    if (!input.preview) {
      await this.#repository.recordEmission({
        actor: input.actor,
        workerNumber: candidato.workerNumber,
        courseKey: candidato.courseKey,
        requestId: input.requestId,
        partial: pieza.blankFields.length > 0,
      });
    }

    return {
      pdf,
      fileName: nombreDeArchivo(candidato, editable),
      blankFields: pieza.blankFields,
      editable,
      workerNumber: candidato.workerNumber,
      workerName: candidato.workerName,
      courseName: candidato.courseName,
    };
  }

  /**
   * Emite varias de una vez: las lee juntas, las compone para comprobar que
   * salen, y asienta las que salieron en un solo viaje a la base.
   *
   * Componer antes de asentar no es redundante: un asiento sin documento diría
   * «ya emitida» de una constancia que nunca existió. Lo que falla no detiene al
   * resto; se devuelve con su código para que la pantalla lo cuente.
   */
  async emitirVarias(input: {
    readonly claves: readonly string[];
    readonly actor: string;
    readonly requestId: string;
    readonly allowMissingDate?: boolean;
  }): Promise<ResultadoDeTanda> {
    const { validas, ilegibles } = separarClaves(input.claves);
    const detalles = await this.#repository.findCandidates(validas);
    const porClave = new Map(detalles.map((detalle) => [claveDc3(detalle), detalle]));

    const emitidas: EmisionDeTanda[] = [];
    const fallidas: FalloDeTanda[] = ilegibles.map((clave) => ({
      clave,
      codigo: "CLAVE_ILEGIBLE",
    }));
    const asientos: Dc3EmissionEntry[] = [];

    for (const clave of validas) {
      const texto = claveDc3(clave);
      const candidato = porClave.get(texto);
      if (!candidato) {
        fallidas.push({ clave: texto, codigo: "CANDIDATO_DC3_NO_ENCONTRADO" });
        continue;
      }
      if (!candidato.completionDate && !input.allowMissingDate) {
        fallidas.push({ clave: texto, codigo: "SIN_FECHA_DE_CURSO" });
        continue;
      }
      const pieza = this.#pieza(candidato);
      try {
        componerConstanciaDc3(pieza.datos, { allowBlank: true, logos: pieza.logos });
      } catch {
        fallidas.push({ clave: texto, codigo: "CONSTANCIA_NO_CABE" });
        continue;
      }
      asientos.push({
        actor: input.actor,
        workerNumber: candidato.workerNumber,
        courseKey: candidato.courseKey,
        requestId: `${input.requestId}-${candidato.workerNumber}-${candidato.courseKey}`,
        partial: pieza.blankFields.length > 0,
      });
      emitidas.push({
        clave: texto,
        workerName: candidato.workerName,
        courseName: candidato.courseName,
        blankFields: pieza.blankFields,
      });
    }

    await this.#repository.recordEmissions(asientos);
    return { emitidas, fallidas };
  }

  /**
   * Compone un documento con varias constancias, sin asentar nada.
   *
   * Lo pide la descarga que sigue a una tanda y lo pide la reimpresión. Con
   * `soloEmitidas` —que es como lo llama la consola— deja fuera lo que nunca se
   * asentó: esta ruta no es otra forma de emitir.
   *
   * Una sola constancia sin hoja de entrega sale con el mismo compositor que la
   * emisión individual, byte por byte: reimprimir no cambia el documento.
   */
  async componerDocumento(input: {
    readonly claves: readonly string[];
    readonly formato: "pdf" | "zip";
    /** Antepone la hoja de entrega. */
    readonly entrega: boolean;
    readonly editable: boolean;
    readonly actor: string;
    /** Día de la planta, `YYYY-MM-DD`: fecha del archivo y de la hoja de entrega. */
    readonly fecha: string;
    readonly contexto?: string;
    readonly soloEmitidas: boolean;
  }): Promise<DocumentoDc3> {
    const { validas, ilegibles } = separarClaves(input.claves);
    const omitidas = [...ilegibles];

    let objetivo = validas;
    if (input.soloEmitidas) {
      const emitidas = await this.emittedKeys();
      objetivo = validas.filter((clave) => emitidas.has(claveDc3(clave)));
      omitidas.push(
        ...validas.filter((clave) => !emitidas.has(claveDc3(clave))).map((c) => claveDc3(c)),
      );
    }

    const detalles = await this.#repository.findCandidates(objetivo);
    const porClave = new Map(detalles.map((detalle) => [claveDc3(detalle), detalle]));
    const piezas: Pieza[] = [];
    for (const clave of objetivo) {
      const candidato = porClave.get(claveDc3(clave));
      if (candidato) piezas.push(this.#pieza(candidato));
      else omitidas.push(claveDc3(clave));
    }

    if (piezas.length === 0) {
      throw new DomainError(
        "SIN_CONSTANCIAS_QUE_COMPONER",
        input.soloEmitidas
          ? "Ninguna de esas constancias está asentada: sólo se reimprime lo ya emitido."
          : "Ninguna de esas constancias corresponde a un trabajador activo.",
      );
    }

    const editableDe = (pieza: Pieza): boolean => input.editable && pieza.blankFields.length > 0;
    const relacion = (): PdfPage[] =>
      componerRelacionDc3(
        piezas.map((pieza) => ({
          workerNumber: pieza.candidato.workerNumber,
          workerName: pieza.candidato.workerName,
          area: pieza.candidato.area,
          courseLabel: etiquetaCortaDeCurso(pieza.candidato.courseName),
          completionDate: pieza.candidato.completionDate,
          partial: pieza.blankFields.length > 0,
        })),
        {
          fecha: input.fecha,
          actor: input.actor,
          ...(input.contexto ? { contexto: input.contexto } : {}),
        },
      );

    if (input.formato === "zip") {
      const archivos = piezas.map((pieza) => ({
        nombre: nombreDeArchivo(pieza.candidato, editableDe(pieza)),
        contenido: generateDc3Document(pieza.datos, {
          allowBlank: true,
          editable: editableDe(pieza),
          logos: pieza.logos,
        }),
      }));
      if (input.entrega) {
        archivos.unshift({
          nombre: "00-HOJA-DE-ENTREGA.pdf",
          contenido: buildPdf({
            pages: relacion(),
            title: "Relación de constancias DC-3",
            date: input.fecha,
            producer: "KCM Cap DC3",
          }),
        });
      }
      return {
        formato: "zip",
        nombre: `DC3-${input.fecha}-${String(piezas.length)}.zip`,
        archivos,
        incluidas: piezas.length,
        omitidas,
      };
    }

    const [unica] = piezas;
    if (unica && piezas.length === 1 && !input.entrega) {
      return {
        formato: "pdf",
        nombre: nombreDeArchivo(unica.candidato, editableDe(unica)),
        pdf: generateDc3Document(unica.datos, {
          allowBlank: true,
          editable: editableDe(unica),
          logos: unica.logos,
        }),
        incluidas: 1,
        omitidas,
      };
    }

    const paginas: PdfPage[] = [
      ...(input.entrega ? relacion() : []),
      ...piezas.map(
        (pieza, indice) =>
          componerConstanciaDc3(pieza.datos, {
            allowBlank: true,
            editable: editableDe(pieza),
            logos: pieza.logos,
            prefijoDeCampos: `c${String(indice + 1)}_`,
          }).page,
      ),
    ];
    return {
      formato: "pdf",
      nombre: `DC3-${input.fecha}-${String(piezas.length)}-constancias.pdf`,
      pdf: buildPdf({
        pages: paginas,
        title: `Constancias DC-3 · ${input.fecha}`,
        date: input.fecha,
        producer: "KCM Cap DC3",
        compartirImagenes: true,
      }),
      incluidas: piezas.length,
      omitidas,
    };
  }

  /**
   * Las claves que asentó una solicitud. Lo que no tiene forma de número de
   * solicitud no llega a la base: la dirección la escribe cualquiera.
   */
  async clavesDeLaSolicitud(requestId: string): Promise<readonly string[]> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId)) {
      return [];
    }
    return this.#repository.listRequestEmissionKeys(requestId);
  }

  /** Lo que la pantalla de datos del formato enseña de la constancia. */
  formatoVisible(): FormatoVisibleDc3 {
    return formatoDeLaConstancia(this.#directorioDeLogotipos);
  }

  /** Varias constancias por clave, en una consulta. Lo pide el acuse de una tanda. */
  async buscar(claves: readonly string[]): Promise<readonly Dc3CandidateDetail[]> {
    const { validas } = separarClaves(claves);
    return this.#repository.findCandidates(validas);
  }

  /** Los datos que se imprimen y los recuadros que saldrían vacíos. */
  #pieza(candidato: Dc3CandidateDetail): Pieza {
    const datos = {
      workerName: candidato.workerName,
      curp: candidato.curp,
      position: candidato.position,
      // Vacío imprime la razón social del formato oficial, ya corregida.
      employerName: "",
      occupation: candidato.occupation,
      courseName: candidato.courseName,
      durationHours: candidato.durationHours ?? "",
      startDate: candidato.completionDate ?? "",
      // El término del periodo: la inducción son tres jornadas y cierra dos días
      // después; los cursos de un día empiezan y terminan el mismo.
      endDate: candidato.completionDate
        ? sumarDiasIso(candidato.completionDate, candidato.periodDays)
        : "",
      thematicArea: areaTematica(candidato),
      trainingAgent: (candidato.trainingAgent ?? "").trim(),
    };

    const blankFields = [
      ...OBLIGATORIOS.filter((campo) => String(datos[campo] ?? "").trim() === "").map(
        (campo) => NOMBRE_LEGIBLE[campo] ?? campo,
      ),
      // La fecha no está en la lista obligatoria del formato, pero si se emitió
      // sin ella hay que decirlo: es el recuadro que más se nota vacío.
      ...(candidato.completionDate ? [] : ["fecha del curso"]),
    ];

    return { candidato, datos, blankFields, logos: this.#logotipos(candidato) };
  }

  /**
   * Los logotipos del encabezado. El de la empresa va en toda constancia; el del
   * sindicato sólo en las de personal sindicalizado, que es lo que dice el tipo
   * de nómina `NS`.
   *
   * Si un archivo falta o no se puede leer, la constancia sale sin ese
   * logotipo en lugar de no salir: un logotipo es membrete, no un dato legal, y
   * detener una emisión por él sería desproporcionado. El intento fallido se
   * refleja en que el recuadro queda vacío, no en una excepción.
   */
  #logotipos(candidato: Dc3CandidateDetail): { company?: unknown; union?: unknown } {
    const empresa = this.#leerLogotipo(LOGOTIPO_EMPRESA);
    const esSindicalizado = (candidato.payrollType ?? "").trim().toUpperCase() === "NS";
    const sindicato = esSindicalizado ? this.#leerLogotipo(LOGOTIPO_SINDICATO) : undefined;
    return {
      ...(empresa ? { company: empresa } : {}),
      ...(sindicato ? { union: sindicato } : {}),
    };
  }

  #leerLogotipo(nombre: string): ImagenParaPdf | undefined {
    const ruta = `${this.#directorioDeLogotipos}${nombre}`;
    const cacheado = this.#logotiposLeidos.get(ruta);
    if (cacheado !== undefined) return cacheado ?? undefined;
    let imagen: ImagenParaPdf | undefined;
    try {
      imagen = leerImagen(readFileSync(ruta));
    } catch {
      imagen = undefined;
    }
    // Se recuerda incluso la ausencia: si no, cada emisión vuelve a tocar el
    // disco para descubrir otra vez que el archivo no está.
    this.#logotiposLeidos.set(ruta, imagen ?? null);
    return imagen;
  }
}

/**
 * El área temática como se imprime: «clave-nombre». El nombre sale de la base o,
 * mientras la base no lo tenga, del catálogo de la STPS; una clave sola no la lee
 * nadie.
 */
export function areaTematica(candidato: Dc3CandidateDetail): string {
  const clave = (candidato.thematicAreaKey ?? "").trim();
  const nombre = nombreDeAreaTematica(clave, candidato.thematicAreaName);
  if (clave && nombre) return `${clave}-${nombre}`;
  return clave;
}

/**
 * Lo que la pantalla de datos del formato enseña: la razón social y las firmas
 * que imprime el formato oficial, el corte y si están los logotipos. No
 * necesita base, así que la pantalla responde también sin ella.
 */
export function formatoDeLaConstancia(
  directorioDeLogotipos: string = DIRECTORIO_DE_LOGOTIPOS,
): FormatoVisibleDc3 {
  const firmas = LEYENDAS_DC3.templateSignatures;
  const hay = (nombre: string): boolean => existsSync(`${directorioDeLogotipos}${nombre}`);
  return {
    razonSocial: LEYENDAS_DC3.employerName,
    firmas: [
      { rotulo: LEYENDAS_DC3.instructorCaption, nombre: firmas.instructor },
      { rotulo: LEYENDAS_DC3.employerCaption, nombre: firmas.employerRepresentative },
      { rotulo: LEYENDAS_DC3.workerCaption, nombre: firmas.workerRepresentative },
    ],
    corte: CORTE_DE_CONSTANCIAS,
    logotipos: { empresa: hay(LOGOTIPO_EMPRESA), sindicato: hay(LOGOTIPO_SINDICATO) },
  };
}

/** Las claves pedidas, sin repetir y en el orden en que llegaron. */
function separarClaves(claves: readonly string[]): {
  validas: Dc3Key[];
  ilegibles: string[];
} {
  const vistas = new Set<string>();
  const validas: Dc3Key[] = [];
  const ilegibles: string[] = [];
  for (const texto of claves) {
    const clave = leerClaveDc3(texto);
    if (!clave) {
      if (texto.trim()) ilegibles.push(texto.trim().slice(0, 90));
      continue;
    }
    const forma = claveDc3(clave);
    if (vistas.has(forma)) continue;
    vistas.add(forma);
    validas.push(clave);
  }
  return { validas, ilegibles };
}

function nombreDeArchivo(candidato: Dc3CandidateDetail, editable: boolean): string {
  return `DC3-${candidato.workerNumber}-${candidato.courseKey}${editable ? "-editable" : ""}.pdf`;
}

/**
 * Los campos que la STPS espera llenos.
 *
 * El puesto no está en la lista, y no es un olvido: el propio formato lo
 * marca con asterisco y su pie declara «* Dato no obligatorio». La ocupación
 * específica del Catálogo Nacional de Ocupaciones sí lo está, y es la que el
 * padrón semanal empezó a traer en su columna nueva.
 */
const OBLIGATORIOS = [
  "workerName",
  "curp",
  "occupation",
  "courseName",
  "durationHours",
  "thematicArea",
  "trainingAgent",
] as const;

const NOMBRE_LEGIBLE: Readonly<Record<string, string>> = {
  workerName: "nombre del trabajador",
  curp: "CURP",
  occupation: "ocupación específica (CNO)",
  courseName: "nombre del curso",
  durationHours: "duración",
  thematicArea: "área temática",
  trainingAgent: "agente capacitador",
};
