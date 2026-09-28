/**
 * Barrido del padrón semanal: columnas detectadas, el puente y las rutas.
 *
 * La regla vigilada es la misma que en el barrido de matriz —leer no
 * escribe— y hay una segunda propia de esta ruta: el archivo viaja tal cual y
 * lo interpreta el extractor del servidor, no la macro. Por eso las pruebas
 * construyen un XLSX de verdad y lo mandan por el puente en lugar de simular
 * filas ya normalizadas: si la macro empezara a interpretar el libro, esto
 * dejaría de comprobar lo que dice comprobar.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-expect-error paquete en JavaScript sin definiciones de tipos
import { buildZip } from "../../../packages/dc3/ooxml.js";
import { MemoryExcelRepository } from "../../src/adapters/memoria/excel.ts";
import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import { RosterExtractorAdapter } from "../../src/adapters/archivos/extractor-padron.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { ExcelIntegrationService } from "../../src/domain/excel/integracion.ts";
import { RosterIngestService } from "../../src/domain/padron/ingesta.ts";
import type {
  EscriturasDePadron,
  FilaDePadronBase,
  InduccionPropuesta,
  PuestoDelCatalogo,
  RosterRepositoryPort,
} from "../../src/ports/padron.port.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import { almacenCompartido } from "../apoyo/almacen-compartido.ts";
import { renderRosterPage } from "../../src/web/pages/padron.ts";

const ENTORNO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
} as const;

const armarZip = buildZip as (entradas: readonly (readonly [string, string])[]) => Buffer;

class RelojFalso implements Clock {
  #ahora: Date;
  constructor(inicio = "2026-08-12T12:00:00.000Z") {
    this.#ahora = new Date(inicio);
  }
  now(): Date {
    return new Date(this.#ahora);
  }
  nowIso(): string {
    return this.#ahora.toISOString();
  }
  avanzarMinutos(minutos: number): void {
    this.#ahora = new Date(this.#ahora.getTime() + minutos * 60_000);
  }
}

// --------------------------------------------------------- el libro sintético

function xmlSeguro(valor: string): string {
  return valor.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function celda(referencia: string, valor: string): string {
  return `<c r="${referencia}" t="inlineStr"><is><t>${xmlSeguro(valor)}</t></is></c>`;
}

function hoja(filas: readonly (readonly [number, readonly string[]])[]): string {
  const cuerpo = filas
    .map(([numero, celdas]) => `<row r="${String(numero)}">${celdas.join("")}</row>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${cuerpo}</sheetData>
    </worksheet>`;
}

interface FilaDeArchivo {
  readonly numero: string;
  readonly nombre: string;
  readonly puesto: string;
  readonly curp: string;
  readonly alta: string;
  readonly cno?: string;
}

/**
 * Una hoja de activos. `conCno` decide si existe la columna opcional, que es lo
 * que permite comprobar que un libro sin ella se lee igual y lo dice.
 */
function hojaDeActivos(
  filas: readonly FilaDeArchivo[],
  conCno: boolean,
  encabezadoDeOcupacion = "CLAVE CNO",
): string {
  const encabezados = [
    celda("A1", "NUMERO"),
    celda("B1", "NOMBRE"),
    celda("C1", "NOMBRE DE PUESTO"),
    celda("E1", "C.U.R.P."),
    celda("G1", "FEC ALTA"),
    ...(conCno ? [celda("H1", encabezadoDeOcupacion)] : []),
  ];
  return hoja([
    [1, encabezados],
    ...filas.map((fila, indice): readonly [number, readonly string[]] => {
      const numero = indice + 2;
      return [
        numero,
        [
          celda(`A${String(numero)}`, fila.numero),
          celda(`B${String(numero)}`, fila.nombre),
          celda(`C${String(numero)}`, fila.puesto),
          celda(`E${String(numero)}`, fila.curp),
          celda(`G${String(numero)}`, fila.alta),
          ...(conCno && fila.cno ? [celda(`H${String(numero)}`, fila.cno)] : []),
        ],
      ];
    }),
  ]);
}

