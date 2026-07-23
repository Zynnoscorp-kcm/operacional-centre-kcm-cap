import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const KIOSK_HTML_PATH = `${PROJECT_ROOT}src/apps-script/web/Kiosk.html`;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_REGISTRATIONS = 40;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "::1"]);
const SYNTHETIC_TOKEN = "kcm-local-kiosk-token-synthetic-v1";

class LocalKioskPreviewError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "LocalKioskPreviewError";
    this.code = code;
    this.status = status;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredRequestId(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) {
    throw new LocalKioskPreviewError("INVALID_INPUT", "La solicitud local no tiene una correlación válida");
  }
  return text;
}

function requiredEmployeeId(value) {
  const text = String(value || "");
  if (!/^\d{5}$/.test(text)) {
    throw new LocalKioskPreviewError("INVALID_EMPLOYEE_ID", "El número debe contener exactamente cinco dígitos");
  }
  return text;
}

function syntheticRoster() {
  return new Map(Array.from({ length: MAX_REGISTRATIONS }, (_, index) => {
    const ordinal = index + 1;
    const employeeId = String(ordinal).padStart(5, "0");
    return [employeeId, Object.freeze({
      employeeId,
      displayName: `Persona ${String(ordinal).padStart(2, "0")}`,
      area: `Área sintética ${String(((ordinal - 1) % 4) + 1)}`
    })];
  }));
}

function responseHeaders(contentType) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": contentType,
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function writeResponse(response, status, body, contentType) {
  const bytes = Buffer.from(String(body));
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
      if (byteSize > MAX_BODY_BYTES) exceeded = true;
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceeded) {
        reject(new LocalKioskPreviewError("REQUEST_TOO_LARGE", "La solicitud local excede el límite", 413));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("invalid");
        resolve(parsed);
      } catch {
        reject(new LocalKioskPreviewError("INVALID_JSON", "La solicitud JSON no es válida"));
      }
    });
    request.on("error", () => reject(new LocalKioskPreviewError("REQUEST_ERROR", "No fue posible leer la solicitud")));
  });
}

function assertLocalRequest(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (contentType !== "application/json") {
    throw new LocalKioskPreviewError("UNSUPPORTED_MEDIA_TYPE", "La API local requiere application/json", 415);
  }
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(String(origin));
    const requestHost = String(request.headers.host || "");
    if (!ALLOWED_HOSTS.has(originUrl.hostname) || originUrl.host !== requestHost) throw new Error("cross-origin");
  } catch {
    throw new LocalKioskPreviewError("FORBIDDEN_ORIGIN", "El origen no está autorizado", 403);
  }
}

function safeFailure(error) {
  if (error instanceof LocalKioskPreviewError) {
    return { status: error.status, error: { code: error.code, message: error.message } };
  }
  return {
    status: 500,
    error: { code: "LOCAL_PREVIEW_ERROR", message: "No fue posible completar el registro local" }
  };
}

