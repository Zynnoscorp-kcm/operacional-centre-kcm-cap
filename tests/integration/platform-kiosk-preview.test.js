import assert from "node:assert/strict";
import test from "node:test";

import { startLocalKioskPreview } from "../../src/apps-script/testing/platform-preview-server.js";

function tokenFromPreviewUrl(value) {
  const url = new URL(value);
  const token = new URLSearchParams(url.hash.slice(1)).get("kioskToken");
  url.hash = "";
  return { token, requestUrl: url };
}

test("preview de plataforma sirve quiosco sintético, seguro e idempotente hasta cuarenta registros", async (context) => {
  const fixedNow = () => new Date("2026-07-22T16:00:00.000Z");
  const preview = await startLocalKioskPreview({ port: 0, now: fixedNow });
  context.after(() => preview.close());

  const { token, requestUrl } = tokenFromPreviewUrl(preview.url);
  assert.match(token, /^kcm-local-kiosk-token-synthetic-v1$/);
  assert.equal(requestUrl.searchParams.get("view"), "kiosk");
  assert.equal(requestUrl.searchParams.has("kioskToken"), false);

  const page = await fetch(requestUrl);
  const pageText = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  assert.match(pageText, /Registro de capacitación/);
  assert.doesNotMatch(pageText, new RegExp(token));

  const bootstrap = await preview.dispatch("kioskBootstrap", { token }, "request-bootstrap");
  assert.equal(bootstrap.data.acceptingRegistrations, true);
  assert.deepEqual(bootstrap.data.availability, { maximum: 40, available: true });
  assert.equal(Object.hasOwn(bootstrap.data, "capacity"), false);
  assert.equal(bootstrap.data.stationLabel, "Sala sintética · Equipo 01");

  const firstPayload = { token, employeeId: "00001" };
  const first = await preview.dispatch("kioskRegister", firstPayload, "request-first");
  const replay = await preview.dispatch("kioskRegister", firstPayload, "request-first");
  assert.deepEqual(replay, first);
  assert.deepEqual(Object.keys(first.data).sort(), ["message", "received"]);
  assert.equal(preview.registrationCount, 1);
  assert.equal(preview.auditCount, 1);

  const duplicate = await preview.dispatch("kioskRegister", firstPayload, "request-first-duplicate");
  assert.deepEqual(duplicate.data, first.data);
  assert.equal(preview.registrationCount, 1);
  assert.equal(preview.auditCount, 1);

  const unknown = await preview.dispatch("kioskRegister", { token, employeeId: "99999" }, "request-unknown");
  assert.deepEqual(unknown.data, first.data, "válido, duplicado e inexistente son indistinguibles en la respuesta");

  for (let ordinal = 2; ordinal <= 40; ordinal += 1) {
    const employeeId = String(ordinal).padStart(5, "0");
    await preview.dispatch("kioskRegister", { token, employeeId }, `request-${employeeId}`);
  }
  assert.equal(preview.registrationCount, 40);
  assert.equal(preview.auditCount, 40);
  const fullReplay = await preview.dispatch("kioskRegister", firstPayload, "request-full-duplicate");
  const fullUnknown = await preview.dispatch("kioskRegister", { token, employeeId: "99999" }, "request-over-capacity");
  assert.deepEqual(fullReplay.data, first.data, "el duplicado conserva su acuse con el cupo lleno");
  assert.deepEqual(fullUnknown.data, first.data, "el cupo lleno no revela si la identidad existe");
  assert.equal(preview.registrationCount, 40);
  assert.equal(preview.auditCount, 40);

  const health = await fetch(new URL("healthz", preview.baseUrl));
  const healthText = await health.text();
  assert.equal(health.status, 200);
  assert.doesNotMatch(healthText, new RegExp(token));
  assert.deepEqual(JSON.parse(healthText), {
    ok: true, mode: "LOCAL_KIOSK_SYNTHETIC", registrations: 40, maximum: 40
  });

  const httpBootstrap = await fetch(new URL("api", preview.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: preview.baseUrl.slice(0, -1) },
    body: JSON.stringify({
      action: "kioskBootstrap",
      requestId: "request-http-bootstrap",
      payload: { token }
    })
  });
  assert.equal(httpBootstrap.status, 200);
  assert.deepEqual((await httpBootstrap.json()).data.availability, { maximum: 40, available: false });

  const forbiddenOrigin = await fetch(new URL("api", preview.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.invalid" },
    body: JSON.stringify({ action: "kioskBootstrap", requestId: "request-origin", payload: { token } })
  });
  assert.equal(forbiddenOrigin.status, 403);

  const wrongContentType = await fetch(new URL("api", preview.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}"
  });
  assert.equal(wrongContentType.status, 415);

  const privatePath = await fetch(new URL("referencias/privado/lista.jpg", preview.baseUrl));
  assert.equal(privatePath.status, 404);
});

test("preview rechaza escucha fuera de loopback", async () => {
  await assert.rejects(
    startLocalKioskPreview({ host: "0.0.0.0", port: 0 }),
    /sólo puede escuchar en loopback/
  );
});
