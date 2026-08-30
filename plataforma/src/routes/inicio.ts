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
import type { Clock } from "../ports/reloj.ts";
import { renderHomePage } from "../web/pages/inicio.ts";

/** La misma ventana corta que usa `/sesiones`. */
const DIAS_DE_VENTANA = 14;

const IDENTIDAD_LECTURA: ActorIdentity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" };

export interface HomeRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessionService: SessionService;
  readonly roomService: RoomReservationService;
  readonly workbenchService: WorkbenchService;
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

  app.get("/", async (peticion, respuesta) => {
    const { fecha } = ahoraEnPlanta(clock);
    const corte = new Date(clock.now().getTime() - DIAS_DE_VENTANA * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [sesiones, reservas, porLiberar] = await Promise.all([
      sinCaerse(peticion.log, "sesiones", () => sessionService.listOperativeSessions(corte)),
      sinCaerse(peticion.log, "salas", () => roomService.list(fecha, fecha)),
      sinCaerse(peticion.log, "liberación", () =>
        workbenchService.listReleaseQueue(IDENTIDAD_LECTURA),
      ),
    ]);

    const cuerpo = renderHomePage({
      config,
      hoy: fecha,
      sesiones,
      reservas,
      porLiberar,
    });

    return respuesta.type("text/html; charset=utf-8").code(200).send(cuerpo);
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
