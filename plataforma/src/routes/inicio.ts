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

const DIAS_DE_VENTANA = 14;

const IDENTIDAD_LECTURA: ActorIdentity = { actor: "USUARIO_CAPACITACION", role: "CAPACITACION" };

export interface HomeRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessionService: SessionService;
  readonly roomService: RoomReservationService;
  readonly workbenchService: WorkbenchService;
  readonly dc3PorEmitir?: () => Promise<number>;
  readonly apagar?: () => void;
}

function pideApagado(cuerpo: unknown): boolean {
  if (typeof cuerpo !== "object" || cuerpo === null) return false;
  return (cuerpo as Record<string, unknown>)["accion"] === "apagar";
}

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
    hora: hora === 24 ? 0 : hora,
  };
}

export function registerHomeRoute(app: FastifyInstance, deps: HomeRouteDeps): void {
  const { config, clock, sessionService, roomService, workbenchService } = deps;
  const apagar = deps.apagar ?? apagadoPorOmision;

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

  app.post("/", async (peticion, respuesta) => {
    if (config.role !== "local") throw notFound();
    if (!pideApagado(peticion.body)) throw notFound();

    peticion.log.info("apagado solicitado desde el tablero");

    const cuerpo = await tablero(peticion.log, true);

    void respuesta
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .code(200)
      .send(cuerpo);

    programarApagado(apagar);
    return respuesta;
  });
}

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
