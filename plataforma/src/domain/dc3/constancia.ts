/**
 * Constancia DC-3 de una persona, emitida desde la pantalla.
 *
 * El runner por lotes sigue siendo el sistema de registro de la emisión masiva:
 * lee el XLSB, lleva su ledger y decide qué se reemplaza. Esto es lo otro —lo
 * de ventanilla—: alguien pide su constancia y hay que dársela ahora. Se compone
 * con los mismos datos y las mismas leyendas horneadas, para que las dos vías
 * impriman el mismo documento y no dos parecidos.
 *
 * Se emite con recuadros vacíos. Es la decisión ya tomada el 2026-08-06:
 * mientras el agente capacitador o el nombre del área temática no estén
 * capturados, el formato sale con esos recuadros en blanco para llenarse a mano,
 * en lugar de no salir. La respuesta dice cuáles quedaron vacíos y la bitácora
 * lo registra; una constancia incompleta es válida como formato, no como
 * constancia.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { leerImagen, type ImagenParaPdf } from "../../web/pdf/imagenes.ts";

import { sumarDiasIso } from "../../../../packages/dc3/fechas.js";
import { generateDc3Document } from "../../../../packages/dc3/pdf/dc3-document.js";
import type { Dc3CandidateDetail, Dc3CertificatePort } from "../../ports/dc3-constancia.port.ts";
import { DomainError } from "../errores.ts";

/** Lo mínimo del archivo privado: lo demás lo aporta la base. */
interface Dc3ConfigFile {
  readonly employer?: { readonly legalName?: string };
  readonly signatures?: Record<string, string>;
  readonly courses?: readonly Dc3ConfigCourse[];
}

interface Dc3ConfigCourse {
  readonly courseId?: string;
  readonly dc3Name?: string;
  readonly durationHours?: number;
  readonly thematicArea?: string;
  readonly trainingAgent?: string;
  readonly endDateOffsetDays?: number;
}

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

/**
 * Dónde viven los logotipos del encabezado. Es una convención de ruta y no una
 * variable de entorno: son dos archivos fijos del membrete, no configuración por
 * despliegue, y `referencias/privado` ya está fuera de Git.
 */
const DIRECTORIO_DE_LOGOTIPOS = "referencias/privado/logotipos";
const LOGOTIPO_EMPRESA = "empresa.png";
const LOGOTIPO_SINDICATO = "sindicato.png";

export class Dc3CertificateService {
  readonly #repository: Dc3CertificatePort;
  readonly #logotiposLeidos = new Map<string, ImagenParaPdf | null>();
  readonly #projectRoot: string;
  readonly #configPath: string;

