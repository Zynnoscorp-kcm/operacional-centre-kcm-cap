/**
 * Apagado de la instancia local.
 *
 * Existe una sola razón para esta ruta: la computadora del departamento
 * enciende la plataforma para mandar el barrido de la matriz o el padrón, y
 * después hay que apagarla. Pedirle a un capacitador que busque la ventana de
 * la terminal y pulse Ctrl+C es pedirle que aprenda una herramienta que no le
 * corresponde.
 *
 * Tres compuertas, y ninguna sobra:
 *
 * 1. **Sólo con `KCM_ROLE=local`.** En la nube la ruta no existe —responde 404,
 *    no un mensaje explicando que no se puede—, porque un proceso publicado que
 *    exponga su propio apagado es un botón de denegación de servicio.
 * 2. **Sólo con sesión de consola.** No está en la lista blanca del guardia, así
 *    que quien no ha entrado por `/acceso` ni llega.
 * 3. **Con confirmación.** `GET` pregunta y `POST` ejecuta. Apagar por navegar a
 *    una dirección, o por recargar una pestaña vieja, sería exactamente el
 *    accidente que la pregunta evita.
 *
 * El cierre se delega en la señal que `main.ts` ya sabe atender: allí están el
 * `app.close()` y el `db.close()` ordenados. Esta ruta no duplica esa lógica,
 * sólo la dispara.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { notFound } from "../server/errors.ts";
import { renderApagadoConfirmarPage, renderApagadoHechoPage } from "../web/pages/apagado.ts";

export interface ApagadoRouteDeps {
  readonly config: AppConfig;
  /**
   * Cómo se apaga. Inyectable por la misma razón que el runner del DC-3: una
   * prueba que llamara al apagado de verdad mataría al propio proceso de
   * pruebas. Por omisión, la señal que `main.ts` ya atiende.
   */
  readonly apagar?: () => void;
}

/** Margen para que la respuesta salga por el cable antes de cerrar el proceso. */
const MARGEN_DE_ACUSE_MS = 250;

/** El cierre de verdad: la señal que `main.ts` ya sabe atender. */
export function apagadoPorOmision(): void {
  process.kill(process.pid, "SIGTERM");
}

/**
 * Programar el cierre, que es lo único que este módulo sabe hacer y que la
 * pantalla de inicio necesita reusar: allí el apagado se pide sin salir de la
 * consola, así que quien responde es la ruta de inicio y no ésta, pero el
 * cuándo y el cómo del cierre tienen que seguir viviendo en un solo sitio.
 */
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

    // El acuse primero y el cierre después: si el proceso muriera antes de
    // responder, quien apagó vería un error de conexión y no sabría si el
    // apagado ocurrió o si la plataforma se cayó sola.
    void respuesta
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .code(200)
      .send(renderApagadoHechoPage({ config }));

    programarApagado(apagar);
    return respuesta;
  });
}
