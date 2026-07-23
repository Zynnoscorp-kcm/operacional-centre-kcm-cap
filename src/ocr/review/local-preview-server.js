import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { extractDigitCrops } from "../recognition/crop-extractor.js";
import { segmentTemplate } from "../segmentation/template-segmenter.js";
import { createReviewBundle, createReviewEvidenceResolver } from "./review-bundle.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_DOCUMENT_ID = "document-local-raster-v1";
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "::1"]);

const DEFAULT_PATHS = Object.freeze({
  index: `${PROJECT_ROOT}src/apps-script/web/Index.html`,
  preview: `${PROJECT_ROOT}src/apps-script/web/local-preview.html`,
  normalized: `${PROJECT_ROOT}artifacts/ocr-public/local-bank-v1/dense-moderate/normalized.png`,
  manifest: `${PROJECT_ROOT}artifacts/ocr-public/local-bank-v1/dense-moderate/review-manifest.json`
});

class LocalPreviewError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "LocalPreviewError";
    this.code = code;
    this.status = status;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredIdentifier(value, field) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(text)) {
    throw new LocalPreviewError("INVALID_INPUT", `${field} no es válido`);
  }
  return text;
}

function requiredReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 3 || reason.length > 300) {
    throw new LocalPreviewError("INVALID_INPUT", "El motivo debe contener entre 3 y 300 caracteres");
  }
  return reason;
}

function employeeId(value) {
  const normalized = String(value || "");
  if (!/^\d{5}$/.test(normalized)) {
    throw new LocalPreviewError("INVALID_INPUT", "La corrección debe contener exactamente cinco dígitos");
  }
  return normalized;
}

function requestId(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9_-]{1,100}$/.test(text) ? text : `local-request-${randomUUID()}`;
}

function candidateInputs(documentId, manifest) {
  if (!Array.isArray(manifest?.rows) || manifest.rows.length < 1 || manifest.rows.length > 40) {
    throw new LocalPreviewError("INVALID_FIXTURE", "El manifiesto de revisión no contiene entre 1 y 40 renglones", 500);
  }
  const seenRows = new Set();
  return manifest.rows.map((row) => {
    const rowIndex = Number(row.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > 40 || seenRows.has(rowIndex)) {
      throw new LocalPreviewError("INVALID_FIXTURE", "El manifiesto contiene renglones inválidos o duplicados", 500);
    }
    seenRows.add(rowIndex);
    const rawDigits = String(row.observedDigits || "");
    if (rawDigits && !/^\d{1,5}$/.test(rawDigits)) {
      throw new LocalPreviewError("INVALID_FIXTURE", "El manifiesto contiene una lectura OCR inválida", 500);
    }
    const overallConfidence = Number(row.overallConfidence || 0);
    if (!Number.isFinite(overallConfidence) || overallConfidence < 0 || overallConfidence > 1) {
      throw new LocalPreviewError("INVALID_FIXTURE", "El manifiesto contiene una confianza OCR inválida", 500);
    }
    return Object.freeze({
      candidateId: `local-candidate-r${String(rowIndex).padStart(2, "0")}`,
      documentId,
      rowIndex,
      rawDigits,
      originalValue: rawDigits,
      normalizedEmployeeId: /^\d{5}$/.test(rawDigits) ? rawDigits : "",
      digitConfidences: null,
      overallConfidence,
      decision: String(row.decision || "REVISION_REQUERIDA"),
      validationFlags: Object.freeze(Array.isArray(row.validationFlags) ? row.validationFlags.map(String) : [])
    });
  });
}

function safeError(error) {
  if (error instanceof LocalPreviewError) {
    return { status: error.status, error: { code: error.code, message: error.message } };
  }
  return {
    status: 500,
    error: { code: "LOCAL_PREVIEW_ERROR", message: "No fue posible completar la operación local" }
  };
}

function evidenceDataUrl(bytes, mimeType) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function injectLocalConfiguration(indexHtml, documentId) {
  const injection = `<script>window.KCM_LOCAL_API_BASE="/api";window.KCM_LOCAL_DOCUMENT_ID="${documentId}";</script>`;
  if (!indexHtml.includes("</head>")) throw new LocalPreviewError("INVALID_UI", "Index.html no contiene un encabezado válido", 500);
  return indexHtml.replace("</head>", `${injection}\n</head>`);
}

function responseHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Security-Policy": "default-src 'self' data:; img-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN"
  };
}