export async function createLocalKioskApplication({
  now = () => new Date(),
  initialRegistrations = [],
  htmlPath = KIOSK_HTML_PATH
} = {}) {
  const kioskHtml = await readFile(htmlPath, "utf8");
  const roster = syntheticRoster();
  const registrations = new Map();
  const completedRequests = new Map();
  const audits = [];
  const createdAt = new Date(now());
  if (Number.isNaN(createdAt.getTime())) throw new TypeError("now debe devolver una fecha válida");
  const expiresAt = new Date(createdAt.getTime() + 120 * 60000).toISOString();

  for (const value of initialRegistrations) {
    const employeeId = requiredEmployeeId(value);
    if (!roster.has(employeeId)) throw new TypeError("initialRegistrations sólo admite identidades sintéticas del preview");
    registrations.set(employeeId, { employeeId, requestId: "preview-initial" });
  }
  if (registrations.size > MAX_REGISTRATIONS) throw new TypeError("initialRegistrations excede el cupo local");

  function capacity() {
    return {
      maximum: MAX_REGISTRATIONS,
      registered: registrations.size,
      remaining: MAX_REGISTRATIONS - registrations.size,
      available: registrations.size < MAX_REGISTRATIONS
    };
  }

  function assertToken(value) {
    if (String(value || "") !== SYNTHETIC_TOKEN) {
      throw new LocalKioskPreviewError("UNAUTHORIZED", "Token de sesión inválido", 401);
    }
  }

  function participantReceipt(requestId) {
    return {
      ok: true,
      requestId,
      data: {
        received: true,
        message: "Solicitud recibida; la asistencia se confirmara durante el cotejo fisico"
      }
    };
  }

  async function dispatch(action, payload = {}, suppliedRequestId) {
    const operation = String(action || "");
    const requestId = requiredRequestId(suppliedRequestId || payload.requestId);
    assertToken(payload.token);
    if (operation === "kioskBootstrap") {
      return {
        ok: true,
        requestId,
        data: {
          sessionId: "session-kiosk-synthetic",
          sessionCode: "KCM-260722-KIOSK1",
          status: "ABIERTA",
          trainingId: "CAP-SINT-001",
          stationLabel: "Sala sintética · Equipo 01",
          expiresAt,
          availability: { maximum: MAX_REGISTRATIONS, available: capacity().available },
          acceptingRegistrations: capacity().available
        }
      };
    }
    if (operation !== "kioskRegister") {
      throw new LocalKioskPreviewError("INVALID_INPUT", "Operación local no reconocida", 404);
    }
    if (completedRequests.has(requestId)) return cloneJson(completedRequests.get(requestId));
    const employeeId = requiredEmployeeId(payload.employeeId);
    if (!capacity().available) {
      const fullReceipt = participantReceipt(requestId);
      completedRequests.set(requestId, fullReceipt);
      return cloneJson(fullReceipt);
    }
    const existing = registrations.get(employeeId);
    if (existing) {
      const envelope = participantReceipt(requestId);
      completedRequests.set(requestId, envelope);
      return cloneJson(envelope);
    }
    const employee = roster.get(employeeId);
    if (!employee) {
      const rejected = participantReceipt(requestId);
      completedRequests.set(requestId, rejected);
      return cloneJson(rejected);
    }
    registrations.set(employeeId, { employeeId, requestId });
    audits.push(Object.freeze({
      eventId: `audit-kiosk-${randomUUID()}`,
      timestamp: new Date(now()).toISOString(),
      actor: "KIOSK",
      role: "KIOSK",
      sessionId: "session-kiosk-synthetic",
      action: "DIGITAL_ATTENDANCE_CAPTURED",
      requestId,
      stationLabel: "Sala sintética · Equipo 01"
    }));
    const accepted = participantReceipt(requestId);
    completedRequests.set(requestId, accepted);
    return cloneJson(accepted);
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/healthz") {
      writeResponse(response, 200, JSON.stringify({
        ok: true,
        mode: "LOCAL_KIOSK_SYNTHETIC",
        registrations: registrations.size,
        maximum: MAX_REGISTRATIONS
      }), "application/json; charset=utf-8");
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/Kiosk.html")) {
      writeResponse(response, 200, kioskHtml, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api") {
      try {
        assertLocalRequest(request);
        const body = await readJsonBody(request);
        const envelope = await dispatch(body.action, body.payload, body.requestId);
        writeResponse(response, 200, JSON.stringify(envelope), "application/json; charset=utf-8");
      } catch (error) {
        const failure = safeFailure(error);
        writeResponse(response, failure.status, JSON.stringify({
          ok: false,
          requestId: `local-error-${randomUUID()}`,
          error: failure.error
        }), "application/json; charset=utf-8");
      }
      return;
    }
    writeResponse(response, 404, "No encontrado", "text/plain; charset=utf-8");
  }

  return Object.freeze({
    mode: "LOCAL_KIOSK_SYNTHETIC",
    dispatch,
    handleRequest,
    get registrationCount() { return registrations.size; },
    get auditCount() { return audits.length; },
    listAudit: () => audits.map(cloneJson)
  });
}

export async function startLocalKioskPreview({ host = "127.0.0.1", port = 4174, ...options } = {}) {
  if (!ALLOWED_HOSTS.has(host)) throw new TypeError("El preview de plataforma sólo puede escuchar en loopback");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("port debe ser un entero entre 0 y 65535");
  const application = await createLocalKioskApplication(options);
  const server = createServer(application.handleRequest);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const effectivePort = typeof address === "object" && address ? address.port : port;
  const formattedHost = host === "::1" ? "[::1]" : host;
  const baseUrl = `http://${formattedHost}:${effectivePort}/`;
  return Object.freeze({
    mode: application.mode,
    dispatch: application.dispatch,
    handleRequest: application.handleRequest,
    listAudit: application.listAudit,
    get registrationCount() { return application.registrationCount; },
    get auditCount() { return application.auditCount; },
    server,
    baseUrl,
    url: `${baseUrl}?view=kiosk#kioskToken=${encodeURIComponent(SYNTHETIC_TOKEN)}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  });
}

export { KIOSK_HTML_PATH, LocalKioskPreviewError, MAX_REGISTRATIONS };
