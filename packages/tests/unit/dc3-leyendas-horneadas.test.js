import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { extractDc3Legends, generateDc3Document } from "../../dc3/pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "../../dc3/pdf/leyendas-oficiales.js";
import { sumarDiasIso } from "../../dc3/fechas.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BORRADOR = resolve(
  RAIZ,
  "referencias/Software Administración de Curs y Cap/DC-3_KCM_Formato_Oficial_Lleno.xlsx"
);

test("las leyendas horneadas cubren todos los campos que el formato imprime", () => {
  for (const clave of ["title", "workerSection", "employerSection", "programSection", "formId"]) {
    assert.equal(typeof LEYENDAS_DC3[clave], "string");
    assert.notEqual(LEYENDAS_DC3[clave].trim(), "");
  }
  assert.equal(LEYENDAS_DC3.formId, "DC-3");
  assert.deepEqual([...LEYENDAS_DC3.taxId], [..."KCM810226-DEA"]);
});

test("coinciden con el borrador oficial cuando esta presente", { skip: !existsSync(BORRADOR) }, () => {
  const delBorrador = extractDc3Legends(readFileSync(BORRADOR));
  for (const [clave, valor] of Object.entries(delBorrador)) {
    if (clave === "employerName") {
      assert.notEqual(LEYENDAS_DC3.employerName, valor);
      assert.match(LEYENDAS_DC3.employerName, /^KIMBERLY CLARK DE MÉXICO/);
      continue;
    }
    if (Array.isArray(valor)) {
      assert.deepEqual([...LEYENDAS_DC3[clave]], valor, `cambio el arreglo ${clave}`);
      continue;
    }
    if (valor && typeof valor === "object") {
      assert.deepEqual({ ...LEYENDAS_DC3[clave] }, valor, `cambio el objeto ${clave}`);
      continue;
    }
    assert.equal(LEYENDAS_DC3[clave], valor, `cambio la leyenda ${clave}`);
  }
  assert.deepEqual(Object.keys(LEYENDAS_DC3).sort(), Object.keys(delBorrador).sort());
});

test("la constancia no arrastra el reverso de consulta del formato", () => {
  const pdf = generateDc3Document({
    workerName: "PERSONA DE PRUEBA UNO",
    curp: "XEXX010101HNEXXXA4",
    position: "PUESTO DE PRUEBA",
    occupation: "0000",
    courseName: "CURSO DE PRUEBA",
    durationHours: 4,
    startDate: "2026-01-15",
    endDate: "2026-01-15",
    thematicArea: "3132-Recursos humanos",
    trainingAgent: "AGENTE DE PRUEBA"
  });
  const impreso = pdf.toString("latin1");
  assert.match(impreso, /%PDF-1\.4/);
  for (const prohibido of [/CLAVES Y DENOMINACIONES/i, /Cultivo, crianza/i, /\bANVERSO\b/i]) {
    assert.doesNotMatch(impreso, prohibido);
  }
});

test("el periodo de la induccion cierra dos dias despues del alta", () => {
  assert.equal(sumarDiasIso("2026-08-23", 2), "2026-08-25");
  assert.equal(sumarDiasIso("2026-12-31", 2), "2027-01-02");
  assert.equal(sumarDiasIso("2026-08-23", 0), "2026-08-23");
  assert.equal(sumarDiasIso("", 2), "");
});
