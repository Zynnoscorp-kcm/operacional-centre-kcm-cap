/**
 * El empaquetador ZIP, byte a byte.
 *
 * Es código que escribe un formato binario a mano, así que la prueba no puede
 * limitarse a «no lanzó excepción»: un ZIP mal formado se abre igual en algunos
 * lectores y se rompe en el de Windows, que es justo el que va a usar el
 * departamento. Lo que se fija aquí son las tres estructuras del formato, el
 * CRC de cada entrada y que el contenido sale intacto, porque dentro van
 * constancias que alguien va a imprimir y entregar.
 */

import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { describe, it } from "node:test";

import { empaquetarZip } from "../../src/server/zip.ts";

const UNO = Buffer.from("%PDF-1.4 constancia uno\n", "utf8");
const DOS = Buffer.from("%PDF-1.4 constancia dos\n", "utf8");

/** Lee el directorio central, que es por donde un lector real entra al archivo. */
function finDelDirectorio(zip: Buffer): { entradas: number; tamano: number; inicio: number } {
  const fin = zip.length - 22;
  assert.equal(zip.readUInt32LE(fin), 0x06054b50, "falta el fin del directorio central");
  return {
    entradas: zip.readUInt16LE(fin + 10),
    tamano: zip.readUInt32LE(fin + 12),
    inicio: zip.readUInt32LE(fin + 16),
  };
}

describe("ZIP · el empaquetador de tandas", () => {
  it("escribe las tres estructuras del formato y cuenta bien las entradas", () => {
    const zip = empaquetarZip([
      { nombre: "DC3-10001-QMS.pdf", contenido: UNO },
      { nombre: "DC3-10002-LOTO.pdf", contenido: DOS },
    ]);

    // Firma local de la primera entrada, al principio del archivo.
    assert.equal(zip.readUInt32LE(0), 0x04034b50);

    const fin = finDelDirectorio(zip);
    assert.equal(fin.entradas, 2);
    // El directorio central empieza donde dice el fin, y ahí está su firma.
    assert.equal(zip.readUInt32LE(fin.inicio), 0x02014b50);
    assert.equal(fin.inicio + fin.tamano + 22, zip.length, "el archivo no cuadra con su índice");
  });

  it("guarda cada archivo sin comprimir y con su CRC", () => {
    const zip = empaquetarZip([{ nombre: "uno.pdf", contenido: UNO }]);

    // Método 0: almacenado. Un PDF ya viene comprimido.
    assert.equal(zip.readUInt16LE(8), 0);
    assert.equal(zip.readUInt32LE(14), crc32(UNO));
    // Sin comprimir, los dos tamaños son el mismo.
    assert.equal(zip.readUInt32LE(18), UNO.length);
    assert.equal(zip.readUInt32LE(22), UNO.length);

    const nombre = zip.readUInt16LE(26);
    const datos = zip.subarray(30 + nombre, 30 + nombre + UNO.length);
    assert.deepEqual(datos, UNO, "el contenido no sale intacto");
  });

  it("marca los nombres como UTF-8, que es lo que los acentos necesitan", () => {
    const zip = empaquetarZip([{ nombre: "constancia-ñ.pdf", contenido: UNO }]);
    // Bit 11 de la bandera: sin él, Windows lee el nombre como Latin-1.
    assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
    assert.match(zip.toString("utf8"), /constancia-ñ\.pdf/u);
  });

  it("un archivo vacío sigue siendo un ZIP legible", () => {
    const zip = empaquetarZip([]);
    assert.equal(zip.length, 22);
    assert.equal(finDelDirectorio(zip).entradas, 0);
  });

  it("no escribe fechas que el formato no sabe representar", () => {
    // MS-DOS no tiene años anteriores a 1980; un reloj mal puesto no puede
    // producir un archivo corrupto.
    const zip = empaquetarZip([{ nombre: "uno.pdf", contenido: UNO }], new Date("1970-01-01"));
    assert.equal(zip.readUInt16LE(12), (1 << 5) | 1);
    assert.equal(zip.readUInt16LE(10), 0);
  });
});
