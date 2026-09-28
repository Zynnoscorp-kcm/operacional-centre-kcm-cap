/**
 * Pantalla base en `/`.
 *
 * Lee de tres servicios que ya existen y no consulta nada propio: las sesiones
 * operativas de la misma ventana de catorce días que `/sesiones`, las
 * reservaciones del día que enseña `/salas` y la bandeja de liberación de la
 * Función 5. Si una lectura falla, el tablero se pinta igual con esa tarjeta
 * vacía: la portada de la consola no puede ser una pantalla de error porque un
 * repositorio esté caído.
 */

import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { ActorIdentity } from "../domain/quiosco/tipos.ts";
import type { SessionService } from "../domain/quiosco/sesiones.ts";
import type { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import type { RoomReservationService } from "../domain/salas/reservaciones.ts";
import type { Clock } from "../ports/reloj.port.ts";
import { notFound } from "../server/errors.ts";
import { renderHomePage } from "../web/pages/inicio.ts";
import { apagadoPorOmision, programarApagado } from "./apagado.ts";

/** La misma ventana corta que usa `/sesiones`. */
const DIAS_DE_VENTANA = 14;

const IDENTIDAD_LECTURA: ActorIdentity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" };

export interface HomeRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessionService: SessionService;
  readonly roomService: RoomReservationService;
  readonly workbenchService: WorkbenchService;
  /**
   * Cuántas constancias DC-3 faltan por emitir de los cursos desde el corte.
   * Ausente sin base: entonces la cola no dice nada de DC-3, que es la verdad
   * de esa corrida.
   */
  readonly dc3PorEmitir?: () => Promise<number>;
  /** Cómo se apaga. Inyectable: una prueba que apagara de verdad se mataría. */
  readonly apagar?: () => void;
}

/** Lo que tiene que traer el formulario para que un `POST /` apague. */
function pideApagado(cuerpo: unknown): boolean {
  if (typeof cuerpo !== "object" || cuerpo === null) return false;
  return (cuerpo as Record<string, unknown>)["accion"] === "apagar";
}

/**
 * La hora de la planta, no la del proceso. `Intl` resuelve el huso sin traer una
 * biblioteca; sin esto, entre las seis de la tarde y la medianoche el tablero
 * llamaría «hoy» al día siguiente y enseñaría cero sesiones con la sala llena.
 */
function ahoraEnPlanta(clock: Clock): { fecha: string; hora: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(clock.now());

  const buscar = (tipo: string): string => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const hora = Number(buscar("hour"));
  return {
    fecha: `${buscar("year")}-${buscar("month")}-${buscar("day")}`,
    // `en-CA` con `hour12:false` devuelve «24» a la medianoche; se normaliza.
    hora: hora === 24 ? 0 : hora,
  };
}

export function registerHomeRoute(app: FastifyInstance, deps: HomeRouteDeps): void {
  const { config, clock, sessionService, roomService, workbenchService } = deps;
  const apagar = deps.apagar ?? apagadoPorOmision;

  /** El tablero, con o sin el acuse del apagado encima. */
  const tablero = async (
    log: { warn: (objeto: object, mensaje: string) => void },
    apagando: boolean,
  ): Promise<string> => {
    const { fecha } = ahoraEnPlanta(clock);
    const corte = new Date(clock.now().getTime() - DIAS_DE_VENTANA * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [sesiones, reservas, porLiberar, dc3PorEmitir] = await Promise.all([
      sinCaerse(log, "sesiones", () => sessionService.listOperativeSessions(corte)),
      sinCaerse(log, "salas", () => roomService.list(fecha, fecha)),
      sinCaerse(log, "liberación", () => workbenchService.listReleaseQueue(IDENTIDAD_LECTURA)),
      sinCaerse(log, "dc3", async () => (deps.dc3PorEmitir ? [await deps.dc3PorEmitir()] : [])),
    ]);

    return renderHomePage({
      config,
      hoy: fecha,
      sesiones,
      reservas,
      porLiberar,
      apagando,
      ...(dc3PorEmitir[0] !== undefined ? { dc3PorEmitir: dc3PorEmitir[0] } : {}),
    });
  };

  app.get("/", async (peticion, respuesta) => {
    const cuerpo = await tablero(peticion.log, false);
    return respuesta.type("text/html; charset=utf-8").code(200).send(cuerpo);
  });

  /*
   * Apagar sin salir de la consola.
   *
   * El apagado se pide desde un recuadro sobre el tablero, y un formulario sin
   * guiones sólo sabe navegar: mandarlo a `/apagar` cambiaba la dirección y
   * dejaba a quien apagó en otra pantalla, que es justo lo que un recuadro
   * emergente no debe hacer. Enviándolo aquí, la respuesta es el mismo tablero
   * —misma dirección, mismo menú, mismas tarjetas— con el acuse encima y la
   * tarjeta de encendido ya en apagado. Al cerrar el acuse queda la consola,
   * quieta pero entera, y no una página huérfana.
   *
   * `/apagar` no se retira: sigue siendo la pregunta y la ejecución para quien
   * llega escribiendo la dirección, y es la que las pruebas de papel comprueban.
   *
   * Las dos compuertas son las mismas de allá. Fuera del equipo del
   * departamento esto no existe —404, no un mensaje—, y sin la acción explícita
   * del formulario tampoco: un `POST /` de cualquier otra cosa no apaga nada.
   */
  app.post("/", async (peticion, respuesta) => {
    if (config.role !== "local") throw notFound();
    if (!pideApagado(peticion.body)) throw notFound();

    peticion.log.info("apagado solicitado desde el tablero");

    const cuerpo = await tablero(peticion.log, true);

    // El acuse primero y el cierre después: si el proceso muriera antes de
    // responder, quien apagó vería un error de conexión y no sabría si el
    // apagado ocurrió o si la plataforma se cayó sola.
    void respuesta
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .code(200)
      .send(cuerpo);

    programarApagado(apagar);
    return respuesta;
  });
}

/** Una lectura del tablero que falla deja su tarjeta vacía y anota el motivo. */
async function sinCaerse<T>(
  log: { warn: (objeto: object, mensaje: string) => void },
  seccion: string,
  leer: () => Promise<readonly T[]>,
): Promise<readonly T[]> {
  try {
    return await leer();
  } catch (error) {
    log.warn({ err: error, seccion }, "el tablero no pudo leer una sección");
    return [];
  }
}
