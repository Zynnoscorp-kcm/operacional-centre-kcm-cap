import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, transition } from "../../contracts/state-machine.js";

test("no permite saltar una sesion directo a liberada", () => {
  assert.equal(canTransition("SESSION", "BORRADOR", "LIBERADA_TOTAL"), false);
  assert.throws(() => transition("SESSION", "BORRADOR", "LIBERADA_TOTAL"), /no permitida/);
  assert.equal(canTransition("SESSION", "OCR_EN_PROCESO", "PRELIBERACION"), false);
  assert.throws(() => transition("SESSION", "OCR_EN_PROCESO", "PRELIBERACION"), /no permitida/);
});

test("una asistencia liberada queda inmutable", () => {
  assert.equal(canTransition("ATTENDANCE", "LIBERADA", "EXAMEN_PENDIENTE"), false);
});
