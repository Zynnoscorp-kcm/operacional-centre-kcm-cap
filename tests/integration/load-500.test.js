import test from "node:test";
import assert from "node:assert/strict";
import { runLoadTest } from "../../scripts/run-load-test.js";

test("procesa un lote sintetico equivalente a 500 registros", async () => {
  const result = await runLoadTest();
  assert.equal(result.captured, 500);
  assert.equal(result.matrixWrites, 500);
  assert.equal(result.effectiveReleases, 500);
  assert.equal(result.sessionCount, 13);
  assert.ok(result.elapsedMs < 5000, `El lote local tomo ${result.elapsedMs} ms`);
});

