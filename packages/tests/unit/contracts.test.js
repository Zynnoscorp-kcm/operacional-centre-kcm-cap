import test from "node:test";
import assert from "node:assert/strict";
import { CAPTURE_ROUTES, createParticipantAttendance, releaseIdempotencyKey } from "../../contracts/contracts.js";

test("conserva ceros iniciales en el numero de trabajador", () => {
  const attendance = createParticipantAttendance({
    attendanceId: "a-1", sessionId: "s-1", employeeId: "00123",
    captureRoute: CAPTURE_ROUTES.DIGITAL
  });
  assert.equal(attendance.employeeId, "00123");
});

test("rechaza numeros que no sean texto de cinco digitos", () => {
  assert.throws(() => createParticipantAttendance({
    attendanceId: "a-1", sessionId: "s-1", employeeId: 123,
    captureRoute: CAPTURE_ROUTES.DIGITAL
  }), /cinco digitos/);
});

test("la clave idempotente es estable y distingue version de mapeo", () => {
  const input = { sessionId: "s-1", employeeId: "00123", trainingId: "t-1", mappingVersion: "v1" };
  assert.equal(releaseIdempotencyKey(input), releaseIdempotencyKey({ ...input }));
  assert.notEqual(releaseIdempotencyKey(input), releaseIdempotencyKey({ ...input, mappingVersion: "v2" }));
});

