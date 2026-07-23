import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import {
  REMOTE_OCR_REQUEST_SCHEMA,
  REMOTE_OCR_RESPONSE_SCHEMA,
  REMOTE_OCR_SCHEMA_VERSION,
  REMOTE_REST_PROVIDER_NAME,
  RemoteOcrProviderError,
  RemoteRestDigitsProvider,
  validateRemoteOcrRequestPayload,
  validateRemoteOcrResponsePayload
} from "../../src/ocr/adapters/remote-rest-provider.js";
import { TEMPLATE_GEOMETRY } from "../../src/ocr/config/template-geometry.js";
import { segmentTemplate } from "../../src/ocr/segmentation/template-segmenter.js";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function onePixelPng() {
  const image = new PNG({ width: 1, height: 1 });
  image.data.set([255, 255, 255, 255]);
  return PNG.sync.write(image);
}

function remoteFixture() {
  const segmentation = segmentTemplate({
    width: TEMPLATE_GEOMETRY.source.width,
    height: TEMPLATE_GEOMETRY.source.height
  });
  const pngBytes = onePixelPng();
  const digest = sha256(pngBytes);
  const crops = Object.freeze({
    crops: Object.freeze(segmentation.digitCrops.map((crop) => Object.freeze({
      cropId: crop.cropId,
      rowIndex: crop.rowIndex,
      digitIndex: crop.digitIndex,
      pngBytes: Buffer.from(pngBytes),
      sha256: digest
    })))
  });
  return { segmentation, crops };
}

function responsePayload(request, { firstRow = "01234", engineName = "tesseract", mutate } = {}) {
  const payload = {
    schema: REMOTE_OCR_RESPONSE_SCHEMA,
    version: REMOTE_OCR_SCHEMA_VERSION,
    requestSha256: request.requestSha256,
    engine: { name: engineName, version: "5.5.1" },
    rows: Array.from({ length: 40 }, (_, rowOffset) => ({
      rowIndex: rowOffset + 1,
      digits: Array.from({ length: 5 }, (_, digitIndex) => {
        const value = rowOffset === 0 ? (firstRow[digitIndex] ?? "") : "";
        return { digitIndex, value, confidence: value ? 0.98 : 0 };
      })
    }))
  };
  mutate?.(payload);
  return payload;
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

test("envia solo 200 recortes procesados y adapta una respuesta remota 40x5", async () => {
  const fixture = remoteFixture();
  let capturedRequest;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    headers: { Authorization: "Bearer synthetic-token" },
    fetchFn: async (url, options) => {
      assert.equal(url, "https://ocr.example.invalid/v1/digits");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      capturedRequest = JSON.parse(options.body);
      assert.equal(options.headers["Idempotency-Key"], capturedRequest.requestSha256);
      return jsonResponse(responsePayload(capturedRequest));
    }
  });

  const recognition = await provider.recognize({
    ...fixture,
    hints: [{ expectedDigits: "99999", employeeName: "DATO-QUE-NO-DEBE-SALIR" }],
    employeeRoster: new Set(["99999"])
  });

  assert.equal(capturedRequest.schema, REMOTE_OCR_REQUEST_SCHEMA);
  assert.equal(capturedRequest.version, REMOTE_OCR_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(capturedRequest).sort(), ["crops", "geometry", "requestSha256", "schema", "version"]);
  assert.equal(capturedRequest.crops.length, 200);
  assert.deepEqual(Object.keys(capturedRequest.crops[0]).sort(), [
    "contentBase64", "cropId", "digitIndex", "mimeType", "rowIndex", "sha256"
  ]);
  assert.doesNotMatch(JSON.stringify(capturedRequest), /DATO-QUE-NO-DEBE-SALIR|employee|roster|name|session|document/i);
  assert.equal(validateRemoteOcrRequestPayload(capturedRequest).totalBytes > 0, true);
  assert.equal(recognition.provider, REMOTE_REST_PROVIDER_NAME);
  assert.deepEqual(recognition.engine, { name: "tesseract", version: "5.5.1" });
  assert.equal(recognition.transport.attempts, 1);
  assert.equal(recognition.rows.length, 40);
  assert.equal(recognition.rows[0].rawDigits, "01234");
  assert.deepEqual(recognition.rows[0].digitConfidences, [0.98, 0.98, 0.98, 0.98, 0.98]);
  assert.equal(recognition.rows[1].detected, false);
  assert.equal(recognition.cropArtifacts.length, 200);
  assert.equal(recognition.binaryArtifactsIncluded, false);
});

test("reintenta solo respuestas 429/5xx con backoff acotado", async () => {
  const fixture = remoteFixture();
  const statuses = [429, 503, 200];
  const delays = [];
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    maxAttempts: 3,
    backoffBaseMs: 5,
    maxBackoffMs: 25,
    sleepFn: async (delayMs) => { delays.push(delayMs); },
    fetchFn: async (_url, options) => {
      const request = JSON.parse(options.body);
      const status = statuses[calls++];
      if (status === 429) return jsonResponse({ ignored: true }, status, { "Retry-After": "0.01" });
      if (status === 503) return jsonResponse({ ignored: true }, status);
      return jsonResponse(responsePayload(request), status);
    }
  });

  const recognition = await provider.recognize(fixture);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 10]);
  assert.equal(recognition.transport.attempts, 3);
});

