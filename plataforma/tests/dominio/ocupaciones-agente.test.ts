import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AgenteDeOcupaciones, type LimitesDelAgente } from "../../src/domain/ocupaciones/agente.ts";
import { catalogoDeLaPlataforma } from "../../src/domain/ocupaciones/catalogo.ts";
import { setTimeout as esperar } from "node:timers/promises";

import {
  FallaDeModelo,
  type ModeloDeLenguajePort,
  type OpcionesDeLlamada,
  type RespuestaJson,
  type SolicitudJson,
} from "../../src/ports/modelo-de-lenguaje.port.ts";

type Guion = unknown;

class ModeloDeGuion implements ModeloDeLenguajePort {
  readonly nombre: string;
  readonly preguntas: SolicitudJson[] = [];
  readonly opciones: OpcionesDeLlamada[] = [];
  readonly #guion: Guion[];
  readonly #demoraMs: number;

  constructor(nombre: string, guion: Guion[], demoraMs = 0) {
    this.nombre = nombre;
    this.#guion = [...guion];
    this.#demoraMs = demoraMs;
  }

  async responderJson(
    solicitud: SolicitudJson,
    opciones: OpcionesDeLlamada = {},
  ): Promise<RespuestaJson> {
    this.preguntas.push(solicitud);
    this.opciones.push(opciones);
    if (this.#demoraMs > 0) await esperar(this.#demoraMs);
    const siguiente = this.#guion.shift();
    if (siguiente === undefined) throw new Error("el guion se acabó");
    if (siguiente instanceof FallaDeModelo) throw siguiente;
    return {
      datos: siguiente,
      proveedor: "prueba",
      modelo: this.nombre,
      tokensDeEntrada: 100,
      tokensDeSalida: 20,
      milisegundos: 1,
      desvios: [],
    };
  }
}

const LIMITES: LimitesDelAgente = {
  maxSubareas: 2,
  maxOpciones: 260,
  reintentosPorCodigoInvalido: 1,
  intentosPorLlamada: 2,
  esperaInicialMs: 1,
  limiteDePasos: 20,
  tiempoMaximoMs: 10_000,
  tiempoMinimoPorLlamadaMs: 0,
};

const CASO = { puesto: "*OPERARIO 2°", centroDeCostos: "HIGIENICOS" } as const;

const subareas = (...claves: string[]) => ({ subareas: claves, motivo: "fabrica papel" });
const ocupacion = (codigo: string, confianza = "alta", alternativa = "") => ({
  codigo,
  alternativa,
  confianza,
  motivo: "opera la máquina de papel",
});

function agente(
  principal: ModeloDeLenguajePort,
  verificador?: ModeloDeLenguajePort,
  limites = LIMITES,
) {
  return new AgenteDeOcupaciones({
    catalogo: catalogoDeLaPlataforma(),
    principal,
    ...(verificador ? { verificador } : {}),
    limites,
  });
}

describe("Ocupaciones · agente en LangGraph", () => {
  it("sugiere cuando principal y verificador coinciden, con la descripción del catálogo", async () => {
    const principal = new ModeloDeGuion("principal", [
      subareas("05.5"),
      ocupacion("552081900", "alta", "552090402"),
    ]);
    const verificador = new ModeloDeGuion("verificador", [
      subareas("05.5"),
      ocupacion("552081900"),
    ]);

    const resultado = await agente(principal, verificador).clasificar(CASO);

    assert.equal(resultado.estado, "sugerida");
    assert.equal(resultado.sugerencia?.codigo, "552081900");
    assert.equal(resultado.sugerencia?.descripcion, "OPERADOR MÁQUINA FABRICACIÓN ARTÍCULOS PAPEL");
    assert.equal(resultado.sugerencia?.subarea, "05.5");
    assert.equal(resultado.sugerencia?.alternativa?.codigo, "552090402");
    assert.deepEqual(
      resultado.traza.map((paso) => paso.nodo),
      AgenteDeOcupaciones.NODOS,
    );
    assert.equal(resultado.traza[0]?.modelo, "principal");
    assert.equal(resultado.traza[0]?.tokensDeEntrada, 100);
  });

  it("al proveedor sólo viajan puesto, centro de costos y el catálogo", async () => {
    const principal = new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900")]);
    await agente(principal).clasificar(CASO);

    const [primera, segunda] = principal.preguntas;
    assert.equal(primera?.mensaje, "Puesto: *OPERARIO 2°\nCentro de costos: HIGIENICOS");
    assert.ok(
      segunda?.mensaje.startsWith("Puesto: *OPERARIO 2°\nCentro de costos: HIGIENICOS\n\n"),
    );
    assert.match(segunda?.mensaje ?? "", /Opciones de 05\.5 Materia orgánica:/u);
    assert.doesNotMatch(segunda?.mensaje ?? "", /Opciones de 04\./u);
    for (const pregunta of principal.preguntas) {
      assert.doesNotMatch(pregunta.instrucciones, /kimberly|clark|ecatepec/iu);
    }
  });

  it("si no coinciden, el caso va a revisar con las dos propuestas", async () => {
    const principal = new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900")]);
    const verificador = new ModeloDeGuion("verificador", [
      subareas("05.5"),
      ocupacion("552090402", "media"),
    ]);

    const resultado = await agente(principal, verificador).clasificar(CASO);

    assert.equal(resultado.estado, "revisar");
    assert.equal(resultado.principal?.codigo, "552081900");
    assert.equal(resultado.verificador?.codigo, "552090402");
    assert.match(resultado.razon, /no coinciden/u);
  });

  it("coincidir con confianza baja tampoco basta", async () => {
    const principal = new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900")]);
    const verificador = new ModeloDeGuion("verificador", [
      subareas("05.5"),
      ocupacion("552081900", "baja"),
    ]);
    const resultado = await agente(principal, verificador).clasificar(CASO);
    assert.equal(resultado.estado, "revisar");
    assert.match(resultado.razon, /confianza baja/u);
  });

  it("un código fuera de la lista se pide de nuevo una vez, con el motivo", async () => {
    const principal = new ModeloDeGuion("principal", [
      subareas("05.5"),
      ocupacion("1034070202"),
      ocupacion("552081900"),
    ]);

    const resultado = await agente(principal).clasificar(CASO);

    assert.equal(resultado.estado, "sugerida");
    assert.match(principal.preguntas[2]?.mensaje ?? "", /Aviso: .*1034070202 no está en la lista/u);
    assert.ok(resultado.traza.some((paso) => /se pide de nuevo/u.test(paso.nota)));
  });

  it("dos códigos inválidos dejan al principal sin propuesta y manda la del verificador a revisar", async () => {
    const principal = new ModeloDeGuion("principal", [
      subareas("05.5"),
      ocupacion("999999999"),
      ocupacion("999999999"),
    ]);
    const verificador = new ModeloDeGuion("verificador", [
      subareas("05.5"),
      ocupacion("552081900"),
    ]);

    const resultado = await agente(principal, verificador).clasificar(CASO);

    assert.equal(resultado.estado, "revisar");
    assert.equal(resultado.principal, null);
    assert.equal(resultado.sugerencia?.codigo, "552081900");
    assert.match(resultado.razon, /sólo respondió el verificador/u);
  });

  it("una falla transitoria se reintenta con la política del nodo", async () => {
    const principal = new ModeloDeGuion("principal", [
      new FallaDeModelo("LIMITE", "prueba respondió 429"),
      subareas("05.5"),
      ocupacion("552081900"),
    ]);
    const resultado = await agente(principal).clasificar(CASO);
    assert.equal(resultado.estado, "sugerida");
    assert.equal(principal.preguntas.length, 3);
  });

  it("una llave mala no se reintenta: el caso termina sin respuesta, sin excepción", async () => {
    const principal = new ModeloDeGuion("principal", [
      new FallaDeModelo("LLAVE", "prueba respondió 401"),
    ]);
    const resultado = await agente(principal).clasificar(CASO);
    assert.equal(resultado.estado, "sin_respuesta");
    assert.equal(principal.preguntas.length, 1);
    assert.match(resultado.razon, /401/u);
  });

  it("sin verificador, sólo la confianza alta llega a sugerida", async () => {
    const alta = await agente(
      new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900", "alta")]),
    ).clasificar(CASO);
    const media = await agente(
      new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900", "media")]),
    ).clasificar(CASO);
    assert.equal(alta.estado, "sugerida");
    assert.equal(media.estado, "revisar");
  });

  it("la segunda subárea se omite si rebasa el tope de opciones, y la traza lo dice", async () => {
    const principal = new ModeloDeGuion("principal", [
      subareas("05.5", "04.1"),
      ocupacion("552081900"),
    ]);
    const resultado = await agente(principal, undefined, {
      ...LIMITES,
      maxOpciones: 250,
    }).clasificar(CASO);
    assert.equal(resultado.estado, "sugerida");
    assert.doesNotMatch(principal.preguntas[1]?.mensaje ?? "", /Opciones de 04\.1/u);
    assert.ok(resultado.traza.some((paso) => /se omitió 04\.1/u.test(paso.nota)));
  });

  it("descarta subáreas que no existen y se queda con las válidas", async () => {
    const principal = new ModeloDeGuion("principal", [
      subareas("99.9", "05.5"),
      ocupacion("552081900"),
    ]);
    const resultado = await agente(principal).clasificar(CASO);
    assert.equal(resultado.estado, "sugerida");
    assert.match(resultado.traza[0]?.nota ?? "", /^subáreas 05\.5$/u);
  });
  it("los dos papeles corren a la vez: el caso tarda lo que el más lento, no la suma", async () => {
    const principal = new ModeloDeGuion(
      "principal",
      [subareas("05.5"), ocupacion("552081900")],
      300,
    );
    const verificador = new ModeloDeGuion(
      "verificador",
      [subareas("05.5"), ocupacion("552081900")],
      300,
    );
    const inicio = Date.now();
    const resultado = await agente(principal, verificador).clasificar(CASO);
    const transcurrido = Date.now() - inicio;
    assert.equal(resultado.estado, "sugerida");
    assert.ok(transcurrido < 1000, `tardó ${String(transcurrido)} ms`);
  });

  it("cada llamada recibe sólo el tiempo que le queda al caso", async () => {
    const principal = new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900")]);
    await agente(principal).clasificar(CASO);
    for (const opciones of principal.opciones) {
      assert.ok(
        opciones.tiempoMaximoMs !== undefined && opciones.tiempoMaximoMs <= LIMITES.tiempoMaximoMs,
      );
    }
  });

  it("sin tiempo para una llamada, el papel ni la empieza y el caso no se cuelga", async () => {
    const principal = new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900")]);
    const verificador = new ModeloDeGuion("verificador", [
      subareas("05.5"),
      ocupacion("552081900"),
    ]);
    const resultado = await agente(principal, verificador, {
      ...LIMITES,
      tiempoMaximoMs: 1000,
      tiempoMinimoPorLlamadaMs: 5000,
    }).clasificar(CASO);
    assert.equal(resultado.estado, "sin_respuesta");
    assert.equal(principal.preguntas.length + verificador.preguntas.length, 0);
    assert.match(resultado.razon, /no alcanzó el plazo del caso/u);
  });

  it("si el verificador no alcanza, la propuesta del principal se conserva para revisar", async () => {
    const principal = new ModeloDeGuion("principal", [subareas("05.5"), ocupacion("552081900")]);
    const verificador = new ModeloDeGuion("verificador", [
      new FallaDeModelo("NO_DISPONIBLE", "verificador no respondió en 70000 ms"),
      new FallaDeModelo("NO_DISPONIBLE", "verificador no respondió en 70000 ms"),
    ]);
    const resultado = await agente(principal, verificador).clasificar(CASO);
    assert.equal(resultado.estado, "revisar");
    assert.equal(resultado.sugerencia?.codigo, "552081900");
    assert.match(resultado.razon, /sin verificación: verificador no respondió/u);
  });
});
