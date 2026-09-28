/**
 * Adaptador del puerto `Clock` contra el reloj del sistema. Es el único lugar
 * del árbol nuevo autorizado a llamar a `Date.now()`.
 */

import type { Clock } from "../../ports/reloj.port.ts";

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
  nowIso(): string {
    return new Date().toISOString();
  },
};