test("agota reintentos 5xx sin propagar cuerpo, endpoint ni secretos", async () => {
  const fixture = remoteFixture();
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/private-path",
    maxAttempts: 2,
    backoffBaseMs: 0,
    maxBackoffMs: 0,
    sleepFn: async () => {},
    fetchFn: async () => {
      calls += 1;
      return new Response("ruta=/private; token=SECRETO", { status: 503 });
    }
  });

  await assert.rejects(
    provider.recognize(fixture),
    (error) => {
      assert.ok(error instanceof RemoteOcrProviderError);
      assert.equal(error.code, "REMOTE_OCR_UNAVAILABLE");
      assert.equal(error.retryable, true);
      assert.equal(error.status, 503);
      assert.equal(error.attempts, 2);
      assert.doesNotMatch(error.message, /private|SECRETO|example/i);
      return true;
    }
  );
  assert.equal(calls, 2);
});

test("reintenta errores de red con backoff inyectado y conserva el numero de intento", async () => {
  const fixture = remoteFixture();
  const delays = [];
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/private-path",
    maxAttempts: 3,
    backoffBaseMs: 5,
    maxBackoffMs: 25,
    sleepFn: async (delayMs) => { delays.push(delayMs); },
    fetchFn: async (_url, options) => {
      calls += 1;
      if (calls < 3) throw new Error("token=SECRETO; ruta=/private-path");
      const request = JSON.parse(options.body);
      return jsonResponse(responsePayload(request));
    }
  });

  const recognition = await provider.recognize(fixture);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
  assert.equal(recognition.transport.attempts, 3);
});

test("agota errores de red segun maxAttempts y devuelve un error sanitizado", async () => {
  const fixture = remoteFixture();
  const delays = [];
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/private-path",
    maxAttempts: 3,
    backoffBaseMs: 5,
    maxBackoffMs: 25,
    sleepFn: async (delayMs) => { delays.push(delayMs); },
    fetchFn: async () => {
      calls += 1;
      throw new Error("token=SECRETO; ruta=/private-path; empleado=00001");
    }
  });

  await assert.rejects(provider.recognize(fixture), (error) => {
    assert.ok(error instanceof RemoteOcrProviderError);
    assert.equal(error.code, "REMOTE_OCR_NETWORK");
    assert.equal(error.retryable, true);
    assert.equal(error.status, null);
    assert.equal(error.attempts, 3);
    assert.doesNotMatch(error.message, /SECRETO|private|00001|example/i);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
});

test("un 4xx no reintentable produce un error sanitizado", async () => {
  const fixture = remoteFixture();
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    fetchFn: async () => {
      calls += 1;
      return new Response("nombre=PERSONA-SINTETICA", { status: 422 });
    }
  });

  await assert.rejects(provider.recognize(fixture), (error) => {
    assert.equal(error.code, "REMOTE_OCR_HTTP_REJECTED");
    assert.equal(error.retryable, false);
    assert.equal(error.status, 422);
    assert.doesNotMatch(error.message, /PERSONA|422/);
    return true;
  });
  assert.equal(calls, 1);
});

test("reintenta un timeout con backoff inyectado y recupera la solicitud", async () => {
  const fixture = remoteFixture();
  const delays = [];
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    timeoutMs: 100,
    maxAttempts: 2,
    backoffBaseMs: 0,
    maxBackoffMs: 0,
    sleepFn: async (delayMs) => { delays.push(delayMs); },
    fetchFn: async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      const request = JSON.parse(options.body);
      return jsonResponse(responsePayload(request));
    }
  });

  const recognition = await provider.recognize(fixture);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [0]);
  assert.equal(recognition.transport.attempts, 2);
});

test("agota timeouts segun maxAttempts sin exponer detalles del transporte", async () => {
  const fixture = remoteFixture();
  const delays = [];
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/private-path",
    timeoutMs: 100,
    maxAttempts: 2,
    backoffBaseMs: 0,
    maxBackoffMs: 0,
    sleepFn: async (delayMs) => { delays.push(delayMs); },
    fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
      calls += 1;
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("token=SECRETO; ruta=/private-path; empleado=00001")),
        { once: true }
      );
    })
  });

  await assert.rejects(provider.recognize(fixture), (error) => {
    assert.ok(error instanceof RemoteOcrProviderError);
    assert.equal(error.code, "REMOTE_OCR_TIMEOUT");
    assert.equal(error.retryable, true);
    assert.equal(error.status, null);
    assert.equal(error.attempts, 2);
    assert.doesNotMatch(error.message, /SECRETO|private|00001|example/i);
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [0]);
});

