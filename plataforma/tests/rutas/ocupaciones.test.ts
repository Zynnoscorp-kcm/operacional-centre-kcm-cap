/**
 * Ocupaciones: la API que conduce la clasificación caso por caso y la pantalla.
 *
 * El agente es un doble y ninguna prueba gasta cupo de un modelo. El padrón es
 * un XLSX sintético de verdad, leído por el mismo extractor que en producción:
 * el plan y la escritura dependen de las celdas reales del libro.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-expect-error paquete en JavaScript sin definiciones de tipos
import { buildZip } from "../../../packages/dc3/ooxml.js";
import { RosterExtractorAdapter } from "../../src/adapters/archivos/extractor-padron.ts";
import { loadConfig } from "../../src/config/environment.ts";
import type {
  ServicioDeOcupacionesPort,
  SugerenciaDeOcupacion,
} from "../../src/domain/ocupaciones/servicio.ts";
import { leerCaso } from "../../src/domain/ocupaciones/servicio.ts";
import { buildServer } from "../../src/server/build-server.ts";

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
} as const;

const servicioFalso: ServicioDeOcupacionesPort = {
  version: "prueba",
  huella: "0123456789abcdef",
  sugerir: (entrada: unknown): Promise<SugerenciaDeOcupacion> => {
    const caso = leerCaso(entrada);
    return Promise.resolve({
      caso,
      version: "prueba",
      huella: "0123456789abcdef",
      estado: "revisar",
      sugerencia: null,
      principal: null,
      verificador: null,
      razon: "prueba",
      traza: [],
    });
  },
};

describe("Ocupaciones · ruta", () => {
  async function servidor(conServicio: boolean) {
    return buildServer({
      config: loadConfig({ ...ENTORNO }),
      ...(conServicio ? { occupationService: () => Promise.resolve(servicioFalso) } : {}),
    });
  }

  async function sesion(app: Awaited<ReturnType<typeof servidor>>): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    });
    return String(res.headers["set-cookie"]).split(";")[0] ?? "";
  }

  it("nace cerrada: sin sesión de consola no llega al agente", async () => {
    const app = await servidor(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/ocupaciones/sugerir",
      payload: { puesto: "*OPERADOR", centroDeCostos: "AGUA" },
    });
    assert.ok(
      res.statusCode === 401 || res.statusCode === 303,
      `respondió ${String(res.statusCode)}`,
    );
  });

  it("sin llave de proveedor responde 503 y dice por qué", async () => {
    const app = await servidor(false);
    const cookie = await sesion(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/ocupaciones/sugerir",
      headers: { cookie },
      payload: { puesto: "*OPERADOR", centroDeCostos: "AGUA" },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json<{ error: { code: string } }>().error.code, "IA_SIN_CONFIGURAR");
  });

  it("con sesión y servicio devuelve la sugerencia con versión y huella", async () => {
    const app = await servidor(true);
    const cookie = await sesion(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/ocupaciones/sugerir",
      headers: { cookie },
      payload: { puesto: "*OPERADOR", centroDeCostos: "AGUA" },
    });
    assert.equal(res.statusCode, 200);
    const cuerpo = res.json<SugerenciaDeOcupacion>();
    assert.equal(cuerpo.version, "prueba");
    assert.equal(cuerpo.huella, "0123456789abcdef");
    assert.deepEqual(cuerpo.caso, { puesto: "*OPERADOR", centroDeCostos: "AGUA" });
  });

  it("un dato personal en el caso se rechaza con 400 antes de llegar a un modelo", async () => {
    const app = await servidor(true);
    const cookie = await sesion(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/ocupaciones/sugerir",
      headers: { cookie },
      payload: { puesto: "*OPERADOR", centroDeCostos: "AGUA", numero: "28392" },
    });
    assert.equal(res.statusCode, 400);
    assert.match(
      res.json<{ error: { message: string } }>().error.message,
      /sólo viajan puesto y centro de costos/u,
    );
  });
});

describe("Ocupaciones · pantalla", () => {
  async function pantalla(conServicio: boolean) {
    const app = await buildServer({
      config: loadConfig({ ...ENTORNO }),
      ...(conServicio ? { occupationService: () => Promise.resolve(servicioFalso) } : {}),
    });
    const cookie = await entrar(app);
    const abrir = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
    return { app, cookie, abrir };
  }

  it("dibuja la clasificación y el catálogo, sin la lista de pasos", async () => {
    const { abrir } = await pantalla(true);
    const res = await abrir("/ocupaciones");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="barra-titulo">Ocupaciones<\/h1>/u);
    assert.match(res.body, /href="\/ocupaciones"[^>]*aria-current="page"/u);
    assert.match(res.body, /IA disponible/u);
    assert.match(res.body, /<form class="formulario" id="form-clasificar">/u);
    assert.match(res.body, /4,737 ocupaciones del catálogo/u);
    assert.match(res.body, /<script src="\/assets\/ocupaciones-[a-z]+\.js"><\/script>/u);
    // La lista de «Cómo funciona» se quitó, y con ella la promesa de dos modelos.
    assert.doesNotMatch(res.body, /Cómo funciona|Flujo de clasificación|dos modelos/u);
    // Sin búsqueda no hay tabla de resultados.
    assert.doesNotMatch(res.body, /N\.º STPS/u);
  });

  it("la tarjeta de avance nace oculta sin estilos en línea, que la política bloquearía", async () => {
    const { abrir } = await pantalla(true);
    const res = await abrir("/ocupaciones");
    assert.match(String(res.headers["content-security-policy"]), /style-src 'self'/u);
    assert.match(res.body, /<div id="progreso-ia" class="[^"]*avance-ia[^"]*" hidden>/u);
    assert.match(
      res.body,
      /<button type="button" id="btn-cancelar" class="boton-secundario" hidden>/u,
    );
    assert.doesNotMatch(res.body, /\sstyle="/u);
  });

  it("busca sin acentos, por palabras, y dice cuántas coincidieron", async () => {
    const { abrir } = await pantalla(true);
    const res = await abrir("/ocupaciones?q=instrumentos+medicion");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /433010600/u);
    assert.match(res.body, /TÉCNICO EN INSTRUMENTOS DE MEDICIÓN/u);
    assert.match(res.body, /2 ocupaciones/u);
    assert.match(res.body, /value="instrumentos medicion"/u);
  });

  it("filtra por subárea, recorta a 60 y avisa del recorte", async () => {
    const { abrir } = await pantalla(true);
    const res = await abrir("/ocupaciones?subarea=05.5");
    assert.match(res.body, /Se muestran 60 de 230/u);
    assert.match(res.body, /<option value="05\.5" selected>/u);
    // Una subárea que no existe se ignora en vez de romper la pantalla.
    const rara = await abrir("/ocupaciones?subarea=99.9");
    assert.equal(rara.statusCode, 200);
    assert.doesNotMatch(rara.body, /Se muestran/u);
  });

  it("sin agente, la clasificación se apaga y el catálogo sigue buscando", async () => {
    const { app, cookie, abrir } = await pantalla(false);
    const res = await abrir("/ocupaciones?q=montacargas");
    assert.match(res.body, /IA apagada/u);
    assert.doesNotMatch(res.body, /id="form-clasificar"/u);
    assert.match(res.body, /MONTACARGAS/u);
    const plan = await app.inject({
      method: "POST",
      url: "/api/ocupaciones/plan",
      headers: { cookie, "content-type": multiparte(PADRON).tipo },
      payload: multiparte(PADRON).cuerpo,
    });
    assert.equal(plan.statusCode, 503);
  });
});

// --------------------------------------------------------- el padrón sintético

const armarZip = buildZip as (entradas: readonly (readonly [string, string])[]) => Buffer;

interface Renglon {
  readonly numero: string;
  readonly nombre: string;
  readonly puesto: string;
  readonly curp: string;
  readonly centro: string;
  readonly clave?: string;
}

const ENCABEZADOS = [
  "NUMERO",
  "NOMBRE",
  "NOMBRE DE PUESTO",
  "C.U.R.P.",
  "FEC ALTA",
  "NOMBRE C COSTOS",
  "CLAVE DE OCUPACION",
] as const;

function celda(referencia: string, valor: string): string {
  const seguro = valor.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<c r="${referencia}" t="inlineStr"><is><t>${seguro}</t></is></c>`;
}

function hoja(renglones: readonly Renglon[]): string {
  const fila = (numero: number, valores: readonly string[]) =>
    `<row r="${String(numero)}">${valores
      .map((valor, indice) =>
        valor === "" ? "" : celda(`${"ABCDEFG"[indice] ?? "Z"}${String(numero)}`, valor),
      )
      .join("")}</row>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[
      fila(1, ENCABEZADOS),
      ...renglones.map((renglon, indice) =>
        fila(indice + 2, [
          renglon.numero,
          renglon.nombre,
          renglon.puesto,
          renglon.curp,
          "2020-01-15",
          renglon.centro,
          renglon.clave ?? "",
        ]),
      ),
    ].join("")}</sheetData></worksheet>`;
}

function libro(hojas: Readonly<Record<string, readonly Renglon[]>>): Buffer {
  const nombres = Object.keys(hojas);
  return armarZip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        </Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        </Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>${nombres
            .map(
              (nombre, indice) =>
                `<sheet name="${nombre}" sheetId="${String(indice + 1)}" r:id="rId${String(indice + 1)}"/>`,
            )
            .join("")}</sheets>
        </workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nombres
          .map(
            (_, indice) =>
              `<Relationship Id="rId${String(indice + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(indice + 1)}.xml"/>`,
          )
          .join("")}</Relationships>`,
    ],
    ...nombres.map((nombre, indice): readonly [string, string] => [
      `xl/worksheets/sheet${String(indice + 1)}.xml`,
      hoja(hojas[nombre] ?? []),
    ]),
  ]);
}

/** Dos operarios de Higiénicos sin clave, un supervisor que ya la trae y un mecánico sin ella. */
const PADRON = libro({
  "SND ACTIVOS": [
    {
      numero: "00001",
      nombre: "PERSONA SINTETICA UNO",
      puesto: "*OPERARIO 2°",
      curp: "AAAA000101HDFBBBB0",
      centro: "HIGIENICOS",
    },
    {
      numero: "00002",
      nombre: "PERSONA SINTETICA DOS",
      puesto: "*OPERARIO 2°",
      curp: "BABC000101MDFCCCC1",
      centro: "HIGIENICOS",
    },
    {
      numero: "00003",
      nombre: "PERSONA SINTETICA TRES",
      puesto: "SUPERVISOR",
      curp: "CACD000101HDFDDDD2",
      centro: "HIGIENICOS",
      clave: "131102100",
    },
  ],
  "EMP ACTIVOS": [
    {
      numero: "00004",
      nombre: "PERSONA SINTETICA CUATRO",
      puesto: "MECANICO",
      curp: "DADE000101HDFEEEE3",
      centro: "MANTENIMIENTO",
    },
  ],
});

