#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { startLocalReviewPreview } from "../src/ocr/review/local-preview-server.js";

function parsePort(argv) {
  const index = argv.indexOf("--port");
  if (index === -1) return 4173;
  const port = Number(argv[index + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new TypeError("--port debe estar entre 1024 y 65535");
  }
  return port;
}

export async function main(argv = process.argv.slice(2)) {
  const preview = await startLocalReviewPreview({ port: parsePort(argv) });
  process.stdout.write(`Preview OCR local disponible en ${preview.url}\n`);
  process.stdout.write("Use Ctrl+C para detenerlo; no se escriben recursos Google.\n");
  return preview;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