function writeResponse(response, status, body, contentType) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, { ...responseHeaders(contentType), "Content-Length": bytes.length });
  response.end(bytes);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteSize = 0;
    let exceeded = false;
    request.on("data", (chunk) => {
      byteSize += chunk.length;
      if (byteSize > MAX_BODY_BYTES) {
        exceeded = true;
      } else {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (exceeded) {
        reject(new LocalPreviewError("REQUEST_TOO_LARGE", "La solicitud excede el límite local", 413));
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("invalid");
        resolve(value);
      } catch {
        reject(new LocalPreviewError("INVALID_JSON", "La solicitud JSON no es válida"));
      }
    });
    request.on("error", () => reject(new LocalPreviewError("REQUEST_ERROR", "No fue posible leer la solicitud")));
  });
}

function assertLocalApiRequest(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new LocalPreviewError("UNSUPPORTED_MEDIA_TYPE", "La API local requiere application/json", 415);
  }
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(String(origin));
    const requestHost = String(request.headers.host || "");
    if (!ALLOWED_HOSTS.has(originUrl.hostname) || originUrl.host !== requestHost) throw new Error("cross-origin");
  } catch {
    throw new LocalPreviewError("FORBIDDEN_ORIGIN", "El origen no está autorizado", 403);
  }
}

