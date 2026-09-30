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
  readonly blankFields: readonly string[];
  readonly editable: boolean;
  readonly workerNumber: string;
  readonly workerName: string;
  readonly courseName: string;
}

export interface EmisionDeTanda {
  readonly clave: string;
  readonly workerName: string;
  readonly courseName: string;
  readonly blankFields: readonly string[];
}

export interface FalloDeTanda {
  readonly clave: string;
  readonly codigo: string;
}

export interface ResultadoDeTanda {
  readonly emitidas: readonly EmisionDeTanda[];
  readonly fallidas: readonly FalloDeTanda[];
}

export interface DocumentoDc3 {
  readonly formato: "pdf" | "zip";
  readonly nombre: string;
  readonly pdf?: Uint8Array;
  readonly archivos?: readonly { readonly nombre: string; readonly contenido: Uint8Array }[];
  readonly incluidas: number;
  readonly omitidas: readonly string[];
}

export interface FormatoVisibleDc3 {
  readonly razonSocial: string;
  readonly firmas: readonly { readonly rotulo: string; readonly nombre: string }[];
  readonly corte: string;
  readonly logotipos: { readonly empresa: boolean; readonly sindicato: boolean };
}

const DIRECTORIO_DE_LOGOTIPOS = fileURLToPath(new URL("../../web/pdf/membrete/", import.meta.url));
const LOGOTIPO_EMPRESA = "empresa.png";
const LOGOTIPO_SINDICATO = "sindicato.png";

export function claveDc3(clave: Dc3Key): string {
  return `${clave.workerNumber}:${clave.courseKey}`;
}

export function leerClaveDc3(texto: string): Dc3Key | undefined {
  const partes = texto.trim().split(":");
  if (partes.length !== 2) return undefined;
  const [numero = "", curso = ""] = partes;
  if (!/^\d{5}$/u.test(numero)) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(curso)) return undefined;
  return { workerNumber: numero, courseKey: curso };
}

export function etiquetaCortaDeCurso(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/u).filter(Boolean);
  const completo = palabras.join(" ");
  if (completo.length <= 12) return completo;
  const ultima = palabras.at(-1) ?? "";
  if (/^[A-ZÁÉÍÓÚÑ]{2,6}$/u.test(ultima)) return ultima;
  const primera = palabras[0] ?? completo;
  return primera.charAt(0).toLocaleUpperCase("es-MX") + primera.slice(1).toLocaleLowerCase("es-MX");
}

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

  constructor(input: { repository: Dc3CertificatePort; directorioDeLogotipos?: string }) {
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

  countCandidates(filter: Parameters<Dc3CertificatePort["countCandidates"]>[0]) {
    return this.#repository.countCandidates(filter);
  }

  countByCourse(filter: Parameters<Dc3CertificatePort["countByCourse"]>[0]) {
    return this.#repository.countByCourse(filter);
  }

  coverage(filter: Parameters<Dc3CertificatePort["coverage"]>[0]) {
    return this.#repository.coverage(filter);
  }

  coverageByArea(filter: Parameters<Dc3CertificatePort["coverageByArea"]>[0]) {
    return this.#repository.coverageByArea(filter);
  }

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

  async emissionIndex(): Promise<ReadonlyMap<string, Dc3EmissionSummary>> {
    const resumenes = await this.#repository.listEmissionSummaries();
    return new Map(resumenes.map((resumen) => [resumen.key, resumen]));
  }

  async emittedKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.#repository.listEmissionSummaries()).map((r) => r.key));
  }

  async emitir(input: {
    readonly workerNumber: string;
    readonly courseKey: string;
    readonly actor: string;
    readonly requestId: string;
    readonly editable?: boolean;
    readonly allowMissingDate?: boolean;
    readonly preview?: boolean;
  }): Promise<Dc3CertificateResult> {
    const candidato = await this.#repository.findCandidate(input.workerNumber, input.courseKey);
    if (!candidato) {
      throw new DomainError(
        "CANDIDATO_DC3_NO_ENCONTRADO",
        "No hay trabajador activo con ese número y ese curso con obligación DC-3.",
      );
    }
    if (!candidato.completionDate && !input.allowMissingDate) {
      throw new DomainError(
        "SIN_FECHA_DE_CURSO",
        `${candidato.workerName} no tiene fecha registrada para ${candidato.courseName}. ` +
          "Sin fecha no se emite: la constancia certifica un día concreto.",
      );
    }

    const pieza = this.#pieza(candidato);
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

  async componerDocumento(input: {
    readonly claves: readonly string[];
    readonly formato: "pdf" | "zip";
    readonly entrega: boolean;
    readonly editable: boolean;
    readonly actor: string;
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

  async clavesDeLaSolicitud(requestId: string): Promise<readonly string[]> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId)) {
      return [];
    }
    return this.#repository.listRequestEmissionKeys(requestId);
  }

  formatoVisible(): FormatoVisibleDc3 {
    return formatoDeLaConstancia(this.#directorioDeLogotipos);
  }

  async buscar(claves: readonly string[]): Promise<readonly Dc3CandidateDetail[]> {
    const { validas } = separarClaves(claves);
    return this.#repository.findCandidates(validas);
  }

  #pieza(candidato: Dc3CandidateDetail): Pieza {
    const datos = {
      workerName: candidato.workerName,
      curp: candidato.curp,
      position: candidato.position,
      employerName: "",
      occupation: candidato.occupation,
      courseName: candidato.courseName,
      durationHours: candidato.durationHours ?? "",
      startDate: candidato.completionDate ?? "",
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
      ...(candidato.completionDate ? [] : ["fecha del curso"]),
    ];

    return { candidato, datos, blankFields, logos: this.#logotipos(candidato) };
  }

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
    this.#logotiposLeidos.set(ruta, imagen ?? null);
    return imagen;
  }
}

export function areaTematica(candidato: Dc3CandidateDetail): string {
  const clave = (candidato.thematicAreaKey ?? "").trim();
  const nombre = nombreDeAreaTematica(clave, candidato.thematicAreaName);
  if (clave && nombre) return `${clave}-${nombre}`;
  return clave;
}

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