test("el timeout permanece activo mientras se lee el cuerpo HTTP", async () => {
  const fixture = remoteFixture();
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    timeoutMs: 100,
    maxAttempts: 1,
    fetchFn: async (_url, options) => ({
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      text: async () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })
    })
  });

  await assert.rejects(provider.recognize(fixture), (error) => {
    assert.equal(error.code, "REMOTE_OCR_TIMEOUT");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("rechaza respuestas con hash cruzado, campos extra o grilla distinta de 40x5", async (context) => {
  const fixture = remoteFixture();
  const cases = [
    {
      name: "hash cruzado",
      mutate: (payload) => { payload.requestSha256 = "f".repeat(64); },
      expectedCode: "REMOTE_OCR_RESPONSE_MISMATCH"
    },
    {
      name: "campo PII extra",
      mutate: (payload) => { payload.rows[0].employeeName = "NO-PERMITIDO"; },
      expectedCode: "REMOTE_OCR_INVALID_RESPONSE"
    },
    {
      name: "solo 39 renglones",
      mutate: (payload) => { payload.rows.pop(); },
      expectedCode: "REMOTE_OCR_INVALID_RESPONSE"
    },
    {
      name: "caracter no numerico",
      mutate: (payload) => { payload.rows[0].digits[0].value = "A"; },
      expectedCode: "REMOTE_OCR_INVALID_RESPONSE"
    },
    {
      name: "confianza fuera de rango",
      mutate: (payload) => { payload.rows[0].digits[0].confidence = 1.01; },
      expectedCode: "REMOTE_OCR_INVALID_RESPONSE"
    },
    {
      name: "indice numerico como texto",
      mutate: (payload) => { payload.rows[0].digits[0].digitIndex = "0"; },
      expectedCode: "REMOTE_OCR_INVALID_RESPONSE"
    }
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      const provider = new RemoteRestDigitsProvider({
        endpoint: "https://ocr.example.invalid/v1/digits",
        fetchFn: async (_url, options) => {
          const request = JSON.parse(options.body);
          return jsonResponse(responsePayload(request, { mutate: item.mutate }));
        }
      });
      await assert.rejects(provider.recognize(fixture), (error) => {
        assert.equal(error.code, item.expectedCode);
        assert.doesNotMatch(error.message, /NO-PERMITIDO|employeeName|rows\[0\]/);
        return true;
      });
    });
  }
});

test("validador compartido detecta adulteracion de PNG, hash o contrato", async () => {
  const fixture = remoteFixture();
  let captured;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    fetchFn: async (_url, options) => {
      captured = JSON.parse(options.body);
      return jsonResponse(responsePayload(captured));
    }
  });
  await provider.recognize(fixture);

  const badHash = structuredClone(captured);
  badHash.crops[0].sha256 = "0".repeat(64);
  assert.throws(() => validateRemoteOcrRequestPayload(badHash), /hash de un recorte no coincide/);

  const extraField = structuredClone(captured);
  extraField.employeeRoster = [];
  assert.throws(() => validateRemoteOcrRequestPayload(extraField), /no coincide con el contrato/);

  const invalidResponse = responsePayload(captured);
  invalidResponse.rows[0].digits[0].confidence = Number.NaN;
  assert.throws(
    () => validateRemoteOcrResponsePayload(invalidResponse, { requestSha256: captured.requestSha256 }),
    (error) => error.code === "REMOTE_OCR_INVALID_RESPONSE"
  );
});

test("limites de entrada detienen la solicitud antes de usar fetch", async () => {
  const fixture = remoteFixture();
  let calls = 0;
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    limits: { maxInputBytes: 100 },
    fetchFn: async () => { calls += 1; }
  });

  await assert.rejects(provider.recognize(fixture), /limite total de bytes/);
  assert.equal(calls, 0);
});

test("limita el cuerpo de respuesta durante la lectura del stream", async () => {
  const fixture = remoteFixture();
  const provider = new RemoteRestDigitsProvider({
    endpoint: "https://ocr.example.invalid/v1/digits",
    limits: { maxResponseBytes: 64 },
    fetchFn: async () => new Response("x".repeat(1_024), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  await assert.rejects(provider.recognize(fixture), (error) => {
    assert.equal(error.code, "REMOTE_OCR_INVALID_RESPONSE");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("configuracion rechaza transporte inseguro y encabezados que rompen el contrato", () => {
  assert.throws(
    () => new RemoteRestDigitsProvider({ endpoint: "http://ocr.example.invalid/v1/digits" }),
    /HTTPS/
  );
  assert.throws(
    () => new RemoteRestDigitsProvider({
      endpoint: "https://ocr.example.invalid/v1/digits",
      headers: { "Content-Type": "text/plain" }
    }),
    /sobrescribir/
  );
  assert.throws(
    () => new RemoteRestDigitsProvider({
      endpoint: "https://ocr.example.invalid/v1/digits",
      headers: { Authorization: "Bearer value\r\nInjected: yes" }
    }),
    /invalido/
  );
});
