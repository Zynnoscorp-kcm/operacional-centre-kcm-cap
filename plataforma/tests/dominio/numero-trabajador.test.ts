import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InvalidWorkerNumberError,
  isWorkerNumber,
  parseWorkerNumber,
  tryParseWorkerNumber,
} from "../../src/domain/comun/numero-trabajador.ts";

describe("número de trabajador", () => {
  it("acepta exactamente cinco dígitos como texto", () => {
    assert.equal(isWorkerNumber("00001"), true);
    assert.equal(isWorkerNumber("41988"), true);
    assert.equal(isWorkerNumber("99999"), true);
  });

  it("conserva los ceros a la izquierda: 01234 y 1234 no son la misma persona", () => {
    const numero = parseWorkerNumber("01234");
    assert.equal(numero, "01234");
    assert.equal(numero.length, 5);
    assert.equal(typeof numero, "string");
    assert.notEqual(numero, String(Number("01234")));
  });

  it("rechaza un número aunque sus dígitos sean los correctos", () => {
    assert.equal(isWorkerNumber(41988), false);
    assert.throws(() => parseWorkerNumber(41988), InvalidWorkerNumberError);
  });

  it("rechaza longitudes distintas de cinco", () => {
    for (const valor of ["", "1", "1234", "123456"]) {
      assert.equal(isWorkerNumber(valor), false, `debió rechazar ${JSON.stringify(valor)}`);
    }
  });

  it("rechaza lo que no sean dígitos, incluidos espacios y signos", () => {
    for (const valor of ["0123a", " 1234", "1234 ", "12-34", "+1234", "1.234", "١٢٣٤٥"]) {
      assert.equal(isWorkerNumber(valor), false, `debió rechazar ${JSON.stringify(valor)}`);
    }
  });

  it("no repara por adivinanza: no recorta espacios ni rellena con ceros", () => {
    assert.equal(tryParseWorkerNumber(" 1234"), null);
    assert.equal(tryParseWorkerNumber("1234"), null);
  });

  it("rechaza tipos que no son texto sin lanzar por otra causa", () => {
    for (const valor of [null, undefined, {}, [], true, Symbol("x")]) {
      assert.equal(tryParseWorkerNumber(valor), null);
    }
  });

  it("el mensaje de rechazo no reproduce el valor recibido", () => {
    const error = capturar(() => parseWorkerNumber("012345"));
    assert.ok(error instanceof InvalidWorkerNumberError);
    assert.ok(!error.message.includes("012345"), `el mensaje filtró el valor: ${error.message}`);
    assert.match(error.message, /longitud 6/u);
  });

  it("expone un código estable para que la capa web lo traduzca", () => {
    const error = capturar(() => parseWorkerNumber("abc"));
    assert.ok(error instanceof InvalidWorkerNumberError);
    assert.equal(error.code, "NUMERO_TRABAJADOR_INVALIDO");
  });
});

function capturar(accion: () => unknown): unknown {
  try {
    accion();
  } catch (error) {
    return error;
  }
  throw new Error("se esperaba un error y no lo hubo");
}
