import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { describe, it } from "node:test";

import { empaquetarZip } from "../../src/server/zip.ts";

const UNO = Buffer.from("%PDF-1.4 constancia uno\n", "utf8");
const DOS = Buffer.from("%PDF-1.4 constancia dos\n", "utf8");

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

    assert.equal(zip.readUInt32LE(0), 0x04034b50);

    const fin = finDelDirectorio(zip);
    assert.equal(fin.entradas, 2);
    assert.equal(zip.readUInt32LE(fin.inicio), 0x02014b50);
    assert.equal(fin.inicio + fin.tamano + 22, zip.length, "el archivo no cuadra con su índice");
  });

  it("guarda cada archivo sin comprimir y con su CRC", () => {
    const zip = empaquetarZip([{ nombre: "uno.pdf", contenido: UNO }]);

    assert.equal(zip.readUInt16LE(8), 0);
    assert.equal(zip.readUInt32LE(14), crc32(UNO));
    assert.equal(zip.readUInt32LE(18), UNO.length);
    assert.equal(zip.readUInt32LE(22), UNO.length);

    const nombre = zip.readUInt16LE(26);
    const datos = zip.subarray(30 + nombre, 30 + nombre + UNO.length);
    assert.deepEqual(datos, UNO, "el contenido no sale intacto");
  });

  it("marca los nombres como UTF-8, que es lo que los acentos necesitan", () => {
    const zip = empaquetarZip([{ nombre: "constancia-ñ.pdf", contenido: UNO }]);
    assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
    assert.match(zip.toString("utf8"), /constancia-ñ\.pdf/u);
  });

  it("un archivo vacío sigue siendo un ZIP legible", () => {
    const zip = empaquetarZip([]);
    assert.equal(zip.length, 22);
    assert.equal(finDelDirectorio(zip).entradas, 0);
  });

  it("no escribe fechas que el formato no sabe representar", () => {
    const zip = empaquetarZip([{ nombre: "uno.pdf", contenido: UNO }], new Date("1970-01-01"));
    assert.equal(zip.readUInt16LE(12), (1 << 5) | 1);
    assert.equal(zip.readUInt16LE(10), 0);
  });
});
