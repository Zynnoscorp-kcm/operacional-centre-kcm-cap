import {
  OCR_DOCUMENT_PATH,
  OCR_HEALTH_PATH,
  OCR_WORKER_VERSION,
  OcrWorkerHttpError,
  authenticateOcrRequest,
  buildCompletedResponse,
  effectiveWorkerLimits,
  publicError,
  validateDocumentRequest,
  validateWorkerSecret
} from "./contract.js";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
});

function jsonResponse(status, payload) {
  const body = JSON.stringify(payload);
  return Object.freeze({
    status,
    headers: Object.freeze({ ...SECURITY_HEADERS, "Content-Length": String(Buffer.byteLength(body, "utf8")) }),
    body
  });
}

function elapsedMilliseconds(startedAt, now) {
  const elapsed = Math.max(0, Number(now()) - startedAt);
  return Math.min(120_000, Math.round(elapsed));
}

export function createOcrWorker({
  recognizeDocument,
  secret,
  now = Date.now,
  workerVersion = OCR_WORKER_VERSION,
  limits = {},
  allowedTemplateVersions
} = {}) {
  if (typeof recognizeDocument !== "function") throw new TypeError("recognizeDocument debe ser una funcion");
  if (typeof now !== "function") throw new TypeError("now debe ser una funcion");
  const safeSecret = validateWorkerSecret(secret);
  const effectiveLimits = effectiveWorkerLimits(limits);

  async function handle({ method, path, headers = {}, body = Buffer.alloc(0) } = {}) {
    if (method === "GET" && path === OCR_HEALTH_PATH) {
      return jsonResponse(200, Object.freeze({ status: "ok", workerVersion }));
    }
    if (path !== OCR_DOCUMENT_PATH) {
      return jsonResponse(404, Object.freeze({ error: Object.freeze({ code: "NOT_FOUND", message: "Recurso no encontrado", retryable: false }) }));
    }
    if (method !== "POST") {
      const response = jsonResponse(405, Object.freeze({
        error: Object.freeze({ code: "METHOD_NOT_ALLOWED", message: "Metodo no permitido", retryable: false })
      }));
      return Object.freeze({
        ...response,
        headers: Object.freeze({ ...response.headers, Allow: "POST" })
      });
    }

    try {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
      const authentication = authenticateOcrRequest({
        headers,
        rawBody,
        secret: safeSecret,
        nowMs: now(),
        limits: effectiveLimits
      });
      const request = validateDocumentRequest(authentication.bodyText, {
        limits: effectiveLimits,
        allowedTemplateVersions
      });
      if (request.requestId !== authentication.requestId) {
        throw new OcrWorkerHttpError(401, "UNAUTHORIZED", "La autenticacion del worker OCR no es valida");
      }
      const startedAt = Number(now());
      const recognition = await recognizeDocument(Object.freeze({
        bytes: Buffer.from(request.sourceBytes),
        mimeType: request.mimeType,
        templateVersion: request.templateVersion,
        requestId: request.requestId,
        documentId: request.documentId,
        sourceSha256: request.sourceSha256
      }));
      const completed = buildCompletedResponse({
        request,
        recognition,
        processingMs: elapsedMilliseconds(startedAt, now),
        workerVersion,
        limits: effectiveLimits
      });
      return Object.freeze({
        status: 200,
        headers: Object.freeze({ ...SECURITY_HEADERS, "Content-Length": String(Buffer.byteLength(completed.body, "utf8")) }),
        body: completed.body
      });
    } catch (error) {
      const sanitized = publicError(error);
      return jsonResponse(sanitized.status, sanitized.payload);
    }
  }

  return Object.freeze({ handle, maxRequestBytes: effectiveLimits.maxRequestBytes });
}
