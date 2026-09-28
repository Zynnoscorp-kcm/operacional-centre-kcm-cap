/**
 * Escritor PDF mínimo y determinista, sin dependencias.
 *
 * Es la misma técnica que `packages/dc3/pdf/pdf-writer.js` del árbol legado, portada
 * a TypeScript para que la aplicación no dependa de ese árbol antes de que E13
 * integre `packages/dc3/`. Cuando esa ejecución consolide el compositor, este módulo
 * y aquél deben quedar en uno solo.
 *
 * Determinista a propósito: la fecha del documento la fija quien llama, nunca el
 * reloj. Dos corridas con la misma entrada producen los mismos bytes, y por eso
 * el SHA-256 del archivo sirve como identidad de la evidencia archivada.
 *
 * Usa las fuentes base Helvetica y Helvetica-Bold, que todo lector PDF incluye:
 * no hay tipografía que incrustar ni licencia que verificar. La codificación es
 * WinAnsi, que cubre acentos y eñe del español.
 */

import { deflateSync } from "node:zlib";

import type { ImagenParaPdf } from "./imagenes.ts";

interface ColocacionDeImagen {
  readonly nombre: string;
  readonly imagen: ImagenParaPdf;
}

const HELVETICA_WIDTHS: readonly number[] = Object.freeze([
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]);

const HELVETICA_BOLD_WIDTHS: readonly number[] = Object.freeze([
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]);

/**
 * Los glifos acentuados de Helvetica tienen el mismo avance que su letra base,
 * así que basta asignarles el código WinAnsi y medirlos por la base.
 */
const WIN_ANSI = new Map<string, readonly [number, string]>([
  ["Á", [193, "A"]],
  ["É", [201, "E"]],
  ["Í", [205, "I"]],
  ["Ó", [211, "O"]],
  ["Ú", [218, "U"]],
  ["Ü", [220, "U"]],
  ["Ñ", [209, "N"]],
  ["á", [225, "a"]],
  ["é", [233, "e"]],
  ["í", [237, "i"]],
  ["ó", [243, "o"]],
  ["ú", [250, "u"]],
  ["ü", [252, "u"]],
  ["ñ", [241, "n"]],
  ["¿", [191, "?"]],
  ["¡", [161, "!"]],
  ["°", [176, "o"]],
  ["º", [186, "o"]],
  ["ª", [170, "a"]],
  ["«", [171, "<"]],
  ["»", [187, ">"]],
  ["–", [150, "-"]],
  ["—", [151, "-"]],
  ["'", [145, "'"]],
  ["'", [146, "'"]],
  ["“", [147, '"']],
  ["”", [148, '"']],
  ["…", [133, "."]],
  ["·", [183, "."]],
  ["©", [169, "O"]],
  ["®", [174, "O"]],
  ["Ç", [199, "C"]],
  ["ç", [231, "c"]],
]);

interface Glyph {
  readonly code: number;
  readonly widthIndex: number;
}

function glyph(character: string): Glyph {
  const code = character.charCodeAt(0);
  if (code >= 32 && code <= 126) return { code, widthIndex: code - 32 };
  const mapped = WIN_ANSI.get(character);
  if (mapped) return { code: mapped[0], widthIndex: mapped[1].charCodeAt(0) - 32 };
  // Un carácter fuera de WinAnsi se sustituye por espacio en vez de romper el
  // archivo. Lo que se imprime aquí ya viene validado por el servicio.
  return { code: 32, widthIndex: 0 };
}

export interface TextMetrics {
  readonly size?: number;
  readonly bold?: boolean;
}

export function measureText(value: string, { size = 10, bold = false }: TextMetrics = {}): number {
  const widths = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const character of String(value)) {
    total += widths[glyph(character).widthIndex] ?? 0;
  }
  return (total * size) / 1000;
}

export interface WrapOptions extends TextMetrics {
  readonly maxWidth?: number;
  readonly maxLines?: number;
}

export function wrapText(
  value: string,
  { size = 10, bold = false, maxWidth = 100, maxLines = 0 }: WrapOptions = {},
): { lines: string[]; overflow: boolean } {
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureText(candidate, { size, bold }) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  if (maxLines > 0 && lines.length > maxLines) {
    return { lines: lines.slice(0, maxLines), overflow: true };
  }
  return { lines, overflow: false };
}

