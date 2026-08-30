import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { extractDc3Legends, generateDc3Document } from "../../dc3/pdf/dc3-document.js";
import { LEYENDAS_DC3 } from "../../dc3/pdf/leyendas-oficiales.js";
import { planDc3Documents } from "../../dc3/planner.js";

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
  // Trece recuadros: el RFC moral son doce caracteres y el borrador imprime un guion antes de la
  // homoclave. Se fija aqui porque es un dato del patron que sale en todas las constancias, no una
  // etiqueta, y un cambio silencioso ahi invalidaria el lote entero.
  assert.deepEqual([...LEYENDAS_DC3.taxId], [..."KCM810226-DEA"]);
});

// El borrador oficial esta ignorado por Git y no existe en ningun servidor. Esta comparacion corre
// donde alguien lo tenga a mano y avisa si el formato oficial cambio; donde no esta, se salta. Es
// deliberado: emitir constancias no puede depender de un archivo que no viaja, pero tampoco quiero
// que un cambio en el formato pase inadvertido para quien si puede verlo.
test("coinciden con el borrador oficial cuando esta presente", { skip: !existsSync(BORRADOR) }, () => {
  const delBorrador = extractDc3Legends(readFileSync(BORRADOR));
  for (const [clave, valor] of Object.entries(delBorrador)) {
    // Unica diferencia declarada: el borrador escribe la razon social con errata y aqui va
    // corregida. Se comprueba que sigan siendo distintas, para que nadie "arregle" la horneada
    // copiandola del borrador sin darse cuenta.
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

// El reverso del formato oficial son los dos catalogos del CNO: material de consulta, no parte de la
// constancia que se entrega. Antes esto solo podia comprobarse donde estuviera el borrador; ahora
// que las leyendas viven en el codigo, se comprueba siempre.
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

// La induccion son doce horas repartidas en tres jornadas: la constancia declara un periodo de tres
// dias, no un dia suelto. El resto de los cursos empieza y termina el mismo dia.
test("el periodo de la induccion cierra dos dias despues del alta", () => {
  const config = {
    schemaVersion: "DC3_CONFIG_V1",
    cutoffDate: "2026-01-01",
    courses: [
      {
        courseId: "INDUCCION_EMPRESA",
        source: { kind: "ACTIVE_HIRE_DATE" },
        dc3Name: "INDUCCIÓN A LA EMPRESA",
        durationHours: 12,
        thematicArea: "3132-Recursos humanos",
        trainingAgent: "AGENTE DE PRUEBA",
        endDateOffsetDays: 2
      },
      {
        courseId: "QMS",
        source: { kind: "HC_COURSE", normalizedNames: ["QMS"] },
        dc3Name: "QMS",
        durationHours: 1,
        thematicArea: "3131-Apoyo a la calidad",
        trainingAgent: "AGENTE DE PRUEBA"
      }
    ]
  };
  const snapshot = {
    schemaVersion: "HC_SNAPSHOT_V1",
    employees: [{ employeeId: "1001", displayName: "PERSONA UNO", hireDate: "2026-08-23" }],
    courses: [{ sourceKey: "hc-course:qms", normalizedName: "QMS", displayName: "QMS" }],
    completions: [{ employeeId: "1001", sourceKey: "hc-course:qms", completionDate: "2026-08-23" }]
  };
  const roster = {
    schemaVersion: "DC3_ACTIVE_ROSTER_V1",
    source: { sha256: "0".repeat(64) },
    employees: [{
      employeeId: "1001",
      displayName: "PERSONA UNO",
      curp: "XEXX010101HNEXXXA4",
      position: "PUESTO",
      hireDate: "2026-08-23",
      issues: []
    }],
    diagnostics: { readyEmployeeCount: 1, issues: {} }
  };

  const plan = planDc3Documents({ snapshot, roster, config });
  const induccion = plan.documents.find((d) => d.courseId === "INDUCCION_EMPRESA");
  const qms = plan.documents.find((d) => d.courseId === "QMS");

  assert.equal(induccion.data.startDate, "2026-08-23");
  assert.equal(induccion.data.endDate, "2026-08-25");
  // Sin desplazamiento declarado, inicio y fin son el mismo dia.
  assert.equal(qms.data.startDate, "2026-08-23");
  assert.equal(qms.data.endDate, "2026-08-23");
});
