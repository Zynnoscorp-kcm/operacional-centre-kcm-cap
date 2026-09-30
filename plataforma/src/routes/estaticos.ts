import type { FastifyInstance } from "fastify";

import {
  guionAcceso,
  guionHaces,
  guionOcupaciones,
  guionQuiosco,
  hojaDeEstilos,
  imagenes,
} from "../web/estaticos.ts";
import { notFound } from "../server/errors.ts";

const CACHE_INMUTABLE = "public, max-age=31536000, immutable";

export function registerAssetRoutes(app: FastifyInstance): void {
  app.get(hojaDeEstilos.ruta, (_peticion, respuesta) => {
    return respuesta
      .type(hojaDeEstilos.tipo)
      .header("cache-control", CACHE_INMUTABLE)
      .header("etag", `"${hojaDeEstilos.hash}"`)
      .code(200)
      .send(hojaDeEstilos.contenido);
  });

  for (const guion of [guionHaces, guionQuiosco, guionAcceso, guionOcupaciones]) {
    app.get(guion.ruta, (_peticion, respuesta) => {
      return respuesta
        .type(guion.tipo)
        .header("cache-control", CACHE_INMUTABLE)
        .header("etag", `"${guion.hash}"`)
        .code(200)
        .send(guion.contenido);
    });
  }

  for (const imagen of imagenes) {
    app.get(imagen.ruta, (_peticion, respuesta) => {
      return respuesta
        .type(imagen.tipo)
        .header("cache-control", CACHE_INMUTABLE)
        .header("etag", `"${imagen.hash}"`)
        .code(200)
        .send(imagen.contenido);
    });
  }

  app.get("/assets/*", (_peticion, _respuesta) => {
    throw notFound("El recurso estático solicitado no existe en esta versión.");
  });
}
