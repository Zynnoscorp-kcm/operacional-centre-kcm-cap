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
