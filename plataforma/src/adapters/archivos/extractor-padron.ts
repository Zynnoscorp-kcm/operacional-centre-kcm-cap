// @ts-expect-error script en JavaScript sin definiciones de tipos
import { extractActiveRosterFromBuffer } from "../../../../packages/dc3/roster-extractor.js";
import type { PadronLeido, RosterExtractorPort } from "../../domain/padron/tipos.ts";

type ExtractorFn = (archivo: Buffer) => PadronLeido;
const extraerPadron = extractActiveRosterFromBuffer as ExtractorFn;

export class RosterExtractorAdapter implements RosterExtractorPort {
  extraer(archivo: Buffer): PadronLeido {
    return extraerPadron(archivo);
  }
}
