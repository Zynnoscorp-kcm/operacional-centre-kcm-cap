import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { componerConstanciaDc3 } from "../../../packages/dc3/pdf/dc3-document.js";
import { PdfPage, buildPdf } from "../../src/web/pdf/escritor.ts";
import type { ImagenParaPdf } from "../../src/web/pdf/imagenes.ts";
import { componerRelacionDc3 } from "../../src/web/pdf/relacion-dc3.ts";

const IMAGEN: ImagenParaPdf = {
  width: 2,
  height: 2,
  components: 3,
  filter: "FlateDecode",
  data: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
};

function paginaConImagen(): PdfPage {
  const pagina = new PdfPage();
  pagina.image(IMAGEN, { x: 10, y: 10, width: 20, height: 20 });
  return pagina;
}

function cuantas(bytes: Buffer, patron: RegExp): number {
  return [...bytes.toString("latin1").matchAll(patron)].length;
}

const DATOS = {
  workerName: "TRABAJADOR SINTETICO",
  curp: "SINT800101HDFXXX01",
  position: "PUESTO SINTETICO",
  employerName: "PATRON SINTETICO",
  occupation: "",
  courseName: "QMS",
  durationHours: 1,
  startDate: "2026-07-30",
  endDate: "2026-07-30",
  thematicArea: "3131-Apoyo a la calidad",
  trainingAgent: "AGENTE SINTETICO",
};

describe("DC-3 · el PDF de una tanda", () => {
  it("la misma imagen en varias hojas se guarda una vez cuando se pide", () => {
    const paginas = [paginaConImagen(), paginaConImagen(), paginaConImagen()];
    const compartido = buildPdf({ pages: paginas, date: "2026-08-06", compartirImagenes: true });
    const repetido = buildPdf({ pages: paginas, date: "2026-08-06" });

    assert.equal(cuantas(compartido, /\/Subtype \/Image/gu), 1);
    assert.equal(cuantas(repetido, /\/Subtype \/Image/gu), 3);
  });

  it("sin pedirlo, un documento de una hoja no cambia", () => {
    const pagina = paginaConImagen();
    assert.deepEqual(
      [...buildPdf({ pages: [pagina], date: "2026-08-06", compartirImagenes: true })],
      [...buildPdf({ pages: [pagina], date: "2026-08-06" })],
    );
  });

  it("los recuadros escribibles de cada constancia son campos distintos", () => {
    const paginas = [1, 2].map(
      (n) =>
        componerConstanciaDc3(DATOS, {
          allowBlank: true,
          editable: true,
          prefijoDeCampos: `c${String(n)}_`,
        }).page,
    );
    const pdf = buildPdf({ pages: paginas, date: "2026-08-06" }).toString("latin1");

    assert.match(pdf, /\/T \(c1_occupation\)/u);
    assert.match(pdf, /\/T \(c2_occupation\)/u);
    assert.doesNotMatch(pdf, /\/T \(occupation\)/u);
  });

  it("la hoja de entrega se parte en hojas y dice cuántas son", () => {
    const renglones = Array.from({ length: 58 }, (_, i) => ({
      workerNumber: String(10000 + i),
      workerName: `TRABAJADOR SINTETICO ${String(i)}`,
      area: "AREA SINTETICA",
      courseLabel: "QMS",
      completionDate: "2026-07-30",
      partial: i === 0,
    }));
    const hojas = componerRelacionDc3(renglones, { fecha: "2026-08-06", actor: "Maricela0000" });
    const pdf = buildPdf({ pages: hojas, date: "2026-08-06" }).toString("latin1");

    assert.equal(hojas.length, 3);
    assert.match(pdf, /Hoja 1 de 3/u);
    assert.match(pdf, /Hoja 3 de 3/u);
    assert.match(pdf, /emitidas el 6 de agosto de 2026 por Maricela0000/u);
    assert.equal(cuantas(Buffer.from(pdf, "latin1"), /Sale con alg\\372n recuadro en blanco/gu), 1);
  });
});
