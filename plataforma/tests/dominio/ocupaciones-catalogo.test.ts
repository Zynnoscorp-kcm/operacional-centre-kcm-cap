import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CatalogoDeOcupaciones,
  SUBAREAS_CNO,
  catalogoDeLaPlataforma,
  subareaDelCodigo,
} from "../../src/domain/ocupaciones/catalogo.ts";

describe("Ocupaciones · catálogo de la STPS", () => {
  const catalogo = catalogoDeLaPlataforma();

  it("trae las 4 737 ocupaciones del libro de la Secretaría", () => {
    assert.equal(catalogo.tamano, 4737);
    assert.match(catalogo.huella, /^[0-9a-f]{64}$/u);
  });

  it("usa las 55 subáreas del reverso del DC-3, y cada una tiene ocupaciones", () => {
    assert.equal(SUBAREAS_CNO.length, 55);
    for (const subarea of SUBAREAS_CNO) {
      assert.ok(catalogo.deSubarea(subarea.clave).length > 0, `${subarea.clave} quedó vacía`);
      assert.ok(subarea.denominacionDelArea, `${subarea.clave} no tiene área`);
    }
  });

  it("deriva la subárea del prefijo, con códigos de nueve y de diez dígitos", () => {
    assert.equal(subareaDelCodigo("552081900"), "05.5");
    assert.equal(subareaDelCodigo("413050300"), "04.1");
    assert.equal(subareaDelCodigo("1034070202"), "10.3");
    assert.equal(subareaDelCodigo("1134010300"), "11.3");
    assert.equal(subareaDelCodigo("55208190"), null);
    assert.equal(subareaDelCodigo("12345678901"), null);
  });

  it("la fabricación de papel cae en 05.5, Materia orgánica", () => {
    const papel = catalogo.ocupacion("552081900");
    assert.equal(papel?.descripcion, "OPERADOR MÁQUINA FABRICACIÓN ARTÍCULOS PAPEL");
    assert.equal(papel?.subarea, "05.5");
    assert.equal(catalogo.subarea("05.5")?.denominacion, "Materia orgánica");
  });

  it("deja escrito el homónimo: «INSTRUMENTISTA» del catálogo es un músico", () => {
    const instrumentista = catalogo.ocupacion("1034070202");
    assert.equal(instrumentista?.descripcion, "INSTRUMENTISTA");
    assert.equal(instrumentista?.subarea, "10.3");
    assert.equal(catalogo.subarea("10.3")?.denominacion, "Interpretación artística");
  });

  it("rechaza un archivo sin encabezado, con prefijo desconocido o con códigos repetidos", () => {
    const encabezado = "consecutivo\tcodigo\tdescripcion";
    assert.throws(() => CatalogoDeOcupaciones.desdeTexto("1\t552081900\tX\n"), /encabezado/u);
    assert.throws(
      () => CatalogoDeOcupaciones.desdeTexto(`${encabezado}\n1\t12345\tX\n`),
      /no es válida/u,
    );
    assert.throws(
      () => CatalogoDeOcupaciones.desdeTexto(`${encabezado}\n1\t552081900\tX\n2\t552081900\tY\n`),
      /dos veces/u,
    );
    assert.throws(() => CatalogoDeOcupaciones.desdeTexto(`# nada\n${encabezado}\n`), /vacío/u);
  });
});

describe("Ocupaciones · búsqueda en el catálogo", () => {
  const catalogo = catalogoDeLaPlataforma();

  it("no distingue acentos ni mayúsculas y exige todas las palabras", () => {
    const { total, ocupaciones } = catalogo.buscar({ texto: "instrumentos medicion", limite: 10 });
    assert.equal(total, 2);
    assert.deepEqual(
      ocupaciones.map((ocupacion) => ocupacion.codigo),
      ["413010300", "433010600"],
    );
  });

  it("busca por el comienzo de la clave y dentro de una subárea", () => {
    assert.equal(catalogo.buscar({ texto: "5520", limite: 5 }).total, 128);
    const convertidora = catalogo.buscar({ texto: "convertidora", subarea: "05.5", limite: 5 });
    assert.deepEqual(
      convertidora.ocupaciones.map((ocupacion) => ocupacion.codigo),
      ["552080300"],
    );
  });

  it("recorta a lo pedido pero cuenta todo", () => {
    const { total, ocupaciones } = catalogo.buscar({ subarea: "05.5", limite: 60 });
    assert.equal(total, 230);
    assert.equal(ocupaciones.length, 60);
  });
});