export async function createLocalReviewApplication({
  documentId = DEFAULT_DOCUMENT_ID,
  paths = DEFAULT_PATHS,
  now = () => new Date().toISOString(),
  actor = "qa-local@example.invalid"
} = {}) {
  const safeDocumentId = requiredIdentifier(documentId, "documentId");
  let indexHtml;
  let previewHtml;
  let normalizedBytes;
  let manifest;
  try {
    [indexHtml, previewHtml, normalizedBytes, manifest] = await Promise.all([
      readFile(paths.index, "utf8"),
      readFile(paths.preview, "utf8"),
      readFile(paths.normalized),
      readFile(paths.manifest, "utf8").then(JSON.parse)
    ]);
  } catch {
    throw new LocalPreviewError(
      "LOCAL_EVIDENCE_MISSING",
      "Falta evidencia sintética local; ejecute npm run evidence:ocr",
      500
    );
  }

  const segmentation = segmentTemplate({ width: 1216, height: 2002 });
  const extraction = extractDigitCrops({ imageBytes: normalizedBytes, segmentation });
  const candidates = candidateInputs(safeDocumentId, manifest);
  const bundle = createReviewBundle({ documentId: safeDocumentId, candidates, extraction });
  const evidenceResolver = createReviewEvidenceResolver({ documentId: safeDocumentId, candidates, extraction });
  const rows = new Map(bundle.rows.map((row) => [row.candidateId, {
    ...cloneJson(row),
    digitConfidences: row.slots.map((slot) => slot.confidence)
  }]));
  const syntheticRoster = new Set(manifest.rows.map((row) => String(row.expectedDigits || "")).filter((value) => /^\d{5}$/.test(value)));
  const audits = [];
  const completedRequests = new Map();

  function listRows() {
    return [...rows.values()].sort((left, right) => left.rowIndex - right.rowIndex).map(cloneJson);
  }

  async function dispatch(action, payload = {}, suppliedRequestId) {
    const operation = String(action || "");
    const currentRequestId = requestId(suppliedRequestId || payload.requestId);
    if (operation === "listOcrCandidates") {
      if (requiredIdentifier(payload.documentId || safeDocumentId, "documentId") !== safeDocumentId) {
        throw new LocalPreviewError("NOT_FOUND", "El documento OCR no existe", 404);
      }
      return { ok: true, requestId: currentRequestId, data: listRows() };
    }
    if (operation === "reviewEvidence") {
      const candidateId = requiredIdentifier(payload.candidateId, "candidateId");
      const candidate = rows.get(candidateId);
      if (!candidate) throw new LocalPreviewError("NOT_FOUND", "El candidato OCR no existe", 404);
      const requestedCropId = payload.cropId ? requiredIdentifier(payload.cropId, "cropId") : null;
      const cropIds = requestedCropId
        ? [requestedCropId]
        : Array.from({ length: 5 }, (_, digitIndex) => `r${String(candidate.rowIndex).padStart(2, "0")}-d${digitIndex + 1}`);
      const resolved = cropIds.map((cropId) => evidenceResolver.resolve({ candidateId, cropId }));
      const crops = resolved.map((evidence) => ({
        cropId: evidence.cropId,
        digitIndex: Number(evidence.cropId.slice(-1)) - 1,
        mimeType: evidence.mimeType,
        originalSha256: evidence.visual.sha256,
        processedSha256: evidence.processed.sha256,
        originalDataUrl: evidenceDataUrl(evidence.visual.bytes, evidence.mimeType),
        processedDataUrl: evidenceDataUrl(evidence.processed.bytes, evidence.mimeType)
      }));
      if (!requestedCropId) {
        return {
          ok: true,
          requestId: currentRequestId,
          data: { documentId: safeDocumentId, candidateId, crops }
        };
      }
      const evidence = resolved[0];
      return {
        ok: true,
        requestId: currentRequestId,
        data: {
          documentId: safeDocumentId,
          candidateId,
          cropId: evidence.cropId,
          mimeType: evidence.mimeType,
          visual: {
            sha256: evidence.visual.sha256,
            dataUrl: evidenceDataUrl(evidence.visual.bytes, evidence.mimeType)
          },
          processed: {
            sha256: evidence.processed.sha256,
            dataUrl: evidenceDataUrl(evidence.processed.bytes, evidence.mimeType)
          }
        }
      };
    }
    if (operation === "reviewOcrCandidate") {
      if (completedRequests.has(currentRequestId)) return cloneJson(completedRequests.get(currentRequestId));
      const candidateId = requiredIdentifier(payload.candidateId, "candidateId");
      const correctedValue = employeeId(payload.correctedValue);
      const reason = requiredReason(payload.reason);
      const row = rows.get(candidateId);
      if (!row) throw new LocalPreviewError("NOT_FOUND", "El candidato OCR no existe", 404);
      if (!syntheticRoster.has(correctedValue)) {
        throw new LocalPreviewError("NOT_FOUND", "No fue posible validar la identidad", 404);
      }
      const duplicate = [...rows.values()].find((other) => other.candidateId !== candidateId
        && other.decision === "CONFIRMADO_HUMANO"
        && other.correctedValue === correctedValue);
      if (duplicate) throw new LocalPreviewError("DUPLICATE", "El número ya fue confirmado en otro renglón", 409);
      const timestamp = now();
      const updated = {
        ...row,
        normalizedEmployeeId: correctedValue,
        decision: "CONFIRMADO_HUMANO",
        validationFlags: ["HUMAN_REVIEW_COMPLETED"],
        correctedValue,
        correctionActor: actor,
        correctionAt: timestamp,
        correctionReason: reason
      };
      rows.set(candidateId, updated);
      audits.push(Object.freeze({
        eventId: `local-audit-${randomUUID()}`,
        timestamp,
        actor,
        role: "CAPACITACION",
        documentId: safeDocumentId,
        candidateId,
        action: "OCR_CANDIDATE_CORRECTED",
        before: row.originalValue,
        after: correctedValue,
        reason,
        requestId: currentRequestId
      }));
      const envelope = { ok: true, requestId: currentRequestId, data: cloneJson(updated) };
      completedRequests.set(currentRequestId, envelope);
      return cloneJson(envelope);
    }
    if (operation === "reviewAudit") {
      return { ok: true, requestId: currentRequestId, data: audits.map(cloneJson) };
    }
    throw new LocalPreviewError("INVALID_INPUT", "Operación local no reconocida", 404);
  }

  const configuredIndexHtml = injectLocalConfiguration(indexHtml, safeDocumentId);

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/healthz") {
      writeResponse(response, 200, JSON.stringify({ ok: true, mode: "LOCAL_RASTER_REVIEW", documentId: safeDocumentId }), "application/json; charset=utf-8");
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/local-preview.html")) {
      writeResponse(response, 200, previewHtml, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/Index.html") {
      writeResponse(response, 200, configuredIndexHtml, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api") {
      try {
        assertLocalApiRequest(request);
        const body = await readJsonBody(request);
        const envelope = await dispatch(body.action, body.payload, body.requestId);
        writeResponse(response, 200, JSON.stringify(envelope), "application/json; charset=utf-8");
      } catch (error) {
        const failure = safeError(error);
        writeResponse(response, failure.status, JSON.stringify({ ok: false, requestId: requestId(), error: failure.error }), "application/json; charset=utf-8");
      }
      return;
    }
    writeResponse(response, 404, "No encontrado", "text/plain; charset=utf-8");
  }

  return Object.freeze({
    documentId: safeDocumentId,
    mode: "LOCAL_RASTER_REVIEW",
    dispatch,
    handleRequest,
    reviewCount: rows.size,
    evidenceCount: extraction.crops.length
  });
}

export async function startLocalReviewPreview({ host = "127.0.0.1", port = 4173, ...options } = {}) {
  if (!ALLOWED_HOSTS.has(host)) throw new TypeError("El preview local sólo puede escuchar en loopback");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("port debe ser un entero entre 0 y 65535");
  const application = await createLocalReviewApplication(options);
  const server = createServer(application.handleRequest);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const effectivePort = typeof address === "object" && address ? address.port : port;
  return Object.freeze({
    ...application,
    server,
    url: `http://${host}:${effectivePort}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  });
}

export { DEFAULT_DOCUMENT_ID, DEFAULT_PATHS, LocalPreviewError };
