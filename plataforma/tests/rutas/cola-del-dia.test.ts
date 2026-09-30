import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import type { OperativeSessionSummary, SessionStatus } from "../../src/domain/quiosco/tipos.ts";
import { renderHomePage } from "../../src/web/pages/inicio.ts";

const HOY = "2026-09-06";

function sesion(codigo: string, status: SessionStatus): OperativeSessionSummary {
  return {
    sessionId: `sesion-${codigo}`,
    sessionCode: codigo,
    trainingId: "curso-1",
    trainingName: "CURSO SINTETICO",
    instructor: "INSTRUCTOR SINTETICO",
    date: HOY,
    durationMinutes: 60,
    status,
    authorized: true,
    totalAttendances: 4,
  };
}

function portada(sesiones: readonly OperativeSessionSummary[], dc3PorEmitir?: number): string {
  return renderHomePage({
    config: loadConfig({ KCM_ENV: "development" }),
    hoy: HOY,
    sesiones,
    reservas: [],
    porLiberar: [],
    ...(dc3PorEmitir === undefined ? {} : { dc3PorEmitir }),
  });
}

function soloLaCola(html: string): string {
  const inicio = html.indexOf('id="titulo-cola"');
  const fin = html.indexOf("kpi-tira", inicio);
  assert.ok(inicio >= 0 && fin > inicio, "la portada debe abrir con la cola del día");
  return html.slice(inicio, fin);
}

describe("Cola del día", () => {
  it("sin nada pendiente lo dice en una línea y no dibuja ceros", () => {
    const cola = soloLaCola(portada([sesion("KCM-A", "LIBERADA_TOTAL")]));
    assert.match(cola, /Nada pendiente/u);
    assert.doesNotMatch(cola, /cola-fila/u);
  });

  it("enseña sólo los grupos que tienen algo", () => {
    const cola = soloLaCola(
      portada([sesion("KCM-A", "CERRADA"), sesion("KCM-B", "CERRADA"), sesion("KCM-C", "ABIERTA")]),
    );

    assert.match(cola, /esperan su lista física/u);
    assert.match(cola, /abiertas en la sala/u);
    assert.doesNotMatch(cola, /en revisión/u);
    assert.doesNotMatch(cola, /con error/u);
  });

  it("va en el orden de la jornada y no en el de la cifra", () => {
    const cola = soloLaCola(
      portada([
        sesion("KCM-A", "PRELIBERACION"),
        sesion("KCM-B", "PRELIBERACION"),
        sesion("KCM-C", "PRELIBERACION"),
        sesion("KCM-D", "ABIERTA"),
        sesion("KCM-E", "CERRADA"),
        sesion("KCM-F", "CERRADA"),
      ]),
    );

    const abierta = cola.indexOf("abiertas en la sala");
    const cerrada = cola.indexOf("esperan su lista física");
    const revision = cola.indexOf("en revisión");
    assert.ok(abierta < cerrada, "la sesión abierta va antes que la cerrada");
    assert.ok(cerrada < revision, "la cerrada va antes que la que está en revisión");
  });

  it("marca lo que pide acción y no marca lo que ocurre en la sala", () => {
    const cola = soloLaCola(portada([sesion("KCM-A", "ABIERTA"), sesion("KCM-B", "CERRADA")]));
    const filas = cola.split("cola-fila");

    assert.doesNotMatch(filas[1] ?? "", /cola-toca/u);
    assert.match(filas[2] ?? "", /cola-toca/u);
  });

  it("un error se marca distinto de lo que sólo espera turno", () => {
    const cola = soloLaCola(portada([sesion("KCM-A", "ERROR")]));
    assert.match(cola, /cola-alto/u);
    assert.match(cola, /con error/u);
  });

  it("cada renglón lleva a dónde se atiende", () => {
    const cola = soloLaCola(
      portada([sesion("KCM-A", "CERRADA"), sesion("KCM-B", "PRELIBERACION")]),
    );
    assert.match(cola, /href="\/preliberacion"/u);
  });

  it("las constancias DC-3 por emitir entran a la cola y llevan a la bandeja", () => {
    const cola = soloLaCola(portada([], 7));
    assert.match(cola, /constancias DC-3 por emitir/u);
    assert.match(cola, /Cursos desde el 1 de enero de 2026/u);
    assert.match(cola, /href="\/dc3"/u);
    assert.doesNotMatch(cola, /plazo/u);
    assert.doesNotMatch(soloLaCola(portada([], 0)), /DC-3/u);
  });
});
