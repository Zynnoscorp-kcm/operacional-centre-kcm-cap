/**
 * Ruta del análisis de sincronía.
 *
 * Una sola ruta y sólo `GET`: abrir la pestaña corre el cotejo y dibuja el
 * resultado. No hay botón de «analizar» porque no hay nada que confirmar —el
 * análisis no escribe— y un `POST` que sólo lee obligaría a inventarle un estado
 * a una pantalla que no lo tiene.
 *
 * Exige sesión, como las otras tres pestañas de Cargas. No escribe nada, pero
 * enseña números de nómina, puestos y adscripciones de mil setecientas personas,
 * y eso no puede quedar detrás de una URL que cualquiera adivine. Sin sesión se
 * manda a `/acceso` con el destino puesto.
 */

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
  /** Ausente cuando no hay base: la pantalla lo explica y no coteja nada. */
  readonly service?: SincroniaService;
  /** De aquí sale cuándo se aplicó el padrón; el cotejo sólo sabe cuándo corrió. */
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
      // El cotejo es de sólo lectura: si la consulta falla, no hay nada a medio
      // hacer que explicar. Se dice y se deja la pestaña usable, en vez de
      // mandar la pantalla de error genérica por una lectura que no rompió nada.
      peticion.log.error({ err: error }, "el cotejo de sincronía no pudo completarse");
      return pantalla(respuesta, 503, {
        error: "El cotejo no pudo completarse: la base no respondió a la consulta de comparación.",
      });
    }
  });
}
