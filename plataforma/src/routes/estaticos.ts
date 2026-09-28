/**
 * Hoja de estilos, servida bajo su hash de contenido.
 *
 * Es la única respuesta del servidor que se cachea. Lleva el hash en la URL, no
 * contiene dato alguno y cambia de dirección en cuanto cambia de contenido, así
 * que `immutable` es cierto. Todo lo demás responde `no-store`.
 */

import type { FastifyInstance } from "fastify";

import {
  guionAcceso,
  guionHaces,
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

  // Los tres guiones —el fondo de haces, el del quiosco y el de la puerta— bajo
  // la misma regla que la hoja: hash en la dirección, sin dato dentro y caché
  // eterna.
  for (const guion of [guionHaces, guionQuiosco, guionAcceso]) {
    app.get(guion.ruta, (_peticion, respuesta) => {
      return respuesta
        .type(guion.tipo)
        .header("cache-control", CACHE_INMUTABLE)
        .header("etag", `"${guion.hash}"`)
        .code(200)
        .send(guion.contenido);
    });
  }

  // El símbolo de marca sigue la misma regla que la hoja: sin dato personal
  // dentro y con el hash en la dirección, la caché eterna es cierta.
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

  // Una hoja con otro hash es una versión que ya no existe. Se responde 404 en
  // vez de servir la vigente con la URL equivocada, que dejaría al navegador
  // cacheando contenido bajo una dirección que no le corresponde.
  app.get("/assets/*", (_peticion, _respuesta) => {
    throw notFound("El recurso estático solicitado no existe en esta versión.");
  });
}
