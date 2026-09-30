import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ModeloChatCompatible,
  ModeloConRespaldo,
  type DestinoDeModelo,
} from "../../src/adapters/ia/chat-compatible.ts";
import { leerAgenteDelEntorno } from "../../src/config/agente-ocupaciones.ts";
import { ConfigError } from "../../src/config/environment.ts";
import { FallaDeModelo, type SolicitudJson } from "../../src/ports/modelo-de-lenguaje.port.ts";

const DESTINO: DestinoDeModelo = {
  proveedor: "groq",
  url: "https://api.ejemplo.test/v1",
  modelo: "openai/gpt-oss-120b",
  llave: "llave-secreta",
  esfuerzo: "high",
  formato: "json_schema",
  maxTokensDeSalida: 3000,
  tiempoMaximoMs: 5000,
};

const SOLICITUD: SolicitudJson = {
  instrucciones: "instrucciones",
  mensaje: "Puesto: *OPERADOR\nCentro de costos: AGUA",
  esquema: { nombre: "prueba", definicion: { type: "object" } },
};

interface Llamada {
  readonly url: string;
  readonly init: RequestInit;
}

function fetchDeMentira(respuestas: Response[]): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const fetchFalso = ((url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init: init ?? {},
    });
    const siguiente = respuestas.shift();
    return siguiente ? Promise.resolve(siguiente) : Promise.reject(new TypeError("sin red"));
  }) as typeof fetch;
  return { fetch: fetchFalso, llamadas };
}

function cuerpoDe(llamada: Llamada | undefined): Record<string, unknown> {
  const cuerpo = llamada?.init.body;
  assert.equal(typeof cuerpo, "string");
  return JSON.parse(cuerpo as string) as Record<string, unknown>;
}

function exito(contenido: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    model: "openai/gpt-oss-120b",
    choices: [{ message: { role: "assistant", content: contenido } }],
    usage: { prompt_tokens: 812, completion_tokens: 95 },
    ...extra,
  });
}

