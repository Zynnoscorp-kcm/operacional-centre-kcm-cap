import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_OCR_RESPONSE_SCHEMA,
  REMOTE_OCR_SCHEMA_VERSION,
  RemoteRestDigitsProvider,
  validateRemoteOcrRequestPayload
} from "../../src/ocr/adapters/remote-rest-provider.js";
import {
  runRasterOcrPipeline,
  runRasterOcrPipelineAsync
} from "../../src/ocr/raster-pipeline.js";
import { createSyntheticAttendancePng } from "../../src/ocr/testing/synthetic-fixture.js";

function workerResponse(request) {
  return {
    schema: REMOTE_OCR_RESPONSE_SCHEMA,
    version: REMOTE_OCR_SCHEMA_VERSION,
    requestSha256: request.requestSha256,
    engine: { name: "synthetic-worker", version: "1.0.0" },
    rows: Array.from({ length: 40 }, (_, rowOffset) => ({
      rowIndex: rowOffset + 1,
      digits: Array.from({ length: 5 }, (_, digitIndex) => {
        const value = rowOffset === 0 ? "01234"[digitIndex] : "";
        return { digitIndex, value, confidence: value ? 0.99 : 0 };
      })
    }))
  };
}

test("pipeline raster asincrono integra el proveedor REST sin enviar padron ni pagina completa", async () => {
  let calls = 0;
  let validatedRequest;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    fetchFn: async (_url, options) => {
      calls += 1;
      const request = JSON.parse(options.body);
      validatedRequest = validateRemoteOcrRequestPayload(request);
      return new Response(JSON.stringify(workerResponse(request)), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const input = {
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: "session-remote-001",
    documentId: "document-remote-001",
    evidenceId: "evidence-remote-001",
    actor: "tester@example.invalid",
    createdAt: "2026-07-21T18:00:00.000Z",
    employeeRoster: new Set(["01234"]),
    recognitionHints: [{ rowIndex: 1, employeeName: "NO-SE-ENVIA", expectedDigits: "99999" }],
    provider
  };

  assert.throws(
    () => runRasterOcrPipeline(input),
    /runRasterOcrPipelineAsync/
  );
  assert.equal(calls, 0);

  const result = await runRasterOcrPipelineAsync(input);
  assert.equal(calls, 1);
  assert.equal(validatedRequest.crops.length, 200);
  assert.equal(validatedRequest.geometry.rowCount, 40);
  assert.doesNotMatch(JSON.stringify(validatedRequest, (_key, value) => Buffer.isBuffer(value) ? undefined : value), /NO-SE-ENVIA|99999|employee|roster|session|document/i);
  assert.equal(result.processing.provider, "REMOTE_REST_DIGITS_V1");
  assert.deepEqual(result.processing.engine, { name: "synthetic-worker", version: "1.0.0" });
  assert.equal(result.recognition.rows.length, 40);
  assert.equal(result.candidates.length, 40);
  assert.equal(result.candidates[0].rawDigits, "01234");
  assert.equal(result.candidates[0].normalizedEmployeeId, "01234");
  assert.deepEqual(result.candidates[0].digitConfidences, [0.99, 0.99, 0.99, 0.99, 0.99]);
  assert.equal(result.candidates[1].rawDigits, "");
  assert.match(result.normalizedImage.sha256, /^[a-f0-9]{64}$/);
});
