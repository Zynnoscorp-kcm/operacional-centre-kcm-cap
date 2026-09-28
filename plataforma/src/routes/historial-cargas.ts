/**
 * Ruta del historial de cargas.
 *
 * Una sola ruta y sólo `GET`: aquí no se corrige nada. Un historial que se puede
 * editar desde la pantalla que lo muestra no es un historial, y es la misma
 * regla que ya rige las tres vistas de auditoría.
 *
 * No declara compuerta de sesión propia. El guardia de la consola deniega por
 * omisión, de modo que una ruta nueva nace cerrada: para dejarla abierta
 * habría que declararla en su lista blanca con un motivo, y ésta no lo tiene —
 * enseña qué archivos entraron a la base y quién los aplicó—.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { BitacoraDeCargas } from "../domain/cargas/bitacora.ts";
import type { UltimoLoteAplicado } from "../domain/excel/tipos.ts";
import { renderLoadHistoryPage } from "../web/pages/historial-cargas.ts";

/**
 * Cuántos asientos se traen.
 *
 * Con dos cargas por semana y cuatro momentos por carga, ciento veinte son unos
 * cuatro meses de operación: alcanza para responder «¿qué pasó esa semana?» sin
 * paginar, que sería una pantalla más para un uso que no la pide.
 */
const TOPE = 120;

export interface LoadHistoryRouteDeps {
  readonly config: AppConfig;
  readonly bitacora: BitacoraDeCargas;
  /** Falso cuando la bitácora escribe en la base; verdadero cuando es la de memoria. */
  readonly enMemoria: boolean;
  /** El último envío chico de fechas que Excel confirmó haber escrito. */
  readonly ultimoLote?: () => Promise<UltimoLoteAplicado | undefined>;
}

export function registerLoadHistoryRoutes(app: FastifyInstance, deps: LoadHistoryRouteDeps): void {
  app.get("/cargas", async (_peticion: FastifyRequest, respuesta: FastifyReply) => {
    const [asientos, ultimoLote] = await Promise.all([
      deps.bitacora.listar(TOPE),
      // Una falla aquí no debe tumbar el historial: el lote es un dato de más.
      deps.ultimoLote?.().catch(() => undefined),
    ]);
    return respuesta.type("text/html; charset=utf-8").send(
      renderLoadHistoryPage({
        entorno: deps.config.environment,
        asientos,
        enMemoria: deps.enMemoria,
        ...(ultimoLote ? { ultimoLote } : {}),
      }),
    );
  });
}