describe("IA · adaptador chat compatible", () => {
  it("pide JSON con esquema, esfuerzo y tope de salida, y lee tokens y modelo", async () => {
    const { fetch, llamadas } = fetchDeMentira([exito('{"a": 1}')]);
    const modelo = new ModeloChatCompatible(DESTINO, { fetch });

    const respuesta = await modelo.responderJson(SOLICITUD);

    assert.deepEqual(respuesta.datos, { a: 1 });
    assert.equal(respuesta.tokensDeEntrada, 812);
    assert.equal(respuesta.tokensDeSalida, 95);
    assert.equal(respuesta.modelo, "openai/gpt-oss-120b");
    assert.deepEqual(respuesta.desvios, []);

    const [llamada] = llamadas;
    assert.equal(llamada?.url, "https://api.ejemplo.test/v1/chat/completions");
    const cuerpo = cuerpoDe(llamada);
    assert.equal(cuerpo.model, "openai/gpt-oss-120b");
    assert.equal(cuerpo.reasoning_effort, "high");
    assert.equal(cuerpo.max_completion_tokens, 3000);
    assert.deepEqual(cuerpo.response_format, {
      type: "json_schema",
      json_schema: { name: "prueba", schema: { type: "object" }, strict: true },
    });
    assert.deepEqual(cuerpo.messages, [
      { role: "system", content: "instrucciones" },
      { role: "user", content: "Puesto: *OPERADOR\nCentro de costos: AGUA" },
    ]);
    const cabeceras = new Headers(llamada?.init.headers);
    assert.equal(cabeceras.get("authorization"), "Bearer llave-secreta");
  });

  it("sin esfuerzo declarado no lo manda, y con json_object no manda esquema", async () => {
    const { fetch, llamadas } = fetchDeMentira([exito('```json\n{"b": 2}\n```')]);
    const { esfuerzo: _omitido, ...sinEsfuerzo } = DESTINO;
    const modelo = new ModeloChatCompatible({ ...sinEsfuerzo, formato: "json_object" }, { fetch });

    const respuesta = await modelo.responderJson(SOLICITUD);

    assert.deepEqual(respuesta.datos, { b: 2 });
    const cuerpo = cuerpoDe(llamadas[0]);
    assert.equal("reasoning_effort" in cuerpo, false);
    assert.deepEqual(cuerpo.response_format, { type: "json_object" });
  });

  it("traduce los códigos HTTP a motivos, sin poner la llave ni el texto en el mensaje", async () => {
    const casos: [number, string, boolean][] = [
      [429, "LIMITE", true],
      [503, "NO_DISPONIBLE", true],
      [413, "DEMASIADO_GRANDE", false],
      [404, "MODELO", false],
      [401, "LLAVE", false],
      [400, "SOLICITUD", false],
    ];
    for (const [estado, motivo, seReintenta] of casos) {
      const { fetch } = fetchDeMentira([
        new Response("repite: Puesto: *OPERADOR", {
          status: estado,
          headers: estado === 429 ? { "retry-after": "7" } : {},
        }),
      ]);
      const falla = await new ModeloChatCompatible(DESTINO, { fetch, esperaMaximaPorLimiteMs: 0 })
        .responderJson(SOLICITUD)
        .then(
          () => assert.fail("debió fallar"),
          (error: unknown) => error,
        );
      assert.ok(falla instanceof FallaDeModelo);
      assert.equal(falla.motivo, motivo);
      assert.equal(falla.seReintenta, seReintenta);
      assert.doesNotMatch(falla.message, /llave-secreta|OPERADOR/u);
      if (estado === 429) assert.equal(falla.esperaMs, 7000);
    }
  });

  it("ante un 429 con espera corta, espera lo que pide el proveedor y lo intenta una vez más", async () => {
    const { fetch, llamadas } = fetchDeMentira([
      new Response("", { status: 429, headers: { "retry-after": "0" } }),
      exito('{"d": 4}'),
    ]);
    const respuesta = await new ModeloChatCompatible(DESTINO, { fetch }).responderJson(SOLICITUD);
    assert.deepEqual(respuesta.datos, { d: 4 });
    assert.equal(llamadas.length, 2);
  });

  it("tolera el razonamiento entre etiquetas antes del JSON", async () => {
    const { fetch } = fetchDeMentira([exito('<think>primero la subárea…</think>\n{"f": 6}')]);
    const respuesta = await new ModeloChatCompatible(DESTINO, { fetch }).responderJson(SOLICITUD);
    assert.deepEqual(respuesta.datos, { f: 6 });
  });

  it("una respuesta cortada por el tope de salida se reporta como tal", async () => {
    const cortada = Response.json({
      choices: [{ finish_reason: "length", message: { content: '{"resultados": [{"id": "C0' } }],
    });
    const { fetch } = fetchDeMentira([cortada]);
    await assert.rejects(
      new ModeloChatCompatible(DESTINO, { fetch }).responderJson(SOLICITUD),
      (error: unknown) =>
        error instanceof FallaDeModelo &&
        error.motivo === "RESPUESTA" &&
        /se cortó al llegar al tope de 3000 tokens/u.test(error.message),
    );
  });

  it("una respuesta que no es JSON es una falla de respuesta, que sí se reintenta", async () => {
    const { fetch } = fetchDeMentira([exito("no soy json")]);
    await assert.rejects(
      new ModeloChatCompatible(DESTINO, { fetch }).responderJson(SOLICITUD),
      (error: unknown) => error instanceof FallaDeModelo && error.motivo === "RESPUESTA",
    );
  });

  it("el respaldo contesta cuando el primero falla, y la respuesta lo dice", async () => {
    const primero = new ModeloChatCompatible(DESTINO, {
      fetch: fetchDeMentira([new Response("", { status: 429 })]).fetch,
    });
    const segundo = new ModeloChatCompatible(
      { ...DESTINO, proveedor: "gemini", modelo: "gemini-3.8-flash" },
      { fetch: fetchDeMentira([exito('{"c": 3}', { model: "gemini-3.8-flash" })]).fetch },
    );
    const cadena = new ModeloConRespaldo([primero, segundo]);

    const respuesta = await cadena.responderJson(SOLICITUD);

    assert.equal(cadena.nombre, "groq/openai/gpt-oss-120b → gemini/gemini-3.8-flash");
    assert.equal(respuesta.proveedor, "gemini");
    assert.deepEqual(respuesta.desvios, ["groq/openai/gpt-oss-120b respondió 429"]);
  });

  it("si toda la cadena falla, se reintenta sólo si algún motivo lo amerita", async () => {
    const llaveMala = new ModeloChatCompatible(DESTINO, {
      fetch: fetchDeMentira([new Response("", { status: 401 })]).fetch,
    });
    const limite = new ModeloChatCompatible(DESTINO, {
      fetch: fetchDeMentira([new Response("", { status: 429 })]).fetch,
    });
    await assert.rejects(
      new ModeloConRespaldo([llaveMala]).responderJson(SOLICITUD),
      (error: unknown) => error instanceof FallaDeModelo && !error.seReintenta,
    );
    const llaveMala2 = new ModeloChatCompatible(DESTINO, {
      fetch: fetchDeMentira([new Response("", { status: 401 })]).fetch,
    });
    await assert.rejects(
      new ModeloConRespaldo([llaveMala2, limite]).responderJson(SOLICITUD),
      (error: unknown) => error instanceof FallaDeModelo && error.seReintenta,
    );
  });
});

