// @ts-expect-error script en JavaScript sin definiciones de tipos
import { extractHcSnapshotFromBuffer } from "../../../../packages/xlsb/extract-hc-xlsb.js";
import type { MatrixSnapshot } from "../../domain/importacion-matriz/tipos.ts";
import type { XlsbExtractOptions, XlsbExtractorPort } from "../../ports/importacion-matriz.port.ts";

type ExtractorFn = (
  buf: Buffer,
  opts: { sheetName?: string; lastCourseColumn?: string },
) => unknown;
const extractSnapshot = extractHcSnapshotFromBuffer as ExtractorFn;

export class XlsbExtractorAdapter implements XlsbExtractorPort {
  extractFromBuffer(buffer: Buffer, options: XlsbExtractOptions = {}): Promise<MatrixSnapshot> {
    const raw = extractSnapshot(buffer, {
      sheetName: options.sheetName ?? "HC",
      ...(options.lastCourseColumn !== undefined
        ? { lastCourseColumn: String(options.lastCourseColumn) }
        : {}),
    });
    return Promise.resolve(raw as MatrixSnapshot);
  }
}
