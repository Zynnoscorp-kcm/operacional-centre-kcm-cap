import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { startLocalReviewPreview } from "../../src/ocr/review/local-preview-server.js";

test("preview local expone 40 filas, evidencia real y correccion auditable", async (context) => {
  const preview = await startLocalReviewPreview({
    port: 0,
    now: () => "2026-07-21T15:00:00.000Z"
  });
  context.after(() => preview.close());

  assert.equal(preview.reviewCount, 40);
  assert.equal(preview.evidenceCount, 200);

  const health = await fetch(new URL("healthz", preview.url));
  assert.equal(health.status, 200);
  assert.match(health.headers.get("content-security-policy"), /object-src 'none'/);
  assert.equal((await health.json()).mode, "LOCAL_RASTER_REVIEW");

  const index = await fetch(new URL("Index.html", preview.url));
  const indexText = await index.text();
  assert.equal(index.status, 200);
  assert.match(indexText, /KCM_LOCAL_API_BASE="\/api"/);
  assert.match(indexText, /document-local-raster-v1/);

  const listed = await preview.dispatch("listOcrCandidates", { documentId: preview.documentId }, "request-list");
  assert.equal(listed.data.length, 40);
  assert.deepEqual(listed.data.map((row) => row.rowIndex), Array.from({ length: 40 }, (_, index_) => index_ + 1));
  const serializedRows = JSON.stringify(listed.data);
  assert.doesNotMatch(serializedRows, /expectedDigits|displayName|position|area|pngBytes|visualPngBytes/);

  const first = listed.data[0];
  const evidence = await preview.dispatch("reviewEvidence", {
    candidateId: first.candidateId,
    cropId: "r01-d1"
  }, "request-evidence");
  assert.match(evidence.data.visual.dataUrl, /^data:image\/png;base64,/);
  assert.match(evidence.data.processed.dataUrl, /^data:image\/png;base64,/);
  assert.match(evidence.data.visual.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(evidence.data.visual.sha256, evidence.data.processed.sha256);

  const rowEvidence = await preview.dispatch("reviewEvidence", {
    candidateId: first.candidateId
  }, "request-row-evidence");
  assert.equal(rowEvidence.data.crops.length, 5);
  assert.deepEqual(rowEvidence.data.crops.map((crop) => crop.digitIndex), [0, 1, 2, 3, 4]);
  assert.ok(rowEvidence.data.crops.every((crop) => /^data:image\/png;base64,/.test(crop.originalDataUrl)));
  assert.ok(rowEvidence.data.crops.every((crop) => /^data:image\/png;base64,/.test(crop.processedDataUrl)));

  await assert.rejects(
    preview.dispatch("reviewEvidence", { candidateId: first.candidateId, cropId: "r02-d1" }),
    /pertenec|corresponde|candidato/i
  );
  await assert.rejects(
    preview.dispatch("reviewEvidence", { candidateId: first.candidateId, cropId: "../r01-d1" }),
    /cropId no es válido/
  );

  const manifest = JSON.parse(await readFile("artifacts/ocr-public/local-bank-v1/dense-moderate/review-manifest.json", "utf8"));
  const correctedValue = manifest.rows[0].expectedDigits;
  const correctionPayload = {
    candidateId: first.candidateId,
    correctedValue,
    reason: "Comparación de las cinco casillas sintéticas"
  };
  const corrected = await preview.dispatch("reviewOcrCandidate", correctionPayload, "request-correction-stable");
  assert.equal(corrected.data.correctedValue, correctedValue);
  assert.equal(corrected.data.decision, "CONFIRMADO_HUMANO");
  assert.equal(corrected.data.correctionAt, "2026-07-21T15:00:00.000Z");

  const repeated = await preview.dispatch("reviewOcrCandidate", correctionPayload, "request-correction-stable");
  assert.deepEqual(repeated, corrected);
  const audit = await preview.dispatch("reviewAudit", {}, "request-audit");
  assert.equal(audit.data.length, 1);
  assert.deepEqual(
    [audit.data[0].before, audit.data[0].after, audit.data[0].actor, audit.data[0].reason],
    [first.originalValue, correctedValue, "qa-local@example.invalid", correctionPayload.reason]
  );

  await assert.rejects(
    preview.dispatch("reviewOcrCandidate", { ...correctionPayload, correctedValue: "99999" }, "request-unknown"),
    /No fue posible validar la identidad/
  );

  const httpList = await fetch(new URL("api", preview.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listOcrCandidates",
      requestId: "request-http-list",
      payload: { documentId: preview.documentId }
    })
  });
  assert.equal(httpList.status, 200);
  const httpCandidates = (await httpList.json()).data;
  assert.equal(httpCandidates.length, 40);

  const httpEvidence = await fetch(new URL("api", preview.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "reviewEvidence",
      payload: { candidateId: httpCandidates[1].candidateId, documentId: preview.documentId }
    })
  });
  assert.equal(httpEvidence.status, 200);
  assert.equal((await httpEvidence.json()).data.crops.length, 5);

  const httpCorrection = await fetch(new URL("api", preview.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "reviewOcrCandidate",
      payload: {
        candidateId: httpCandidates[1].candidateId,
        correctedValue: manifest.rows[1].expectedDigits,
        reason: "Verificación HTTP de cinco casillas sintéticas",
        requestId: "request-http-correction"
      }
    })
  });
  assert.equal(httpCorrection.status, 200);
  assert.equal((await httpCorrection.json()).data.decision, "CONFIRMADO_HUMANO");

  const forbiddenOrigin = await fetch(new URL("api", preview.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.invalid" },
    body: JSON.stringify({ action: "listOcrCandidates", payload: { documentId: preview.documentId } })
  });
  assert.equal(forbiddenOrigin.status, 403);

  const wrongContentType = await fetch(new URL("api", preview.url), {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "listOcrCandidates", payload: { documentId: preview.documentId } })
  });
  assert.equal(wrongContentType.status, 415);

  const unknownPath = await fetch(new URL("../referencias/privado/listas/IMG_0102.jpg", `${preview.url}assets/`));
  assert.equal(unknownPath.status, 404);
});
