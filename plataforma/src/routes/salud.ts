import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";

export interface Comprobacion {
  readonly nombre: string;
  readonly estado: "ok" | "degradado" | "caido";
  readonly detalle?: string;
}

export interface RespuestaSalud {
  readonly status: "ok" | "degradado" | "caido";
  readonly environment: string;
  readonly checkedAt: string;
  readonly uptimeSeconds: number;
  readonly checks: readonly Comprobacion[];
}

export function registerHealthRoute(app: FastifyInstance, config: AppConfig, clock: Clock): void {
  app.get("/healthz", (_peticion, respuesta) => {
    const checks: readonly Comprobacion[] = [];
    const cuerpo: RespuestaSalud = {
      status: resumir(checks),
      environment: config.environment,
      checkedAt: clock.nowIso(),
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
    return respuesta.code(200).send(cuerpo);
  });
}

function resumir(checks: readonly Comprobacion[]): "ok" | "degradado" | "caido" {
  if (checks.some((check) => check.estado === "caido")) return "caido";
  if (checks.some((check) => check.estado === "degradado")) return "degradado";
  return "ok";
}
