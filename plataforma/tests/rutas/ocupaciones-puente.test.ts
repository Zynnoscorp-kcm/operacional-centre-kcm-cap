/**
 * «Clasificar faltantes» por el puente de Excel, de punta a punta: un padrón
 * sintético pasa por el extractor de siempre, el plan dice dónde escribir, y el
 * lote avanza paso a paso —como lo llama Excel— hasta devolver una fila por caso.
 * Los modelos son de mentira; todo lo demás es el código de producción.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-expect-error módulo JavaScript sin definiciones de tipos
import { buildZip } from "../../../packages/dc3/ooxml.js";
import { RosterExtractorAdapter } from "../../src/adapters/archivos/extractor-padron.ts";
import { MemoryExcelRepository } from "../../src/adapters/memoria/excel.ts";
import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import { ExcelIntegrationService } from "../../src/domain/excel/integracion.ts";
import { catalogoDeLaPlataforma } from "../../src/domain/ocupaciones/catalogo.ts";
import { ClasificadorPorLotes } from "../../src/domain/ocupaciones/lote.ts";
import { PuertaDeOcupaciones } from "../../src/domain/ocupaciones/puerta.ts";
import type {
  ModeloDeLenguajePort,
  RespuestaJson,
  SolicitudJson,
} from "../../src/ports/modelo-de-lenguaje.port.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";

const armarZip = buildZip as (entradas: readonly (readonly [string, string])[]) => Buffer;
const INSTANTE = "2026-09-26T12:00:00.000Z";
const reloj: Clock = { now: () => new Date(INSTANTE), nowIso: () => INSTANTE };

// --------------------------------------------------------- el libro sintético

function celda(referencia: string, valor: string): string {
  return `<c r="${referencia}" t="inlineStr"><is><t>${valor}</t></is></c>`;
}

interface Fila {
  readonly numero: string;
  readonly puesto: string;
  readonly centro: string;
  readonly clave?: string;
}

function hojaDeActivos(filas: readonly Fila[], conClave: boolean): string {
  const encabezados = [
    celda("A1", "NUMERO"),
    celda("B1", "NOMBRE"),
    celda("C1", "NOMBRE DE PUESTO"),
    celda("E1", "C.U.R.P."),
    celda("G1", "FEC ALTA"),
    celda("I1", "NOMBRE  C COSTOS"),
    ...(conClave ? [celda("Q1", "CLAVE DE OCUPACION")] : []),
  ];
  const cuerpo = filas.map((fila, indice) => {
    const n = String(indice + 2);
    return `<row r="${n}">${[
      celda(`A${n}`, fila.numero),
      celda(`B${n}`, "APELLIDO,APELLIDO,NOMBRE"),
      celda(`C${n}`, fila.puesto),
      celda(`E${n}`, "AAAA000101HDFBBBB0"),
      celda(`G${n}`, "2026-01-15"),
      celda(`I${n}`, fila.centro),
      ...(conClave && fila.clave ? [celda(`Q${n}`, fila.clave)] : []),
    ].join("")}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData><row r="1">${encabezados.join("")}</row>${cuerpo.join("")}</sheetData>
    </worksheet>`;
}

function padron(snd: readonly Fila[], emp: readonly Fila[]): Buffer {
  const hojas = ["SND ACTIVOS", "EMP ACTIVOS"];
  return armarZip([
    [
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>${hojas
            .map(
              (nombre, i) =>
                `<sheet name="${nombre}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
            )
            .join("")}</sheets>
        </workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          ${hojas
            .map(
              (_, i) =>
                `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
            )
            .join("")}
        </Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", hojaDeActivos(snd, true)],
    ["xl/worksheets/sheet2.xml", hojaDeActivos(emp, false)],
  ]);
}

const PADRON = padron(
  [
    { numero: "28392", puesto: "*OPERADOR", centro: "AGUA", clave: "552081900" },
    { numero: "28418", puesto: "*OPERADOR", centro: "TOALLAS (CONVERSION)" },
    { numero: "28425", puesto: "*OPERADOR", centro: "TOALLAS (CONVERSION)" },
    { numero: "28431", puesto: "*OPERARIO 1°", centro: "HIGIENICOS" },
    // Texto que no es clave: alguien lo escribió, así que no se trata como vacío.
    { numero: "28440", puesto: "*MECANICO", centro: "MAQUINA 5", clave: "PENDIENTE DE ASIGNACION" },
  ],
  [{ numero: "17981", puesto: "JEFE DE TURNO", centro: "MAQUINA WADDING 05" }],
);

// --------------------------------------------------------- modelo y puente

class ModeloSencillo implements ModeloDeLenguajePort {
  readonly nombre: string;
  llamadas = 0;
  constructor(nombre: string) {
    this.nombre = nombre;
  }
  responderJson(solicitud: SolicitudJson): Promise<RespuestaJson> {
    this.llamadas += 1;
    const ids = [...solicitud.mensaje.matchAll(/^(C\d{3}) \| /gmu)].map((m) => m[1] ?? "");
    const resultados =
      solicitud.esquema.nombre === "subareas_en_lote"
        ? ids.map((id) => ({ id, subareas: ["05.5"], motivo: "papel" }))
        : ids.map((id) => ({
            id,
            codigo: "552081900",
            alternativa: "552090402",
            confianza: "alta",
            motivo: "opera la máquina",
          }));
    return Promise.resolve({
      datos: { resultados },
      proveedor: "prueba",
      modelo: this.nombre,
      tokensDeEntrada: 1,
      tokensDeSalida: 1,
      milisegundos: 1,
      desvios: [],
    });
  }
}

async function puente(conAgente = true, casosPorCorrida = 30) {
  const principal = new ModeloSencillo("principal");
  const lotes = new ClasificadorPorLotes({
    catalogo: catalogoDeLaPlataforma(),
    principal,
    verificador: new ModeloSencillo("verificador"),
    limites: {
      casosPorCorrida,
      casosPorTandaDeSubarea: 20,
      casosPorTandaDeOcupacion: 6,
      tandasEnParaleloPorPapel: 2,
      maxSubareas: 2,
      maxOpciones: 260,
      intentosPorCaso: 2,
      fallasSeguidasPorPapel: 3,
      tandasFallidasPorCaso: 4,
      esperaTrasFallaMs: 0,
      tiempoPorPasoMs: 95_000,
      tiempoMinimoPorTandaMs: 0,
      limiteDePasos: 200,
    },
    version: "v",
    huella: "h",
  });
  const extractor = new RosterExtractorAdapter();
  const service = new ExcelIntegrationService({
    repository: new MemoryExcelRepository({ clock: reloj }),
    matrixRepository: new MemoryMatrixRepository(),
    clock: reloj,
    ...(conAgente
      ? {
          ocupaciones: () =>
            Promise.resolve(
              new PuertaDeOcupaciones({
                extraer: (a) => extractor.extraer(a),
                lotes,
                casosPorCorrida,
              }),
            ),
        }
      : {}),
  });
  const { secret } = await service.issueCredential({
    clientId: "KCM-OFFICE-01",
    principal: "usuario.sintetico",
    windowsProfile: "perfil-sintetico",
    equipment: "equipo-sintetico",
    scope: "PUENTE_VBA",
    resource: "bridge",
    expiresAt: "2026-09-27T12:00:00.000Z",
  });
  let nonce = 0;
  const llamar = async (action: "OCCUPATION_PLAN_V1" | "OCCUPATION_STEP_V1", carga: string) => {
    nonce += 1;
    const texto = await service.handleBridge({
      action,
      clientId: "KCM-OFFICE-01",
      requestId: `vba-ocupaciones-${String(nonce)}`,
      sentAt: INSTANTE,
      nonce: `nonce-${String(nonce)}`,
      credential: secret,
      payload: Buffer.from(carga).toString("base64url"),
    });
    const [, estado, ...pares] = texto.split("\n");
    const campos: Record<string, string> = { estado: estado ?? "" };
    for (const par of pares) {
      const corte = par.indexOf("=");
      campos[par.slice(0, corte)] = decodeURIComponent(par.slice(corte + 1));
    }
    return campos;
  };
  return { llamar, principal };
}

const sobre = JSON.stringify({ fileName: "sem 32 CAP.xlsx", content: PADRON.toString("base64") });

function tabla(campo: string | undefined): Record<string, string>[] {
  const [encabezado = "", ...filas] = Buffer.from(campo ?? "", "base64url")
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  const nombres = encabezado.split("\t").map(decodeURIComponent);
  return filas.map((fila) => {
    const valores = fila.split("\t").map(decodeURIComponent);
    return Object.fromEntries(nombres.map((nombre, i) => [nombre, valores[i] ?? ""]));
  });
}

describe("Ocupaciones · «Clasificar faltantes» por el puente", () => {
  it("planea con el extractor de siempre: faltantes, casos y la celda de cada uno", async () => {
    const { llamar } = await puente();
    const plan = await llamar("OCCUPATION_PLAN_V1", sobre);

    assert.equal(plan.estado, "OK");
    assert.equal(plan.cases, "2");
    assert.equal(plan.rows, "3");
    assert.equal(plan.withKey, "1");
    assert.equal(plan.withText, "1");
    assert.equal(plan.sheetsWithoutColumn, "EMP ACTIVOS");
    assert.equal(plan.pendingCases, "0");
    assert.equal(plan.pendingRows, "0");
    assert.deepEqual(tabla(plan.payload), [
      {
        hoja: "SND ACTIVOS",
        fila: "3",
        numero: "28418",
        columna: "Q",
        columnaNumero: "A",
        caso: "C001",
      },
      {
        hoja: "SND ACTIVOS",
        fila: "4",
        numero: "28425",
        columna: "Q",
        columnaNumero: "A",
        caso: "C001",
      },
      {
        hoja: "SND ACTIVOS",
        fila: "5",
        numero: "28431",
        columna: "Q",
        columnaNumero: "A",
        caso: "C002",
      },
    ]);
    // El estado del lote no lleva nombres, CURP ni números de trabajador.
    assert.doesNotMatch(plan.lote ?? "", /APELLIDO|AAAA000101|28418|28425|28431/u);
  });

  it("avanza por pasos hasta terminar y devuelve una fila por caso", async () => {
    const { llamar } = await puente();
    const plan = await llamar("OCCUPATION_PLAN_V1", sobre);
    let lote = plan.lote ?? "";
    let paso: Record<string, string> = {};
    for (let vuelta = 0; vuelta < 10; vuelta += 1) {
      paso = await llamar("OCCUPATION_STEP_V1", lote);
      assert.equal(paso.estado, "OK");
      lote = paso.lote ?? "";
      if (paso.done === "true") break;
    }
    assert.equal(paso.done, "true");
    const resultados = tabla(paso.payload);
    assert.deepEqual(
      resultados.map((fila) => [fila.caso, fila.estado, fila.codigo, fila.subarea]),
      [
        ["C001", "sugerida", "552081900", "05.5 Materia orgánica"],
        ["C002", "sugerida", "552081900", "05.5 Materia orgánica"],
      ],
    );
    assert.equal(resultados[0]?.alternativa, "552090402 OPERADOR DE MÁQUINA DE FABRICAR PAPEL");
    assert.equal(resultados[0]?.descripcion, "OPERADOR MÁQUINA FABRICACIÓN ARTÍCULOS PAPEL");
  });

  it("lo que no cabe en la corrida se queda sin tocar y se cuenta", async () => {
    const { llamar } = await puente(true, 1);
    const plan = await llamar("OCCUPATION_PLAN_V1", sobre);

    assert.equal(plan.cases, "1");
    assert.equal(plan.rows, "2");
    assert.equal(plan.pendingCases, "1");
    assert.equal(plan.pendingRows, "1");
    // Entra el caso con más trabajadores; el renglón del otro no viaja a Excel.
    assert.deepEqual(
      tabla(plan.payload).map((fila) => [fila.fila, fila.caso]),
      [
        ["3", "C001"],
        ["4", "C001"],
      ],
    );
  });

  it("un archivo que no es el padrón se rechaza con el motivo, sin reintento", async () => {
    const { llamar, principal } = await puente();
    const plan = await llamar(
      "OCCUPATION_PLAN_V1",
      JSON.stringify({
        fileName: "sem 32 CAP.xlsx",
        content: Buffer.from("no es un libro").toString("base64"),
      }),
    );
    assert.equal(plan.estado, "ERROR");
    assert.equal(plan.code, "INVALID_ROSTER_FILE");
    assert.equal(plan.retryable, "false");
    assert.equal(principal.llamadas, 0);
  });

  it("sin llave de proveedor lo dice, sin intentar nada", async () => {
    const { llamar } = await puente(false);
    const plan = await llamar("OCCUPATION_PLAN_V1", sobre);
    assert.equal(plan.estado, "ERROR");
    assert.equal(plan.code, "EXCEL_OCUPACIONES_APAGADAS");
  });

  it("un estado alterado con un dato personal se rechaza antes de llegar a un modelo", async () => {
    const { llamar, principal } = await puente();
    const plan = await llamar("OCCUPATION_PLAN_V1", sobre);
    const alterado = (plan.lote ?? "").replace("*OPERARIO 1°", "28431");
    const paso = await llamar("OCCUPATION_STEP_V1", alterado);
    assert.equal(paso.estado, "ERROR");
    assert.equal(paso.code, "CASO_CON_DATO_PERSONAL");
    assert.equal(principal.llamadas, 0);
  });
});
