import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
  const sugerenciaDePrueba = (entrada: unknown): Promise<SugerenciaDeOcupacion> => {
    const caso = leerCaso(entrada);
    const propuesta = {
      codigo: "552081900",
      descripcion: "OPERADOR MÁQUINA FABRICACIÓN ARTÍCULOS PAPEL",
      consecutivo: "2192",
      subarea: "05.5",
      denominacionDeSubarea: "Materia orgánica",
      alternativa: { codigo: "552090402", descripcion: "OPERADOR DE MÁQUINA DE FABRICAR PAPEL" },
      confianza: "alta" as const,
      motivo: "Opera una línea de conversión de papel.",
    };
    return Promise.resolve({
      caso,
      version: "2026-09-26.5",
      huella: "cf257cdf0f9d7737",
      estado: "sugerida",
      sugerencia: propuesta,
      principal: propuesta,
      verificador: propuesta,
      razon: "principal y verificador coinciden",
      traza: [
        {
          nodo: "principal_ocupacion",
          proveedor: "openrouter",
          modelo: "nvidia/nemotron-3-super-120b-a12b:free",
          milisegundos: 27_557,
          tokensDeEntrada: 5685,
          tokensDeSalida: 2450,
          nota: "230 opciones; eligió 552081900",
        },
        {
          nodo: "conciliacion",
          proveedor: null,
          modelo: null,
          milisegundos: 0,
          tokensDeEntrada: null,
          tokensDeSalida: null,
          nota: "sugerida: principal y verificador coinciden",
        },
      ],
    });
  };

  async function pantalla(conServicio: boolean) {
    const app = await buildServer({
      config: loadConfig({ ...ENTORNO }),
      ...(conServicio
        ? {
            occupationService: () =>
              Promise.resolve({ ...servicioFalso, sugerir: sugerenciaDePrueba }),
          }
        : {}),
    });
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ usuario: "Maricela0000", clave: "0000" }).toString(),
    });
    const cookie = String(res.headers["set-cookie"]).split(";")[0] ?? "";
    const abrir = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
    const consultar = (campos: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/ocupaciones",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams(campos).toString(),
      });
    return { abrir, consultar };
  }

  it("dibuja la sección con su lugar en el lateral, la consulta y el catálogo", async () => {
    const { abrir } = await pantalla(true);
    const res = await abrir("/ocupaciones");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1 class="barra-titulo">Ocupaciones<\/h1>/u);
    assert.match(
      res.body,
      /class="lateral-enlace"[^>]*href="\/ocupaciones"[^>]*aria-current="page"|href="\/ocupaciones"[^>]*aria-current="page"/u,
    );
    assert.match(res.body, /Consultar una ocupación/u);
    assert.match(res.body, /Consulta disponible/u);
    assert.match(res.body, /4,737 ocupaciones del catálogo/u);
    // Sin búsqueda no hay tabla de resultados.
    assert.doesNotMatch(res.body, /N\.º STPS/u);
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

  it("consulta al agente y enseña la clave, la subárea, las dos opiniones y el recorrido", async () => {
    const { consultar } = await pantalla(true);
    const res = await consultar({ puesto: "*OPERARIO 2°", centroDeCostos: "HIGIENICOS" });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /\*OPERARIO 2° · HIGIENICOS/u);
    assert.match(res.body, /<span class="insignia insignia-completado">Sugerida<\/span>/u);
    assert.match(res.body, /<span class="kpi-cifra">552081900<\/span>/u);
    assert.match(res.body, /Materia orgánica/u);
    assert.match(res.body, /552090402 OPERADOR DE MÁQUINA DE FABRICAR PAPEL/u);
    assert.match(res.body, /Recorrido de la consulta/u);
    assert.match(res.body, /Primer modelo · ocupación/u);
    // El formulario vuelve lleno, para ajustar y volver a consultar.
    assert.match(res.body, /value="\*OPERARIO 2°"/u);
  });

  it("un dato personal se rechaza en la pantalla, sin llegar al agente", async () => {
    const { consultar } = await pantalla(true);
    const res = await consultar({ puesto: "28392", centroDeCostos: "AGUA" });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /class="aviso-error" role="alert"/u);
    assert.match(res.body, /parece un dato personal/u);
  });

  it("sin agente, la consulta se apaga y el catálogo sigue buscando", async () => {
    const { abrir, consultar } = await pantalla(false);
    const res = await abrir("/ocupaciones?q=montacargas");
    assert.match(res.body, /Consulta apagada/u);
    assert.doesNotMatch(res.body, /<form method="post" action="\/ocupaciones"/u);
    assert.match(res.body, /MONTACARGAS/u);
    const envio = await consultar({ puesto: "*OPERADOR", centroDeCostos: "AGUA" });
    assert.equal(envio.statusCode, 503);
  });
});
