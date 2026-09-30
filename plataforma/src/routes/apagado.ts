import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { notFound } from "../server/errors.ts";
import { renderApagadoConfirmarPage, renderApagadoHechoPage } from "../web/pages/apagado.ts";

export interface ApagadoRouteDeps {
  readonly config: AppConfig;
  readonly apagar?: () => void;
}

const MARGEN_DE_ACUSE_MS = 250;

export function apagadoPorOmision(): void {
  process.kill(process.pid, "SIGTERM");
}

export function programarApagado(apagar: () => void): void {
  setTimeout(apagar, MARGEN_DE_ACUSE_MS).unref();
}

export function registerShutdownRoutes(app: FastifyInstance, deps: ApagadoRouteDeps): void {
  const { config } = deps;
  const apagar = deps.apagar ?? apagadoPorOmision;

  app.get("/apagar", (_peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (config.role !== "local") throw notFound();
    return respuesta
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .code(200)
      .send(renderApagadoConfirmarPage({ config }));
  });

  app.post("/apagar", (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (config.role !== "local") throw notFound();

    peticion.log.info("apagado solicitado desde la consola");

    void respuesta
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .code(200)
      .send(renderApagadoHechoPage({ config }));

    programarApagado(apagar);
    return respuesta;
  });
}