  constructor(input: { repository: Dc3CertificatePort; projectRoot: string; configPath?: string }) {
    this.#repository = input.repository;
    this.#projectRoot = resolve(input.projectRoot);
    this.#configPath = resolve(
      input.configPath ?? `${this.#projectRoot}/referencias/privado/dc3-config.json`,
    );
  }

  listDc3Courses() {
    return this.#repository.listDc3Courses();
  }

  listCandidates(filter: Parameters<Dc3CertificatePort["listCandidates"]>[0], limit: number) {
    return this.#repository.listCandidates(filter, limit);
  }

  summarizePlan(filter: Parameters<Dc3CertificatePort["summarizePlan"]>[0]) {
    return this.#repository.summarizePlan(filter);
  }

  /** Las claves ya emitidas, como conjunto: la pantalla pregunta una por renglón. */
  async emittedKeys(): Promise<ReadonlySet<string>> {
    return new Set(await this.#repository.listEmittedKeys());
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
    const configuracion = this.#leerConfiguracion();
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

    const delArchivo = this.#cursoDeConfiguracion(configuracion, candidato);
    const datos = {
      workerName: candidato.workerName,
      curp: candidato.curp,
      position: candidato.position,
      employerName: String(configuracion.employer?.legalName ?? "").trim(),
      occupation: candidato.occupation,
      courseName: candidato.courseName,
      durationHours: candidato.durationHours ?? delArchivo?.durationHours ?? "",
      startDate: candidato.completionDate ?? "",
      // Mismo desplazamiento que aplica el generador de línea de comandos: la inducción son doce
      // horas en tres jornadas y cierra dos días después. Las dos vías tienen que producir el
      // mismo documento o el ledger las vería como constancias distintas.
      endDate: candidato.completionDate
        ? sumarDiasIso(candidato.completionDate, Number(delArchivo?.endDateOffsetDays) || 0)
        : "",
      thematicArea: this.#areaTematica(candidato, delArchivo),
      trainingAgent: (candidato.trainingAgent ?? delArchivo?.trainingAgent ?? "").trim(),
      ...(configuracion.signatures ? { signatures: configuracion.signatures } : {}),
    };

    const blankFields = [
      ...OBLIGATORIOS.filter((campo) => String(datos[campo] ?? "").trim() === "").map(
        (campo) => NOMBRE_LEGIBLE[campo] ?? campo,
      ),
      // La fecha no está en la lista obligatoria del formato, pero si se emitió
      // sin ella hay que decirlo: es el recuadro que más se nota vacío.
      ...(candidato.completionDate ? [] : ["fecha del curso"]),
    ];

    // Editable sólo tiene sentido si algo quedó en blanco: pedirlo sobre una
    // constancia completa devolvería un formulario sin campos.
    const editable = (input.editable ?? false) && blankFields.length > 0;
    const logos = this.#logotipos(candidato);
    const pdf = generateDc3Document(datos, { allowBlank: true, editable, logos });

    if (!input.preview) {
      await this.#repository.recordEmission({
        actor: input.actor,
        workerNumber: candidato.workerNumber,
        courseKey: candidato.courseKey,
        requestId: input.requestId,
        partial: blankFields.length > 0,
      });
    }

    return {
      pdf,
      fileName: `DC3-${candidato.workerNumber}-${candidato.courseKey}${editable ? "-editable" : ""}.pdf`,
      blankFields,
      editable,
      workerNumber: candidato.workerNumber,
      workerName: candidato.workerName,
      courseName: candidato.courseName,
    };
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
    const ruta = resolve(this.#projectRoot, DIRECTORIO_DE_LOGOTIPOS, nombre);
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

  /**
   * El área temática se imprime «clave-nombre». La base tiene la clave y —hasta
   * que se aplique la migración 0040— no siempre el nombre; el archivo privado
   * sí lo trae ya compuesto, así que se usa como respaldo en vez de imprimir una
   * clave suelta que nadie sabe leer.
   */
  #areaTematica(candidato: Dc3CandidateDetail, delArchivo: Dc3ConfigCourse | undefined): string {
    const nombre = (candidato.thematicAreaName ?? "").trim();
    const clave = (candidato.thematicAreaKey ?? "").trim();
    if (clave && nombre) return `${clave}-${nombre}`;
    const respaldo = (delArchivo?.thematicArea ?? "").trim();
    if (respaldo) return respaldo;
    return clave;
  }

  /** Empata por nombre DC-3, que es lo único común entre la base y el archivo. */
  #cursoDeConfiguracion(configuracion: Dc3ConfigFile, candidato: Dc3CandidateDetail) {
    const objetivo = normalizar(candidato.courseName);
    return (configuracion.courses ?? []).find(
      (curso) => normalizar(String(curso.dc3Name ?? "")) === objetivo,
    );
  }

  #leerConfiguracion(): Dc3ConfigFile {
    try {
      return JSON.parse(readFileSync(this.#configPath, "utf8")) as Dc3ConfigFile;
    } catch {
      throw new DomainError(
        "SIN_CONFIGURACION_DC3",
        "Falta referencias/privado/dc3-config.json: sin él no hay razón social ni catálogo de cursos.",
      );
    }
  }
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

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
