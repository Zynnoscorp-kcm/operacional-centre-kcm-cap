#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { startLocalKioskPreview } from "../src/apps-script/testing/platform-preview-server.js";

function parsePort(argv) {
  const index = argv.indexOf("--port");
  if (index === -1) return 4174;
  const port = Number(argv[index + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new TypeError("--port debe estar entre 1024 y 65535");
  }
  return port;
}

export async function main(argv = process.argv.slice(2)) {
  const preview = await startLocalKioskPreview({ port: parsePort(argv) });
  process.stdout.write(`Preview de quiosco local disponible en ${preview.url}\n`);
  process.stdout.write("Use números sintéticos del 00001 al 00040. No se escriben recursos Google.\n");
  process.stdout.write("Use Ctrl+C para detenerlo.\n");
  return preview;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
