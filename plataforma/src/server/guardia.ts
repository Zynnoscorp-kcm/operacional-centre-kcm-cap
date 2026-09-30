import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { ConsoleSessionCodec } from "./sesion-consola.ts";

const PUBLICAS_EXACTAS: ReadonlySet<string> = new Set([
  "/acceso",
  "/salir",
  "/healthz",
  "/quiosco",
  "/agenda",
  "/api/rooms/availability",
  "/api/v1/vba-bridge",
]);

const PUBLICAS_POR_PREFIJO: readonly string[] = [
  "/assets/",
  "/api/kiosk/",
  "/api/excel/power-query/",
];

const MENSAJE_SIN_SESION =
  "Esta pantalla exige una cuenta de consola. Entra por /acceso y vuelve a intentarlo.";

function rutaDe(url: string): string {
  const corte = url.indexOf("?");
  const ruta = corte === -1 ? url : url.slice(0, corte);
  return ruta.length > 1 && ruta.endsWith("/") ? ruta.slice(0, -1) : ruta;
}

function esPublica(ruta: string): boolean {
  if (PUBLICAS_EXACTAS.has(ruta)) return true;
  return PUBLICAS_POR_PREFIJO.some((prefijo) => ruta.startsWith(prefijo));
}

function esApi(ruta: string): boolean {
  return ruta === "/api" || ruta.startsWith("/api/");
}

export interface GuardiaDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
}

export function registrarGuardiaDeConsola(app: FastifyInstance, deps: GuardiaDeps): void {
  const { config, clock, sessions } = deps;

  if (config.pilot.openAccess) {
    app.log.warn(
      "ACCESO ABIERTO ENCENDIDO: la consola responde sin sesión. " +
        "Retira KCM_PILOT_OPEN_ACCESS antes de publicar nada.",
    );
  }

  app.addHook("onRequest", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    const ruta = rutaDe(peticion.url);
    if (esPublica(ruta)) return;
    if (config.pilot.openAccess) return;
    if (sessions.leer(peticion.headers.cookie, clock.now()) !== undefined) return;

    peticion.log.warn({ ruta }, "petición sin sesión de consola rechazada");

    if (esApi(ruta)) {
      return respuesta
        .code(401)
        .send({ error: { code: "SESION_REQUERIDA", message: MENSAJE_SIN_SESION } });
    }
    const destino =
      peticion.method === "GET" || peticion.method === "HEAD"
        ? peticion.url
        : `/${ruta.split("/")[1] ?? ""}`;
    return respuesta.redirect(`/acceso?destino=${encodeURIComponent(destino)}`, 303);
  });
}
