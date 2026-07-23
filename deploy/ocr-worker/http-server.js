import { createServer } from "node:http";

function readRequestBody(request, maximumBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      const error = new Error("REQUEST_TOO_LARGE");
      error.code = "REQUEST_TOO_LARGE";
      request.resume();
      reject(error);
      return;
    }
    const chunks = [];
    let received = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > maximumBytes) {
        const error = new Error("REQUEST_TOO_LARGE");
        error.code = "REQUEST_TOO_LARGE";
        settled = true;
        chunks.length = 0;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

const TOO_LARGE = JSON.stringify({
  error: { code: "REQUEST_TOO_LARGE", message: "La solicitud OCR excede el limite permitido", retryable: false }
});

export function createOcrHttpServer(worker) {
  if (!worker || typeof worker.handle !== "function" || !Number.isInteger(worker.maxRequestBytes)) {
    throw new TypeError("worker no es valido");
  }
  return createServer(async (request, response) => {
    try {
      const body = request.method === "POST"
        ? await readRequestBody(request, worker.maxRequestBytes)
        : Buffer.alloc(0);
      const result = await worker.handle({
        method: request.method,
        path: new URL(request.url ?? "/", "http://worker.invalid").pathname,
        headers: request.headers,
        body
      });
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch (error) {
      const tooLarge = error?.code === "REQUEST_TOO_LARGE";
      const body = tooLarge
        ? TOO_LARGE
        : JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "No fue posible completar la solicitud", retryable: false } });
      if (!response.headersSent) {
        response.writeHead(tooLarge ? 413 : 500, {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(Buffer.byteLength(body, "utf8")),
          "X-Content-Type-Options": "nosniff"
        });
      }
      response.end(body);
    }
  });
}
