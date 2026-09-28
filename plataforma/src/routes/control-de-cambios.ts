/**
 * Ruta de Control de cambios.
 *
 * Sólo `GET`: la pestaña avisa y enlaza; aprobar sigue siendo cosa de la
 * revisión de la matriz o del padrón. Nace cerrada por el guardia de la
 * consola, como el historial: enseña nóminas y quién envió qué.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { BitacoraDeCargas } from "../domain/cargas/bitacora.ts";
import type { Clock } from "../ports/reloj.port.ts";
import { armarAvisos, renderChangeControlPage } from "../web/pages/control-de-cambios.ts";

/** Los mismos asientos que el historial: unos cuatro meses de operación. */
const TOPE = 120;

export interface ChangeControlRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly bitacora: BitacoraDeCargas;
}

export function registerChangeControlRoutes(
  app: FastifyInstance,
  deps: ChangeControlRouteDeps,
): void {
  app.get("/cambios", async (_peticion: FastifyRequest, respuesta: FastifyReply) => {
    const asientos = await deps.bitacora.listar(TOPE);
    return respuesta.type("text/html; charset=utf-8").send(
      renderChangeControlPage({
        entorno: deps.config.environment,
        avisos: armarAvisos(asientos, deps.clock.now()),
      }),
    );
  });
}