function escapeLiteral(value: string): string {
  let output = "";
  for (const character of String(value)) {
    const { code } = glyph(character);
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      output += `\\${String.fromCharCode(code)}`;
    } else if (code < 32 || code > 126) {
      output += `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      output += String.fromCharCode(code);
    }
  }
  return output;
}

function formatNumber(value: number): string {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export type TextAlign = "left" | "center" | "right";

/** Color en componentes 0..1, como los espera el operador `rg` del PDF. */
export type Color = readonly [number, number, number];

/** Convierte `#3E6899` al triplete que el PDF entiende. */
export function rgb(hex: string): Color {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match || match[1] === undefined) throw new Error(`Color inválido: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function fillOperator(color: Color | undefined, gray: number): string {
  if (!color) return `${formatNumber(gray)} g`;
  return `${formatNumber(color[0])} ${formatNumber(color[1])} ${formatNumber(color[2])} rg`;
}

function strokeOperator(color: Color | undefined, gray: number): string {
  if (!color) return `${formatNumber(gray)} G`;
  return `${formatNumber(color[0])} ${formatNumber(color[1])} ${formatNumber(color[2])} RG`;
}

export interface TextOptions extends TextMetrics {
  readonly x?: number;
  readonly y?: number;
  readonly align?: TextAlign;
  readonly width?: number;
  readonly gray?: number;
  readonly color?: Color;
}

export interface ParagraphOptions extends TextMetrics {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly leading?: number;
  readonly gray?: number;
  readonly color?: Color;
  readonly maxLines?: number;
}

export interface RectOptions {
  readonly stroke?: number | null;
  readonly fill?: number | null;
  readonly strokeColor?: Color;
  readonly fillColor?: Color;
  readonly lineWidth?: number;
}

/**
 * Un recuadro que se puede escribir en el visor.
 *
 * Existe para el caso de la constancia DC-3 con datos por capturar: el recuadro
 * se imprimía vacío y alguien lo llenaba con pluma. Un campo de formulario deja
 * escribirlo en pantalla y volver a guardar el archivo, sin cambiar en nada el
 * resto de la maqueta ni traer una biblioteca.
 */
export interface FormFieldOptions {
  /** Nombre interno del campo. Único dentro del documento. */
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly size?: number;
  /** Texto de ayuda que el visor enseña al pasar el puntero. */
  readonly tooltip?: string;
  /** Valor inicial. Vacío es lo normal: el campo existe porque falta el dato. */
  readonly value?: string;
}

interface FormField extends FormFieldOptions {
  /** Ya convertido al sistema del PDF, donde `y` crece hacia arriba. */
  readonly rect: readonly [number, number, number, number];
}

/**
 * Página en coordenadas de lectura: el origen está arriba a la izquierda y `y`
 * crece hacia abajo, como en la maqueta. La conversión al sistema del PDF, donde
 * `y` crece hacia arriba, ocurre en un solo lugar.
 */
export class PdfPage {
  readonly width: number;
  readonly height: number;
  private readonly operations: string[] = [];
  private readonly fields: FormField[] = [];
  private readonly imagenes: ColocacionDeImagen[] = [];

  constructor({ width = 612, height = 792 }: { width?: number; height?: number } = {}) {
    this.width = width;
    this.height = height;
  }

  /**
   * Declara un campo escribible sobre las coordenadas de la maqueta. No dibuja
   * nada: el recuadro ya está trazado por `rect`, y lo que se agrega es la
   * posibilidad de escribir dentro.
   */
  formField(options: FormFieldOptions): this {
    this.fields.push({
      ...options,
      rect: [
        options.x,
        this.height - options.y - options.height,
        options.x + options.width,
        this.height - options.y,
      ],
    });
    return this;
  }

  /**
   * Coloca una imagen ya leída. Las coordenadas son las de la maqueta —origen
   * arriba a la izquierda— igual que en el resto de la página, y el dibujo va
   * entre `q`/`Q` para que la matriz de escala no afecte a nada de lo demás.
   */
  image(
    imagen: ImagenParaPdf,
    opciones: { x: number; y: number; width: number; height: number },
  ): this {
    const nombre = `Im${String(this.imagenes.length + 1)}`;
    this.imagenes.push({ nombre, imagen });
    const abajo = this.height - opciones.y - opciones.height;
    this.operations.push(
      `q ${formatNumber(opciones.width)} 0 0 ${formatNumber(opciones.height)} ` +
        `${formatNumber(opciones.x)} ${formatNumber(abajo)} cm /${nombre} Do Q`,
    );
    return this;
  }

  /** Sólo lo lee `buildPdf`. */
  get placedImages(): readonly ColocacionDeImagen[] {
    return this.imagenes;
  }

  /** Sólo lo lee `buildPdf`. */
  get formFields(): readonly FormField[] {
    return this.fields;
  }

  private flip(value: number): string {
    return formatNumber(this.height - value);
  }

  text(value: string, options: TextOptions = {}): this {
    const {
      x = 0,
      y = 0,
      size = 10,
      bold = false,
      align = "left",
      width = 0,
      gray = 0,
      color,
    } = options;
    const content = String(value ?? "");
    if (!content.trim()) return this;

    let left = x;
    if (align === "center") left = x + (width - measureText(content, { size, bold })) / 2;
    else if (align === "right") left = x + width - measureText(content, { size, bold });

    this.operations.push(
      `BT /${bold ? "F2" : "F1"} ${formatNumber(size)} Tf ${fillOperator(color, gray)} ` +
        `${formatNumber(left)} ${this.flip(y + size * 0.78)} Td (${escapeLiteral(content)}) Tj ET`,
    );
    return this;
  }

  paragraph(
    value: string,
    options: ParagraphOptions = {},
  ): { height: number; lines: number; overflow: boolean } {
    const {
      x = 0,
      y = 0,
      size = 8,
      bold = false,
      width = 100,
      leading = 0,
      gray = 0,
      color,
      maxLines = 0,
    } = options;
    const step = leading || size * 1.25;
    const { lines, overflow } = wrapText(value, { size, bold, maxWidth: width, maxLines });
    lines.forEach((line, index) => {
      this.text(
        line,
        color
          ? { x, y: y + index * step, size, bold, color }
          : { x, y: y + index * step, size, bold, gray },
      );
    });
    return { height: lines.length * step, lines: lines.length, overflow };
  }

  rect(x: number, y: number, width: number, height: number, options: RectOptions = {}): this {
    const { stroke = 0.35, fill = null, strokeColor, fillColor, lineWidth = 0.6 } = options;
    const hasFill = fill !== null || fillColor !== undefined;
    const hasStroke = stroke !== null || strokeColor !== undefined;
    const parts = [`${formatNumber(lineWidth)} w`];
    if (hasFill) parts.push(fillOperator(fillColor, fill ?? 0));
    if (hasStroke) parts.push(strokeOperator(strokeColor, stroke ?? 0));
    parts.push(
      `${formatNumber(x)} ${this.flip(y + height)} ${formatNumber(width)} ${formatNumber(height)} re`,
    );
    parts.push(hasFill && hasStroke ? "B" : hasFill ? "f" : "S");
    this.operations.push(parts.join(" "));
    return this;
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    {
      gray = 0.35,
      color,
      lineWidth = 0.6,
    }: { gray?: number; color?: Color; lineWidth?: number } = {},
  ): this {
    this.operations.push(
      `${formatNumber(lineWidth)} w ${strokeOperator(color, gray)} ` +
        `${formatNumber(x1)} ${this.flip(y1)} m ${formatNumber(x2)} ${this.flip(y2)} l S`,
    );
    return this;
  }

  get content(): string {
    return this.operations.join("\n");
  }
}

function pdfDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ""));
  if (!match) throw new Error("La fecha del PDF debe usar YYYY-MM-DD");
  return `D:${match[1]}${match[2]}${match[3]}000000Z`;
}

export interface BuildPdfInput {
  readonly pages: readonly PdfPage[];
  readonly title?: string;
  readonly date: string;
  readonly producer?: string;
  /**
   * Una imagen que aparece en varias páginas se guarda una sola vez.
   *
   * Es opcional y no el comportamiento por omisión, a propósito: los documentos
   * que ya existen —el reporte de preliberación, la constancia de una página—
   * se archivan por su SHA-256, y guardar distinto sus imágenes cambiaría sus
   * bytes sin cambiar nada de lo que dicen. Lo pide la tanda de constancias,
   * donde el logotipo del sindicato pesa doscientos kilobytes y se repetiría en
   * cada hoja.
   *
   * Se reconoce la misma imagen por identidad del objeto, no por contenido: el
   * servicio que lee los logotipos ya los guarda en caché, así que la misma
   * imagen es el mismo objeto.
   */
  readonly compartirImagenes?: boolean;
}

export function buildPdf({
  pages,
  title = "",
  date,
  producer = "KCM Cap",
  compartirImagenes = false,
}: BuildPdfInput): Buffer {
  if (pages.length === 0) {
    throw new Error("El PDF requiere al menos una página");
  }
  const timestamp = pdfDate(date);
  const objects: (string | null)[] = [];
  const push = (body: string | null): number => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = push(null);
  const pagesId = push(null);
  const fontRegularId = push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBoldId = push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const infoId = push(
    `<< /Producer (${escapeLiteral(producer)}) /Creator (KCM Cap) /Title (${escapeLiteral(title)}) ` +
      `/CreationDate (${timestamp}) /ModDate (${timestamp}) >>`,
  );

  const pageIds: number[] = [];
  /** Widgets de todas las páginas: el catálogo los necesita en una sola lista. */
  const fieldIds: number[] = [];
  /** Imágenes ya escritas, cuando el documento las comparte entre páginas. */
  const imagenesEscritas = new Map<ImagenParaPdf, number>();

  for (const page of pages) {
    // Las imágenes se emiten antes que la página porque su recurso tiene que
    // existir para nombrarlo en `/XObject`. Cada una puede traer su máscara de
    // transparencia, que es otro objeto y se referencia desde la imagen.
    const recursosDeImagen: string[] = [];
    for (const { nombre, imagen } of page.placedImages) {
      const escrita = compartirImagenes ? imagenesEscritas.get(imagen) : undefined;
      if (escrita !== undefined) {
        recursosDeImagen.push(`/${nombre} ${String(escrita)} 0 R`);
        continue;
      }
      let mascara = "";
      if (imagen.alpha) {
        const alfa = deflateSync(imagen.alpha);
        const alfaId = push(
          `<< /Type /XObject /Subtype /Image /Width ${String(imagen.width)} ` +
            `/Height ${String(imagen.height)} /ColorSpace /DeviceGray /BitsPerComponent 8 ` +
            `/Filter /FlateDecode /Length ${String(alfa.length)} >>\nstream\n` +
            `${alfa.toString("latin1")}\nendstream`,
        );
        mascara = ` /SMask ${alfaId} 0 R`;
      }
      const cuerpo = imagen.filter === "FlateDecode" ? deflateSync(imagen.data) : imagen.data;
      const id = push(
        `<< /Type /XObject /Subtype /Image /Width ${String(imagen.width)} ` +
          `/Height ${String(imagen.height)} ` +
          `/ColorSpace ${imagen.components === 1 ? "/DeviceGray" : "/DeviceRGB"} ` +
          `/BitsPerComponent 8 /Filter /${imagen.filter}${mascara} ` +
          `/Length ${String(cuerpo.length)} >>\nstream\n${cuerpo.toString("latin1")}\nendstream`,
      );
      if (compartirImagenes) imagenesEscritas.set(imagen, id);
      recursosDeImagen.push(`/${nombre} ${id} 0 R`);
    }

    const stream = page.content;
    const contentId = push(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    // La página se reserva antes que sus campos porque cada campo apunta de
    // vuelta a ella con `/P`, y el número tiene que existir para escribirlo.
    const pageId = push(null);
    pageIds.push(pageId);

    const propios: number[] = [];
    for (const field of page.formFields) {
      const size = field.size ?? 9;
      const partes = [
        "<< /Type /Annot /Subtype /Widget /FT /Tx",
        `/T (${escapeLiteral(field.name)})`,
        `/V (${escapeLiteral(field.value ?? "")})`,
        `/DA (/F1 ${formatNumber(size)} Tf 0 g)`,
        `/Rect [${field.rect.map(formatNumber).join(" ")}]`,
        // Bit 3: imprimible. Sin él, el campo se ve en pantalla y desaparece al
        // imprimir, que es la peor combinación posible para una constancia.
        "/F 4",
        `/P ${pageId} 0 R`,
        // Fondo y borde transparentes: el recuadro ya está trazado en la maqueta
        // y un segundo marco encima se vería como un error de impresión.
        "/MK << >>",
      ];
      if (field.tooltip) partes.push(`/TU (${escapeLiteral(field.tooltip)})`);
      propios.push(push(`${partes.join(" ")} >>`));
    }
    fieldIds.push(...propios);

    objects[pageId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(page.width)} ` +
      `${formatNumber(page.height)}] /Resources << /Font << /F1 ${fontRegularId} 0 R ` +
      `/F2 ${fontBoldId} 0 R >>` +
      (recursosDeImagen.length ? ` /XObject << ${recursosDeImagen.join(" ")} >>` : "") +
      ` >> /Contents ${contentId} 0 R` +
      (propios.length ? ` /Annots [${propios.map((id) => `${id} 0 R`).join(" ")}]` : "") +
      " >>";
  }

  // `NeedAppearances` le pide al visor que dibuje el contenido del campo con sus
  // propias reglas. Es lo que evita tener que generar un flujo de apariencia por
  // campo —varios cientos de líneas de PDF a mano— y lo respetan Acrobat, Vista
  // Previa, Firefox y Chrome.
  const acroForm = fieldIds.length
    ? ` /AcroForm << /Fields [${fieldIds.map((id) => `${id} 0 R`).join(" ")}] ` +
      `/NeedAppearances true /DA (/F1 9 Tf 0 g) ` +
      `/DR << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`
    : "";

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${acroForm} >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const startXref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${startXref}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}
