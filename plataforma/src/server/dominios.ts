/**
 * Dominios dedicados del quiosco y de la agenda.
 *
 * El quiosco está en la sala y la agenda es pública. Si comparten dominio con
 * la consola, basta borrar `/quiosco` o `/agenda` de la barra para llegar a la
 * puerta de la plataforma central. Con un dominio propio (`KCM_DOMINIO_QUIOSCO`,
 * `KCM_DOMINIO_AGENDA`), ese dominio sólo sirve su pantalla y lo que ella
 * necesita; cualquier otra dirección vuelve a la pantalla, y un envío a otra
 * ruta no existe.
 *
 * En el dominio de la consola nada cambia: `/quiosco` y `/agenda` siguen
 * respondiendo ahí para quien administra.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";

interface Recinto {
  readonly pantalla: string;
  readonly permite: (ruta: string) => boolean;
}

const COMUNES = (ruta: string): boolean => ruta === "/healthz" || ruta.startsWith("/assets/");

const QUIOSCO: Recinto = {
  pantalla: "/quiosco",
  permite: (ruta) => ruta === "/quiosco" || ruta.startsWith("/api/kiosk/") || COMUNES(ruta),
};

const AGENDA: Recinto = {
  pantalla: "/agenda",
  permite: (ruta) => ruta === "/agenda" || ruta === "/api/rooms/availability" || COMUNES(ruta),
};

function rutaDe(url: string): string {
  const corte = url.indexOf("?");
  const ruta = corte === -1 ? url : url.slice(0, corte);
  return ruta.length > 1 && ruta.endsWith("/") ? ruta.slice(0, -1) : ruta;
}

export function registrarDominiosDedicados(app: FastifyInstance, config: AppConfig): void {
  const recintos = new Map<string, Recinto>();
  for (const dominio of config.dedicatedHosts.kiosk) recintos.set(dominio, QUIOSCO);
  for (const dominio of config.dedicatedHosts.agenda) recintos.set(dominio, AGENDA);
  if (recintos.size === 0) return;

  app.addHook("onRequest", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    const recinto = recintos.get(peticion.hostname.toLowerCase());
    if (!recinto) return;
    const ruta = rutaDe(peticion.url);
    if (recinto.permite(ruta)) return;
    if (peticion.method === "GET" || peticion.method === "HEAD") {
      return respuesta.redirect(recinto.pantalla, 302);
    }
    return respuesta
      .code(404)
      .send({ error: { code: "NO_ENCONTRADO", message: "No se encontró el recurso solicitado." } });
  });
}