function libroDePadron(input: {
  readonly snd: readonly FilaDeArchivo[];
  readonly emp: readonly FilaDeArchivo[];
  /** La columna del CNO existe en `SND ACTIVOS` pero no en `EMP ACTIVOS`. */
  readonly cnoSoloEnSnd?: boolean;
  /** Con qué rótulo llega la columna de la clave de ocupación. */
  readonly encabezadoDeOcupacion?: string;
}): Buffer {
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
              (nombre, indice) =>
                `<sheet name="${nombre}" sheetId="${String(indice + 1)}" r:id="rId${String(indice + 1)}"/>`,
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
              (_, indice) =>
                `<Relationship Id="rId${String(indice + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(indice + 1)}.xml"/>`,
            )
            .join("")}
        </Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", hojaDeActivos(input.snd, true, input.encabezadoDeOcupacion)],
    [
      "xl/worksheets/sheet2.xml",
      hojaDeActivos(input.emp, input.cnoSoloEnSnd !== true, input.encabezadoDeOcupacion),
    ],
  ]);
}

const PADRON = libroDePadron({
  snd: [
    {
      numero: "00001",
      nombre: "PERSONA SINTETICA UNO",
      puesto: "OPERADOR",
      curp: "AAAA000101HDFBBBB0",
      alta: "2020-01-15",
      cno: "8121",
    },
    {
      numero: "00002",
      nombre: "PERSONA SINTETICA DOS",
      puesto: "SUPERVISOR",
      curp: "BABC000101MDFCCCC1",
      alta: "2021-03-01",
      cno: "1311",
    },
  ],
  emp: [
    {
      numero: "00003",
      nombre: "PERSONA SINTETICA TRES",
      puesto: "OPERADOR",
      curp: "CACD000101HDFDDDD2",
      alta: "2022-05-20",
    },
  ],
  cnoSoloEnSnd: true,
});

// ------------------------------------------------------------------ el doble

class RepositorioFalso implements RosterRepositoryPort {
  escrituras = 0;
  readonly #base: FilaDePadronBase[];
  readonly #puestos: PuestoDelCatalogo[];