describe("IA · parámetros del agente", () => {
  it("sin llave el agente no existe", () => {
    assert.equal(leerAgenteDelEntorno({}), undefined);
    assert.equal(leerAgenteDelEntorno({ KCM_IA_OPENROUTER_LLAVE: "  " }), undefined);
  });

  it("un solo modelo: Nemotron y, de respaldo, las dos Gemma, con la llave de OpenRouter", () => {
    const parametros = leerAgenteDelEntorno({ KCM_IA_OPENROUTER_LLAVE: "o" });
    assert.deepEqual(
      parametros?.principal.map((destino) => destino.modelo),
      [
        "nvidia/nemotron-3-super-120b-a12b:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
      ],
    );
    assert.equal(parametros && "verificador" in parametros, false);
    for (const destino of parametros?.principal ?? []) {
      assert.equal(destino.url, "https://openrouter.ai/api/v1");
      assert.equal(destino.llave, "o");
      assert.equal(destino.campoDeTope, "max_tokens");
      assert.deepEqual(destino.extras, {
        reasoning: { effort: "high", exclude: true },
        provider: { require_parameters: true },
      });
    }
    assert.deepEqual(
      parametros?.principal.map((destino) => destino.formato),
      ["json_schema", "json_object", "json_object"],
    );
    assert.ok((parametros?.limites.tiempoMaximoMs ?? 0) <= 110_000);
  });

  it("el cuerpo para Gemma pide JSON simple, sin esquema, con los campos de OpenRouter", async () => {
    const [, gemma] = leerAgenteDelEntorno({ KCM_IA_OPENROUTER_LLAVE: "o" })?.principal ?? [];
    assert.ok(gemma);
    const { fetch, llamadas } = fetchDeMentira([exito('{"e": 5}')]);
    await new ModeloChatCompatible(gemma, { fetch }).responderJson(SOLICITUD);
    const cuerpo = cuerpoDe(llamadas[0]);
    assert.equal(llamadas[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(cuerpo.model, "google/gemma-4-31b-it:free");
    assert.deepEqual(cuerpo.response_format, { type: "json_object" });
    assert.equal(cuerpo.max_tokens, 16_000);
    assert.deepEqual(cuerpo.reasoning, { effort: "high", exclude: true });
    assert.deepEqual(cuerpo.provider, { require_parameters: true });
  });

  it("si Nemotron responde 429, contesta Gemma y la respuesta lo dice", async () => {
    const parametros = leerAgenteDelEntorno({ KCM_IA_OPENROUTER_LLAVE: "o" });
    assert.ok(parametros);
    const { fetch, llamadas } = fetchDeMentira([
      new Response("{}", { status: 429 }),
      exito('{"e": 5}', { model: "google/gemma-4-31b-it:free" }),
    ]);
    const cadena = new ModeloConRespaldo(
      parametros.principal.map((destino) => new ModeloChatCompatible(destino, { fetch })),
      parametros.respaldo,
    );
    const respuesta = await cadena.responderJson(SOLICITUD, { tiempoMaximoMs: 100_000 });
    assert.equal(respuesta.modelo, "google/gemma-4-31b-it:free");
    assert.deepEqual(
      llamadas.map(
        (llamada) => (JSON.parse(llamada.init.body as string) as { model: string }).model,
      ),
      ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"],
    );
    assert.match(respuesta.desvios.join("; "), /nemotron.*respondió 429/u);
  });

  it("el cuerpo para OpenRouter lleva el razonamiento, el enrutamiento y max_tokens", async () => {
    const [nemotron] = leerAgenteDelEntorno({ KCM_IA_OPENROUTER_LLAVE: "o" })?.principal ?? [];
    assert.ok(nemotron);
    const { fetch, llamadas } = fetchDeMentira([exito('{"e": 5}')]);
    await new ModeloChatCompatible(nemotron, { fetch }).responderJson(SOLICITUD);
    const cuerpo = cuerpoDe(llamadas[0]);
    assert.equal(llamadas[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(cuerpo.model, "nvidia/nemotron-3-super-120b-a12b:free");
    assert.equal(cuerpo.max_tokens, 16_000);
    assert.equal("max_completion_tokens" in cuerpo, false);
    assert.deepEqual(cuerpo.reasoning, { effort: "high", exclude: true });
    assert.deepEqual(cuerpo.provider, { require_parameters: true });
    assert.equal((cuerpo.response_format as { type: string }).type, "json_schema");
  });

  it("el respaldo sólo recibe el tiempo que dejó el anterior", async () => {
    const vistos: (number | undefined)[] = [];
    const lento = {
      nombre: "lento",
      responderJson: async (_s: SolicitudJson, o: { tiempoMaximoMs?: number } = {}) => {
        vistos.push(o.tiempoMaximoMs);
        await new Promise((listo) => setTimeout(listo, 50));
        throw new FallaDeModelo("NO_DISPONIBLE", "lento no respondió");
      },
    };
    const rapido = {
      nombre: "rapido",
      responderJson: (_s: SolicitudJson, o: { tiempoMaximoMs?: number } = {}) => {
        vistos.push(o.tiempoMaximoMs);
        return Promise.reject(new FallaDeModelo("NO_DISPONIBLE", "rapido tampoco"));
      },
    };
    await assert.rejects(
      new ModeloConRespaldo([lento, rapido]).responderJson(SOLICITUD, { tiempoMaximoMs: 5000 }),
    );
    assert.equal(vistos[0], 5000);
    assert.ok((vistos[1] ?? 5000) < 5000);
  });

  it("una respuesta con otra forma pasa al respaldo, como si no fuera JSON", async () => {
    const primero = new ModeloChatCompatible(DESTINO, {
      fetch: fetchDeMentira([exito('{"resultados": "05.5"}')]).fetch,
    });
    const segundo = new ModeloChatCompatible(
      { ...DESTINO, proveedor: "qwen", modelo: "qwen3" },
      { fetch: fetchDeMentira([exito('{"resultados": ["05.5"]}', { model: "qwen3" })]).fetch },
    );
    const conForma: SolicitudJson = {
      ...SOLICITUD,
      validar: (datos) => Array.isArray((datos as { resultados?: unknown }).resultados),
    };

    const respuesta = await new ModeloConRespaldo([primero, segundo]).responderJson(conForma);

    assert.equal(respuesta.modelo, "qwen3");
    assert.deepEqual(respuesta.desvios, ["groq/openai/gpt-oss-120b respondió JSON con otra forma"]);
  });

  it("un modelo que no contestó a tiempo se salta un rato y el respaldo recibe el tiempo completo", async () => {
    let ahora = 0;
    const vistos: string[] = [];
    const modelo = (nombre: string, falla: boolean) => ({
      nombre,
      responderJson: (_s: SolicitudJson, o: { tiempoMaximoMs?: number } = {}) => {
        vistos.push(`${nombre}:${String(o.tiempoMaximoMs)}`);
        if (falla) {
          ahora += 70_000;
          return Promise.reject(new FallaDeModelo("NO_DISPONIBLE", `${nombre} no respondió`));
        }
        return Promise.resolve({
          datos: {},
          proveedor: "p",
          modelo: nombre,
          tokensDeEntrada: null,
          tokensDeSalida: null,
          milisegundos: 0,
          desvios: [],
        });
      },
    });
    const cadena = new ModeloConRespaldo([modelo("dots", true), modelo("qwen", false)], {
      enfriamientoMs: 300_000,
      tiempoMinimoMs: 15_000,
      reloj: () => ahora,
    });

    await cadena.responderJson(SOLICITUD, { tiempoMaximoMs: 95_000 });
    const segunda = await cadena.responderJson(SOLICITUD, { tiempoMaximoMs: 95_000 });
    assert.deepEqual(vistos, ["dots:95000", "qwen:25000", "qwen:95000"]);
    assert.deepEqual(segunda.desvios, ["dots se saltó: falló hace poco"]);

    ahora += 300_001;
    vistos.length = 0;
    await cadena.responderJson(SOLICITUD, { tiempoMaximoMs: 95_000 });
    assert.equal(vistos[0], "dots:95000");
  });

  it("con menos del mínimo por delante, el respaldo no se empieza", async () => {
    let ahora = 0;
    const vistos: string[] = [];
    const lento = {
      nombre: "lento",
      responderJson: () => {
        vistos.push("lento");
        ahora += 85_000;
        return Promise.reject(new FallaDeModelo("NO_DISPONIBLE", "lento no respondió"));
      },
    };
    const respaldo = {
      nombre: "respaldo",
      responderJson: () => {
        vistos.push("respaldo");
        return Promise.reject(new FallaDeModelo("NO_DISPONIBLE", "no debió llamarse"));
      },
    };
    const cadena = new ModeloConRespaldo([lento, respaldo], {
      tiempoMinimoMs: 15_000,
      reloj: () => ahora,
    });
    await assert.rejects(
      cadena.responderJson(SOLICITUD, { tiempoMaximoMs: 95_000 }),
      (error: unknown) =>
        error instanceof FallaDeModelo &&
        /respaldo no se intentó: no quedaba tiempo/u.test(error.message),
    );
    assert.deepEqual(vistos, ["lento"]);
  });

  it("no arranca el agente si LangSmith recibiría las trazas", () => {
    assert.throws(
      () => leerAgenteDelEntorno({ KCM_IA_OPENROUTER_LLAVE: "o", LANGSMITH_TRACING: "true" }),
      ConfigError,
    );
    assert.equal(leerAgenteDelEntorno({ LANGSMITH_TRACING: "true" }), undefined);
  });
});
