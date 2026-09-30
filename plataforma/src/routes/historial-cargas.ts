import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { BitacoraDeCargas } from "../domain/cargas/bitacora.ts";
import type { UltimoLoteAplicado } from "../domain/excel/tipos.ts";
import { renderLoadHistoryPage } from "../web/pages/historial-cargas.ts";

const TOPE = 120;

export interface LoadHistoryRouteDeps {
  readonly config: AppConfig;
  readonly bitacora: BitacoraDeCargas;
  readonly enMemoria: boolean;
  readonly ultimoLote?: () => Promise<UltimoLoteAplicado | undefined>;
}

export function registerLoadHistoryRoutes(app: FastifyInstance, deps: LoadHistoryRouteDeps): void {
  app.get("/cargas", async (_peticion: FastifyRequest, respuesta: FastifyReply) => {
    const [asientos, ultimoLote] = await Promise.all([
      deps.bitacora.listar(TOPE),
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