function multiparte(
  archivo: Buffer,
  campos: Readonly<Record<string, string>> = {},
  nombre = "sem 31 CAP.xlsx",
): { readonly cuerpo: Buffer; readonly tipo: string } {
  const limite = "frontera-de-prueba-kcm";
  const partes: Buffer[] = [];
  for (const [campo, valor] of Object.entries(campos)) {
    partes.push(
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="${campo}"\r\n\r\n${valor}\r\n`,
        "utf8",
      ),
    );
  }
  partes.push(
    Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\n` +
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
      "utf8",
    ),
    archivo,
    Buffer.from(`\r\n--${limite}--\r\n`, "utf8"),
  );
  return { cuerpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${limite}` };
}

async function entrar(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/acceso",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
  });
  return String(res.headers["set-cookie"]).split(";")[0] ?? "";
}

interface CasoDelPlan {
  readonly id: string;
  readonly puesto: string;
  readonly centroDeCostos: string;
  readonly trabajadores: number;
}

describe("Ocupaciones · clasificación caso por caso", () => {
  async function consola() {
    const app = await buildServer({
      config: loadConfig({ ...ENTORNO }),
      occupationService: () => Promise.resolve(servicioFalso),
    });
    const cookie = await entrar(app);
    const enviar = (
      url: string,
      formulario: { readonly cuerpo: Buffer; readonly tipo: string },
      conSesion = true,
    ) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...(conSesion ? { cookie } : {}), "content-type": formulario.tipo },
        payload: formulario.cuerpo,
      });
    return { enviar };
  }

  it("el plan agrupa a los faltantes por puesto y centro de costos, sin datos personales", async () => {
    const { enviar } = await consola();
    const res = await enviar("/api/ocupaciones/plan", multiparte(PADRON));
    assert.equal(res.statusCode, 200);
    const plan = res.json<{
      casos: CasoDelPlan[];
      trabajadores: number;
      conClave: number;
      pendientes: { casos: number; trabajadores: number };
    }>();
    assert.deepEqual(plan.casos, [
      { id: "C001", puesto: "*OPERARIO 2°", centroDeCostos: "HIGIENICOS", trabajadores: 2 },
      { id: "C002", puesto: "MECANICO", centroDeCostos: "MANTENIMIENTO", trabajadores: 1 },
    ]);
    assert.equal(plan.trabajadores, 3);
    assert.equal(plan.conClave, 1);
    assert.deepEqual(plan.pendientes, { casos: 0, trabajadores: 0 });
    // Al navegador sólo vuelven puestos y centros de costos: ni nombres, ni CURP, ni números.
    assert.doesNotMatch(res.body, /PERSONA SINTETICA|HDF|0000[1-4]/u);
  });

  it("sin sesión de consola, el plan no se entrega", async () => {
    const { enviar } = await consola();
    const res = await enviar("/api/ocupaciones/plan", multiparte(PADRON), false);
    assert.equal(res.statusCode, 401);
  });

  it("un archivo que no es el padrón se rechaza con el motivo", async () => {
    const { enviar } = await consola();
    const res = await enviar("/api/ocupaciones/plan", multiparte(Buffer.from("no es un libro")));
    assert.equal(res.statusCode, 400);
    assert.match(
      res.json<{ error: { message: string } }>().error.message,
      /no tiene la forma del padrón semanal/u,
    );
  });

  it("escribir devuelve el padrón con la clave sólo en las celdas vacías de su caso", async () => {
    const { enviar } = await consola();
    const codigos = JSON.stringify([
      {
        casoId: "C001",
        puesto: "*OPERARIO 2°",
        centroDeCostos: "HIGIENICOS",
        codigo: "552081900",
      },
    ]);
    const res = await enviar(
      "/api/ocupaciones/escribir",
      multiparte(PADRON, { codigos }, "sem 31 CAPACITACIÓN.xlsx"),
    );
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /spreadsheetml\.sheet/u);
    assert.equal(res.headers["x-kcm-celdas-escritas"], "2");
    // Una cabecera sólo admite latin-1: el nombre real viaja codificado y el simple, sin acento.
    assert.equal(
      res.headers["content-disposition"],
      `attachment; filename="sem 31 CAPACITACION con ocupaciones.xlsx"; ` +
        `filename*=UTF-8''sem%2031%20CAPACITACI%C3%93N%20con%20ocupaciones.xlsx`,
    );

    const leido = new RosterExtractorAdapter().extraer(res.rawPayload);
    const claves = Object.fromEntries(
      leido.employees.map((empleado) => [empleado.employeeId, empleado.cnoKey]),
    );
    assert.deepEqual(claves, {
      "00001": "552081900",
      "00002": "552081900",
      "00003": "131102100",
      "00004": "",
    });
  });

  it("una clave que no cuadra con el plan no escribe nada", async () => {
    const { enviar } = await consola();
    const intentar = (clave: Record<string, string>) =>
      enviar(
        "/api/ocupaciones/escribir",
        multiparte(PADRON, {
          codigos: JSON.stringify([
            {
              casoId: "C001",
              puesto: "*OPERARIO 2°",
              centroDeCostos: "HIGIENICOS",
              codigo: "552081900",
              ...clave,
            },
          ]),
        }),
      );
    // Otro par puesto-centro con el mismo número de caso: sería la celda de otra persona.
    const otroCaso = await intentar({ puesto: "MECANICO" });
    assert.equal(otroCaso.statusCode, 400);
    assert.match(
      otroCaso.json<{ error: { message: string } }>().error.message,
      /no corresponden a los casos de este padrón/u,
    );
    // Una clave que no existe en el catálogo tampoco pasa.
    const inventada = await intentar({ codigo: "999999999" });
    assert.equal(inventada.statusCode, 400);
    // Sin claves no hay nada que escribir.
    const vacia = await enviar("/api/ocupaciones/escribir", multiparte(PADRON, { codigos: "[]" }));
    assert.equal(vacia.statusCode, 400);
  });
});
