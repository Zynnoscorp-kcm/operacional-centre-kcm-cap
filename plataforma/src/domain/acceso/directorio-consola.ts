import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { Clock } from "../../ports/reloj.port.ts";
import type { ConsoleDirectoryPort, CuentaDeConsola } from "../../ports/directorio-consola.port.ts";

const SAL_DE_RELLENO = randomBytes(16).toString("hex");

function derivar(clave: string, sal: string): string {
  return scryptSync(clave, Buffer.from(sal, "hex"), 32).toString("hex");
}

function igualEnTiempoConstante(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido, "hex");
  const b = Buffer.from(esperado, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export class ConsoleDirectoryService {
  readonly #directorio: ConsoleDirectoryPort;
  readonly #clock: Clock;

  constructor(input: { directory: ConsoleDirectoryPort; clock: Clock }) {
    this.#directorio = input.directory;
    this.#clock = input.clock;
  }

  async verificar(usuario: string, clave: string): Promise<CuentaDeConsola | undefined> {
    const nombre = usuario.trim();
    const cuenta = nombre === "" ? undefined : await this.#directorio.buscarPorUsuario(nombre);

    const derivada = derivar(clave, cuenta?.sal ?? SAL_DE_RELLENO);
    if (cuenta === undefined) return undefined;
    if (!igualEnTiempoConstante(derivada, cuenta.credencialHash)) return undefined;

    await this.#directorio.registrarAcceso(cuenta.credencialId, this.#clock.nowIso());
    return cuenta;
  }
}
