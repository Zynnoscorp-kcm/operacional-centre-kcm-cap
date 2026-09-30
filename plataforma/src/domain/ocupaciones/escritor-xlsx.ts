/**
 * Escribe claves de ocupación de vuelta en un XLSX sin tocar la base de datos.
 *
 * Recibe el archivo original, las filas donde escribir y el código sugerido para
 * cada caso. Devuelve un buffer con el XLSX modificado: las celdas de ocupación
 * que estaban vacías ahora llevan el código que la IA sugirió.
 *
 * Usa `rebuildZip` de `ooxml.js` para reconstruir el archivo con las hojas
 * modificadas, y cadenas en línea (`t="inlineStr"`) para no tener que tocar la
 * tabla de cadenas compartidas.
 */

// @ts-expect-error script en JavaScript sin definiciones de tipos
import { XlsxWorkbook } from "../../../../packages/dc3/xlsx-reader.js";
// @ts-expect-error script en JavaScript sin definiciones de tipos
import { rebuildZip } from "../../../../packages/dc3/ooxml.js";

import type { FilaPorEscribir } from "./plan.ts";

interface CodigoPorCaso {
  readonly casoId: string;
  readonly codigo: string;
}

function escapeXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Inserta o reemplaza una celda en el XML de una hoja OOXML.
 *
 * Busca `<row r="N">` y dentro de ella la celda `<c r="REF">`. Si la celda
 * existe la reemplaza; si no, la inserta al final de la fila. Si la fila no
 * existe (no debería pasar con datos de un padrón leído), la crea dentro de
 * `<sheetData>`.
 */
function establecerCelda(xml: string, ref: string, fila: number, valor: string): string {
  const celdaXml = `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(valor)}</t></is></c>`;

  const rowPattern = new RegExp(
    `(<(?:\\w+:)?row\\b[^>]*\\br\\s*=\\s*"${fila}"[^>]*>)([\\s\\S]*?)(</(?:\\w+:)?row>)`,
    "i",
  );
  const rowMatch = rowPattern.exec(xml);

  if (rowMatch) {
    const fullRow = rowMatch[0];
    const apertura = rowMatch[1]!;
    const contenido = rowMatch[2]!;
    const cierre = rowMatch[3]!;
    const cellPattern = new RegExp(
      `<(?:\\w+:)?c\\b[^>]*\\br\\s*=\\s*"${ref}"[^>]*(?:/>|>[\\s\\S]*?</(?:\\w+:)?c>)`,
      "i",
    );
    const cellMatch = cellPattern.exec(contenido);
    if (cellMatch) {
      const nuevoContenido = contenido.replace(cellMatch[0], celdaXml);
      return xml.replace(fullRow, `${apertura}${nuevoContenido}${cierre}`);
    }
    return xml.replace(fullRow, `${apertura}${contenido}${celdaXml}${cierre}`);
  }

  const nuevaFila = `<row r="${fila}">${celdaXml}</row>`;
  return xml.replace(/<\/(?:\w+:)?sheetData>/i, `${nuevaFila}</sheetData>`);
}

export interface ResultadoDeEscritura {
  readonly buffer: Buffer;
  readonly celdasEscritas: number;
}

export function escribirCodigosEnXlsx(
  archivoOriginal: Buffer,
  filas: readonly FilaPorEscribir[],
  codigos: readonly CodigoPorCaso[],
): ResultadoDeEscritura {
  const codigoPorCaso = new Map(codigos.map((c) => [c.casoId, c.codigo]));

  const workbook = new XlsxWorkbook(archivoOriginal) as {
    archive: { has(name: string): boolean; read(name: string): Buffer; names(): string[] };
    sheets: Array<{ name: string; part: string }>;
    sheetByName(name: string): { name: string; part: string };
  };

  const cambiosPorHoja = new Map<
    string,
    Array<{ fila: number; columna: string; codigo: string }>
  >();

  let celdasEscritas = 0;
  for (const f of filas) {
    const codigo = codigoPorCaso.get(f.caso);
    if (!codigo) continue;

    const lista = cambiosPorHoja.get(f.hoja) ?? [];
    lista.push({ fila: f.fila, columna: f.columna, codigo });
    cambiosPorHoja.set(f.hoja, lista);
    celdasEscritas += 1;
  }

  const reemplazos = new Map<string, Buffer>();

  for (const [nombreHoja, cambios] of cambiosPorHoja) {
    let sheet: { part: string };
    try {
      sheet = workbook.sheetByName(nombreHoja);
    } catch {
      continue;
    }

    let xml = workbook.archive.read(sheet.part).toString("utf8");

    for (const cambio of cambios) {
      const ref = `${cambio.columna}${cambio.fila}`;
      xml = establecerCelda(xml, ref, cambio.fila, cambio.codigo);
    }

    reemplazos.set(sheet.part, Buffer.from(xml, "utf8"));
  }

  const buffer: Buffer = rebuildZip(workbook.archive, reemplazos);
  return { buffer, celdasEscritas };
}
