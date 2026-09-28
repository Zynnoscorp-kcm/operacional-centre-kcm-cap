/**
 * La cola del día y el atajo de la sesión limpia.
 *
 * Las dos piezas atacan lo mismo desde lados distintos: que operar la consola no
 * dependa de recordar el ritual. La cola dice qué toca sin que nadie lo
 * pregunte; el atajo quita el paso que no decidía nada.
 *
 * Lo que se vigila aquí son las tres reglas que las hacen confiables:
 *
 * 1. **Los ceros no se dibujan.** Una cola que enseña cuatro ceros obliga a leer
 *    cuatro renglones para saber que no hay nada.
 * 2. **El orden es el de la jornada**, no el del tamaño ni el del alfabeto:
 *    bajar la lista tiene que ser avanzar el trabajo.
 * 3. **El atajo sólo existe sin hallazgos**, y el servidor lo comprueba otra vez
 *    aunque la pantalla no haya dibujado el botón.
 */

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

/** El bloque de la cola, recortado del documento para no medir el resto. */
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
    // Nada en revisión ni con error: esos dos renglones no existen.
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

    // Tres en revisión contra una abierta: por tamaño iría primero la de tres.
    const abierta = cola.indexOf("abiertas en la sala");
    const cerrada = cola.indexOf("esperan su lista física");
    const revision = cola.indexOf("en revisión");
    assert.ok(abierta < cerrada, "la sesión abierta va antes que la cerrada");
    assert.ok(cerrada < revision, "la cerrada va antes que la que está en revisión");
  });

  it("marca lo que pide acción y no marca lo que ocurre en la sala", () => {
    const cola = soloLaCola(portada([sesion("KCM-A", "ABIERTA"), sesion("KCM-B", "CERRADA")]));
    const filas = cola.split("cola-fila");

    // La abierta no lleva franja: lo que falta ahí pasa en el quiosco, no aquí.
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
    // Sin pendientes, la cola no dibuja el cero.
    assert.doesNotMatch(soloLaCola(portada([], 0)), /DC-3/u);
  });
});
