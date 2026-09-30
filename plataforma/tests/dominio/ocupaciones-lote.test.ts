import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DomainError } from "../../src/domain/comun/errores.ts";
import { catalogoDeLaPlataforma } from "../../src/domain/ocupaciones/catalogo.ts";
import type { CasoEnLote } from "../../src/domain/ocupaciones/instrucciones.ts";
import {
  ClasificadorPorLotes,
  type EstadoDelLote,
  type LimitesDelLote,
} from "../../src/domain/ocupaciones/lote.ts";
import {
  FallaDeModelo,
  type ModeloDeLenguajePort,
  type RespuestaJson,
  type SolicitudJson,
} from "../../src/ports/modelo-de-lenguaje.port.ts";

type Decision = (id: string) => { codigo: string; confianza?: string } | null;

class ModeloDeLote implements ModeloDeLenguajePort {
  readonly nombre: string;
  readonly preguntas: SolicitudJson[] = [];
  readonly #subarea: (id: string) => string[] | null;
  readonly #ocupacion: Decision;
  readonly #fallas: FallaDeModelo[];
  readonly #reloj: { ahora: number } | undefined;

  constructor(
    nombre: string,
    opciones: {
      subarea?: (id: string) => string[] | null;
      ocupacion?: Decision;
      fallas?: FallaDeModelo[];
      reloj?: { ahora: number };
    } = {},
  ) {
    this.nombre = nombre;
    this.#subarea = opciones.subarea ?? (() => ["05.5"]);
    this.#ocupacion = opciones.ocupacion ?? (() => ({ codigo: "552081900" }));
    this.#fallas = [...(opciones.fallas ?? [])];
    this.#reloj = opciones.reloj;
  }