  constructor(base: FilaDePadronBase[], puestos: PuestoDelCatalogo[]) {
    this.#base = base;
    this.#puestos = puestos;
  }
  leerPadronBase(): Promise<readonly FilaDePadronBase[]> {
    return Promise.resolve(this.#base.map((fila) => ({ ...fila })));
  }
  leerPuestos(): Promise<readonly PuestoDelCatalogo[]> {
    return Promise.resolve(this.#puestos.map((fila) => ({ ...fila })));
  }
  revisarInducciones(
    propuestas: readonly InduccionPropuesta[],
  ): Promise<{ nuevas: number; divergentes: number }> {
    return Promise.resolve({ nuevas: propuestas.length, divergentes: 0 });
  }
  aplicar(escrituras: EscriturasDePadron): Promise<{
    curp: number;
    altas: number;
    inducciones: number;
    ocupaciones: number;
  }> {
    this.escrituras += 1;
    return Promise.resolve({
      curp: escrituras.curp.length,
      altas: escrituras.altas.length,
      inducciones: escrituras.inducciones.length,
      ocupaciones: escrituras.ocupaciones.length,
    });
  }
}

function baseCargada(): RepositorioFalso {
  return new RepositorioFalso(
    [
      {
        trabajadorId: "t-1",
        numeroTrabajador: "00001",
        curp: null,
        fechaAlta: "2020-01-15",
        puesto: "OPERADOR",
        area: "CONVERTIDORA",
        claveOcupacion: null,
        tipoNomina: null,
        planta: null,
        activo: true,
      },
      {
        trabajadorId: "t-2",
        numeroTrabajador: "00002",
        curp: "BABC000101MDFCCCC1",
        fechaAlta: "2021-03-01",
        puesto: "OPERADOR",
        area: "EMPAQUE",
        claveOcupacion: null,
        tipoNomina: null,
        planta: null,
        activo: true,
      },
      {
        trabajadorId: "t-4",
        numeroTrabajador: "00004",
        curp: null,
        fechaAlta: null,
        puesto: "OPERADOR",
        area: "CONVERTIDORA",
        claveOcupacion: null,
        tipoNomina: null,
        planta: null,
        activo: true,
      },
    ],
    [
      { nombre: "OPERADOR", claveCno: null },
      { nombre: "SUPERVISOR", claveCno: null },
    ],
  );
}

function servicio(reloj = new RelojFalso(), repositorio = baseCargada()) {
  return {
    repositorio,
    service: new RosterIngestService({
      repository: repositorio,
      extractor: new RosterExtractorAdapter(),
      clock: reloj,
    }),
  };
}

// ------------------------------------------------------- columnas detectadas

describe("Barrido de padrón · columnas detectadas", () => {
  it("dice qué encabezado se leyó como cada campo, hoja por hoja", async () => {
    const { service } = servicio();
    const plan = await service.previsualizar(PADRON, "sem 33 CAP.xlsx");

    assert.deepEqual(
      plan.hojas.map((h) => h.sheetName),
      ["SND ACTIVOS", "EMP ACTIVOS"],
    );

    const snd = plan.hojas[0];
    const porCampo = new Map(snd?.columns.map((c) => [c.field, c]));
    assert.equal(porCampo.get("employeeId")?.header, "NUMERO");
    assert.equal(porCampo.get("employeeId")?.columnName, "A");
    // El rótulo del libro no es el nombre del campo, y por eso se enseña: quien
    // busca «fecha de alta» en la hoja encuentra `FEC ALTA`.
    assert.equal(porCampo.get("hireDate")?.header, "FEC ALTA");
    assert.equal(porCampo.get("hireDate")?.columnName, "G");
    assert.equal(porCampo.get("curp")?.header, "C.U.R.P.");
    assert.equal(porCampo.get("cnoKey")?.present, true);
    assert.equal(porCampo.get("cnoKey")?.columnName, "H");

    // La segunda hoja no trae la columna opcional: se nombra ausente en lugar
    // de quedar en silencio, que es lo que hacía que pareciera un error.
    const emp = plan.hojas[1];
    const cnoEnEmp = emp?.columns.find((c) => c.field === "cnoKey");
    assert.equal(cnoEnEmp?.present, false);
    assert.equal(cnoEnEmp?.required, false);
    assert.equal(emp?.acceptedRows, 1);
    assert.equal(snd?.acceptedRows, 2);
  });

  it("cuadra el archivo contra la base y detalla quién cambió de puesto", async () => {
    const { service, repositorio } = servicio();
    const plan = await service.previsualizar(PADRON, "sem 33 CAP.xlsx");

    assert.equal(plan.cuadre.activosEnArchivo, 3);
    assert.equal(plan.cuadre.reconocidos, 2);
    assert.equal(plan.cuadre.desconocidos, 1);
    assert.deepEqual(plan.muestras.desconocidos, ["00003"]);
    assert.equal(plan.cuadre.ausentes, 1);
    assert.deepEqual(plan.muestras.ausentes, ["00004"]);

    assert.equal(plan.cuadre.puestosCambiados, 1);
    assert.deepEqual(plan.muestras.cambiosDePuesto, [
      {
        numeroTrabajador: "00002",
        antes: "OPERADOR",
        ahora: "SUPERVISOR",
        fueraDeCatalogo: false,
      },
    ]);

    assert.equal(plan.cuadre.traeColumnaCno, true);
    assert.equal(plan.origen.tipo, "CONSOLA");
    // Leer no escribe: la revisión existe y el repositorio sigue intacto.
    assert.equal(repositorio.escrituras, 0);
  });

  it("propone la clave de ocupación por trabajador, aunque compartan puesto", async () => {
    const { service } = servicio();
    const plan = await service.previsualizar(PADRON, "sem 33 CAP.xlsx");

    // 00001 y 00002 traen claves distintas; el tercero no trae columna. Bajo la
    // regla anterior —consolidar por puesto— esto habría escrito cero.
    assert.equal(plan.cuadre.cnoPorEscribir, 2);
    assert.equal(plan.cuadre.cnoQueCoinciden, 0);
    assert.equal(plan.cuadre.cnoEnConflicto, 0);
  });

  /**
   * El rótulo declarado el 2026-08-13 es «Clave de ocupación», provisional. Se
   * prueba con acento y en minúsculas, tal como se escribe en la hoja: la
   * comparación es sobre el rótulo ya normalizado, y esta prueba es lo que fija
   * que esa normalización siga cubriendo el caso real y no sólo el de manual.
   */
  it("acepta «Clave de ocupación» tal como se escribe en la hoja", async () => {
    const { service } = servicio();
    const plan = await service.previsualizar(
      libroDePadron({
        snd: [
          {
            numero: "00001",
            nombre: "PERSONA SINTETICA UNO",
            puesto: "OPERADOR",
            curp: "AAAA000101HDFBBBB0",
            alta: "2020-01-15",
            cno: "8121",
          },
        ],
        emp: [],
        encabezadoDeOcupacion: "Clave de ocupación",
      }),
      "sem 34 CAP.xlsx",
    );

    assert.equal(plan.cuadre.traeColumnaCno, true);
    assert.equal(plan.cuadre.cnoPorEscribir, 1);
    const columna = plan.hojas[0]?.columns.find((c) => c.field === "cnoKey");
    assert.equal(columna?.present, true);
    // Se enseña el rótulo tal como está en el libro, no el alias normalizado.
    assert.equal(columna?.header, "Clave de ocupación");
  });

  it("sigue aceptando los rótulos anteriores y el que usó el departamento al pedirla", async () => {
    for (const encabezado of ["CLAVE CNO", "CLAVE DEL TIPO DE TRABAJO", "Ocupación Específica"]) {
      const { service } = servicio();
      const plan = await service.previsualizar(
        libroDePadron({
          snd: [
            {
              numero: "00001",
              nombre: "PERSONA SINTETICA UNO",
              puesto: "OPERADOR",
              curp: "AAAA000101HDFBBBB0",
              alta: "2020-01-15",
              cno: "8121",
            },
          ],
          emp: [],
          encabezadoDeOcupacion: encabezado,
        }),
        "sem 34 CAP.xlsx",
      );
      assert.equal(plan.cuadre.cnoPorEscribir, 1, `no resolvió el encabezado ${encabezado}`);
    }
  });
});

// ------------------------------------------------------- la revisión viva

describe("Barrido de padrón · revisión", () => {
  it("leer el archivo deja la revisión a la vista y descartarla la borra", async () => {
    const { service } = servicio();

    const plan = await service.previsualizar(PADRON, "sem 33 CAP.xlsx", {
      tipo: "PUENTE_VBA",
      actor: "KCM-OFFICE-01",
    });
    assert.equal(service.ultimoPlan()?.planId, plan.planId);

    await service.descartar();
    assert.equal(service.ultimoPlan(), undefined);
  });
});

// -------------------------------------------------------------- el puente

describe("Barrido de padrón · ROSTER_SCAN_V1", () => {
  const instante = "2026-08-12T12:00:00.000Z";

  async function puente() {
    const reloj = new RelojFalso(instante);
    const { service: roster, repositorio } = servicio(reloj);
    const service = new ExcelIntegrationService({
      repository: new MemoryExcelRepository({ clock: reloj }),
      matrixRepository: new MemoryMatrixRepository(),
      clock: reloj,
      roster,
    });
    const emitida = await service.issueCredential({
      clientId: "KCM-OFFICE-01",
      principal: "usuario.sintetico",
      windowsProfile: "perfil-sintetico",
      equipment: "equipo-sintetico",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
    return { service, roster, repositorio, secreto: emitida.secret };
  }

  function sobre(archivo: Buffer, nombre = "sem 33 CAP.xlsx", huella?: string): string {
    return JSON.stringify({
      fileName: nombre,
      ...(huella === undefined ? {} : { sha256: huella }),
      content: archivo.toString("base64"),
    });
  }

  function llamar(
    service: ExcelIntegrationService,
    secreto: string,
    payload: string,
    nonce: string,
  ) {
    return service.handleBridge({
      action: "ROSTER_SCAN_V1",
      clientId: "KCM-OFFICE-01",
      requestId: `vba-padron-${nonce}`,
      sentAt: instante,
      nonce,
      credential: secreto,
      payload: Buffer.from(payload).toString("base64url"),
    });
  }

  function campos(respuesta: string): Record<string, string> {
    const [, estado, ...pares] = respuesta.split("\n");
    const salida: Record<string, string> = { estado: estado ?? "" };
    for (const par of pares) {
      const corte = par.indexOf("=");
      salida[par.slice(0, corte)] = decodeURIComponent(par.slice(corte + 1));
    }
    return salida;
  }

  it("entrega el archivo tal cual y deja la revisión sin escribir nada", async () => {
    const { service, roster, repositorio, secreto } = await puente();

    const respuesta = campos(await llamar(service, secreto, sobre(PADRON), "nonce-1"));
    assert.equal(respuesta.estado, "OK");
    assert.equal(respuesta.applied, "false");
    assert.equal(respuesta.workers, "3");
    assert.equal(respuesta.unknownWorkers, "1");
    assert.equal(respuesta.missingWorkers, "1");
    assert.equal(respuesta.positionChanges, "1");
    assert.equal(respuesta.hasCnoColumn, "true");

    const plan = roster.ultimoPlan();
    assert.equal(plan?.planId, respuesta.planId);
    assert.equal(plan?.nombreArchivo, "sem 33 CAP.xlsx");
    assert.equal(plan?.origen.tipo, "PUENTE_VBA");
    assert.equal(plan?.origen.actor, "KCM-OFFICE-01");
    assert.equal(repositorio.escrituras, 0);
  });

  it("una huella que no cuadra se rechaza como traslado dañado", async () => {
    const { service, roster, secreto } = await puente();
    const respuesta = campos(
      await llamar(service, secreto, sobre(PADRON, "sem 33 CAP.xlsx", "0".repeat(64)), "nonce-2"),
    );
    assert.equal(respuesta.estado, "ERROR");
    assert.equal(respuesta.code, "EXCEL_ROSTER_CHECKSUM");
    assert.equal(roster.ultimoPlan(), undefined);
  });

  it("un sobre sin archivo o sin nombre se rechaza sin reintento", async () => {
    const { service, secreto } = await puente();

    const sinArchivo = campos(
      await llamar(service, secreto, JSON.stringify({ fileName: "sem 33 CAP.xlsx" }), "nonce-3"),
    );
    assert.equal(sinArchivo.code, "INVALID_EXCEL_REQUEST");
    assert.equal(sinArchivo.retryable, "false");

    const sinNombre = campos(
      await llamar(service, secreto, JSON.stringify({ content: "AAAA" }), "nonce-4"),
    );
    assert.equal(sinNombre.code, "INVALID_EXCEL_REQUEST");
  });

  it("un libro con otra forma se rechaza nombrando lo que no resolvió", async () => {
    const { service, secreto } = await puente();
    const otroLibro = armarZip([
      [
        "[Content_Types].xml",
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      ],
      [
        "xl/workbook.xml",
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OTRA COSA" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ],
      [
        "xl/_rels/workbook.xml.rels",
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ],
      ["xl/worksheets/sheet1.xml", hoja([[1, [celda("A1", "COSA")]]])],
    ]);

    const respuesta = campos(await llamar(service, secreto, sobre(otroLibro), "nonce-5"));
    assert.equal(respuesta.estado, "ERROR");
    assert.equal(respuesta.code, "INVALID_ROSTER_FILE");
    assert.match(respuesta.message ?? "", /forma del padrón semanal/u);
  });
});

// ------------------------------------------------------------- la pantalla

describe("Barrido de padrón · pantalla", () => {
  it("enseña las columnas plegadas y quién cambió de puesto, con nombre", async () => {
    const { service } = servicio();
    const plan = await service.previsualizar(PADRON, "sem 33 CAP.xlsx", {
      tipo: "PUENTE_VBA",
      actor: "KCM-OFFICE-01",
    });

    const html = renderRosterPage({ entorno: "development", plan });

    assert.match(html, /Columnas del archivo/u);
    assert.match(html, /FEC ALTA/u);
    assert.match(html, /C\.U\.R\.P\./u);
    assert.match(html, /No viene/u);
    assert.match(html, /con cambios/u);
    assert.match(html, /00002/u);
    assert.match(
      html,
      /<del>[^<]*<\/del>\s*<span class="diff-flecha"[^>]*>→<\/span>\s*<ins>SUPERVISOR<\/ins>/u,
    );
    // Desde el 2026-09-25 la revisión nombra a la persona. Sigue detrás de sesión.
    assert.match(html, /PERSONA SINTETICA/u);
  });

  it("sin revisión remite a Excel y ofrece subir a mano", () => {
    const html = renderRosterPage({ entorno: "development" });
    assert.doesNotMatch(html, /Leer no cambia nada/u);
    assert.match(html, /Carga manual del archivo/u);
    assert.doesNotMatch(html, /Solicitar barrido|Cancelar encargo/u);
  });
});

// --------------------------------------------------------------- las rutas

describe("Barrido de padrón · rutas", () => {
  async function servidor() {
    return buildServer({
      config: loadConfig({ ...ENTORNO }),
      clock: new RelojFalso(),
      rosterRepository: baseCargada(),
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

  it("las rutas nuevas también exigen sesión", async () => {
    const app = await servidor();
    for (const url of ["/padron/descartar"]) {
      const res = await app.inject({ method: "POST", url });
      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, "/acceso?destino=%2Fpadron");
    }
  });

  it("las rutas del encargo retirado ya no responden", async () => {
    const app = await servidor();
    const cookie = await sesion(app);

    for (const url of ["/padron/barrido", "/padron/cancelar"]) {
      const res = await app.inject({ method: "POST", url, headers: { cookie } });
      assert.equal(res.statusCode, 404);
    }

    const pantalla = await app.inject({ method: "GET", url: "/padron", headers: { cookie } });
    assert.doesNotMatch(pantalla.body, /Solicitar barrido|Barrido encargado/u);
  });
});

describe("Barrido de padrón · varias instancias", () => {
  it("el plan leído en una instancia se aplica en otra, una sola vez", async () => {
    const repositorio = baseCargada();
    const revisiones = almacenCompartido();
    const reloj = new RelojFalso();
    const crear = () =>
      new RosterIngestService({
        repository: repositorio,
        extractor: new RosterExtractorAdapter(),
        clock: reloj,
        revisiones,
      });
    const lee = crear();
    const aplica = crear();

    const plan = await lee.previsualizar(PADRON, "sem 33 CAP.xlsx", {
      tipo: "CONSOLA",
      actor: "Maricela0000",
    });

    await aplica.sincronizar();
    assert.equal(aplica.ultimoPlan()?.planId, plan.planId);
    await aplica.aplicar(plan.planId, "Maricela0000");

    await lee.sincronizar();
    assert.equal(lee.ultimoPlan(), undefined);
    await assert.rejects(lee.aplicar(plan.planId, "Pablo0000"), /ya no está disponible/u);
  });
});
