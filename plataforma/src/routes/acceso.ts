import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { ConsoleDirectoryService } from "../domain/acceso/directorio-consola.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { igualEnTiempoConstante } from "../server/sesion-consola.ts";
import { renderAccessPage } from "../web/pages/acceso.ts";

const POLITICA_DEL_ACCESO = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const DIRECTORIO_SIN_CONECTAR =
  "El directorio de credenciales no está conectado. " +
  "El acceso lo asigna el departamento de capacitación.";

const CREDENCIAL_RECHAZADA = "Usuario o contraseña incorrectos.";

const DEMASIADOS_INTENTOS =
  "Demasiados intentos desde este equipo. El acceso se reabre en cinco minutos.";

const MAXIMO_DE_INTENTOS = 10;
const VENTANA_MS = 5 * 60 * 1000;

function destinoSeguro(valor: unknown): string | undefined {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto.startsWith("/") || texto.startsWith("//")) return undefined;
  return texto;
}

export interface AccessRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
  readonly directory?: ConsoleDirectoryService;
}

export function registerAccessRoutes(app: FastifyInstance, deps: AccessRouteDeps): void {
  const { config, clock, sessions, directory } = deps;
  const usuarioEsperado = config.pilot.consoleUser;
  const claveEsperada = config.pilot.consolePassword;
  const enProduccion = config.environment === "production";

  const porHttps = (peticion: FastifyRequest): boolean => {
    if (enProduccion) return true;
    const reenviado = String(peticion.headers["x-forwarded-proto"] ?? "")
      .split(",")[0]
      ?.trim();
    return reenviado === "https";
  };

  const intentos = new Map<string, { cuenta: number; venceEn: number }>();

  function desalojarVencidos(ahora: number): void {
    for (const [llave, registro] of intentos) {
      if (registro.venceEn <= ahora) intentos.delete(llave);
    }
  }

  function llaveDeIntento(peticion: FastifyRequest, usuario: string): string {
    return `${peticion.ip}\u0000${usuario.trim().toLowerCase()}`;
  }

  function excedioIntentos(llave: string): boolean {
    const ahora = clock.now().getTime();
    const registro = intentos.get(llave);
    if (!registro || registro.venceEn <= ahora) {
      desalojarVencidos(ahora);
      intentos.set(llave, { cuenta: 1, venceEn: ahora + VENTANA_MS });
      return false;
    }
    registro.cuenta += 1;
    return registro.cuenta > MAXIMO_DE_INTENTOS;
  }

  const responderPantalla = (
    respuesta: FastifyReply,
    codigo: number,
    props: Parameters<typeof renderAccessPage>[0],
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .header("content-security-policy", POLITICA_DEL_ACCESO)
      .code(codigo)
      .send(renderAccessPage(props));

  app.get("/acceso", (peticion: FastifyRequest, respuesta: FastifyReply) => {
    const consulta = peticion.query as { destino?: unknown };
    return responderPantalla(respuesta, 200, {
      destino: destinoSeguro(consulta.destino),
      accesoAbierto: config.pilot.openAccess,
    });
  });

  app.post("/acceso", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    const cuerpo = (peticion.body ?? {}) as {
      destino?: unknown;
      usuario?: unknown;
      clave?: unknown;
    };
    const destino = destinoSeguro(cuerpo.destino);
    const usuario = typeof cuerpo.usuario === "string" ? cuerpo.usuario.trim() : "";
    const clave = typeof cuerpo.clave === "string" ? cuerpo.clave : "";
    const llave = llaveDeIntento(peticion, usuario);

    const conceder = (nombre: string): FastifyReply =>
      respuesta
        .header("set-cookie", sessions.emitir(nombre, clock.now(), porHttps(peticion)))
        .redirect(destino ?? "/", 303);

    if (config.pilot.openAccess) {
      const escrito = typeof cuerpo.usuario === "string" ? cuerpo.usuario.trim() : "";
      peticion.log.warn("acceso concedido sin credencial: KCM_PILOT_OPEN_ACCESS está activo");
      return conceder(escrito || "PRUEBA_ABIERTA");
    }

    if (directory) {
      if (excedioIntentos(llave)) {
        peticion.log.warn("acceso bloqueado por exceso de intentos");
        return responderPantalla(respuesta, 429, { error: DEMASIADOS_INTENTOS, destino });
      }

      const cuenta = await directory.verificar(usuario, clave);

      if (!cuenta) {
        peticion.log.warn("credencial de consola rechazada");
        return responderPantalla(respuesta, 401, { error: CREDENCIAL_RECHAZADA, destino });
      }

      intentos.delete(llave);
      peticion.log.info("acceso concedido con credencial del directorio");
      return conceder(cuenta.usuario);
    }

    if (usuarioEsperado === undefined || claveEsperada === undefined) {
      peticion.log.warn("intento de acceso sin directorio de credenciales conectado");
      return responderPantalla(respuesta, 503, { error: DIRECTORIO_SIN_CONECTAR, destino });
    }

    if (excedioIntentos(llave)) {
      peticion.log.warn("acceso bloqueado por exceso de intentos");
      return responderPantalla(respuesta, 429, { error: DEMASIADOS_INTENTOS, destino });
    }

    const usuarioValido = igualEnTiempoConstante(
      usuario.toLowerCase(),
      usuarioEsperado.toLowerCase(),
    );
    const claveValida = igualEnTiempoConstante(clave, claveEsperada);

    if (!usuarioValido || !claveValida) {
      peticion.log.warn("credencial de piloto rechazada");
      return responderPantalla(respuesta, 401, { error: CREDENCIAL_RECHAZADA, destino });
    }

    intentos.delete(llave);
    peticion.log.info("acceso concedido con credencial de piloto");

    return conceder(usuarioEsperado);
  });

  app.get("/salir", (peticion: FastifyRequest, respuesta: FastifyReply) =>
    respuesta.header("set-cookie", sessions.revocar(porHttps(peticion))).redirect("/acceso", 303),
  );
}
