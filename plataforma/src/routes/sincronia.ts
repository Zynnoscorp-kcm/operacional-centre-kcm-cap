import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { BitacoraDeCargas } from "../domain/cargas/bitacora.ts";
import type { SincroniaService } from "../domain/sincronia/servicio.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { renderSyncPage, type DatosDeSincronia } from "../web/pages/sincronia.ts";

export interface SyncRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
  readonly service?: SincroniaService;
  readonly cargas?: BitacoraDeCargas;
}

export function registerSyncRoutes(app: FastifyInstance, deps: SyncRouteDeps): void {
  const { config, clock, sessions, service, cargas } = deps;

  const pantalla = (
    respuesta: FastifyReply,
    codigo: number,
    datos: Omit<DatosDeSincronia, "entorno" | "sinBase">,
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .code(codigo)
      .send(
        renderSyncPage({
          entorno: config.environment,
          sinBase: service === undefined,
          ...datos,
        }),
      );

  app.get("/sincronia", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!config.pilot.openAccess && !sessions.leer(peticion.headers.cookie, clock.now())) {
      return respuesta.redirect("/acceso?destino=/sincronia", 303);
    }
    if (!service) return pantalla(respuesta, 503, {});

    try {
      const [informe, padron] = await Promise.all([
        service.cotejar(),
        cargas?.ultimaAplicada("PADRON"),
      ]);
      if (informe) {
        peticion.log.info(
          {
            veredicto: informe.veredicto,
            diferencias: informe.diferenciasTotales,
            equivalentes: informe.equivalentesTotales,
          },
          "cotejo matriz-padrón",
        );
      }
      return pantalla(respuesta, 200, {
        ...(informe ? { informe } : {}),
        ...(padron ? { padronAplicadoEn: padron.ocurridoEn } : {}),
      });
    } catch (error) {
      peticion.log.error({ err: error }, "el cotejo de sincronía no pudo completarse");
      return pantalla(respuesta, 503, {
        error: "El cotejo no pudo completarse: la base no respondió a la consulta de comparación.",
      });
    }
  });
}
