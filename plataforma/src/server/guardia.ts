/**
 * Guardia de la consola: sin sesión no se responde, salvo lista blanca.
 *
 * Sin esta guarda, la sesión de `/acceso` existe pero no cierra nada: las
 * rutas de la consola responden igual con o sin ella. Con la plataforma
 * publicada, eso significa que cualquiera con la URL lee el padrón completo,
 * entra a preliberación, libera a la matriz, explora la base y emite
 * credenciales del puente.
 *
 * Por qué lista blanca y no lista negra
 *
 * Una lista negra deja abierta cada ruta que alguien agregue mañana y se le
 * olvide anotar. La lista blanca falla del lado seguro: una ruta nueva nace
 * cerrada y quien la quiera pública tiene que decirlo aquí, con su motivo.
 *
 * Lo que queda abierto, y por qué cada cosa
 *
 * Ninguna de estas rutas es «pública» en el sentido de estar desprotegida: cada
 * una tiene su propio secreto, y lo que está abierto es únicamente la puerta.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { ConsoleSessionCodec } from "./sesion-consola.ts";

/**
 * Rutas exactas que responden sin sesión de consola.
 *
 * - `/acceso` y `/salir` son la puerta misma; cerrarlas dejaría fuera a todos.
 * - `/healthz` no revela nada y lo consulta el túnel.
 * - `/quiosco` es la pantalla de la sala: la abre el trabajador y su secreto es
 *   el PIN de quiosco, no una cuenta nominal.
 * - `/agenda` es la disponibilidad pública declarada en el plan —sala, fecha,
 *   horario y `RESERVADA`, sin identidades— y sus escrituras piden la
 *   contraseña de agenda.
 */
const PUBLICAS_EXACTAS: ReadonlySet<string> = new Set([
  "/acceso",
  "/salir",
  "/healthz",
  "/quiosco",
  "/agenda",
  "/api/rooms/availability",
  "/api/v1/vba-bridge",
]);

/**
 * Prefijos abiertos.
 *
 * - `/assets/` son hoja de estilos y tipografías; no hay datos ahí.
 * - `/api/kiosk/` valida PIN de quiosco y PIN de apertura en cada llamada.
 * - `/api/excel/power-query/` exige credencial de equipo con alcance de lectura.
 */
const PUBLICAS_POR_PREFIJO: readonly string[] = [
  "/assets/",
  "/api/kiosk/",
  "/api/excel/power-query/",
];

const MENSAJE_SIN_SESION =
  "Esta pantalla exige una cuenta de consola. Entra por /acceso y vuelve a intentarlo.";

/** Ruta sin cadena de consulta ni fragmento. */
function rutaDe(url: string): string {
  const corte = url.indexOf("?");
  const ruta = corte === -1 ? url : url.slice(0, corte);
  // `/matriz/` y `/matriz` son la misma ruta para el enrutador; que también lo
  // sean aquí, o una barra final saltaría el guardia.
  return ruta.length > 1 && ruta.endsWith("/") ? ruta.slice(0, -1) : ruta;
}

function esPublica(ruta: string): boolean {
  if (PUBLICAS_EXACTAS.has(ruta)) return true;
  return PUBLICAS_POR_PREFIJO.some((prefijo) => ruta.startsWith(prefijo));
}

/**
 * Si la respuesta debe ser una redirección a la puerta o un error en JSON.
 *
 * Se decide por la ruta y no por la cabecera `Accept`: un navegador la manda,
 * pero un enlace abierto desde otra aplicación, un `curl` o una pestaña
 * restaurada pueden no mandarla, y entonces la persona vería un JSON de error
 * en lugar de la pantalla de acceso. Todo lo que cuelga de `/api/` es cliente
 * de máquina; lo demás es pantalla.
 */
function esApi(ruta: string): boolean {
  return ruta === "/api" || ruta.startsWith("/api/");
}

export interface GuardiaDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
}

/**
 * Registra el guardia. Se engancha en `onRequest`, que es lo primero que corre:
 * una petición sin sesión no llega a tocar un repositorio ni deja rastro en el
 * dominio.
 */
export function registrarGuardiaDeConsola(app: FastifyInstance, deps: GuardiaDeps): void {
  const { config, clock, sessions } = deps;

  if (config.pilot.openAccess) {
    // Una sola línea al arrancar, no una por petición: si esto está encendido,
    // tiene que verse en la primera pantalla del registro y no diluido.
    app.log.warn(
      "ACCESO ABIERTO ENCENDIDO: la consola responde sin sesión. " +
        "Retira KCM_PILOT_OPEN_ACCESS antes de publicar nada.",
    );
  }

  app.addHook("onRequest", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    const ruta = rutaDe(peticion.url);
    if (esPublica(ruta)) return;
    // La bandera declarada del piloto sigue valiendo, pero `loadConfig` la
    // prohíbe en producción, así que no puede convertirse en puerta trasera.
    if (config.pilot.openAccess) return;
    if (sessions.leer(peticion.headers.cookie, clock.now()) !== undefined) return;

    peticion.log.warn({ ruta }, "petición sin sesión de consola rechazada");

    if (esApi(ruta)) {
      return respuesta
        .code(401)
        .send({ error: { code: "SESION_REQUERIDA", message: MENSAJE_SIN_SESION } });
    }
    // A dónde volver después de entrar. Un `GET` vuelve a donde iba; un envío
    // de formulario vuelve a su pantalla, no a la ruta que sólo acepta
    // `POST` —volver ahí daría un 404 justo después de escribir la contraseña—.
    const destino =
      peticion.method === "GET" || peticion.method === "HEAD"
        ? peticion.url
        : `/${ruta.split("/")[1] ?? ""}`;
    return respuesta.redirect(`/acceso?destino=${encodeURIComponent(destino)}`, 303);
  });
}
