/**
 * Lectura de PNG y JPEG para incrustarlos en un PDF.
 *
 * El escritor de PDF de la casa no sabía de imágenes: dibujaba texto, líneas y
 * recuadros. Esto le agrega lo mínimo para poner un logotipo, y nada más:
 * no reescala, no recorta y no toca el trazo de ningún documento existente.
 *
 * Se resuelve con `node:zlib`, que ya viene con Node, en vez de sumar una
 * dependencia de imágenes al despliegue. El JPEG ni siquiera se descomprime: el
 * PDF entiende su compresión tal cual y se le pasa el archivo íntegro.
 */

import { inflateSync } from "node:zlib";

export interface ImagenParaPdf {
  readonly width: number;
  readonly height: number;
  /** Cuántos componentes de color tiene cada píxel: 1 gris, 3 color. */
  readonly components: 1 | 3;
  /** El filtro con el que el PDF debe leer `data`. */
  readonly filter: "DCTDecode" | "FlateDecode";
  /** Los bytes del flujo, ya en la forma que el filtro espera. */
  readonly data: Buffer;
  /** Canal alfa como máscara suave, cuando la imagen lo trae. */
  readonly alpha?: Buffer;
}

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function leerImagen(bytes: Buffer): ImagenParaPdf {
  if (bytes.subarray(0, 8).equals(FIRMA_PNG)) return leerPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return leerJpeg(bytes);
  throw new Error("El logotipo debe ser PNG o JPEG.");
}

/**
 * JPEG sin descomprimir. Sólo se recorren los marcadores para saber de qué
 * tamaño es y cuántos componentes trae; los bytes viajan intactos al PDF.
 */
function leerJpeg(bytes: Buffer): ImagenParaPdf {
  let posicion = 2;
  while (posicion + 9 < bytes.length) {
    if (bytes[posicion] !== 0xff) {
      posicion += 1;
      continue;
    }
    const marcador = bytes[posicion + 1] ?? 0;
    // Los SOF describen la trama. Se excluyen DHT, DAC y RST, que comparten rango.
    const esSof =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc;
    if (esSof) {
      const height = bytes.readUInt16BE(posicion + 5);
      const width = bytes.readUInt16BE(posicion + 7);
      const componentes = bytes[posicion + 9] ?? 3;
      if (componentes !== 1 && componentes !== 3) {
        throw new Error("El JPEG del logotipo debe ser en escala de grises o RGB, no CMYK.");
      }
      return { width, height, components: componentes, filter: "DCTDecode", data: bytes };
    }
    posicion += 2 + bytes.readUInt16BE(posicion + 2);
  }
  throw new Error("El JPEG del logotipo no declara sus dimensiones.");
}

interface Ihdr {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
}

function leerPng(bytes: Buffer): ImagenParaPdf {
  let posicion = 8;
  let ihdr: Ihdr | undefined;
  let paleta: Buffer | undefined;
  let transparencia: Buffer | undefined;
  const trozos: Buffer[] = [];

  while (posicion + 8 <= bytes.length) {
    const largo = bytes.readUInt32BE(posicion);
    const tipo = bytes.toString("latin1", posicion + 4, posicion + 8);
    const cuerpo = bytes.subarray(posicion + 8, posicion + 8 + largo);
    if (tipo === "IHDR") {
      ihdr = {
        width: cuerpo.readUInt32BE(0),
        height: cuerpo.readUInt32BE(4),
        bitDepth: cuerpo[8] ?? 8,
        colorType: cuerpo[9] ?? 6,
        interlace: cuerpo[12] ?? 0,
      };
    } else if (tipo === "PLTE") paleta = Buffer.from(cuerpo);
    else if (tipo === "tRNS") transparencia = Buffer.from(cuerpo);
    else if (tipo === "IDAT") trozos.push(Buffer.from(cuerpo));
    else if (tipo === "IEND") break;
    posicion += 12 + largo;
  }

  if (!ihdr) throw new Error("El PNG del logotipo no tiene cabecera IHDR.");
  if (ihdr.bitDepth !== 8) {
    throw new Error("El PNG del logotipo debe ser de 8 bits por canal.");
  }
  if (ihdr.interlace !== 0) {
    throw new Error("El PNG del logotipo no puede estar entrelazado; guárdelo sin entrelazar.");
  }

  const canales = canalesDe(ihdr.colorType);
  const crudo = desfiltrar(inflateSync(Buffer.concat(trozos)), ihdr.width, ihdr.height, canales);

  return componer(ihdr, crudo, canales, paleta, transparencia);
}

