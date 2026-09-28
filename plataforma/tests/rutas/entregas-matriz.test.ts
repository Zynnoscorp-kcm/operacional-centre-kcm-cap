/**
 * El tablero de entregas a la matriz.
 *
 * Lo que se fija aquí es el hueco que el tablero llena: entre liberar en la
 * consola y que el cliente de Excel escriba la fecha en el XLSB pasa un rato en
 * el que nadie sabía nada. El foco rojo dice «todavía no» y el verde «ya», y la
 * equis sólo aparece cuando el verde es de verdad —quitar de la vista algo que
 * sigue esperando sería perderlo justo mientras es lo que hay que vigilar.
 *
 * El adaptador de PostgreSQL no entra aquí: sin base no hay nada que consultar.
 * Lo que se ejercita es la pantalla, la ruta y la regla del servicio, contra un
 * puerto falso que devuelve las tres situaciones.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config/environment.ts";
import { MatrixDeliveryService } from "../../src/domain/liberacion/entregas.ts";
import { DomainError } from "../../src/domain/comun/errores.ts";
import type { MatrixDelivery, MatrixDeliveryPort } from "../../src/ports/entregas-matriz.port.ts";
import { buildServer } from "../../src/server/build-server.ts";

const ahora = "2026-08-31T12:00:00.000Z";
const reloj = { now: () => new Date(ahora), nowIso: () => ahora };

const ESPERANDO: MatrixDelivery = {
  batchId: "11111111-1111-1111-1111-111111111111",
  sessionId: "aaaaaaaa-1111-1111-1111-111111111111",
  sessionCode: "KCM-260830-AAAAAA",
  courseName: "CURSO SINTETICO",
  sessionDate: "2026-08-30",
  releasedAt: "2026-08-30T18:00:00.000Z",
  total: 12,
  delivered: 0,
  rejected: 0,
  state: "PENDIENTE",
  deliveredAt: null,
};

const ENTREGADA: MatrixDelivery = {
  ...ESPERANDO,
  batchId: "22222222-2222-2222-2222-222222222222",
  sessionId: "bbbbbbbb-2222-2222-2222-222222222222",
  sessionCode: "KCM-260829-BBBBBB",
  delivered: 12,
  state: "ENTREGADA",
  deliveredAt: "2026-08-30T19:30:00.000Z",
};

const CON_CONFLICTO: MatrixDelivery = {
  ...ESPERANDO,
  batchId: "33333333-3333-3333-3333-333333333333",
  sessionId: "cccccccc-3333-3333-3333-333333333333",
  sessionCode: "KCM-260828-CCCCCC",
  delivered: 9,
  rejected: 3,
  state: "CON_CONFLICTO",
};

class TableroFalso implements MatrixDeliveryPort {
  readonly ocultadas: string[] = [];
  entregas: MatrixDelivery[] = [ESPERANDO, ENTREGADA, CON_CONFLICTO];

  listDeliveries(limit: number): Promise<readonly MatrixDelivery[]> {
    return Promise.resolve(
      this.entregas.filter((fila) => !this.ocultadas.includes(fila.batchId)).slice(0, limit),
    );
  }

  findDelivery(batchId: string): Promise<MatrixDelivery | null> {
    return Promise.resolve(this.entregas.find((fila) => fila.batchId === batchId) ?? null);
  }

  hideDelivery(input: { readonly batchId: string }): Promise<void> {
    this.ocultadas.push(input.batchId);
    return Promise.resolve();
  }
}

const abiertos: FastifyInstance[] = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()?.close();
});

async function servidor(tablero?: MatrixDeliveryPort): Promise<FastifyInstance> {
  const app = await buildServer({
    config: loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      KCM_PILOT_OPEN_ACCESS: "true",
    }),
    clock: reloj,
    ...(tablero ? { matrixDeliveryRepository: tablero } : {}),
  });
  abiertos.push(app);
  return app;
}

describe("Entregas a la matriz · el tablero de la pantalla de liberación", () => {
  it("enumera lo liberado con su foco: rojo esperando, verde entregado", async () => {
    const app = await servidor(new TableroFalso());
    const pantalla = await app.inject({ method: "GET", url: "/liberacion" });

    assert.equal(pantalla.statusCode, 200);
    assert.match(pantalla.body, /Entregas a la matriz/u);
    for (const codigo of [/KCM-260830-AAAAAA/u, /KCM-260829-BBBBBB/u, /KCM-260828-CCCCCC/u]) {
      assert.match(pantalla.body, codigo);
    }
    // Los tres focos, y el color nunca solo: cada uno lleva su texto.
    assert.match(pantalla.body, /foco foco-rojo/u);
    assert.match(pantalla.body, /foco foco-verde/u);
    assert.match(pantalla.body, /foco foco-ambar/u);
    assert.match(pantalla.body, /Pendiente de escritura en Excel/u);
  });

  it("va plegado, y la dirección lo mantiene abierto al actualizar", async () => {
    const app = await servidor(new TableroFalso());

    const plegado = await app.inject({ method: "GET", url: "/liberacion" });
    assert.doesNotMatch(plegado.body, /<details[^>]*\sopen/u);
    // El botón de actualizar es el que conserva el estado desplegado.
    assert.match(plegado.body, /href="\/liberacion\?entregas=1#entregas"/u);

    const abierto = await app.inject({ method: "GET", url: "/liberacion?entregas=1" });
    assert.match(abierto.body, /<details[^>]*\sopen/u);
  });

  it("la equis sólo se ofrece en las entregas ya confirmadas", async () => {
    const app = await servidor(new TableroFalso());
    const pantalla = await app.inject({ method: "GET", url: "/liberacion" });

    assert.match(
      pantalla.body,
      /action="\/liberacion\/entregas\/22222222-2222-2222-2222-222222222222\/ocultar"/u,
    );
    // La que espera y la que tiene conflicto no la llevan: quitarlas de la vista
    // sería perderlas mientras son las que hay que mirar.
    assert.doesNotMatch(
      pantalla.body,
      /action="\/liberacion\/entregas\/11111111-1111-1111-1111-111111111111\/ocultar"/u,
    );
    assert.doesNotMatch(
      pantalla.body,
      /action="\/liberacion\/entregas\/33333333-3333-3333-3333-333333333333\/ocultar"/u,
    );
  });

  it("ocultar una entregada la saca del tablero y devuelve a la lista desplegada", async () => {
    const tablero = new TableroFalso();
    const app = await servidor(tablero);

    const respuesta = await app.inject({
      method: "POST",
      url: "/liberacion/entregas/22222222-2222-2222-2222-222222222222/ocultar",
    });

    assert.equal(respuesta.statusCode, 303);
    assert.match(respuesta.headers.location ?? "", /^\/liberacion\?entregas=1&aviso=.*#entregas$/u);
    assert.deepEqual(tablero.ocultadas, ["22222222-2222-2222-2222-222222222222"]);

    const despues = await app.inject({ method: "GET", url: "/liberacion?entregas=1" });
    assert.doesNotMatch(despues.body, /KCM-260829-BBBBBB/u);
    // Y las otras dos siguen ahí: ocultar una no vacía el tablero.
    assert.match(despues.body, /KCM-260830-AAAAAA/u);
  });

  it("sin base conectada el tablero lo dice, en vez de parecer vacío", async () => {
    const app = await servidor();
    const pantalla = await app.inject({ method: "GET", url: "/liberacion" });

    assert.match(pantalla.body, /Entregas a la matriz/u);
    assert.match(pantalla.body, /Sin conexión con la base de datos: no hay entregas que seguir/u);
  });
});

describe("Entregas a la matriz · la regla de ocultar", () => {
  const servicio = (tablero: MatrixDeliveryPort) =>
    new MatrixDeliveryService({ repository: tablero });

  it("una entrega que todavía espera no se puede quitar de la vista", async () => {
    const tablero = new TableroFalso();

    await assert.rejects(
      servicio(tablero).hide({
        batchId: ESPERANDO.batchId,
        actor: "PRUEBA",
        requestId: "req-1",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "ENTREGA_SIN_CONFIRMAR",
    );
    assert.deepEqual(tablero.ocultadas, []);
  });

  it("se relee el estado antes de ocultar y no se cree lo que la pantalla enseñó", async () => {
    const tablero = new TableroFalso();
    // La pantalla la dibujó verde, pero para cuando llega la equis ya no lo es.
    tablero.entregas = [{ ...ENTREGADA, delivered: 4, state: "PENDIENTE" }];

    await assert.rejects(
      servicio(tablero).hide({
        batchId: ENTREGADA.batchId,
        actor: "PRUEBA",
        requestId: "req-2",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "ENTREGA_SIN_CONFIRMAR",
    );
  });

  it("un lote que no está en el tablero no se confunde con uno sin confirmar", async () => {
    await assert.rejects(
      servicio(new TableroFalso()).hide({
        batchId: "99999999-9999-9999-9999-999999999999",
        actor: "PRUEBA",
        requestId: "req-3",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "ENTREGA_NO_ENCONTRADA",
    );
  });
});
