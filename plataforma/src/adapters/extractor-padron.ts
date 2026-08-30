/**
 * Lectura del padrón semanal con el extractor puro que ya existe.
 *
 * Es el mismo módulo que usa `scripts/ingest-roster.js`: un solo lector de
 * XLSX en el árbol, de modo que la consola y la línea de comandos no puedan
 * interpretar el archivo de dos maneras distintas. Sigue el patrón de
 * `xlsb-extractor.adapter.ts` para importar un módulo JavaScript sin tipos.
 */

// @ts-expect-error script en JavaScript sin definiciones de tipos
import { extractActiveRosterFromBuffer } from "../../../packages/dc3/roster-extractor.js";
import type { PadronLeido, RosterExtractorPort } from "../domain/padron/tipos.ts";

type ExtractorFn = (archivo: Buffer) => PadronLeido;
const extraerPadron = extractActiveRosterFromBuffer as ExtractorFn;

export class RosterExtractorAdapter implements RosterExtractorPort {
  extraer(archivo: Buffer): PadronLeido {
    return extraerPadron(archivo);
  }
}