function canalesDe(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // gris
    case 2:
      return 3; // color
    case 3:
      return 1; // índice de paleta
    case 4:
      return 2; // gris con alfa
    case 6:
      return 4; // color con alfa
    default:
      throw new Error(`El PNG del logotipo usa un tipo de color no soportado (${colorType}).`);
  }
}

/**
 * Deshace los filtros por renglón del PNG. Es el paso que ninguna imagen se
 * salta: cada scanline se guarda como diferencia contra la anterior o contra el
 * píxel de al lado, y sin revertirlo lo que se ve es ruido.
 */
function desfiltrar(datos: Buffer, ancho: number, alto: number, canales: number): Buffer {
  const bpp = canales;
  const porRenglon = ancho * bpp;
  const salida = Buffer.alloc(porRenglon * alto);
  let entrada = 0;

  for (let fila = 0; fila < alto; fila += 1) {
    const filtro = datos[entrada];
    entrada += 1;
    const inicio = fila * porRenglon;
    const anterior = inicio - porRenglon;

    for (let i = 0; i < porRenglon; i += 1) {
      const actual = datos[entrada + i] ?? 0;
      const izquierda = i >= bpp ? (salida[inicio + i - bpp] ?? 0) : 0;
      const arriba = fila > 0 ? (salida[anterior + i] ?? 0) : 0;
      const diagonal = fila > 0 && i >= bpp ? (salida[anterior + i - bpp] ?? 0) : 0;

      let valor: number;
      switch (filtro) {
        case 0:
          valor = actual;
          break;
        case 1:
          valor = actual + izquierda;
          break;
        case 2:
          valor = actual + arriba;
          break;
        case 3:
          valor = actual + ((izquierda + arriba) >> 1);
          break;
        case 4:
          valor = actual + paeth(izquierda, arriba, diagonal);
          break;
        default:
          throw new Error(`El PNG del logotipo usa un filtro desconocido (${String(filtro)}).`);
      }
      salida[inicio + i] = valor & 0xff;
    }
    entrada += porRenglon;
  }
  return salida;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Separa color y alfa, y resuelve la paleta si la imagen viene indexada. */
function componer(
  ihdr: Ihdr,
  crudo: Buffer,
  canales: number,
  paleta: Buffer | undefined,
  transparencia: Buffer | undefined,
): ImagenParaPdf {
  const pixeles = ihdr.width * ihdr.height;
  const base = { width: ihdr.width, height: ihdr.height } as const;

  if (ihdr.colorType === 3) {
    if (!paleta) throw new Error("El PNG indexado del logotipo no trae paleta.");
    const color = Buffer.alloc(pixeles * 3);
    const alfa = transparencia ? Buffer.alloc(pixeles) : undefined;
    for (let i = 0; i < pixeles; i += 1) {
      const indice = crudo[i] ?? 0;
      color[i * 3] = paleta[indice * 3] ?? 0;
      color[i * 3 + 1] = paleta[indice * 3 + 1] ?? 0;
      color[i * 3 + 2] = paleta[indice * 3 + 2] ?? 0;
      if (alfa) alfa[i] = transparencia?.[indice] ?? 255;
    }
    return {
      ...base,
      components: 3,
      filter: "FlateDecode",
      data: color,
      ...(alfa ? { alpha: alfa } : {}),
    };
  }

  if (canales === 1 || canales === 3) {
    return {
      ...base,
      components: canales === 1 ? 1 : 3,
      filter: "FlateDecode",
      data: crudo,
    };
  }

  // Con alfa: el color va por un lado y la transparencia por otro, que es como
  // el PDF la entiende (una máscara suave aparte del color).
  const colorCanales = canales === 2 ? 1 : 3;
  const color = Buffer.alloc(pixeles * colorCanales);
  const alfa = Buffer.alloc(pixeles);
  for (let i = 0; i < pixeles; i += 1) {
    for (let c = 0; c < colorCanales; c += 1) {
      color[i * colorCanales + c] = crudo[i * canales + c] ?? 0;
    }
    alfa[i] = crudo[i * canales + colorCanales] ?? 255;
  }
  return {
    ...base,
    components: colorCanales === 1 ? 1 : 3,
    filter: "FlateDecode",
    data: color,
    alpha: alfa,
  };
}