  responderJson(solicitud: SolicitudJson): Promise<RespuestaJson> {
    this.preguntas.push(solicitud);
    if (this.#reloj) this.#reloj.ahora += 30_000;
    const falla = this.#fallas.shift();
    if (falla) return Promise.reject(falla);
    const ids = idsDe(solicitud.mensaje);
    const resultados =
      solicitud.esquema.nombre === "subareas_en_lote"
        ? ids.flatMap((id) => {
            const subareas = this.#subarea(id);
            return subareas ? [{ id, subareas, motivo: "prueba" }] : [];
          })
        : ids.flatMap((id) => {
            const decision = this.#ocupacion(id);
            return decision
              ? [
                  {
                    id,
                    codigo: decision.codigo,
                    alternativa: "",
                    confianza: decision.confianza ?? "alta",
                    motivo: "prueba",
                  },
                ]
              : [];
          });
    return Promise.resolve({
      datos: { resultados },
      proveedor: "prueba",
      modelo: this.nombre,
      tokensDeEntrada: 10,
      tokensDeSalida: 5,
      milisegundos: 1,
      desvios: [],
    });
  }
}

function idsDe(mensaje: string): string[] {
  return [...mensaje.matchAll(/^(C\d{3}) \| /gmu)].map((coincidencia) => coincidencia[1] ?? "");
}

function casos(cuantos: number): CasoEnLote[] {
  return Array.from({ length: cuantos }, (_, indice) => ({
    id: `C${String(indice + 1).padStart(3, "0")}`,
    puesto: `*OPERARIO ${String((indice % 3) + 1)}°`,
    centroDeCostos: indice % 2 === 0 ? "HIGIENICOS" : "SERVILLETAS Y FACIALES",
  }));
}

const LIMITES: LimitesDelLote = {
  casosPorCorrida: 30,
  casosPorTandaDeSubarea: 20,
  casosPorTandaDeOcupacion: 6,
  tandasEnParaleloPorPapel: 2,
  maxSubareas: 2,
  maxOpciones: 260,
  intentosPorCaso: 2,
  fallasSeguidasPorPapel: 3,
  tandasFallidasPorCaso: 4,
  esperaTrasFallaMs: 0,
  tiempoPorPasoMs: 100_000,
  tiempoMinimoPorTandaMs: 0,
  limiteDePasos: 200,
};

function clasificador(
  principal: ModeloDeLenguajePort,
  verificador?: ModeloDeLenguajePort,
  limites: LimitesDelLote = LIMITES,
  reloj?: { ahora: number },
  esperas: number[] = [],
) {
  return new ClasificadorPorLotes({
    catalogo: catalogoDeLaPlataforma(),
    principal,
    ...(verificador ? { verificador } : {}),
    limites,
    version: "v-prueba",
    huella: "h-prueba",
    ...(reloj ? { reloj: () => reloj.ahora } : {}),
    esperar: (milisegundos) => {
      esperas.push(milisegundos);
      if (reloj) reloj.ahora += milisegundos;
      return Promise.resolve();
    },
  });
}

async function hastaTerminar(lote: ClasificadorPorLotes, estado: EstadoDelLote) {
  let actual = estado;
  for (let vuelta = 0; vuelta < 20; vuelta += 1) {
    const avance = await lote.avanzar(lote.leer(JSON.stringify(actual)));
    if (avance.terminado) return { ...avance, vueltas: vuelta + 1 };
    actual = avance.estado;
  }
  throw new Error("el lote no terminó");
}

describe("Ocupaciones · agente por lotes", () => {
  it("14 casos: 8 peticiones en lugar de 56, y todos sugeridos si los dos papeles coinciden", async () => {
    const principal = new ModeloDeLote("principal");
    const verificador = new ModeloDeLote("verificador");
    const lote = clasificador(principal, verificador);

    const avance = await lote.avanzar(lote.iniciar(casos(14)));

    assert.equal(avance.terminado, true);
    assert.equal(avance.estado.consultas, 8);
    assert.equal(avance.resultados?.length, 14);
    assert.ok(avance.resultados?.every((resultado) => resultado.estado === "sugerida"));
    assert.equal(
      avance.resultados?.[0]?.sugerencia?.descripcion,
      "OPERADOR MÁQUINA FABRICACIÓN ARTÍCULOS PAPEL",
    );
  });

  it("las tandas respetan sus topes y la ocupación sólo ve las opciones de su subárea", async () => {
    const principal = new ModeloDeLote("principal", {
      subarea: (id) => (Number(id.slice(1)) % 2 === 0 ? ["04.1"] : ["05.5"]),
      ocupacion: (id) => ({ codigo: Number(id.slice(1)) % 2 === 0 ? "413050300" : "552081900" }),
    });
    const lote = clasificador(principal);
    await lote.avanzar(lote.iniciar(casos(30)));

    for (const pregunta of principal.preguntas) {
      const cuantos = idsDe(pregunta.mensaje).length;
      if (pregunta.esquema.nombre === "subareas_en_lote") assert.ok(cuantos <= 20);
      else {
        assert.ok(cuantos <= 6, `una tanda de ocupación llevó ${String(cuantos)} casos`);
        const una = /Opciones de 05\.5/u.test(pregunta.mensaje);
        const otra = /Opciones de 04\.1/u.test(pregunta.mensaje);
        assert.ok(una !== otra, "cada tanda de ocupación muestra una sola subárea");
      }
    }
  });

  it("el verificador arma sus lotes con los casos en orden inverso", async () => {
    const principal = new ModeloDeLote("principal");
    const verificador = new ModeloDeLote("verificador");
    const lote = clasificador(principal, verificador);
    await lote.avanzar(lote.iniciar(casos(5)));

    assert.deepEqual(idsDe(principal.preguntas[0]?.mensaje ?? ""), [
      "C001",
      "C002",
      "C003",
      "C004",
      "C005",
    ]);
    assert.deepEqual(idsDe(verificador.preguntas[0]?.mensaje ?? ""), [
      "C005",
      "C004",
      "C003",
      "C002",
      "C001",
    ]);
  });

  it("al modelo sólo viajan identificador, puesto y centro de costos, y pide resolverlos por separado", async () => {
    const principal = new ModeloDeLote("principal");
    const lote = clasificador(principal);
    await lote.avanzar(lote.iniciar(casos(2)));

    const [primera] = principal.preguntas;
    assert.equal(
      primera?.mensaje,
      "Casos:\nC001 | Puesto: *OPERARIO 1° | Centro de costos: HIGIENICOS\n" +
        "C002 | Puesto: *OPERARIO 2° | Centro de costos: SERVILLETAS Y FACIALES",
    );
    assert.match(primera?.instrucciones ?? "", /Resuelve cada caso por separado/u);
    assert.match(primera?.instrucciones ?? "", /No copies la respuesta de un caso a otro/u);
  });

  it("un código fuera de la lista vuelve a preguntarse con el motivo, sólo para ese caso", async () => {
    let primeraVez = true;
    const principal = new ModeloDeLote("principal", {
      ocupacion: (id) => {
        if (id === "C002" && primeraVez) {
          primeraVez = false;
          return { codigo: "1034070202" };
        }
        return { codigo: "552081900" };
      },
    });
    const lote = clasificador(principal);
    const avance = await lote.avanzar(lote.iniciar(casos(3)));

    const reintento = principal.preguntas.at(-1)?.mensaje ?? "";
    assert.deepEqual(idsDe(reintento), ["C002"]);
    assert.match(reintento, /C002: no sirvió porque el código elegido no está en la lista/u);
    assert.doesNotMatch(reintento, /1034070202/u);
    assert.ok(avance.resultados?.every((resultado) => resultado.estado === "sugerida"));
  });

  it("un caso que nunca llega en la respuesta se da por fallido al agotar sus intentos", async () => {
    const principal = new ModeloDeLote("principal", {
      ocupacion: (id) => (id === "C001" ? null : { codigo: "552081900" }),
    });
    const verificador = new ModeloDeLote("verificador");
    const lote = clasificador(principal, verificador);
    const avance = await lote.avanzar(lote.iniciar(casos(2)));

    const [c1, c2] = avance.resultados ?? [];
    assert.equal(c1?.estado, "revisar");
    assert.equal(c1?.principal, null);
    assert.match(c1?.razon ?? "", /sólo respondió el verificador.*sin respuesta tras 2 intentos/u);
    assert.equal(c2?.estado, "sugerida");
  });

  it("si no coinciden, el caso va a revisar con las dos propuestas", async () => {
    const principal = new ModeloDeLote("principal");
    const verificador = new ModeloDeLote("verificador", {
      ocupacion: (id) => ({ codigo: id === "C001" ? "552090402" : "552081900" }),
    });
    const lote = clasificador(principal, verificador);
    const avance = await lote.avanzar(lote.iniciar(casos(2)));
    assert.equal(avance.resultados?.[0]?.estado, "revisar");
    assert.match(avance.resultados?.[0]?.razon ?? "", /no coinciden/u);
    assert.equal(avance.resultados?.[1]?.estado, "sugerida");
  });

  it("fallas seguidas del proveedor tiran al papel sin gastar los intentos de los casos", async () => {
    const limite = () => new FallaDeModelo("LIMITE", "principal respondió 429");
    const principal = new ModeloDeLote("principal", { fallas: [limite(), limite(), limite()] });
    const verificador = new ModeloDeLote("verificador");
    const lote = clasificador(principal, verificador);
    const avance = await lote.avanzar(lote.iniciar(casos(3)));

    assert.equal(principal.preguntas.length, 3);
    assert.ok(avance.resultados?.every((resultado) => resultado.estado === "revisar"));
    assert.match(avance.resultados?.[0]?.razon ?? "", /falló 3 tandas seguidas/u);
    assert.equal(avance.resultados?.[0]?.sugerencia?.codigo, "552081900");
  });

  it("un parpadeo del proveedor no tira al papel: espera cada vez más y sigue", async () => {
    const caida = () => new FallaDeModelo("NO_DISPONIBLE", "principal respondió 502");
    const principal = new ModeloDeLote("principal", { fallas: [caida(), caida()] });
    const esperas: number[] = [];
    const lote = clasificador(
      principal,
      new ModeloDeLote("verificador"),
      { ...LIMITES, esperaTrasFallaMs: 5000 },
      undefined,
      esperas,
    );
    const avance = await lote.avanzar(lote.iniciar(casos(3)));

    assert.deepEqual(esperas, [5000, 10_000]);
    assert.ok(avance.resultados?.every((resultado) => resultado.estado === "sugerida"));
    assert.equal(principal.preguntas.length, 4);
  });

  it("una petición que siempre falla se parte y no se repite sin fin", async () => {
    const base = new ModeloDeLote("principal");
    let conC001 = 0;
    const principal: ModeloDeLenguajePort = {
      nombre: "principal",
      responderJson: (solicitud) => {
        if (idsDe(solicitud.mensaje).includes("C001")) {
          conC001 += 1;
          return Promise.reject(new FallaDeModelo("DEMASIADO_GRANDE", "principal respondió 413"));
        }
        return base.responderJson(solicitud);
      },
    };
    const lote = clasificador(principal, new ModeloDeLote("verificador"));
    const final = await hastaTerminar(lote, lote.iniciar(casos(6)));
    const estado = (id: string) => final.resultados?.find((r) => r.id === id);

    assert.equal(conC001, 4);
    assert.equal(estado("C001")?.estado, "revisar");
    assert.match(estado("C001")?.razon ?? "", /falló en 4 tandas: principal respondió 413/u);
    for (const id of ["C003", "C004", "C005", "C006"]) assert.equal(estado(id)?.estado, "sugerida");
  });

  it("una llave mala tira al papel de inmediato", async () => {
    const principal = new ModeloDeLote("principal", {
      fallas: [new FallaDeModelo("LLAVE", "principal respondió 401")],
    });
    const lote = clasificador(principal);
    const avance = await lote.avanzar(lote.iniciar(casos(2)));
    assert.equal(principal.preguntas.length, 1);
    assert.ok(avance.resultados?.every((resultado) => resultado.estado === "sin_respuesta"));
    assert.match(avance.resultados?.[0]?.razon ?? "", /401/u);
  });

  it("sin tiempo para otra tanda, el paso termina y el siguiente sigue donde se quedó", async () => {
    const reloj = { ahora: 0 };
    const principal = new ModeloDeLote("principal", { reloj });
    const verificador = new ModeloDeLote("verificador", { reloj });
    const lote = clasificador(
      principal,
      verificador,
      { ...LIMITES, tiempoPorPasoMs: 100_000, tiempoMinimoPorTandaMs: 50_000 },
      reloj,
    );

    const primero = await lote.avanzar(lote.iniciar(casos(14)));
    assert.equal(primero.terminado, false);
    assert.ok(primero.estado.consultas > 0 && primero.estado.consultas < 8);

    const final = await hastaTerminar(lote, primero.estado);
    assert.equal(final.estado.consultas, 8, "reanudar no repite peticiones");
    assert.ok(final.resultados?.every((resultado) => resultado.estado === "sugerida"));
  });

  it("lo decidido que regresa de Excel se valida contra el catálogo", async () => {
    const lote = clasificador(new ModeloDeLote("principal"));
    const avance = await lote.avanzar(lote.iniciar(casos(1)));
    const estado = avance.estado;
    const propuesta = estado.principal.propuestas.C001;
    assert.ok(propuesta);

    const alterada = {
      ...estado,
      principal: {
        ...estado.principal,
        propuestas: { C001: { ...propuesta, descripcion: "OTRA COSA" } },
      },
    };
    assert.equal(
      lote.leer(JSON.stringify(alterada)).principal.propuestas.C001?.descripcion,
      "OPERADOR MÁQUINA FABRICACIÓN ARTÍCULOS PAPEL",
    );

    const inventada = {
      ...estado,
      principal: {
        ...estado.principal,
        propuestas: { C001: { ...propuesta, codigo: "999999999" } },
      },
    };
    assert.throws(
      () => lote.leer(JSON.stringify(inventada)),
      (error: unknown) => error instanceof DomainError && error.code === "LOTE_INVALIDO",
    );
  });

  it("el estado que regresa de Excel se valida entero antes de seguir", () => {
    const lote = clasificador(new ModeloDeLote("principal"));
    const estado = lote.iniciar(casos(2));
    assert.deepEqual(lote.leer(JSON.stringify(estado)), estado);

    const codigo = (texto: string) => (error: unknown) =>
      error instanceof DomainError && error.code === texto;
    assert.throws(() => lote.leer("no es json"), codigo("LOTE_INVALIDO"));
    assert.throws(
      () => lote.leer(JSON.stringify({ ...estado, version: "otra" })),
      codigo("LOTE_DE_OTRA_VERSION"),
    );
    assert.throws(
      () =>
        lote.leer(
          JSON.stringify({
            ...estado,
            casos: [{ id: "C001", puesto: "28392", centroDeCostos: "AGUA" }],
          }),
        ),
      codigo("CASO_CON_DATO_PERSONAL"),
    );
    assert.throws(
      () =>
        lote.leer(
          JSON.stringify({ ...estado, casos: [{ id: "X", puesto: "A", centroDeCostos: "B" }] }),
        ),
      codigo("LOTE_INVALIDO"),
    );
    const [primero] = estado.casos;
    assert.throws(
      () => lote.leer(JSON.stringify({ ...estado, casos: [primero, primero] })),
      codigo("LOTE_INVALIDO"),
    );
  });

  it("subáreas y avisos alterados en Excel no llegan al prompt", () => {
    const lote = clasificador(new ModeloDeLote("principal"));
    const estado = lote.iniciar(casos(2));
    const codigo = (error: unknown) =>
      error instanceof DomainError && error.code === "LOTE_INVALIDO";
    const conPapel = (principal: Record<string, unknown>) =>
      JSON.stringify({ ...estado, principal: { ...estado.principal, ...principal } });

    assert.throws(
      () => lote.leer(conPapel({ subareas: { C001: ["GARCIA,LOPEZ,JUAN 28392"] } })),
      codigo,
    );
    assert.throws(() => lote.leer(conPapel({ subareas: { C001: ["05.5", "05.5"] } })), codigo);
    assert.throws(() => lote.leer(conPapel({ subareas: { C001: [] } })), codigo);
    assert.throws(
      () => lote.leer(conPapel({ avisos: { C001: "trabajador 28392, juan@correo.mx" } })),
      codigo,
    );
    const leido = lote.leer(
      conPapel({
        subareas: { C001: [" 05.5"] },
        avisos: { C001: "faltó en la respuesta", C002: "" },
      }),
    );
    assert.deepEqual(leido.principal.subareas, { C001: ["05.5"] });
  });

  it("un lote no pasa del tope de la corrida, ni al empezar ni al regresar de Excel", () => {
    const lote = clasificador(new ModeloDeLote("principal"), undefined, {
      ...LIMITES,
      casosPorCorrida: 2,
    });
    const codigo = (error: unknown) =>
      error instanceof DomainError && error.code === "LOTE_INVALIDO";
    assert.throws(() => lote.iniciar(casos(3)), codigo);
    const estado = lote.iniciar(casos(2));
    assert.throws(() => lote.leer(JSON.stringify({ ...estado, casos: casos(3) })), codigo);
  });
});
