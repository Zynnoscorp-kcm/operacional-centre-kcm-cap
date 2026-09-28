/**
 * Ruta de la pantalla de acceso.
 *
 * Hay dos formas de entrar y el orden importa:
 *
 * 1. El directorio (`seguridad.credencial_consola`, migración 0038). Es el
 *    mecanismo real: una fila por persona, contraseña sólo como derivación
 *    scrypt, revocación con actor y motivo, y la hora de la última entrada. Con
 *    base conectada, es lo único que se consulta.
 * 2. La credencial del entorno, que existía antes del directorio y sigue
 *    ahí para la corrida en memoria y las pruebas. `loadConfig` la prohíbe en
 *    producción, así que no puede convertirse en una puerta trasera.
 *
 * Sin ninguna de las dos el POST no autentica a nadie y responde 503 diciendo
 * que el directorio no está conectado.
 *
 * Lo que la sesión sigue sin hacer: cerrar pantallas. La consola responde igual
 * con cookie y sin ella, y eso no cambió aquí.
 *
 * La política de contenido es la de la consola más `script-src 'self'`: la
 * puerta lleva un guion propio —el que abre las dos hojas antes de enviar el
 * formulario— servido desde `/assets` con su hash. Ya no hay CDN ni tipografías
 * externas que permitir; eso venía de cuando la pantalla era la del quiosco.
 */

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

/** Nunca dice cuál de los dos campos falló: eso confirmaría cuentas. */
const CREDENCIAL_RECHAZADA = "Usuario o contraseña incorrectos.";

const DEMASIADOS_INTENTOS =
  "Demasiados intentos desde este equipo. El acceso se reabre en cinco minutos.";

const MAXIMO_DE_INTENTOS = 10;
const VENTANA_MS = 5 * 60 * 1000;

/**
 * Sólo se acepta volver a una ruta de esta misma plataforma. Un destino con
 * origen —o que empiece con `//`— convertiría la pantalla en un trampolín para
 * mandar a alguien a otro sitio con la marca de la empresa encima.
 */
function destinoSeguro(valor: unknown): string | undefined {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto.startsWith("/") || texto.startsWith("//")) return undefined;
  return texto;
}

export interface AccessRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
  /** Directorio de cuentas. Ausente sólo donde no hay base. */
  readonly directory?: ConsoleDirectoryService;
}

export function registerAccessRoutes(app: FastifyInstance, deps: AccessRouteDeps): void {
  const { config, clock, sessions, directory } = deps;
  const usuarioEsperado = config.pilot.consoleUser;
  const claveEsperada = config.pilot.consolePassword;
  const enProduccion = config.environment === "production";

  /**
   * Si la cookie de sesión lleva `Secure`.
   *
   * Antes se decidía por el entorno, y eso dejaba la sesión sin `Secure`
   * siempre que la plataforma se publicaba por túnel con `KCM_ENV=development`:
   * publicada por HTTPS, pero con una cookie que el navegador habría mandado
   * también por HTTP. Lo que manda es cómo llegó la petición —el túnel lo
   * declara en `x-forwarded-proto`—, con el entorno como piso: en producción
   * siempre.
   */
  const porHttps = (peticion: FastifyRequest): boolean => {
    if (enProduccion) return true;
    const reenviado = String(peticion.headers["x-forwarded-proto"] ?? "")
      .split(",")[0]
      ?.trim();
    return reenviado === "https";
  };

  /**
   * Intentos fallidos, por equipo y cuenta.
   *
   * Antes la llave era sólo `request.ip`, y eso hacía dos cosas malas a la vez
   * en cuanto la plataforma se publica por túnel. La primera es que sin
   * `KCM_TRUST_PROXY` declarado esa IP es la del túnel: una sola para todo el
   * mundo, así que diez contraseñas mal escritas —por cualquiera, sin mala
   * intención— dejaban a la planta entera fuera cinco minutos, y al
   * departamento con ella. La segunda sobrevive incluso con la IP verdadera,
   * porque las computadoras de planta salen por un mismo NAT y comparten
   * dirección igual.
   *
   * Agregar la cuenta a la llave arregla las dos: adivinar contraseñas de
   * *una* cuenta desde un lugar sigue cortándose a los diez intentos, y quien
   * teclea mal la suya ya no cierra la puerta de nadie más.
   *
   * Lo que esto no hace es frenar a quien reparta un intento por cuenta
   * entre muchas cuentas. Contra un directorio de tres personas eso no compra
   * gran cosa, y el precio de impedirlo —un tope por IP— es justo el bloqueo
   * global que se acaba de quitar.
   */
  const intentos = new Map<string, { cuenta: number; venceEn: number }>();

  /**
   * Un `Map` que sólo se limpia al acertar crece con cada llave nueva, y ahora
   * la llave la escribe en parte quien llama. Se desaloja lo vencido antes de
   * anotar, para que la memoria la acote la ventana y no el tamaño del
   * diccionario de quien insista.
   */
  function desalojarVencidos(ahora: number): void {
    for (const [llave, registro] of intentos) {
      if (registro.venceEn <= ahora) intentos.delete(llave);
    }
  }

  /** La cuenta se normaliza igual que al compararla, o `Pablo` y `pablo` serían dos cubos. */
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
    // Se leen aquí y no dentro de cada camino porque la llave del freno los
    // necesita antes de comprobar nada.
    const usuario = typeof cuerpo.usuario === "string" ? cuerpo.usuario.trim() : "";
    const clave = typeof cuerpo.clave === "string" ? cuerpo.clave : "";
    const llave = llaveDeIntento(peticion, usuario);

    const conceder = (nombre: string): FastifyReply =>
      respuesta
        .header("set-cookie", sessions.emitir(nombre, clock.now(), porHttps(peticion)))
        .redirect(destino ?? "/", 303);

    // Acceso abierto de prueba: la pantalla sigue existiendo y la sesión sigue
    // emitiéndose —la consola interna firma la bitácora con ella—, pero no hay
    // credencial que comprobar. Se guarda el nombre que se escribió, para que la
    // bitácora no quede toda a nombre del mismo actor de servicio.
    if (config.pilot.openAccess) {
      const escrito = typeof cuerpo.usuario === "string" ? cuerpo.usuario.trim() : "";
      peticion.log.warn("acceso concedido sin credencial: KCM_PILOT_OPEN_ACCESS está activo");
      return conceder(escrito || "PRUEBA_ABIERTA");
    }

    // El directorio manda donde existe: una cuenta revocada allí no puede
    // volver a entrar por la puerta del entorno.
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
      // Ni el usuario ni la contraseña se leen: no hay contra qué compararlos, y
      // tocarlos sólo abriría la puerta a que terminaran en la bitácora.
      peticion.log.warn("intento de acceso sin directorio de credenciales conectado");
      return responderPantalla(respuesta, 503, { error: DIRECTORIO_SIN_CONECTAR, destino });
    }

    if (excedioIntentos(llave)) {
      peticion.log.warn("acceso bloqueado por exceso de intentos");
      return responderPantalla(respuesta, 429, { error: DEMASIADOS_INTENTOS, destino });
    }

    // Se comprueban los dos siempre, aunque el primero ya haya fallado: cortar
    // en el usuario diría por el tiempo de respuesta cuáles existen.
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
