#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startDc3PreviewServer } from "../../packages/dc3/testing/preview-server.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_CONFIG = "config/dc3-generator.example.json";
const DEFAULT_PORT = 4175;

function parseArguments(argv) {
  const options = { configPath: DEFAULT_CONFIG, port: DEFAULT_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--config") {
      if (!value || value.startsWith("--")) throw new Error("Falta valor para --config");
      options.configPath = value;
      index += 1;
    } else if (argument === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new TypeError("--port debe estar entre 1024 y 65535");
      }
      options.port = port;
      index += 1;
    } else throw new Error(`Argumento desconocido: ${argument}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const preview = await startDc3PreviewServer({
    port: options.port,
    projectRoot: PROJECT_ROOT,
    configPath: options.configPath
  });
  const state = preview.state();
  process.stdout.write(`Banco de pruebas DC-3: ${preview.url}\n`);
  process.stdout.write(`  Configuración: ${state.configPath} · corte ${state.cutoffDate}\n`);
  process.stdout.write(
    state.realSourcesAvailable
      ? `  Fuentes reales presentes: el plan corre en sólo lectura y publica sólo conteos y hashes.\n`
      : "  Fuentes reales ausentes: sólo está disponible el ensayo sintético.\n"
  );
  process.stdout.write(`  Plantilla para la vista previa: ${state.template.origin} (${state.template.name})\n`);
  process.stdout.write("La emisión real sigue siendo npm run dc3:generate. Use Ctrl+C para detenerlo.\n");
  return preview;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
