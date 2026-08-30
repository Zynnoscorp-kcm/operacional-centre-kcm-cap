/**
 * Comprobación de salud.
 *
 * `/healthz` es la ruta que ya usan los servidores de vista previa del árbol
 * legado (`platform-preview-server.js`, `preview-server.js` de DC-3); se
 * conserva el nombre para que el túnel y la supervisión no tengan que aprender
 * dos convenciones.
 *
 * La lista `checks` nace vacía a propósito: hoy no hay dependencia externa que
 * comprobar —Supabase está vacío y sin migraciones—. Cuando E5 aplique el
 * esquema, la comprobación de base entra aquí y `status` pasa a depender de
 * ella.
 */

import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.ts";

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
