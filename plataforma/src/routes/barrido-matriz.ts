import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { MatrixScanService } from "../domain/barrido-matriz/servicio.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { renderMatrixScanPage, type DatosDeBarrido } from "../web/pages/barrido-matriz.ts";

export interface MatrixScanRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
  readonly service?: MatrixScanService;
}

export function registerMatrixScanRoutes(app: FastifyInstance, deps: MatrixScanRouteDeps): void {
  const { config, clock, sessions, service } = deps;

  const pantalla = (
    respuesta: FastifyReply,
    codigo: number,
    datos: Omit<DatosDeBarrido, "entorno" | "sinBase">,
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .code(codigo)
      .send(
        renderMatrixScanPage({
          entorno: config.environment,
          papel: config.role,
          sinBase: service === undefined,
          ...datos,
        }),
      );

  const estado = (): Omit<DatosDeBarrido, "entorno" | "sinBase"> => {
    if (!service) return {};
    const informe = service.ultimoBarrido();
    const resultado = service.ultimoResultado();
    const comparacion = service.comparacion();
    return {
      ...(informe ? { informe } : {}),
      ...(resultado ? { resultado } : {}),
      ...(comparacion ? { comparacion } : {}),
    };
  };

  const conSesion = (peticion: FastifyRequest, respuesta: FastifyReply): boolean => {
    if (config.pilot.openAccess) return true;
    if (sessions.leer(peticion.headers.cookie, clock.now())) return true;
    void respuesta.redirect("/acceso?destino=/matriz", 303);
    return false;
  };

  const actor = (peticion: FastifyRequest): string =>
    sessions.leer(peticion.headers.cookie, clock.now())?.usuario ?? "acceso-abierto";

  const sinBase = (respuesta: FastifyReply): FastifyReply =>
    pantalla(respuesta, 503, {
      error: "Sin conexión con la base de datos: no hay contra qué comparar la matriz.",
    });

  app.get("/matriz", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!conSesion(peticion, respuesta)) return respuesta;
    await service?.sincronizar();
    return pantalla(respuesta, 200, estado());
  });

  app.post("/matriz/descartar", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!conSesion(peticion, respuesta)) return respuesta;
    if (!service) return sinBase(respuesta);
    await service.descartar();
    peticion.log.info("revisión de barrido descartada");
    return respuesta.redirect("/matriz", 303);
  });

  app.post("/matriz/aplicar", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!conSesion(peticion, respuesta)) return respuesta;
    if (!service) return sinBase(respuesta);

    const cuerpo = (peticion.body ?? {}) as { barridoId?: unknown };
    const barridoId = typeof cuerpo.barridoId === "string" ? cuerpo.barridoId : "";

    try {
      await service.sincronizar();
      const resultado = await service.aplicar(barridoId, actor(peticion));
      peticion.log.info(
        {
          importId: resultado.importId,
          altas: resultado.conteos.insertedCount,
          corregidas: resultado.conteos.correctedCount,
          retiradas: resultado.conteos.retiredCount,
        },
        "barrido de matriz aplicado",
      );
      return pantalla(respuesta, 200, estado());
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      peticion.log.warn({ codigo: error.code }, "aplicación de barrido rechazada");
      return pantalla(respuesta, 409, { ...estado(), error: error.message });
    }
  });
}
