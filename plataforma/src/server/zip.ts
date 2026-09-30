import { crc32 } from "node:zlib";

export interface ArchivoDelZip {
  readonly nombre: string;
  readonly contenido: Uint8Array;
}

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

const VERSION = 20;
const BANDERA_UTF8 = 0x0800;
const METODO_ALMACENADO = 0;

function fechaDos(cuando: Date): { fecha: number; hora: number } {
  const anio = cuando.getFullYear();
  if (anio < 1980) return { fecha: (1 << 5) | 1, hora: 0 };
  return {
    fecha: ((anio - 1980) << 9) | ((cuando.getMonth() + 1) << 5) | cuando.getDate(),
    hora:
      (cuando.getHours() << 11) | (cuando.getMinutes() << 5) | Math.floor(cuando.getSeconds() / 2),
  };
}

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
