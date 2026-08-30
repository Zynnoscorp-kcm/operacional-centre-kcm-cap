import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Dc3JobService } from "../../src/domain/dc3/tarea.ts";
import type { Clock } from "../../src/ports/reloj.ts";

const clock: Clock = {
  now: () => new Date("2026-08-03T12:00:00.000Z"),
  nowIso: () => "2026-08-03T12:00:00.000Z",
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("E13 · DC-3 como tarea", () => {
  it("ejecuta fuera de la petición y expone bloqueo por candidato con identidad protegida", async () => {
    const service = new Dc3JobService({
      clock,
      projectRoot: process.cwd(),
      runner: () => ({
        detected: 2,
        ready: 1,
        blocked: 1,
        candidateStatuses: [
          {
            candidateKey: "a".repeat(64),
            courseId: "QMS",
            completionDate: "2026-08-01",
            status: "BLOQUEADO",
            blockingReasons: ["MISSING_CNO_MAPPING"],
          },
        ],
        execution: { mode: "PLAN_ONLY" },
      }),
    });
    assert.equal(service.enqueue({ generate: false }).status, "EN_COLA");
    await tick();
    const status = service.status();
    assert.equal(status.status, "BLOQUEADO");
    assert.equal(status.candidates[0]?.candidateKey, "a".repeat(64));
    assert.equal(JSON.stringify(status).includes("10001"), false);
  });

  it("impide dos tareas simultáneas", () => {
    const service = new Dc3JobService({
      clock,
      projectRoot: process.cwd(),
      runner: () => ({ detected: 0, ready: 0, blocked: 0, execution: { mode: "PLAN_ONLY" } }),
    });
    service.enqueue({ generate: false });
    assert.throws(() => service.enqueue({ generate: false }), /tarea DC-3 activa/u);
  });
});
