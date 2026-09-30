import type { Clock } from "../../ports/reloj.port.ts";

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
  nowIso(): string {
    return new Date().toISOString();
  },
};
