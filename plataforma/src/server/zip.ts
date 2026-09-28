/**
 * Un ZIP sin comprimir, escrito a mano.
 *
 * Existe por una sola pantalla: emitir treinta constancias de un área y que
 * caigan en un archivo en vez de en treinta descargas que el navegador bloquea
 * a la tercera. No hay biblioteca porque no hace falta: un ZIP «almacenado»
 * —sin compresión— son tres estructuras de bytes bien documentadas desde 1989 y
 * una suma CRC-32 que Node trae en `node:zlib` desde la 22. Añadir una
 * dependencia para esto sería añadir una dependencia para copiar bytes.
 *
 * Y no se comprime a propósito: un PDF ya viene comprimido, así que pasarlo por
 * deflate cuesta tiempo de proceso para ahorrar un uno por ciento.
 *
 * Lo que este archivo **no** hace, y no debe empezar a hacer: ZIP64 —que hace
 * falta pasando de 65 535 entradas o de 4 GB—, cifrado, ni carpetas. Un lote de
 * constancias no se acerca a ninguno de esos techos; si alguna vez se acerca,
 * el sitio para resolverlo es una biblioteca, no este archivo.
 */

import { crc32 } from "node:zlib";

export interface ArchivoDelZip {
  /** Nombre dentro del archivo. Sin carpetas: se escribe tal cual. */
  readonly nombre: string;
  readonly contenido: Uint8Array;
}

/** Firmas del formato, en el orden en que aparecen en el archivo. */
const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

/** Versión mínima para leerlo: 2.0, que es la de un ZIP sin comprimir. */
const VERSION = 20;
/** Bit 11: el nombre viaja en UTF-8. Sin él, un acento se lee mal en Windows. */
const BANDERA_UTF8 = 0x0800;
/** 0 = almacenado. Ver la cabecera de este archivo. */
const METODO_ALMACENADO = 0;

/**
 * La hora en el formato de MS-DOS que el ZIP heredó: dos campos de 16 bits con
 * la fecha y la hora empaquetadas, y segundos en pasos de dos. No admite años
 * anteriores a 1980, así que cualquier reloj adelantado hacia atrás se queda en
 * el primer día que el formato sabe escribir.
 */
function fechaDos(cuando: Date): { fecha: number; hora: number } {
  const anio = cuando.getFullYear();
  if (anio < 1980) return { fecha: (1 << 5) | 1, hora: 0 };
  return {
    fecha: ((anio - 1980) << 9) | ((cuando.getMonth() + 1) << 5) | cuando.getDate(),
    hora:
      (cuando.getHours() << 11) | (cuando.getMinutes() << 5) | Math.floor(cuando.getSeconds() / 2),
  };
}

/**
 * Empaqueta los archivos en un ZIP y devuelve sus bytes.
 *
 * El archivo entero se arma en memoria, que es lo correcto aquí: el lote más
 * grande que esta pantalla ofrece son unos cientos de constancias de pocos
 * kilobytes cada una. Un flujo tendría sentido para un respaldo de la base, no
 * para esto.
 */
export function empaquetarZip(archivos: readonly ArchivoDelZip[], cuando = new Date()): Buffer {
  const { fecha, hora } = fechaDos(cuando);
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;

  for (const archivo of archivos) {
    const nombre = Buffer.from(archivo.nombre, "utf8");
    const datos = Buffer.from(archivo.contenido);
    const suma = crc32(datos);

    const cabeceraLocal = Buffer.alloc(30);
    cabeceraLocal.writeUInt32LE(FIRMA_LOCAL, 0);
    cabeceraLocal.writeUInt16LE(VERSION, 4);
    cabeceraLocal.writeUInt16LE(BANDERA_UTF8, 6);
    cabeceraLocal.writeUInt16LE(METODO_ALMACENADO, 8);
    cabeceraLocal.writeUInt16LE(hora, 10);
    cabeceraLocal.writeUInt16LE(fecha, 12);
    cabeceraLocal.writeUInt32LE(suma, 14);
    // Sin comprimir, los dos tamaños son el mismo. Es lo que hace que un lector
    // pueda saltar de entrada en entrada sin descomprimir nada.
    cabeceraLocal.writeUInt32LE(datos.length, 18);
    cabeceraLocal.writeUInt32LE(datos.length, 22);
    cabeceraLocal.writeUInt16LE(nombre.length, 26);
    cabeceraLocal.writeUInt16LE(0, 28);

    locales.push(cabeceraLocal, nombre, datos);

    const cabeceraCentral = Buffer.alloc(46);
    cabeceraCentral.writeUInt32LE(FIRMA_CENTRAL, 0);
    cabeceraCentral.writeUInt16LE(VERSION, 4);
    cabeceraCentral.writeUInt16LE(VERSION, 6);
    cabeceraCentral.writeUInt16LE(BANDERA_UTF8, 8);
    cabeceraCentral.writeUInt16LE(METODO_ALMACENADO, 10);
    cabeceraCentral.writeUInt16LE(hora, 12);
    cabeceraCentral.writeUInt16LE(fecha, 14);
    cabeceraCentral.writeUInt32LE(suma, 16);
    cabeceraCentral.writeUInt32LE(datos.length, 20);
    cabeceraCentral.writeUInt32LE(datos.length, 24);
    cabeceraCentral.writeUInt16LE(nombre.length, 28);
    // Sin campos extra, sin comentario, sin disco, sin atributos: un archivo
    // suelto dentro de un contenedor, que es todo lo que esto necesita ser.
    cabeceraCentral.writeUInt32LE(desplazamiento, 42);

    central.push(cabeceraCentral, nombre);
    desplazamiento += cabeceraLocal.length + nombre.length + datos.length;
  }

  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(FIRMA_FIN, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([...locales, directorio, fin]);
}
